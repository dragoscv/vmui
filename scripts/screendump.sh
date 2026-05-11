{ echo '{"execute":"qmp_capabilities"}'; sleep 0.3; echo '{"execute":"screendump","arguments":{"filename":"/tmp/winscreen.ppm"}}'; sleep 1; } | nc -q 2 127.0.0.1 4445 >/dev/null
ls -lh /tmp/winscreen.ppm
convert /tmp/winscreen.ppm /mnt/e/gh/vmui/diag-vmscreen.jpg
ls -lh /mnt/e/gh/vmui/diag-vmscreen.jpg
echo === t0 qcow ===
ls -lh /home/dragos/vmui-vms/win/Win11.qcow2
sleep 60
echo === t+60 qcow ===
ls -lh /home/dragos/vmui-vms/win/Win11.qcow2
{ echo '{"execute":"qmp_capabilities"}'; sleep 0.3; echo '{"execute":"screendump","arguments":{"filename":"/tmp/winscreen2.ppm"}}'; sleep 1; } | nc -q 2 127.0.0.1 4445 >/dev/null
convert /tmp/winscreen2.ppm /mnt/e/gh/vmui/diag-vmscreen2.jpg
ls -lh /mnt/e/gh/vmui/diag-vmscreen2.jpg
echo === query-status ===
{ echo '{"execute":"qmp_capabilities"}'; sleep 0.3; echo '{"execute":"query-status"}'; sleep 0.3; } | nc -q 2 127.0.0.1 4445