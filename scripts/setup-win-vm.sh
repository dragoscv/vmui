#!/usr/bin/env bash
# vmui — first-time setup for the Windows 11 Enterprise KVM guest.
#
# Run with:  wsl -d Ubuntu-24.04 -- bash /mnt/e/gh/vmui/scripts/setup-win-vm.sh
#
# Strategy (rewritten 2026-05):
#   - Prefer Win11-Enterprise.iso (downloaded by dl-enterprise-iso.sh) when
#     present; fall back to Win11.iso (consumer multi-edition).
#   - Modern Win11 install ISOs are UDF-only and the EFI El-Torito image
#     (efisys.bin) prompts "Press any key to boot from CD or DVD..." for
#     several seconds. xorriso cannot read UDF, so the only reliable repack
#     path is: 7z to extract → swap in efisys_noprompt.bin → bake
#     autounattend.xml at the root → mkisofs to rebuild a hybrid ISO.
#   - The rebuilt Win11-auto.iso boots WITHOUT any "press any key" prompt.
#   - autounattend.xml installs the first available "Enterprise" edition,
#     creates a local administrator (creds taken from $VMDIR/vm-creds.env
#     written by the vmui server action), enables RDP + OpenSSH, skips
#     Microsoft-account / OOBE, and bypasses TPM/Secure-Boot check-paths
#     in WinPE just-in-case.
set -euo pipefail

VMDIR="${VMDIR:-$HOME/vmui-vms/win}"
mkdir -p "$VMDIR"

# Source UI-provided credentials. The server action writes this file with
# WIN_USERNAME and WIN_PASSWORD when a Local-KVM Windows account is
# created; without it we have no creds and bail out (no shared default).
if [ -f "$VMDIR/vm-creds.env" ]; then
  # shellcheck disable=SC1091
  set -a; . "$VMDIR/vm-creds.env"; set +a
fi

DISK_GB="${DISK_GB:-200}"
USERNAME="${WIN_USERNAME:-}"
PASSWORD="${WIN_PASSWORD:-}"
HOSTNAME_W="${WIN_HOSTNAME:-VMUI-WIN}"

if [ -z "$USERNAME" ] || [ -z "$PASSWORD" ]; then
  cat >&2 <<MSG
ERROR: no guest credentials configured.

Expected one of:
  - $VMDIR/vm-creds.env containing WIN_USERNAME and WIN_PASSWORD
    (vmui writes this automatically when you create the account from
     the web UI).
  - WIN_USERNAME=... WIN_PASSWORD=... env vars on the command line.
MSG
  exit 2
fi

VIRTIO_URL="https://fedorapeople.org/groups/virt/virtio-win/direct-downloads/stable-virtio/virtio-win.iso"

echo "=== [1/7] apt install qemu, ovmf, swtpm, 7z, wimtools, isolinux tooling ==="
sudo apt-get update -qq
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq \
  qemu-system-x86 qemu-utils ovmf swtpm swtpm-tools \
  genisoimage xorriso curl ca-certificates \
  p7zip-full wimtools udftools 2>&1 | tail -5

mkdir -p "$VMDIR"
cd "$VMDIR"

echo
echo "=== [2/7] Copy OVMF firmware (Secure Boot enabled, Microsoft keys preloaded) ==="
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
echo "  VARS: $SRC_VARS  -> ./OVMF_VARS.fd"

echo
echo "=== [3/7] Create main disk Win11.qcow2 (${DISK_GB} GiB, sparse) ==="
if [ -f Win11.qcow2 ]; then
  echo "  exists, skipping"
else
  qemu-img create -f qcow2 -o nocow=on Win11.qcow2 "${DISK_GB}G"
fi

echo
echo "=== [4/7] Download VirtIO drivers ISO (stable channel) ==="
if [ -f virtio-win.iso ]; then
  echo "  exists, skipping"
else
  curl -L --fail -o virtio-win.iso.tmp "$VIRTIO_URL"
  mv virtio-win.iso.tmp virtio-win.iso
fi
ls -lh virtio-win.iso | awk '{print "  size:", $5}'

# ---------------------------------------------------------------------------
# [5/7] Pick which Windows ISO to repack.
# ---------------------------------------------------------------------------
echo
echo "=== [5/7] Select source Windows ISO ==="
SOURCE_ISO=""
if [ -f Win11-Enterprise.iso ] && [ "$(stat -c %s Win11-Enterprise.iso)" -gt $((4 * 1024 * 1024 * 1024)) ]; then
  SOURCE_ISO="Win11-Enterprise.iso"
elif [ -f Win11.iso ]; then
  SOURCE_ISO="Win11.iso"
fi
if [ -z "$SOURCE_ISO" ]; then
  cat >&2 <<EOF
ERROR: no Windows install ISO found in $VMDIR.

For Windows 11 Enterprise (recommended): run
    wsl -d Ubuntu-24.04 -- bash $(dirname "$(readlink -f "$0")")/dl-enterprise-iso.sh
or drop your own Win11-Enterprise.iso here.

For consumer Win11: drop the Microsoft Win11 ISO at $VMDIR/Win11.iso
EOF
  exit 1
fi
echo "  using: $SOURCE_ISO ($(stat -c %s "$SOURCE_ISO") bytes)"

# ---------------------------------------------------------------------------
# Extract the ISO with 7z (the only tool in apt that reads Win11 UDF reliably).
# ---------------------------------------------------------------------------
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
EXTRACT="$WORK/iso"
mkdir -p "$EXTRACT"

echo "  extracting $SOURCE_ISO with 7z (this takes ~30-60 s)..."
7z x -y -o"$EXTRACT" "$SOURCE_ISO" >"$WORK/7z.log" 2>&1 || {
  echo "ERROR: 7z extraction failed:" >&2
  tail -30 "$WORK/7z.log" >&2
  exit 1
}
# 7z creates a synthetic "[BOOT]" directory for El-Torito boot images.
# Move them aside so they don't end up as ordinary files in the new ISO tree.
mkdir -p "$WORK/etboot"
if [ -d "$EXTRACT/[BOOT]" ]; then
  mv "$EXTRACT/[BOOT]"/* "$WORK/etboot/" 2>/dev/null || true
  rm -rf "$EXTRACT/[BOOT]"
fi

# Sanity check: the no-prompt EFI boot image must be present.
if [ ! -f "$EXTRACT/efi/microsoft/boot/efisys_noprompt.bin" ]; then
  echo "ERROR: efisys_noprompt.bin missing from extracted ISO." >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# Detect Enterprise edition inside install.wim/install.esd. /IMAGE/NAME in the
# autounattend must match the WIM image name exactly.
# ---------------------------------------------------------------------------
WIM=""
for cand in "$EXTRACT/sources/install.wim" "$EXTRACT/sources/install.esd"; do
  if [ -f "$cand" ]; then WIM="$cand"; break; fi
done
if [ -z "$WIM" ]; then
  echo "ERROR: extracted ISO has no sources/install.{wim,esd}." >&2
  exit 1
fi

echo "  enumerating editions in $WIM ..."
EDITIONS="$(wimlib-imagex info "$WIM" | awk -F': *' '/^Name:/ {print $2}')"
echo "$EDITIONS" | sed 's/^/    - /'

# Pick the first Enterprise edition (excluding "N" SKUs). Fall back to Pro,
# then to whatever the first index is.
IMAGE_NAME=""
while IFS= read -r e; do
  case "$e" in
    *Enterprise*Eval*|*Enterprise*evaluation*) IMAGE_NAME="$e"; break ;;
  esac
done <<< "$EDITIONS"
if [ -z "$IMAGE_NAME" ]; then
  while IFS= read -r e; do
    if [[ "$e" == *Enterprise* && "$e" != *" N"* ]]; then IMAGE_NAME="$e"; break; fi
  done <<< "$EDITIONS"
fi
if [ -z "$IMAGE_NAME" ]; then
  while IFS= read -r e; do
    if [[ "$e" == *Pro* && "$e" != *" N"* && "$e" != *Education* ]]; then IMAGE_NAME="$e"; break; fi
  done <<< "$EDITIONS"
fi
if [ -z "$IMAGE_NAME" ]; then
  IMAGE_NAME="$(echo "$EDITIONS" | head -n 1)"
fi
echo "  selected edition: $IMAGE_NAME"

# Edition -> Microsoft generic / KMS key. Eval ISOs ignore this anyway because
# they're pre-keyed for evaluation.
case "$IMAGE_NAME" in
  *Enterprise*) PRODUCT_KEY="NPPR9-FWDCX-D2C8J-H872K-2YT43" ;;
  *Education*)  PRODUCT_KEY="NW6C2-QMPVW-D7KKK-3GKT6-VCFB2" ;;
  *Pro*)        PRODUCT_KEY="W269N-WFGWX-YVC9B-4J6C9-T83GX" ;;
  *)            PRODUCT_KEY="VK7JG-NPHTM-C97JM-9MPGT-3V66T" ;;
esac
echo "  generic key for edition: $PRODUCT_KEY"

# ---------------------------------------------------------------------------
# [6/7] Generate autounattend.xml with the chosen edition, then bake it into
# the repacked ISO root. Setup auto-loads /autounattend.xml.
# ---------------------------------------------------------------------------
echo
echo "=== [6/7] Generate autounattend.xml (edition='$IMAGE_NAME', user='$USERNAME') ==="

cat > "$EXTRACT/autounattend.xml" <<XML
<?xml version="1.0" encoding="utf-8"?>
<unattend xmlns="urn:schemas-microsoft-com:unattend">
  <settings pass="windowsPE">
    <component name="Microsoft-Windows-PnpCustomizationsWinPE" processorArchitecture="amd64" publicKeyToken="31bf3856ad364e35" language="neutral" versionScope="nonSxS" xmlns:wcm="http://schemas.microsoft.com/WMIConfig/2002/State">
      <DriverPaths>
        <PathAndCredentials wcm:action="add" wcm:keyValue="1"><Path>E:\amd64\w11</Path></PathAndCredentials>
        <PathAndCredentials wcm:action="add" wcm:keyValue="2"><Path>E:\viostor\w11\amd64</Path></PathAndCredentials>
        <PathAndCredentials wcm:action="add" wcm:keyValue="3"><Path>E:\NetKVM\w11\amd64</Path></PathAndCredentials>
        <PathAndCredentials wcm:action="add" wcm:keyValue="4"><Path>E:\vioscsi\w11\amd64</Path></PathAndCredentials>
        <PathAndCredentials wcm:action="add" wcm:keyValue="5"><Path>E:\viogpudo\w11\amd64</Path></PathAndCredentials>
        <PathAndCredentials wcm:action="add" wcm:keyValue="6"><Path>E:\Balloon\w11\amd64</Path></PathAndCredentials>
        <PathAndCredentials wcm:action="add" wcm:keyValue="7"><Path>F:\amd64\w11</Path></PathAndCredentials>
        <PathAndCredentials wcm:action="add" wcm:keyValue="8"><Path>F:\viostor\w11\amd64</Path></PathAndCredentials>
        <PathAndCredentials wcm:action="add" wcm:keyValue="9"><Path>F:\NetKVM\w11\amd64</Path></PathAndCredentials>
      </DriverPaths>
    </component>
    <component name="Microsoft-Windows-International-Core-WinPE" processorArchitecture="amd64" publicKeyToken="31bf3856ad364e35" language="neutral" versionScope="nonSxS" xmlns:wcm="http://schemas.microsoft.com/WMIConfig/2002/State">
      <SetupUILanguage><UILanguage>en-US</UILanguage></SetupUILanguage>
      <InputLocale>0409:00000409</InputLocale>
      <SystemLocale>en-US</SystemLocale>
      <UILanguage>en-US</UILanguage>
      <UserLocale>en-US</UserLocale>
    </component>
    <component name="Microsoft-Windows-Setup" processorArchitecture="amd64" publicKeyToken="31bf3856ad364e35" language="neutral" versionScope="nonSxS" xmlns:wcm="http://schemas.microsoft.com/WMIConfig/2002/State">
      <RunSynchronous>
        <RunSynchronousCommand wcm:action="add"><Order>1</Order><Path>reg add HKLM\SYSTEM\Setup\LabConfig /v BypassTPMCheck /t REG_DWORD /d 1 /f</Path></RunSynchronousCommand>
        <RunSynchronousCommand wcm:action="add"><Order>2</Order><Path>reg add HKLM\SYSTEM\Setup\LabConfig /v BypassSecureBootCheck /t REG_DWORD /d 1 /f</Path></RunSynchronousCommand>
        <RunSynchronousCommand wcm:action="add"><Order>3</Order><Path>reg add HKLM\SYSTEM\Setup\LabConfig /v BypassRAMCheck /t REG_DWORD /d 1 /f</Path></RunSynchronousCommand>
        <RunSynchronousCommand wcm:action="add"><Order>4</Order><Path>reg add HKLM\SYSTEM\Setup\LabConfig /v BypassCPUCheck /t REG_DWORD /d 1 /f</Path></RunSynchronousCommand>
        <RunSynchronousCommand wcm:action="add"><Order>5</Order><Path>reg add HKLM\SYSTEM\Setup\LabConfig /v BypassStorageCheck /t REG_DWORD /d 1 /f</Path></RunSynchronousCommand>
        <RunSynchronousCommand wcm:action="add"><Order>6</Order><Path>reg add HKLM\SYSTEM\Setup\MoSetup /v AllowUpgradesWithUnsupportedTPMOrCPU /t REG_DWORD /d 1 /f</Path></RunSynchronousCommand>
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
              <Key>/IMAGE/NAME</Key>
              <Value>$IMAGE_NAME</Value>
            </MetaData>
          </InstallFrom>
          <WillShowUI>OnError</WillShowUI>
        </OSImage>
      </ImageInstall>
      <UserData>
        <ProductKey><Key>$PRODUCT_KEY</Key><WillShowUI>OnError</WillShowUI></ProductKey>
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
    <component name="Microsoft-Windows-Deployment" processorArchitecture="amd64" publicKeyToken="31bf3856ad364e35" language="neutral" versionScope="nonSxS" xmlns:wcm="http://schemas.microsoft.com/WMIConfig/2002/State">
      <RunSynchronous>
        <RunSynchronousCommand wcm:action="add">
          <Order>1</Order>
          <Path>reg add HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\OOBE /v BypassNRO /t REG_DWORD /d 1 /f</Path>
        </RunSynchronousCommand>
      </RunSynchronous>
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
        <HideLocalAccountScreen>true</HideLocalAccountScreen>
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
        <SynchronousCommand wcm:action="add"><Order>5</Order><CommandLine>powershell -Command "Set-LocalUser -Name '$USERNAME' -PasswordNeverExpires \$true"</CommandLine></SynchronousCommand>
      </FirstLogonCommands>
      <RegisteredOrganization>vmui</RegisteredOrganization>
      <RegisteredOwner>$USERNAME</RegisteredOwner>
    </component>
  </settings>
</unattend>
XML

cp -f "$EXTRACT/autounattend.xml" "$VMDIR/autounattend.xml"

# Sidecar autounattend.iso (fallback in case the main ISO repack ever fails).
mkdir -p "$WORK/unattend_iso"
cp "$EXTRACT/autounattend.xml" "$WORK/unattend_iso/autounattend.xml"
genisoimage -quiet -V "AUTOUNATTEND" -J -r -o "$VMDIR/autounattend.iso" "$WORK/unattend_iso"

# ---------------------------------------------------------------------------
# [7/7] Repack as Win11-auto.iso (hybrid BIOS + UEFI, no-prompt boot).
# ---------------------------------------------------------------------------
echo
echo "=== [7/7] Repack -> Win11-auto.iso (hybrid BIOS+UEFI, no-prompt) ==="

EFI_REL="efi/microsoft/boot/efisys_noprompt.bin"

# BIOS El-Torito leg: prefer the original Boot-NoEmul.img extracted by 7z.
BIOS_REL=""
if [ -f "$WORK/etboot/Boot-NoEmul.img" ]; then
  mkdir -p "$EXTRACT/boot"
  cp -f "$WORK/etboot/Boot-NoEmul.img" "$EXTRACT/boot/etfsboot.com"
fi
[ -f "$EXTRACT/boot/etfsboot.com" ] && BIOS_REL="boot/etfsboot.com"

OUT_ISO="$VMDIR/Win11-auto.iso"
rm -f "$OUT_ISO" "$OUT_ISO.tmp"

XORRISO_ARGS=(
  -as mkisofs
  -iso-level 4
  -joliet -joliet-long -rational-rock
  -V "WIN11_AUTO"
  -publisher "vmui"
  -appid "WIN11_AUTO_INSTALL"
)
if [ -n "$BIOS_REL" ]; then
  XORRISO_ARGS+=( -b "$BIOS_REL" -no-emul-boot -boot-load-size 8 )
  XORRISO_ARGS+=( -eltorito-alt-boot )
fi
XORRISO_ARGS+=(
  -e "$EFI_REL" -no-emul-boot
  -isohybrid-gpt-basdat
  -o "$OUT_ISO.tmp"
  "$EXTRACT"
)

if ! xorriso "${XORRISO_ARGS[@]}" >"$WORK/xorriso.log" 2>&1; then
  echo "ERROR: xorriso failed:" >&2
  tail -30 "$WORK/xorriso.log" >&2
  exit 1
fi
mv -f "$OUT_ISO.tmp" "$OUT_ISO"
ls -lh "$OUT_ISO" | awk '{print "  size:", $5}'

echo
echo "=== Status ==="
echo "VM directory : $VMDIR"
ls -1 "$VMDIR"
cat <<EOF

Setup complete.

  Edition baked in : $IMAGE_NAME
  Local account    : $USERNAME / $PASSWORD  (Administrator)
  Hostname         : $HOSTNAME_W

Start the VM via the VS Code task "vmui: start win VM" or via the vmui UI.
VNC :6900   .   RDP :13389   .   SSH :10023   .   QMP :4445
EOF
echo
echo "=== WIN_SETUP_DONE ==="
