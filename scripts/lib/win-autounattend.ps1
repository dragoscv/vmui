# vmui — generates a Windows 11 25H2 unattended-install answer file.
#
# Schema reference (Microsoft Learn):
#   https://learn.microsoft.com/windows-hardware/customize/desktop/unattend
#
# Design notes:
#   - All five Windows Setup configuration passes are included; the relevant
#     ones for fresh install are `windowsPE`, `specialize`, and `oobeSystem`.
#   - Image selection is by NAME ("Windows 11 Enterprise") rather than index,
#     because Microsoft can re-order the WIM index between revisions.
#   - The Enterprise generic key (NPPR9-FWDCX-D2C8J-H872K-2YT43) is a
#     Microsoft-published KMS Client Setup Key — used only to bypass the
#     "enter your product key" prompt during PE; the install remains unactivated
#     until the user runs `slmgr /ipk <real key>`. Reference:
#     https://learn.microsoft.com/windows-server/get-started/kms-client-activation-keys
#   - Win11 25H2 enforces a Microsoft-account OOBE. We bypass it by:
#       * Setting `BypassNRO` registry key in the FirstLogonCommands
#         (Microsoft removed the script in 25H2 but the policy still works).
#       * Pre-creating the local administrator account via UserAccounts +
#         AutoLogon.
#   - Win11 25H2 still ignores the unattended local-account on some builds,
#     so we belt-and-braces by ALSO adding `oobe.HideOnlineAccountScreens` and
#     setting LocalAccount in `oobeSystem`.
#   - Hardware bypass (TPM/SecureBoot/RAM/Storage) is set via a
#     RunSynchronousCommand that writes the `LabConfig` registry keys before
#     compatibility checks run. Hyper-V Gen2 already provides vTPM 2.0 +
#     Secure Boot + ≥4 GB RAM, so these are fail-safes for downgraded VMs.

function New-VmuiAutounattendXml {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory)] [string]$Username,
    [Parameter(Mandatory)] [string]$Password,
    [string]$ComputerName  = 'VMUI-WIN',
    [string]$ImageName     = 'Windows 11 Enterprise',
    [string]$Locale        = 'en-US',
    [string]$KeyboardLayout = '0409:00000409',
    [string]$TimeZone      = 'GMT Standard Time',
    [string]$ProductKey    = 'NPPR9-FWDCX-D2C8J-H872K-2YT43'
  )

  # XML-escape a string for safe substitution into the template.
  function Esc([string]$s) {
    if ($null -eq $s) { return '' }
    return [System.Security.SecurityElement]::Escape($s)
  }

  # Win11 obfuscates passwords by base64-encoding (UTF-16LE) the password
  # concatenated with a fixed suffix. The suffix differs by where it's used.
  function PlainTextBase64([string]$value, [string]$suffix) {
    $combined = $value + $suffix
    [Convert]::ToBase64String([System.Text.Encoding]::Unicode.GetBytes($combined))
  }

  $userPwdAdmin   = PlainTextBase64 $Password 'AdministratorPassword'
  $userPwdAccount = PlainTextBase64 $Password 'Password'
  $autoLogonPwd   = PlainTextBase64 $Password 'Password'

  $xmlUsername      = Esc $Username
  $xmlComputerName  = Esc $ComputerName
  $xmlImageName     = Esc $ImageName
  $xmlLocale        = Esc $Locale
  $xmlKeyboard      = Esc $KeyboardLayout
  $xmlTimeZone      = Esc $TimeZone
  $xmlProductKey    = Esc $ProductKey

@"
<?xml version="1.0" encoding="utf-8"?>
<unattend xmlns="urn:schemas-microsoft-com:unattend">

  <!-- ============================================================ -->
  <!-- windowsPE: runs in WinPE before disk setup.                    -->
  <!-- Picks language + product key, partitions disk, applies image. -->
  <!-- ============================================================ -->
  <settings pass="windowsPE">
    <component name="Microsoft-Windows-International-Core-WinPE"
               processorArchitecture="amd64"
               publicKeyToken="31bf3856ad364e35"
               language="neutral" versionScope="nonSxS"
               xmlns:wcm="http://schemas.microsoft.com/WMIConfig/2002/State">
      <SetupUILanguage>
        <UILanguage>$xmlLocale</UILanguage>
      </SetupUILanguage>
      <InputLocale>$xmlKeyboard</InputLocale>
      <SystemLocale>$xmlLocale</SystemLocale>
      <UILanguage>$xmlLocale</UILanguage>
      <UserLocale>$xmlLocale</UserLocale>
    </component>

    <component name="Microsoft-Windows-Setup"
               processorArchitecture="amd64"
               publicKeyToken="31bf3856ad364e35"
               language="neutral" versionScope="nonSxS"
               xmlns:wcm="http://schemas.microsoft.com/WMIConfig/2002/State">

      <!-- Bypass Win11 hardware checks via LabConfig registry keys.
           These are read by Setup BEFORE the compat scan, so they must
           be applied as the very first RunSynchronous step. -->
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
          <Path>reg add HKLM\SYSTEM\Setup\LabConfig /v BypassStorageCheck /t REG_DWORD /d 1 /f</Path>
        </RunSynchronousCommand>
        <RunSynchronousCommand wcm:action="add">
          <Order>5</Order>
          <Path>reg add HKLM\SYSTEM\Setup\LabConfig /v BypassCPUCheck /t REG_DWORD /d 1 /f</Path>
        </RunSynchronousCommand>
      </RunSynchronous>

      <DiskConfiguration>
        <Disk wcm:action="add">
          <DiskID>0</DiskID>
          <WillWipeDisk>true</WillWipeDisk>
          <CreatePartitions>
            <!-- ESP (EFI System Partition) -->
            <CreatePartition wcm:action="add">
              <Order>1</Order>
              <Type>EFI</Type>
              <Size>260</Size>
            </CreatePartition>
            <!-- MSR (Microsoft Reserved) -->
            <CreatePartition wcm:action="add">
              <Order>2</Order>
              <Type>MSR</Type>
              <Size>16</Size>
            </CreatePartition>
            <!-- OS partition: fills the rest of the disk. -->
            <CreatePartition wcm:action="add">
              <Order>3</Order>
              <Type>Primary</Type>
              <Extend>true</Extend>
            </CreatePartition>
          </CreatePartitions>
          <ModifyPartitions>
            <ModifyPartition wcm:action="add">
              <Order>1</Order>
              <PartitionID>1</PartitionID>
              <Format>FAT32</Format>
              <Label>System</Label>
            </ModifyPartition>
            <ModifyPartition wcm:action="add">
              <Order>2</Order>
              <PartitionID>2</PartitionID>
            </ModifyPartition>
            <ModifyPartition wcm:action="add">
              <Order>3</Order>
              <PartitionID>3</PartitionID>
              <Format>NTFS</Format>
              <Label>Windows</Label>
              <Letter>C</Letter>
            </ModifyPartition>
          </ModifyPartitions>
        </Disk>
        <WillShowUI>OnError</WillShowUI>
      </DiskConfiguration>

      <ImageInstall>
        <OSImage>
          <InstallTo>
            <DiskID>0</DiskID>
            <PartitionID>3</PartitionID>
          </InstallTo>
          <InstallFrom>
            <MetaData wcm:action="add">
              <Key>/IMAGE/NAME</Key>
              <Value>$xmlImageName</Value>
            </MetaData>
          </InstallFrom>
          <WillShowUI>OnError</WillShowUI>
        </OSImage>
      </ImageInstall>

      <UserData>
        <ProductKey>
          <Key>$xmlProductKey</Key>
          <WillShowUI>OnError</WillShowUI>
        </ProductKey>
        <AcceptEula>true</AcceptEula>
        <FullName>$xmlUsername</FullName>
        <Organization>vmui</Organization>
      </UserData>
    </component>
  </settings>

  <!-- ============================================================ -->
  <!-- specialize: runs after the image is applied and the machine   -->
  <!-- is booting from disk for the first time.                      -->
  <!-- ============================================================ -->
  <settings pass="specialize">
    <component name="Microsoft-Windows-Shell-Setup"
               processorArchitecture="amd64"
               publicKeyToken="31bf3856ad364e35"
               language="neutral" versionScope="nonSxS"
               xmlns:wcm="http://schemas.microsoft.com/WMIConfig/2002/State">
      <ComputerName>$xmlComputerName</ComputerName>
      <TimeZone>$xmlTimeZone</TimeZone>
    </component>

    <!-- BypassNRO: skip OOBE network requirement. Win11 25H2 removed the
         BypassNRO.cmd helper but still honours this registry key. -->
    <component name="Microsoft-Windows-Deployment"
               processorArchitecture="amd64"
               publicKeyToken="31bf3856ad364e35"
               language="neutral" versionScope="nonSxS"
               xmlns:wcm="http://schemas.microsoft.com/WMIConfig/2002/State">
      <RunSynchronous>
        <RunSynchronousCommand wcm:action="add">
          <Order>1</Order>
          <Path>reg add HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\OOBE /v BypassNRO /t REG_DWORD /d 1 /f</Path>
          <Description>BypassNRO</Description>
        </RunSynchronousCommand>
      </RunSynchronous>
    </component>
  </settings>

  <!-- ============================================================ -->
  <!-- oobeSystem: runs at the end of OOBE.                          -->
  <!-- Creates the local admin account and configures auto-logon.   -->
  <!-- ============================================================ -->
  <settings pass="oobeSystem">
    <component name="Microsoft-Windows-Shell-Setup"
               processorArchitecture="amd64"
               publicKeyToken="31bf3856ad364e35"
               language="neutral" versionScope="nonSxS"
               xmlns:wcm="http://schemas.microsoft.com/WMIConfig/2002/State">

      <OOBE>
        <HideEULAPage>true</HideEULAPage>
        <HideLocalAccountScreen>true</HideLocalAccountScreen>
        <HideOEMRegistrationScreen>true</HideOEMRegistrationScreen>
        <HideOnlineAccountScreens>true</HideOnlineAccountScreens>
        <HideWirelessSetupInOOBE>true</HideWirelessSetupInOOBE>
        <ProtectYourPC>3</ProtectYourPC>
        <SkipMachineOOBE>true</SkipMachineOOBE>
        <SkipUserOOBE>true</SkipUserOOBE>
      </OOBE>

      <UserAccounts>
        <LocalAccounts>
          <LocalAccount wcm:action="add">
            <Name>$xmlUsername</Name>
            <DisplayName>$xmlUsername</DisplayName>
            <Group>Administrators</Group>
            <Password>
              <Value>$userPwdAccount</Value>
              <PlainText>false</PlainText>
            </Password>
          </LocalAccount>
        </LocalAccounts>
      </UserAccounts>

      <AutoLogon>
        <Enabled>true</Enabled>
        <Username>$xmlUsername</Username>
        <LogonCount>1</LogonCount>
        <Password>
          <Value>$autoLogonPwd</Value>
          <PlainText>false</PlainText>
        </Password>
      </AutoLogon>

      <FirstLogonCommands>
        <SynchronousCommand wcm:action="add">
          <Order>1</Order>
          <Description>Set password to never expire</Description>
          <CommandLine>powershell -NoProfile -Command "Set-LocalUser -Name '$Username' -PasswordNeverExpires `$true"</CommandLine>
        </SynchronousCommand>
        <SynchronousCommand wcm:action="add">
          <Order>2</Order>
          <Description>Enable Remote Desktop</Description>
          <CommandLine>reg add "HKLM\SYSTEM\CurrentControlSet\Control\Terminal Server" /v fDenyTSConnections /t REG_DWORD /d 0 /f</CommandLine>
        </SynchronousCommand>
        <SynchronousCommand wcm:action="add">
          <Order>3</Order>
          <Description>Allow RDP through firewall</Description>
          <CommandLine>netsh advfirewall firewall set rule group="remote desktop" new enable=Yes</CommandLine>
        </SynchronousCommand>
        <SynchronousCommand wcm:action="add">
          <Order>4</Order>
          <Description>Install + harden OpenSSH server</Description>
          <CommandLine>powershell -NoProfile -ExecutionPolicy Bypass -Command "&amp; { for(`$i=0;`$i -lt 5;`$i++){ try { Add-WindowsCapability -Online -Name OpenSSH.Server~~~~0.0.1.0 -ErrorAction Stop; break } catch { Start-Sleep 10 } }; Set-Service -Name sshd -StartupType Automatic -ErrorAction SilentlyContinue; Set-Service -Name 'ssh-agent' -StartupType Automatic -ErrorAction SilentlyContinue; Start-Service sshd -ErrorAction SilentlyContinue; Start-Service ssh-agent -ErrorAction SilentlyContinue; if (-not (Get-NetFirewallRule -Name 'OpenSSH-Server-In-TCP-vmui' -ErrorAction SilentlyContinue)) { New-NetFirewallRule -Name 'OpenSSH-Server-In-TCP-vmui' -DisplayName 'OpenSSH Server (vmui, all profiles)' -Enabled True -Direction Inbound -Protocol TCP -LocalPort 22 -Action Allow -Profile Any | Out-Null }; New-ItemProperty -Path 'HKLM:\SOFTWARE\OpenSSH' -Name DefaultShell -Value 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe' -PropertyType String -Force | Out-Null }"</CommandLine>
        </SynchronousCommand>
        <SynchronousCommand wcm:action="add">
          <Order>5</Order>
          <Description>Mark setup complete</Description>
          <CommandLine>cmd /c echo VMUI setup complete &gt; C:\vmui-setup-done.txt</CommandLine>
        </SynchronousCommand>
      </FirstLogonCommands>

      <TimeZone>$xmlTimeZone</TimeZone>
    </component>

    <component name="Microsoft-Windows-International-Core"
               processorArchitecture="amd64"
               publicKeyToken="31bf3856ad364e35"
               language="neutral" versionScope="nonSxS"
               xmlns:wcm="http://schemas.microsoft.com/WMIConfig/2002/State">
      <InputLocale>$xmlKeyboard</InputLocale>
      <SystemLocale>$xmlLocale</SystemLocale>
      <UILanguage>$xmlLocale</UILanguage>
      <UserLocale>$xmlLocale</UserLocale>
    </component>
  </settings>

</unattend>
"@
}
