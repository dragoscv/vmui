pkill -9 -f 'qemu-system-x86_64' 2>/dev/null
pkill -9 swtpm 2>/dev/null
sleep 3
echo ===PGREP===
pgrep -af qemu | head
echo ===RELOAD KVM===
sudo modprobe -r kvm_intel
sudo modprobe kvm_intel nested=1 dump_invalid_vmcs=1
echo "dump_invalid_vmcs=$(cat /sys/module/kvm_intel/parameters/dump_invalid_vmcs)"
echo "nested=$(cat /sys/module/kvm_intel/parameters/nested)"
echo ===DMESG CLEAR===
sudo dmesg -C
echo done