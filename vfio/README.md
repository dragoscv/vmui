# Bare-metal Linux + VFIO: a macOS guest with real Metal

Goal: **working iPhone/iPad simulators**, which need Metal, which needs a real
GPU passed through to the guest.

> **Status: prepared, not yet run.** It needs an AMD GPU that is not installed
> yet. Everything here is written against the surveyed host below and is meant
> to be executed in order once the card arrives.

## Why this is the only route

Four things were measured on the current WSL2 setup, and each rules out a
cheaper option:

| Attempt | Result |
| ------------------------------------ | -------------------------------------------------------------------- |
| Emulated GPU (`AppleBochVGAFB`)      | `MTLCreateSystemDefaultDevice()` → `NULL`. No Metal, so no Simulator. |
| `AppleParavirtGPU.kext` (ships in Tahoe) | Matches PCI `106b:eeee`, but it is the guest half of Apple's closed **ParavirtualizedGraphics.framework**. The host half exists only inside macOS. QEMU cannot speak it — even VMware Fusion and Parallels, running *on* macOS, keep breaking with it. |
| `virtio-gpu`                         | No macOS driver. `AppleVirtIO.kext` covers socket/sound/input/storage/biometrics — not graphics. |
| VFIO from WSL2                       | `/sys/kernel/iommu_groups/` is empty: WSL2 is itself a Hyper-V guest and never sees host PCI. |

So: a real GPU, passed through, from a hypervisor that exposes IOMMU. That
means bare metal.

## Hardware

Surveyed on this machine:

| Component | Value | Verdict |
| ------------- | ---------------------------------- | ------------------------------------------ |
| Motherboard   | Gigabyte Z790 AORUS ELITE AX       | VT-d capable |
| CPU           | Intel i9-14900K (24C / 32T)        | VT-x + VT-d |
| RAM           | 192 GB                             | ample |
| Host GPU      | RTX 3060 Ti                        | keep for the Linux host |
| Spare GPU     | Intel UHD 770 (currently disabled) | can serve as host display instead |
| Disk          | F: 118 GB free, H: 1138 GB free    | ample |

### The card you need to buy

macOS drivers bind by PCI ID, so only cards Apple already ships a driver for
will work. Those drivers are **already on your disk** — they just have nothing
to bind to.

| Card | macOS driver | Price (used) | Notes |
| --------------- | ----------------------- | -------- | -------------------------------------------- |
| **RX 580 8GB**  | `AMDRadeonX4000.kext`   | €70–100  | The community default. What an `iMac19,1` shipped with, so it matches your SMBIOS. Recommended. |
| RX 5500 XT      | `AMDRadeonX5000.kext`   | €100–140 | Navi 10; needs `agdpmod=pikera` |
| RX 6600 / 6600 XT | `AMDRadeonX6000.kext` | €150–200 | Newer, Metal 3, lower power |

**Do not buy:** RX 7000/9000 (no macOS driver at all), or any NVIDIA newer than
Kepler (Apple dropped NVIDIA after High Sierra — your 3060 Ti will never work).

Also check: one free PCIe x16 slot, a spare 8-pin PCIe power lead (RX 580 pulls
~185 W), and two spare display outputs or a dummy HDMI plug.

## Order of work

1. [`01-bios-checklist.md`](01-bios-checklist.md) — firmware settings, before anything else
2. [`02-host-setup.sh`](02-host-setup.sh) — install packages, enable IOMMU, bind the GPU to `vfio-pci`
3. [`03-check-iommu.sh`](03-check-iommu.sh) — verify isolation; **stop here if groups are bad**
4. [`04-migrate-image.sh`](04-migrate-image.sh) — copy `mac-tahoe.qcow2` out of WSL2
5. [`05-macos-vm.xml`](05-macos-vm.xml) — libvirt domain with the GPU attached
6. [`06-verify-metal.sh`](06-verify-metal.sh) — prove Metal works, then install Xcode

## What you get

| | WSL2 today | After passthrough |
| ---------------- | ------------------------- | ------------------------ |
| Metal            | `NULL` | working |
| iOS Simulators   | impossible | working |
| Window borders   | opaque 1px stroke | properly composited |
| Cursor           | software, laggy | hardware |
| Audio            | no driver attaches | works |
| Display          | remote encode over SPICE | native, direct to monitor |

The one thing passthrough does **not** fix is Apple ID sign-in: that is the
placeholder SMBIOS (serial `W00000000001`, all-zero UUID), and it needs a
GenSMBIOS-generated `PlatformInfo` in OpenCore. Xcode requires a working Apple
ID, so this must be solved too — see [`07-smbios.md`](07-smbios.md).

## Trade-off, stated plainly

This replaces Windows as your primary OS on this machine. Dual-booting is
possible but you cannot run both at once, and the passed-through GPU is
unavailable to Linux while the VM is running.

If the only goal is iOS development, a used **M-series Mac mini** (~€450–500)
is faster, needs no maintenance, survives macOS updates, and leaves this
machine alone. This path makes sense if you want the VM *and* enjoy the build.
