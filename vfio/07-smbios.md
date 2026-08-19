# Step 7 — a real SMBIOS, so Apple ID works

Metal alone does not get you simulators. `Simulator.app` and `simctl` ship with
**Xcode**, Xcode comes from the App Store or the developer portal, and both
need a signed-in Apple ID.

## Why sign-in fails today

Measured on the current guest:

```
Serial Number      W00000000001                            <- OSX-KVM placeholder
Hardware UUID      00000000-0000-0000-0000-000000000000    <- all zeros
Provisioning UDID  00000000-0000-0000-0000-000000000000
ROM / MLB          not set in nvram
```

Apple validates the machine before it validates you:

```
AppleIDSettings: Error creating mmAccount
cdpd: (AAAFoundationSwift) All retry failed
```

It is not the password and not the account. `en0` was checked and is fine
(`IOBuiltin = Yes`, `IOPrimaryInterface = Yes`, holds the default route), so
identity is the only cause.

## Generating one

[GenSMBIOS](https://github.com/corpnewt/GenSMBIOS) produces a consistent set:

```bash
git clone https://github.com/corpnewt/GenSMBIOS && cd GenSMBIOS
./GenSMBIOS.command
#  1. select OpenCore's config.plist
#  2. generate for  iMac19,1        <- keep matching the existing SMBIOS
```

It writes four linked values. They must be internally consistent — a serial
that does not match its board serial is worse than the placeholder:

| Field                | What it is                                      |
| -------------------- | ----------------------------------------------- |
| `SystemSerialNumber` | the machine serial                              |
| `MLB`                | board serial, derived from it                   |
| `SystemUUID`         | replaces the all-zero UUID                      |
| `ROM`                | 6 bytes, conventionally the primary MAC address |

## Where it goes

OpenCore `config.plist` → `PlatformInfo`:

```xml
<key>PlatformInfo</key>
<dict>
  <key>Automatic</key><true/>
  <key>UpdateSMBIOS</key><true/>
  <key>UpdateSMBIOSMode</key><string>Create</string>
  <key>Generic</key>
  <dict>
    <key>SystemProductName</key>  <string>iMac19,1</string>
    <key>SystemSerialNumber</key> <string>GENERATED</string>
    <key>MLB</key>                <string>GENERATED</string>
    <key>SystemUUID</key>         <string>GENERATED</string>
    <key>ROM</key>                <data>BASE64_OF_MAC</data>
  </dict>
</dict>
```

## The catch on the current setup

`OpenCore.qcow2` is attached with `snapshot=on`, so **every EFI write is
discarded at shutdown**. Editing `config.plist` from inside the guest achieves
nothing.

Edit it offline instead:

```bash
sudo modprobe nbd max_part=8
sudo qemu-nbd --connect=/dev/nbd0 OpenCore.qcow2
sudo mount /dev/nbd0p1 /mnt/oc
sudo cp /mnt/oc/EFI/OC/config.plist ~/config.plist.bak   # always
# edit ~/config.plist, copy it back
sudo umount /mnt/oc && sudo qemu-nbd --disconnect /dev/nbd0
```

Take a copy of `OpenCore.qcow2` first. A malformed `config.plist` means the VM
will not boot, and the failure looks like a hang with no error.

On the bare-metal setup, drop `snapshot=on` so OpenCore is writable and this
becomes a normal edit.

## Expectations

- A generated serial **may already belong to a real Mac**. Apple can reject it,
  or flag the account used with it. **Do not test with your primary Apple ID.**
- Some serials work for the App Store but not iMessage/FaceTime. Those need
  activation records Apple issues only to genuine hardware.
- For Xcode, App Store sign-in is enough — iMessage is not required.

## Alternative that avoids all of this

Xcode is also downloadable from
[developer.apple.com/download](https://developer.apple.com/download/all/) with
a **free** developer account, as a `.xip`. That still needs a working Apple ID
for the download, but it sidesteps the App Store, which is the fussier of the
two paths.
