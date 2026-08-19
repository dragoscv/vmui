# Bare-metal Linux + VFIO: a macOS guest with real Metal

Goal: **working iPhone/iPad simulators**, which need Metal, which needs a real
GPU passed through to the guest.

> **Status: reference material. Not planned, not recommended.**
>
> This was written out after establishing that GPU passthrough is the only way
> to get Metal in a macOS guest on non-Apple hardware. It was then **decided
> against** (2026-08-19): it needs an AMD GPU this machine does not have, and
> it means giving up Windows as the primary OS — too high a price for a VM
> feature.
>
> Kept because the research is done and correct. If a spare machine, an old
> GPU, or a change of plan ever makes it relevant, the steps are ready. Read
> "Is this worth doing?" at the end before starting.

## Why this is the only route

Four things were measured on the current WSL2 setup, and each rules out a
cheaper option:

| Attempt                                  | Result                                                                                                                                                                                                                                                 |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Emulated GPU (`AppleBochVGAFB`)          | `MTLCreateSystemDefaultDevice()` → `NULL`. No Metal, so no Simulator.                                                                                                                                                                                  |
| `AppleParavirtGPU.kext` (ships in Tahoe) | Matches PCI `106b:eeee`, but it is the guest half of Apple's closed **ParavirtualizedGraphics.framework**. The host half exists only inside macOS. QEMU cannot speak it — even VMware Fusion and Parallels, running _on_ macOS, keep breaking with it. |
| `virtio-gpu`                             | No macOS driver. `AppleVirtIO.kext` covers socket/sound/input/storage/biometrics — not graphics.                                                                                                                                                       |
| VFIO from WSL2                           | `/sys/kernel/iommu_groups/` is empty: WSL2 is itself a Hyper-V guest and never sees host PCI.                                                                                                                                                          |

So: a real GPU, passed through, from a hypervisor that exposes IOMMU. That
means bare metal.

## Hardware

Surveyed on this machine:

| Component   | Value                              | Verdict                           |
| ----------- | ---------------------------------- | --------------------------------- |
| Motherboard | Gigabyte Z790 AORUS ELITE AX       | VT-d capable                      |
| CPU         | Intel i9-14900K (24C / 32T)        | VT-x + VT-d                       |
| RAM         | 192 GB                             | ample                             |
| Host GPU    | RTX 3060 Ti                        | keep for the Linux host           |
| Spare GPU   | Intel UHD 770 (currently disabled) | can serve as host display instead |
| Disk        | F: 118 GB free, H: 1138 GB free    | ample                             |

### The card you need to buy

macOS drivers bind by PCI ID, so only cards Apple already ships a driver for
will work. Those drivers are **already on your disk** — they just have nothing
to bind to.

| Card              | macOS driver          | Price (used) | Notes                                                                                           |
| ----------------- | --------------------- | ------------ | ----------------------------------------------------------------------------------------------- |
| **RX 580 8GB**    | `AMDRadeonX4000.kext` | €70–100      | The community default. What an `iMac19,1` shipped with, so it matches your SMBIOS. Recommended. |
| RX 5500 XT        | `AMDRadeonX5000.kext` | €100–140     | Navi 10; needs `agdpmod=pikera`                                                                 |
| RX 6600 / 6600 XT | `AMDRadeonX6000.kext` | €150–200     | Newer, Metal 3, lower power                                                                     |

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

|                | WSL2 today               | After passthrough         |
| -------------- | ------------------------ | ------------------------- |
| Metal          | `NULL`                   | working                   |
| iOS Simulators | impossible               | working                   |
| Window borders | opaque 1px stroke        | properly composited       |
| Cursor         | software, laggy          | hardware                  |
| Audio          | no driver attaches       | works                     |
| Display        | remote encode over SPICE | native, direct to monitor |

The one thing passthrough does **not** fix is Apple ID sign-in: that is the
placeholder SMBIOS (serial `W00000000001`, all-zero UUID), and it needs a
GenSMBIOS-generated `PlatformInfo` in OpenCore. Xcode requires a working Apple
ID, so this must be solved too — see [`07-smbios.md`](07-smbios.md).

## Is this worth doing?

Usually not. Read this before starting.

| Option                        | Cost      | Ongoing effort               | Gets simulators |
| ----------------------------- | --------- | ---------------------------- | --------------- |
| Keep the WSL2 VM              | €0        | none                         | no              |
| Dual-boot Linux + RX 580      | ~€85      | reboot for every session     | yes             |
| Linux as primary OS + RX 580  | ~€85      | relearn the desktop          | yes             |
| Used M-series Mac mini        | ~€450–500 | none                         | yes, and faster |

**The hidden cost is maintenance, not money.** A Hackintosh VM breaks in ways
real hardware does not — one session of work here hit the SMP install trap, an
Electron redraw bug, a sound card no driver will bind to, and Apple ID
rejection from a placeholder SMBIOS. Every macOS update can re-break any of it.

**Dual-boot sounds like the compromise but rarely is.** If testing a build
means closing everything, rebooting, starting a VM, and rebooting back, it gets
done twice and then abandoned.

If the goal is genuinely iOS development, a used **M-series Mac mini** is the
honest answer: faster than any passthrough Hackintosh, Apple ID works with no
SMBIOS forgery, it survives updates, and the Windows machine stays untouched.
You can leave it on the network and remote in.

This path makes sense in one case: you have a **spare machine** to dedicate to
it, or you want the build itself as much as the result.

### What the current VM is still good for

Everything that does not need a GPU: file work, Safari testing, shell scripting
against macOS, checking how something renders, running the toolkit. Only
Metal-dependent things are out — simulators, correct window compositing, and a
hardware cursor.
