#!/usr/bin/env bash
# vmui — first-time setup for the Windows 11 KVM guest.
#
# Run with:  wsl -d Ubuntu-24.04 -- bash /mnt/e/gh/vmui/scripts/setup-win-vm.sh
#
# What this does:
#   1. Installs QEMU + OVMF (with Microsoft Secure Boot keys) + swtpm + tooling.
#   2. Creates ~/vmui-vms/win and copies OVMF firmware files into it.
#   3. Creates Win11.qcow2 (200 GiB sparse) if it doesn't exist.
#   4. Downloads the latest VirtIO drivers ISO from Fedora's stable channel.
#   5. Builds autounattend.iso baking dragos:REDACTED_GUEST_PASSWORD as a local administrator
#      and bypassing TPM/SecureBoot/RAM checks (belt-and-braces — the host
#      provides real TPM 2.0 + Secure Boot, but the registry tweaks make the
#      installer happy on any Win11 build).
#   6. Tells the user where to drop the Windows 11 25H2 ISO.
set -euo pipefail

VMDIR="${VMDIR:-$HOME/vmui-vms/win}"
DISK_GB="${DISK_GB:-200}"
USERNAME="${WIN_USERNAME:-dragos}"
PASSWORD="${WIN_PASSWORD:-REDACTED_GUEST_PASSWORD}"
HOSTNAME_W="${WIN_HOSTNAME:-VMUI-WIN}"

VIRTIO_URL="https://fedorapeople.org/groups/virt/virtio-win/direct-downloads/stable-virtio/virtio-win.iso"

echo "=== [1/6] apt install qemu, ovmf, swtpm, isolinux tooling ==="
sudo apt-get update -qq
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq \
  qemu-system-x86 qemu-utils ovmf swtpm swtpm-tools \
  genisoimage xorriso curl ca-certificates 2>&1 | tail -5

mkdir -p "$VMDIR"
cd "$VMDIR"

echo
echo "=== [2/6] Copy OVMF firmware (Secure Boot enabled, Microsoft keys preloaded) ==="
# Ubuntu ships OVMF under /usr/share/OVMF. The MS-keyed VARS template is what
# lets Windows boot under Secure Boot without manual KEK enrollment.
SRC_CODE=""
for cand in \
  /usr/share/OVMF/OVMF_CODE_4M.secboot.fd \
  /usr/share/OVMF/OVMF_CODE.secboot.fd \
  /usr/share/OVMF/OVMF_CODE.fd; do
  if [ -f "$cand" ]; then SRC_CODE="$cand"; break; fi
done
SRC_VARS=""
for cand in \
  /usr/share/OVMF/OVMF_VARS_4M.ms.fd \
  /usr/share/OVMF/OVMF_VARS.ms.fd \
  /usr/share/OVMF/OVMF_VARS_4M.fd \
  /usr/share/OVMF/OVMF_VARS.fd; do
  if [ -f "$cand" ]; then SRC_VARS="$cand"; break; fi
done
if [ -z "$SRC_CODE" ] || [ -z "$SRC_VARS" ]; then
  echo "ERROR: OVMF firmware files not found under /usr/share/OVMF." >&2
  exit 1
fi
cp -f "$SRC_CODE" OVMF_CODE.secboot.fd
[ -f OVMF_VARS.fd ] || cp -f "$SRC_VARS" OVMF_VARS.fd
echo "  CODE: $SRC_CODE"
echo "  VARS: $SRC_VARS  → ./OVMF_VARS.fd"

echo
echo "=== [3/6] Create main disk Win11.qcow2 (${DISK_GB} GiB, sparse) ==="
if [ -f Win11.qcow2 ]; then
  echo "  exists, skipping"
else
  qemu-img create -f qcow2 -o nocow=on Win11.qcow2 "${DISK_GB}G"
fi

echo
echo "=== [4/6] Download VirtIO drivers ISO (stable channel) ==="
if [ -f virtio-win.iso ]; then
  echo "  exists, skipping"
else
  curl -L --fail -o virtio-win.iso.tmp "$VIRTIO_URL"
  mv virtio-win.iso.tmp virtio-win.iso
fi
ls -lh virtio-win.iso | awk '{print "  size:", $5}'

echo
echo "=== [5/6] Build autounattend.iso (user=$USERNAME, host=$HOSTNAME_W) ==="
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# autounattend.xml — covers WinPE (disk select) and OOBE (account creation).
# - <RunSynchronousCommand> in WinPE flips the LabConfig + OOBE registry keys
#   that disable TPM, Secure Boot, RAM, CPU, network and Microsoft-account
#   checks. This makes the installer succeed on any Win11 build (25H2 broke
#   the older oobe\BypassNRO trick).
# - <UserAccounts> creates a local admin "dragos" with the given password.
# - <AutoLogon> runs once so RDP + SSH can be enabled by the FirstLogonCommand
#   without the user having to log in via VNC first.
# - The OEM-key 'VK7JG-…' is the public Microsoft Pro generic key — it lets
#   Setup proceed past the edition picker on Pro media. Replace if you want
#   Home/Enterprise.
cat > "$WORK/autounattend.xml" <<XML
<?xml version="1.0" encoding="utf-8"?>
<unattend xmlns="urn:schemas-microsoft-com:unattend">
  <settings pass="windowsPE">
    <component name="Microsoft-Windows-International-Core-WinPE" processorArchitecture="amd64" publicKeyToken="31bf3856ad364e35" language="neutral" versionScope="nonSxS" xmlns:wcm="http://schemas.microsoft.com/WMIConfig/2002/State">
      <SetupUILanguage><UILanguage>en-US</UILanguage></SetupUILanguage>
      <InputLocale>0409:00000409</InputLocale>
      <SystemLocale>en-US</SystemLocale>
      <UILanguage>en-US</UILanguage>
      <UserLocale>en-US</UserLocale>
    </component>
    <component name="Microsoft-Windows-Setup" processorArchitecture="amd64" publicKeyToken="31bf3856ad364e35" language="neutral" versionScope="nonSxS" xmlns:wcm="http://schemas.microsoft.com/WMIConfig/2002/State">
      <RunSynchronous>
        <RunSynchronousCommand wcm:action="add">
          <Order>1</Order>
          <Path>reg add HKLM\SYSTEM\Setup\LabConfig /v BypassTPMCheck /t REG_DWORD /d 1 /f</Path>
        </RunSynchronousCommand>
        <RunSynchronousCommand wcm:action="add">
          <Order>2</Order>
          <Path>reg add HKLM\SYSTEM\Setup\LabConfig /v BypassSecureBootCheck /t REG_DWORD /d 1 /f</Path>
        </RunSynchronousCommand>
        <RunSynchronousCommand wcm:action="add">
          <Order>3</Order>
          <Path>reg add HKLM\SYSTEM\Setup\LabConfig /v BypassRAMCheck /t REG_DWORD /d 1 /f</Path>
        </RunSynchronousCommand>
        <RunSynchronousCommand wcm:action="add">
          <Order>4</Order>
          <Path>reg add HKLM\SYSTEM\Setup\LabConfig /v BypassCPUCheck /t REG_DWORD /d 1 /f</Path>
        </RunSynchronousCommand>
        <RunSynchronousCommand wcm:action="add">
          <Order>5</Order>
          <Path>reg add HKLM\SYSTEM\Setup\LabConfig /v BypassStorageCheck /t REG_DWORD /d 1 /f</Path>
        </RunSynchronousCommand>
      </RunSynchronous>
      <DiskConfiguration>
        <Disk wcm:action="add">
          <DiskID>0</DiskID>
          <WillWipeDisk>true</WillWipeDisk>
          <CreatePartitions>
            <CreatePartition wcm:action="add"><Order>1</Order><Type>EFI</Type><Size>300</Size></CreatePartition>
            <CreatePartition wcm:action="add"><Order>2</Order><Type>MSR</Type><Size>16</Size></CreatePartition>
            <CreatePartition wcm:action="add"><Order>3</Order><Type>Primary</Type><Extend>true</Extend></CreatePartition>
          </CreatePartitions>
          <ModifyPartitions>
            <ModifyPartition wcm:action="add"><Order>1</Order><PartitionID>1</PartitionID><Format>FAT32</Format><Label>System</Label></ModifyPartition>
            <ModifyPartition wcm:action="add"><Order>2</Order><PartitionID>2</PartitionID></ModifyPartition>
            <ModifyPartition wcm:action="add"><Order>3</Order><PartitionID>3</PartitionID><Format>NTFS</Format><Label>Windows</Label><Letter>C</Letter></ModifyPartition>
          </ModifyPartitions>
        </Disk>
      </DiskConfiguration>
      <ImageInstall>
        <OSImage>
          <InstallTo><DiskID>0</DiskID><PartitionID>3</PartitionID></InstallTo>
          <InstallFrom>
            <MetaData wcm:action="add">
              <Key>/IMAGE/INDEX</Key>
              <Value>6</Value>
            </MetaData>
          </InstallFrom>
        </OSImage>
      </ImageInstall>
      <UserData>
        <ProductKey><Key>VK7JG-NPHTM-C97JM-9MPGT-3V66T</Key><WillShowUI>OnError</WillShowUI></ProductKey>
        <AcceptEula>true</AcceptEula>
        <FullName>$USERNAME</FullName>
        <Organization>vmui</Organization>
      </UserData>
    </component>
  </settings>

  <settings pass="specialize">
    <component name="Microsoft-Windows-Shell-Setup" processorArchitecture="amd64" publicKeyToken="31bf3856ad364e35" language="neutral" versionScope="nonSxS" xmlns:wcm="http://schemas.microsoft.com/WMIConfig/2002/State">
      <ComputerName>$HOSTNAME_W</ComputerName>
      <TimeZone>UTC</TimeZone>
    </component>
    <component name="Microsoft-Windows-TerminalServices-LocalSessionManager" processorArchitecture="amd64" publicKeyToken="31bf3856ad364e35" language="neutral" versionScope="nonSxS">
      <fDenyTSConnections>false</fDenyTSConnections>
    </component>
    <component name="Networking-MPSSVC-Svc" processorArchitecture="amd64" publicKeyToken="31bf3856ad364e35" language="neutral" versionScope="nonSxS">
      <FirewallGroups>
        <FirewallGroup wcm:action="add" wcm:keyValue="rdp"><Active>true</Active><Group>Remote Desktop</Group><Profile>all</Profile></FirewallGroup>
      </FirewallGroups>
    </component>
  </settings>

  <settings pass="oobeSystem">
    <component name="Microsoft-Windows-International-Core" processorArchitecture="amd64" publicKeyToken="31bf3856ad364e35" language="neutral" versionScope="nonSxS">
      <InputLocale>0409:00000409</InputLocale>
      <SystemLocale>en-US</SystemLocale>
      <UILanguage>en-US</UILanguage>
      <UserLocale>en-US</UserLocale>
    </component>
    <component name="Microsoft-Windows-Shell-Setup" processorArchitecture="amd64" publicKeyToken="31bf3856ad364e35" language="neutral" versionScope="nonSxS" xmlns:wcm="http://schemas.microsoft.com/WMIConfig/2002/State">
      <OOBE>
        <HideEULAPage>true</HideEULAPage>
        <HideOEMRegistrationScreen>true</HideOEMRegistrationScreen>
        <HideOnlineAccountScreens>true</HideOnlineAccountScreens>
        <HideWirelessSetupInOOBE>true</HideWirelessSetupInOOBE>
        <NetworkLocation>Home</NetworkLocation>
        <ProtectYourPC>3</ProtectYourPC>
        <SkipMachineOOBE>true</SkipMachineOOBE>
        <SkipUserOOBE>true</SkipUserOOBE>
      </OOBE>
      <UserAccounts>
        <LocalAccounts>
          <LocalAccount wcm:action="add">
            <Name>$USERNAME</Name>
            <Group>Administrators</Group>
            <DisplayName>$USERNAME</DisplayName>
            <Password><Value>$PASSWORD</Value><PlainText>true</PlainText></Password>
          </LocalAccount>
        </LocalAccounts>
      </UserAccounts>
      <AutoLogon>
        <Username>$USERNAME</Username>
        <Password><Value>$PASSWORD</Value><PlainText>true</PlainText></Password>
        <Enabled>true</Enabled>
        <LogonCount>1</LogonCount>
      </AutoLogon>
      <FirstLogonCommands>
        <SynchronousCommand wcm:action="add"><Order>1</Order><CommandLine>cmd /c reg add "HKLM\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon" /v AutoAdminLogon /t REG_SZ /d 0 /f</CommandLine></SynchronousCommand>
        <SynchronousCommand wcm:action="add"><Order>2</Order><CommandLine>powershell -Command "Set-ItemProperty -Path 'HKLM:\System\CurrentControlSet\Control\Terminal Server' -Name fDenyTSConnections -Value 0"</CommandLine></SynchronousCommand>
        <SynchronousCommand wcm:action="add"><Order>3</Order><CommandLine>powershell -Command "Enable-NetFirewallRule -DisplayGroup 'Remote Desktop'"</CommandLine></SynchronousCommand>
        <SynchronousCommand wcm:action="add"><Order>4</Order><CommandLine>powershell -Command "Add-WindowsCapability -Online -Name OpenSSH.Server~~~~0.0.1.0; Set-Service sshd -StartupType Automatic; Start-Service sshd"</CommandLine></SynchronousCommand>
      </FirstLogonCommands>
      <RegisteredOrganization>vmui</RegisteredOrganization>
      <RegisteredOwner>$USERNAME</RegisteredOwner>
    </component>
  </settings>
</unattend>
XML

# Build the ISO. Both autounattend.xml at the volume root AND a copy under
# Autounattend\ (some Win11 builds look there) are included for safety.
mkdir -p "$WORK/iso/Autounattend"
cp "$WORK/autounattend.xml" "$WORK/iso/autounattend.xml"
cp "$WORK/autounattend.xml" "$WORK/iso/Autounattend/autounattend.xml"
genisoimage -quiet -V "AUTOUNATTEND" -J -r -o autounattend.iso "$WORK/iso"
ls -lh autounattend.iso | awk '{print "  size:", $5}'

echo
echo "=== [6/6] Status ==="
echo "VM directory : $VMDIR"
ls -1 "$VMDIR"
if [ ! -f "$VMDIR/Win11.iso" ]; then
  cat <<EOF

NEXT STEP — drop the Windows 11 ISO in:
    $VMDIR/Win11.iso

Get the official ISO from https://www.microsoft.com/software-download/windows11
(pick "x64 English"). 25H2 (build 26200+) is the latest stable as of 2026.

Then start the VM via the VS Code task "vmui: start win VM" or via the vmui UI.
Default credentials baked in: $USERNAME / $PASSWORD
VNC: 127.0.0.1:6900 · RDP: 127.0.0.1:13389 · SSH: 127.0.0.1:10023
EOF
fi
echo
echo "=== ✅ WIN_SETUP_DONE ==="
