#!/bin/bash
{
  echo '{"execute":"qmp_capabilities"}'
  sleep 0.3
  echo '{"execute":"screendump","arguments":{"filename":"/tmp/winscreen.ppm"}}'
  sleep 1.5
} | nc -q 2 127.0.0.1 4445
ls -lh /tmp/winscreen.ppm
which convert || echo "no convert"
cp /tmp/winscreen.ppm /mnt/e/gh/vmui/diag-winscreen.ppm
pkill -9 vncsnapshot 2>/dev/null; echo cleaned
