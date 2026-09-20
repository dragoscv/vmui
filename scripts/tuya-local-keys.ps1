<#
.SYNOPSIS
  Fetch Tuya local_keys for every device on the account and store them in
  .private/tuya-devices.json (never printed).

.DESCRIPTION
  Needs a Tuya IoT Platform cloud project linked to the Smart Life account:
    iot.tuya.com -> Cloud -> Create project (Smart Home, Central Europe)
    -> Devices -> Link App Account -> scan QR with Smart Life
    -> Overview: Access ID / Access Secret.
  Put them in .private/credentials.env as TUYA_ACCESS_ID / TUYA_ACCESS_SECRET.

  Local control (tinytuya) then needs only the id + local_key + IP from the
  written file. Used by ambilight/tuya_bar_bridge.py for the Desk Light Bar,
  whose firmware has no "colour" work_mode, so HA cannot set its colour.
#>
$ErrorActionPreference = 'Stop'
$Root = Split-Path $PSScriptRoot -Parent
. (Join-Path $PSScriptRoot 'lib\guest-credentials.ps1') | Out-Null
foreach ($k in 'TUYA_ACCESS_ID', 'TUYA_ACCESS_SECRET') {
    if (-not (Get-Item "env:$k" -ErrorAction SilentlyContinue).Value) { throw "$k missing in .private\credentials.env" }
}
$out = Join-Path $Root '.private\tuya-devices.json'
$py = @'
import json, os, sys, tinytuya
c = tinytuya.Cloud(apiRegion="eu", apiKey=os.environ["TUYA_ACCESS_ID"], apiSecret=os.environ["TUYA_ACCESS_SECRET"])
devs = c.getdevices(verbose=False)
if not isinstance(devs, list):
    print("cloud error:", json.dumps(devs)[:300], file=sys.stderr); sys.exit(1)
lan = tinytuya.deviceScan(False, 6)
by_id = { (d.get("gwId") or d.get("id")): (ip, d.get("version")) for ip, d in lan.items() }
rows = []
for d in devs:
    ip, ver = by_id.get(d["id"], (None, None))
    rows.append({"id": d["id"], "name": d.get("name"), "product_id": d.get("product_id"), "local_key": d.get("key"), "ip": ip, "version": ver})
json.dump(rows, open(sys.argv[1], "w", encoding="utf-8"), indent=2)
for r in rows:
    print(f'  {r["name"]:30} id={r["id"]} ip={r["ip"] or "-":15} v{r["version"] or "?"} key={"yes" if r["local_key"] else "NO"}')
'@
$tmp = Join-Path $env:TEMP 'tuya-keys.py'
Set-Content $tmp $py -Encoding utf8
python $tmp $out
Remove-Item $tmp
Write-Host "  written $out (gitignored)" -ForegroundColor Green
