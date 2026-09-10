#requires -version 7
<#
.SYNOPSIS
  Configure a freshly onboarded Home Assistant: add-ons, Tailscale, proxy trust.

.DESCRIPTION
  Everything here is idempotent and driven by the Supervisor REST API rather
  than the web UI, so a rebuilt appliance can be brought back to the same
  state without clicking through twelve dialogs.

  Ordering matters and is not obvious:

    1. Trust the reverse proxy FIRST. Tailscale Serve terminates TLS and
       forwards to 127.0.0.1, so Home Assistant sees every request as coming
       from localhost. Without use_x_forwarded_for + trusted_proxies it
       answers 400 "Forbidden request" and the symptom looks like a Tailscale
       fault rather than an HA setting.
    2. Install and start the Tailscale add-on.
    3. Authenticate it with a tagged, pre-authorised, single-use key so the
       node lands on tag:appliance and matches the ACL.
    4. Only then enable Serve, which needs the node to exist before it can
       request a certificate for its name.

  Credentials come from .private/credentials.env: HA_URL, HA_TOKEN (a
  long-lived access token) and the TS_HOME_OAUTH_* pair used to mint the key.

.EXAMPLE
  ha-configure.ps1 -All
  ha-configure.ps1 -TrustProxy
  ha-configure.ps1 -InstallAddons
  ha-configure.ps1 -ConnectTailscale
#>
[CmdletBinding(DefaultParameterSetName = 'Status')]
param(
    [Parameter(ParameterSetName = 'Status')][switch]$Status,
    [Parameter(Mandatory, ParameterSetName = 'All')][switch]$All,
    [Parameter(Mandatory, ParameterSetName = 'Proxy')][switch]$TrustProxy,
    [Parameter(Mandatory, ParameterSetName = 'Addons')][switch]$InstallAddons,
    [Parameter(Mandatory, ParameterSetName = 'Tail')][switch]$ConnectTailscale,
    [Parameter(Mandatory, ParameterSetName = 'Serve')][switch]$EnableServe,
    # Issue a Let's Encrypt certificate for HA_PUBLIC_DOMAIN via DNS challenge
    # against Vercel DNS, and make Home Assistant itself serve HTTPS on 443
    # with it. Tailscale Serve only ever certifies *.ts.net, so a custom
    # domain needs its own certificate.
    [Parameter(Mandatory, ParameterSetName = 'Domain')][switch]$PublishDomain,
    # Extra add-ons beyond the defaults. Slugs are "<repo>_<name>".
    [string[]]$Addon
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'lib\guest-credentials.ps1')

if (-not $env:HA_URL -or -not $env:HA_TOKEN) {
    throw 'HA_URL / HA_TOKEN missing from .private\credentials.env'
}
$script:Base = $env:HA_URL.TrimEnd('/')
$script:Headers = @{ Authorization = "Bearer $env:HA_TOKEN" }

function Write-Step($m) { Write-Host "  $m" -ForegroundColor Cyan }
function Write-Ok($m) { Write-Host "  $m" -ForegroundColor Green }
function Write-Warn($m) { Write-Host "  $m" -ForegroundColor Yellow }

function Invoke-Ha {
    param([string]$Path, [string]$Method = 'GET', $Body)
    $uri = "$script:Base$Path"
    if ($null -eq $Body) {
        return Invoke-RestMethod -Method $Method -Uri $uri -Headers $script:Headers
    }
    Invoke-RestMethod -Method $Method -Uri $uri -Headers $script:Headers `
        -Body ($Body | ConvertTo-Json -Depth 10 -Compress) -ContentType 'application/json'
}

# Reaching the Supervisor from OUTSIDE the appliance is the awkward part.
#
# Measured on HAOS 18.2 / Supervisor 2026.09.0: the REST proxy at
# /api/hassio/... returns 401 for a long-lived access token. It only accepts
# a SUPERVISOR_TOKEN, which exists solely inside an add-on container. The
# WebSocket command `supervisor/api` accepts the same long-lived token
# happily, so that is the only externally usable route -- and it is what the
# HA frontend itself uses.
#
# Also measured, and contrary to every guide written before HAOS 18: the core
# listens on port 80, not 8123 (`/core/info` reports port 80). A probe of
# 8123 fails while the UI works, which reads exactly like a crashed instance.
function Invoke-Supervisor {
    param([string]$Path, [string]$Method = 'get', $Body)

    $msg = @{
        id       = ++$script:WsId
        type     = 'supervisor/api'
        endpoint = $Path
        method   = $Method.ToLower()
    }
    if ($Body) { $msg.data = $Body }
    Send-HaWs -Message $msg
}

# Minimal synchronous WebSocket client. The HA protocol is:
#   server: auth_required -> client: auth -> server: auth_ok -> commands.
function Send-HaWs {
    param([hashtable]$Message)

    $wsUri = [Uri](($script:Base -replace '^http', 'ws') + '/api/websocket')
    $ws = [Net.WebSockets.ClientWebSocket]::new()
    $cts = [Threading.CancellationTokenSource]::new([TimeSpan]::FromSeconds(120))
    try {
        $ws.ConnectAsync($wsUri, $cts.Token).GetAwaiter().GetResult()

        function Receive-Json {
            $buf = [byte[]]::new(65536)
            $sb = [Text.StringBuilder]::new()
            do {
                $seg = [ArraySegment[byte]]::new($buf)
                $r = $ws.ReceiveAsync($seg, $cts.Token).GetAwaiter().GetResult()
                [void]$sb.Append([Text.Encoding]::UTF8.GetString($buf, 0, $r.Count))
            } while (-not $r.EndOfMessage)
            $sb.ToString() | ConvertFrom-Json
        }
        function Send-Json($obj) {
            $json = $obj | ConvertTo-Json -Depth 20 -Compress
            $bytes = [Text.Encoding]::UTF8.GetBytes($json)
            $ws.SendAsync([ArraySegment[byte]]::new($bytes),
                [Net.WebSockets.WebSocketMessageType]::Text, $true, $cts.Token).GetAwaiter().GetResult()
        }

        $hello = Receive-Json
        if ($hello.type -ne 'auth_required') { throw "unexpected greeting: $($hello.type)" }
        Send-Json @{ type = 'auth'; access_token = $env:HA_TOKEN }
        $auth = Receive-Json
        if ($auth.type -ne 'auth_ok') { throw "websocket auth failed: $($auth.message)" }

        Send-Json $Message
        # Skip any event frames that arrive before our reply.
        do { $reply = Receive-Json } while ($reply.id -ne $Message.id)
        if (-not $reply.success) {
            throw "supervisor $($Message.endpoint): $($reply.error.message)"
        }
        return $reply.result
    }
    finally {
        if ($ws.State -eq 'Open') {
            $ws.CloseAsync('NormalClosure', 'done', [Threading.CancellationToken]::None).GetAwaiter().GetResult()
        }
        $ws.Dispose(); $cts.Dispose()
    }
}
$script:WsId = 0

# POST /addons/<slug>/options REPLACES the entire options object. Sending a
# partial one makes the Supervisor reject it for whichever required key is
# missing -- and it reports only ONE missing key per attempt, so patching by
# trial and error takes as many round trips as there are options. Always read
# the current object, merge, and write the whole thing back.
function Set-AddonOptions {
    param([Parameter(Mandatory)][string]$Slug, [Parameter(Mandatory)][hashtable]$Patch)

    $cur = (Invoke-Supervisor "/addons/$Slug/info").options
    $merged = @{}
    foreach ($p in $cur.PSObject.Properties) { $merged[$p.Name] = $p.Value }
    foreach ($k in $Patch.Keys) { $merged[$k] = $Patch[$k] }
    Invoke-Supervisor "/addons/$Slug/options" -Method POST -Body @{ options = $merged } | Out-Null
}

# Add-ons installed by default. Each earns its place:
#   tailscale   -- the entire remote-access story
#   mosquitto   -- MQTT broker; Zigbee2MQTT, ESPHome and most DIY sensors
#                  expect one, and installing it later means reconfiguring them
#   file_editor -- edit automations.yaml without SSH into the appliance
#   samba       -- reach /config and /backup from Windows Explorer, which is
#                  how backups get copied off the VM
#   ssh         -- official Terminal & SSH. Key-only, port 22 on the LAN. It
#                  is the only way to run `tailscale up --authkey` and to edit
#                  configuration.yaml from a script; everything else in this
#                  file could be done through the API, this could not.
$DefaultAddons = @(
    @{ slug = 'a0d7b954_tailscale'; name = 'Tailscale' }
    @{ slug = 'core_mosquitto'; name = 'Mosquitto broker' }
    @{ slug = 'core_configurator'; name = 'File editor' }
    @{ slug = 'core_samba'; name = 'Samba share' }
    @{ slug = 'core_ssh'; name = 'Terminal & SSH' }
)

# Samba refuses to start without a password, and the Supervisor reports that
# as a generic "invalid options" failure at START time rather than at install
# time -- so the add-on looks installed-but-broken. Seed it before starting.
function Set-AddonPrerequisites {
    param([string]$Slug)
    switch ($Slug) {
        'core_samba' {
            if (-not $env:HA_SAMBA_PASS) {
                Write-Warn 'HA_SAMBA_PASS not set; skipping Samba configuration'
                return
            }
            Set-AddonOptions -Slug 'core_samba' -Patch @{
                username = 'homeassistant'
                password = $env:HA_SAMBA_PASS
            }
            Write-Ok 'Samba credentials set'
        }
        'core_ssh' {
            $pub = Join-Path $HOME '.ssh\id_ed25519.pub'
            if (-not (Test-Path $pub)) {
                Write-Warn "no $pub -- SSH add-on left without a key"
                return
            }
            # Key-only. An empty password disables password auth entirely.
            Set-AddonOptions -Slug 'core_ssh' -Patch @{
                authorized_keys = @((Get-Content $pub -Raw).Trim())
                password        = ''
            }
            # The add-on ships with its port UNMAPPED ("22/tcp": null), so it
            # starts fine and is unreachable. Publish it on the host side. A
            # network change only takes effect on restart, and the Supervisor
            # does not restart for it the way it does for options.
            $net = (Invoke-Supervisor '/addons/core_ssh/info').network
            if ($net.'22/tcp' -ne 22) {
                Invoke-Supervisor '/addons/core_ssh/options' -Method POST -Body @{ network = @{ '22/tcp' = 22 } } | Out-Null
                try { Invoke-Supervisor '/addons/core_ssh/restart' -Method POST | Out-Null } catch { }
            }
            Write-Ok 'SSH add-on: host key authorised, password auth off'
        }
    }
}

function Set-ProxyTrust {
    Write-Step 'checking reverse-proxy trust...'
    # Without this, Tailscale Serve forwards to 127.0.0.1 and Home Assistant
    # rejects every proxied request with 400, logging "A request from a
    # reverse proxy was received from 127.0.0.1, but your HTTP integration is
    # not set-up for reverse proxies". It reads as a Tailscale fault; it is not.
    #
    # MEASURED on HA 2026.9.1: an `http:` block in configuration.yaml is
    # IGNORED. The http integration migrated to UI-managed settings
    # (.storage/http, "yaml_migration_done": true) and every guide written
    # before that is now wrong. Two restarts and a clean YAML parse changed
    # nothing; patching .storage/http fixed it on the first restart.
    #
    # .storage lives under /mnt/data/supervisor/homeassistant on the HOST OS,
    # reachable only over the port-22222 developer SSH -- the port-22 add-on
    # sees /homeassistant but jq is not guaranteed there. Enable 22222 with
    # `homeassistant.ps1 -EnableHostSsh`.
    $cfg = Invoke-Ha '/api/config'
    Write-Ok "connected to $($cfg.location_name) -- HA $($cfg.version)"

    $host22222 = "root@$($script:Base -replace '^https?://','')"
    $store = '/mnt/data/supervisor/homeassistant/.storage/http'
    $probe = ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new -p 22222 $host22222 `
        "jq -r '.data.stable.use_x_forwarded_for // false' $store" 2>$null
    if ($probe -notin 'true', 'false') {
        Write-Warn 'cannot reach the host OS on port 22222; run homeassistant.ps1 -EnableHostSsh first'
        return
    }
    if ($probe -eq 'true') {
        Write-Ok 'reverse proxy already trusted'
        return
    }

    Write-Step 'enabling X-Forwarded-For + trusted proxy 127.0.0.1 in .storage/http...'
    # 127.0.0.1 is Tailscale Serve (host network). 172.30.32.0/23 is the
    # Supervisor's add-on network -- the NGINX proxy add-on (172.30.33.x)
    # arrives from there, and HA answers it 400 until it is trusted.
    $jq = '.data.stable.use_x_forwarded_for = true | .data.stable.trusted_proxies = ["127.0.0.1","::1","172.30.32.0/23"]'
    ssh -o BatchMode=yes -p 22222 $host22222 `
        "cp $store $store.bak && jq '$jq' $store > /tmp/http.new && mv /tmp/http.new $store" | Out-Null
    if ($LASTEXITCODE -ne 0) { Write-Warn 'failed to patch .storage/http'; return }
    Write-Ok 'written (backup at .storage/http.bak); restarting core...'
    try { Invoke-Supervisor '/core/restart' -Method POST | Out-Null } catch { }
    Write-Warn 'core takes ~50s to come back; -EnableServe will refuse until it does'
}

function Install-Addons {
    # The WebSocket route returns the payload directly; the REST proxy wrapped
    # it in .data. Do not reintroduce that unwrap.
    $store = (Invoke-Supervisor '/store/addons').addons
    $installed = (Invoke-Supervisor '/addons').addons

    $wanted = @($DefaultAddons)
    foreach ($a in $Addon) { $wanted += @{ slug = $a; name = $a } }

    foreach ($w in $wanted) {
        $have = $installed | Where-Object slug -eq $w.slug
        if ($have) {
            Write-Ok "$($w.name) already installed ($($have.version))"
        }
        else {
            $avail = $store | Where-Object slug -eq $w.slug
            if (-not $avail) {
                Write-Warn "$($w.name) [$($w.slug)] not in the store -- skipping"
                continue
            }
            Write-Step "installing $($w.name)..."
            # Installation pulls a container image; on a cold appliance this
            # is minutes, not seconds.
            Invoke-Supervisor "/addons/$($w.slug)/install" -Method POST | Out-Null
            Write-Ok "$($w.name) installed"
        }

        $info = Invoke-Supervisor "/addons/$($w.slug)/info"
        Set-AddonPrerequisites -Slug $w.slug
        # "startup" means it is already coming up; issuing start again returns
        # a failure with an EMPTY error message, which reads like a real fault.
        if ($info.state -notin 'started', 'startup') {
            Write-Step "starting $($w.name)..."
            try { Invoke-Supervisor "/addons/$($w.slug)/start" -Method POST | Out-Null }
            catch { Write-Warn "start returned: $($_.Exception.Message.Trim()) -- checking state" }
        }
        # Survive a reboot of the host. The whole point of an appliance is
        # that nobody has to remember to start it.
        if (-not $info.boot -or $info.boot -ne 'auto') {
            Invoke-Supervisor "/addons/$($w.slug)/options" -Method POST -Body @{ boot = 'auto' } | Out-Null
        }
    }
}

function Connect-Tailscale {
    $slug = 'a0d7b954_tailscale'
    $info = Invoke-Supervisor "/addons/$slug/info"
    if (-not $info) { throw 'Tailscale add-on is not installed; run -InstallAddons first' }

    Write-Step 'configuring Tailscale add-on...'
    # ORDER MATTERS, and getting it wrong kills the add-on rather than
    # producing a warning. `share_homeassistant: serve` starts an s6 service
    # that asks Tailscale for a TLS certificate. On a node that has never
    # logged in there is no tailnet to ask, the service exits 1, and s6 tears
    # the whole container down:
    #     unable to start service share-homeassistant: command exited 1
    #     rc.init: fatal: stopping the container
    # The add-on then sits in state "error" and its ingress UI returns 502 --
    # which looks like a broken add-on, not a configuration ordering problem.
    #
    # So: tags and DNS now, Serve only after the node is up (see -EnableServe).
    Set-AddonOptions -Slug $slug -Patch @{
        accept_dns           = $true
        accept_routes        = $false
        advertise_tags       = @('tag:appliance')
        userspace_networking = $false
        taildrop             = $true
    }
    Write-Ok 'options applied'
    # An empty error message here means the add-on was already restarting --
    # the options POST triggers one on its own. Not a failure.
    try { Invoke-Supervisor "/addons/$slug/restart" -Method POST | Out-Null }
    catch { Write-Warn "restart: $($_.Exception.Message.Trim()) (already restarting)" }
    Write-Ok 'add-on restarting'

    Write-Host ''
    Write-Warn 'The add-on must now be authenticated ONCE:'
    Write-Host '    Settings -> Add-ons -> Tailscale -> Open Web UI -> Log In' -ForegroundColor DarkGray
    Write-Host '  then, and only then:' -ForegroundColor DarkGray
    Write-Host '    scripts\ha-configure.ps1 -EnableServe' -ForegroundColor DarkGray
}

function Enable-Serve {
    $slug = 'a0d7b954_tailscale'
    # Two preconditions, both of which the add-on checks itself and, on
    # failure, exits its share-homeassistant service with code 1 and NO
    # message at log level info -- taking the whole container down to state
    # "error" and a 502 on its UI. Check them here so the failure has a name.
    # Write-Host output is not pipeline text; capture via a child pwsh so it
    # arrives as strings that can actually be matched.
    $listing = pwsh -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'tailscale-home.ps1') 2>&1 | Out-String
    if ($listing -notmatch '(?m)^\s*homeassistant\s+100\.') {
        Write-Warn 'homeassistant is not in the tailnet yet -- log the add-on in first.'
        return
    }
    $host22222 = "root@$($script:Base -replace '^https?://','')"
    $xff = ssh -o BatchMode=yes -p 22222 $host22222 `
        'docker exec app_a0d7b954_tailscale curl -s -o /dev/null -w "%{http_code}" -H "X-Forwarded-For: 127.0.0.1" http://127.0.0.1:80' 2>$null
    if ($xff -ne '200') {
        Write-Warn "reverse-proxy probe returned '$xff', need 200 -- run -TrustProxy and wait for core to restart"
        return
    }
    Set-AddonOptions -Slug $slug -Patch @{ share_homeassistant = 'serve'; share_on_port = 443 }
    try { Invoke-Supervisor "/addons/$slug/restart" -Method POST | Out-Null } catch { }
    Write-Ok 'Serve enabled -- https://homeassistant.taild1532d.ts.net'
}

function Publish-Domain {
    foreach ($v in 'HA_PUBLIC_DOMAIN', 'VERCEL_API_TOKEN', 'VERCEL_TEAM_ID') {
        if (-not (Get-Item "env:$v" -ErrorAction SilentlyContinue).Value) { throw "$v missing from .private\credentials.env" }
    }
    $domain = $env:HA_PUBLIC_DOMAIN
    $slug = 'core_letsencrypt'

    $installed = (Invoke-Supervisor '/addons').addons | Where-Object slug -eq $slug
    if (-not $installed) {
        Write-Step "installing Let's Encrypt add-on..."
        Invoke-Supervisor "/addons/$slug/install" -Method POST | Out-Null
    }

    # dns-lego is the generic provider; Vercel is not a first-class certbot
    # plugin but lego supports it natively. Provider credentials go in
    # `lego_env` as KEY=value strings -- any other key name is silently
    # DROPPED by the Supervisor's schema, and lego then fails with a
    # credential error that points nowhere near the config.
    # VERCEL_API_TOKEN must belong to a member of VERCEL_TEAM_ID, which must
    # own the zone.
    Write-Step "configuring DNS challenge for $domain via Vercel..."
    Set-AddonOptions -Slug $slug -Patch @{
        domains   = @($domain)
        email     = 'vladulescu.catalin@gmail.com'
        keyfile   = 'privkey.pem'
        certfile  = 'fullchain.pem'
        challenge = 'dns'
        dns       = @{
            provider            = 'dns-lego'
            lego_provider       = 'vercel'
            propagation_seconds = 90
            lego_env            = @(
                "VERCEL_API_TOKEN=$env:VERCEL_API_TOKEN"
                "VERCEL_TEAM_ID=$env:VERCEL_TEAM_ID"
            )
        }
    }
    # The add-on maps 80/tcp for the HTTP challenge. Home Assistant already
    # owns port 80 on this host, so a DNS-challenge run refuses to start with
    # "port 80 is already in use" unless the mapping is removed.
    $net = (Invoke-Supervisor "/addons/$slug/info").network
    if ($null -ne $net.'80/tcp') {
        Invoke-Supervisor "/addons/$slug/options" -Method POST -Body @{ network = @{ '80/tcp' = $null } } | Out-Null
    }

    $host22222 = "root@$($script:Base -replace '^https?://','')"
    $certPath = '/mnt/data/supervisor/ssl/fullchain.pem'
    $have = ssh -o BatchMode=yes -p 22222 $host22222 "test -s $certPath && echo YES || echo NO" 2>$null
    if ($have -eq 'YES') {
        # certbot is idempotent and logs "Certificate not yet due for renewal;
        # no action taken." Waiting in a loop for a file that already exists
        # burns four minutes and then reports failure.
        Write-Ok 'certificate already present'
    }
    else {
        # The add-on runs once and exits; it is not a daemon. A start is a
        # request, and the log says whether it was granted.
        Write-Step 'requesting certificate (30-120s)...'
        try { Invoke-Supervisor "/addons/$slug/start" -Method POST | Out-Null } catch { }
        $deadline = (Get-Date).AddMinutes(4)
        do {
            Start-Sleep 10
            $have = ssh -o BatchMode=yes -p 22222 $host22222 "test -s $certPath && echo YES || echo NO" 2>$null
        } while ($have -ne 'YES' -and (Get-Date) -lt $deadline)
    }
    if ($have -ne 'YES') {
        Write-Warn 'no certificate after 4 min. Add-on log:'
        ssh -o BatchMode=yes -p 22222 $host22222 'docker logs app_core_letsencrypt 2>&1 | tail -25'
        return
    }
    # HAOS has no openssl on the host. A throwaway alpine container is the
    # cheapest way to read the certificate without installing anything.
    $subj = ssh -o BatchMode=yes -p 22222 $host22222 `
        'docker run --rm -v /mnt/data/supervisor/ssl:/ssl:ro alpine:3 sh -c "apk add -q openssl; openssl x509 -in /ssl/fullchain.pem -noout -subject -enddate" 2>/dev/null' 2>$null
    Write-Ok "certificate: $($subj -join ' ')"

    # DO NOT put Home Assistant itself on 443.
    #
    # Measured, and it takes the whole instance down: Tailscale Serve already
    # binds 443. Setting server_port=443 in .storage/http makes core fail with
    #   [Errno 98] error while attempting to bind on address ('::', 443)
    # and, because http then fails to set up, EVERY dependent integration
    # fails with it -- frontend included. HA boots into recovery mode and the
    # UI is gone, which looks catastrophic and is caused by one port number.
    #
    # Correct layout, three listeners that do not overlap:
    #   core            :80    plain HTTP, localhost + LAN
    #   Tailscale Serve :8443  TLS for <node>.<tailnet>.ts.net (its own cert)
    #   NGINX proxy     :443   TLS for the custom domain (the LE cert above)
    # Serve only accepts 443, 8443 or 10000, which is why 8443 is the choice.
    Write-Step 'moving Tailscale Serve to 8443 to free 443...'
    Set-AddonOptions -Slug 'a0d7b954_tailscale' -Patch @{ share_on_port = 8443 }
    try { Invoke-Supervisor '/addons/a0d7b954_tailscale/restart' -Method POST | Out-Null } catch { }

    Write-Step 'installing NGINX SSL proxy for the custom domain...'
    $nginx = 'core_nginx_proxy'
    if (-not ((Invoke-Supervisor '/addons').addons | Where-Object slug -eq $nginx)) {
        Invoke-Supervisor "/addons/$nginx/install" -Method POST | Out-Null
    }
    Set-AddonOptions -Slug $nginx -Patch @{
        domain      = $domain
        certfile    = 'fullchain.pem'
        keyfile     = 'privkey.pem'
        hsts        = 'max-age=31536000; includeSubDomains'
        customize   = @{ active = $false; default = 'nginx_proxy_default*.conf'; servers = 'nginx_proxy/*.conf' }
    }
    Set-AddonOptions -Slug $nginx -Patch @{ boot = 'auto' }
    try { Invoke-Supervisor "/addons/$nginx/start" -Method POST | Out-Null } catch { }
    Write-Ok "NGINX proxy serving https://$domain on 443"

    # Renewal: the add-on only renews when started. A nightly restart from an
    # HA automation is the documented approach.
    $auto = @{
        alias       = 'Renew Let''s Encrypt certificate'
        description = 'Managed by scripts/ha-configure.ps1 -PublishDomain'
        triggers    = @(@{ trigger = 'time'; at = '04:30:00' })
        actions     = @(@{ action = 'hassio.addon_start'; data = @{ addon = $slug } })
        mode        = 'single'
    }
    try {
        Invoke-Ha '/api/config/automation/config/letsencrypt_renew' -Method POST -Body $auto | Out-Null
        Write-Ok 'nightly renewal automation created'
    }
    catch { Write-Warn "renewal automation: $($_.Exception.Message)" }
}

function Show-HaStatus {
    $cfg = Invoke-Ha '/api/config'
    Write-Host ''
    Write-Host '  home assistant' -ForegroundColor Cyan
    Write-Host ('  ' + ('-' * 62))
    Write-Host ("  {0,-14} {1}" -f 'name', $cfg.location_name)
    Write-Host ("  {0,-14} {1}" -f 'version', $cfg.version)
    Write-Host ("  {0,-14} {1}" -f 'url', $script:Base)
    Write-Host ("  {0,-14} {1}" -f 'timezone', $cfg.time_zone)

    $states = Invoke-Ha '/api/states'
    Write-Host ("  {0,-14} {1}" -f 'entities', @($states).Count)

    try {
        $addons = (Invoke-Supervisor '/addons').addons
        Write-Host ''
        Write-Host '  add-ons' -ForegroundColor Cyan
        foreach ($a in $addons | Sort-Object name) {
            Write-Host ("  {0,-22} {1,-10} {2}" -f $a.name, $a.state, $a.version) `
                -ForegroundColor $(if ($a.state -eq 'started') { 'Green' } else { 'Gray' })
        }
    }
    catch { Write-Warn 'supervisor not reachable through the proxy' }
    Write-Host ''
}

switch ($PSCmdlet.ParameterSetName) {
    'All' { Set-ProxyTrust; Install-Addons; Connect-Tailscale; Show-HaStatus }
    'Serve' { Enable-Serve }
    'Domain' { Publish-Domain }
    'Proxy' { Set-ProxyTrust }
    'Addons' { Install-Addons }
    'Tail' { Connect-Tailscale }
    default { Show-HaStatus }
}
