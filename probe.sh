(
  cd /tmp
  rm -rf isoprobe
  mkdir isoprobe
  cd isoprobe
  7z x -y ~/vmui-vms/win/Win11.iso "sources/install.wim" "sources/install.esd" "efi/microsoft/boot/efisys*.bin" 2>&1 | tail -20
  echo ===FILES===
  find . -type f | head
  for f in sources/install.wim sources/install.esd; do
    if [ -f "$f" ]; then
      echo "=== EDITIONS in $f ==="
      wimlib-imagex info "$f" | grep -E "Index|Name|Edition|Description" | head -60
    fi
  done
  echo ===EFISYS===
  ls -la efi/microsoft/boot/ 2>/dev/null
) > /tmp/taskA.log 2>&1 &
PIDA=$!

(
  set +e
  ua="Mozilla/5.0 (X11; Linux x86_64; rv:120.0) Gecko/20100101 Firefox/120.0"
  page=$(curl -sSL -A "$ua" --max-filesize 2M "https://www.microsoft.com/en-us/evalcenter/download-windows-11-enterprise" 2>&1)
  echo "$page" | wc -c
  echo "=== FWLINKS ==="
  echo "$page" | grep -oE "https://go\.microsoft\.com/fwlink/[^\"]+" | head -10
  echo "=== ALT LINKS ==="
  echo "$page" | grep -oE "https://software[^\"]*\.microsoft\.com[^\"]+\.iso[^\"]*" | head -5
  echo "=== TITLE ==="
  echo "$page" | grep -oE "<title>[^<]+</title>" | head -1
) > /tmp/taskB.log 2>&1 &
PIDB=$!

wait $PIDA $PIDB
echo "########## TASK A ##########"
cat /tmp/taskA.log
echo "########## TASK B ##########"
cat /tmp/taskB.log
