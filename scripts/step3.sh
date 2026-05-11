sleep 90
echo ===CPU ARG===
pgrep -af qemu | grep 4445 | head -1 | grep -oE 'Skylake[^ ]*'
echo ===QCOW===
ls -lh /home/dragos/vmui-vms/win/Win11.qcow2
echo ===QEMU LOG===
tail -80 /tmp/vmui-win.qemu.log
echo ===DMESG KVM===
sudo dmesg | grep -iE 'kvm|vmcs|vmx|VM-entry' | tail -50
echo ===QMP STATUS===
{ echo '{"execute":"qmp_capabilities"}'; sleep 0.3; echo '{"execute":"query-status"}'; sleep 0.3; } | nc -q 2 127.0.0.1 4445