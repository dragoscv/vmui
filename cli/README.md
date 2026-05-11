# vmui-cli

Tiny Go binary that drives a vmui instance via its REST API. Useful for
shell automation, scripts, and CI.

## Build

```pwsh
cd cli
go build -o ../vmui-cli.exe .
```

Or cross-compile for Linux:

```sh
GOOS=linux GOARCH=amd64 go build -o vmui-cli .
```

## Configure

Create an API key in **Settings → API keys** with at least the `operator`
role, then export:

```pwsh
$env:VMUI_URL = "http://127.0.0.1:3737"   # optional, this is the default
$env:VMUI_API_KEY = "vmui_xxx..."
```

## Use

```pwsh
vmui-cli list
vmui-cli start    i-01234abcd
vmui-cli stop     westeurope/my-vm
vmui-cli reboot   us-central1-a/my-vm
vmui-cli snapshot i-01234abcd -label nightly-backup
vmui-cli terminate i-01234abcd
```

Instance IDs come from the `id` column shown by `vmui-cli list`.

## Exit codes

| Code | Meaning |
|------|---------|
| 0    | Success |
| 1    | API error or runtime failure |
| 2    | Usage error |
