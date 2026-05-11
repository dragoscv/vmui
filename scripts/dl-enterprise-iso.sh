#!/usr/bin/env bash
# vmui — download the Windows 11 Enterprise Evaluation ISO from Microsoft.
# Run in WSL (Ubuntu) before scripts/setup-win-vm.sh.
set -euo pipefail

VMDIR="${VMDIR:-$HOME/vmui-vms/win}"
URL='https://software-static.download.prss.microsoft.com/dbazure/888969d5-f34g-4e03-ac9d-1f9786c66749/26200.6584.250915-1905.25h2_ge_release_svc_refresh_CLIENTENTERPRISEEVAL_OEMRET_x64FRE_en-us.iso'
OUT="$VMDIR/Win11-Enterprise.iso"

mkdir -p "$VMDIR"
cd "$VMDIR"

if [ -f "$OUT" ]; then
  size=$(stat -c %s "$OUT")
  if [ "$size" -gt $((4 * 1024 * 1024 * 1024)) ]; then
    echo "Win11-Enterprise.iso already present (${size} bytes), skipping."
    exit 0
  fi
fi

echo "Downloading Windows 11 Enterprise Eval (25H2 en-us) → $OUT"
curl --location --fail --output "${OUT}.PART" --continue-at - "$URL"
mv "${OUT}.PART" "$OUT"
ls -lh "$OUT"
