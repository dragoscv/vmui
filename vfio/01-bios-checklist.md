# Step 1 — BIOS settings (Gigabyte Z790 AORUS ELITE AX)

Do this first. Nothing later works without IOMMU, and a wrong setting here
shows up as a confusing failure three steps down.

Enter with **DEL** at boot, then **F2** for Advanced Mode.

## Required

| Setting                | Value       | Where                                 | Why                                               |
| ---------------------- | ----------- | ------------------------------------- | ------------------------------------------------- |
| Intel VT-x             | Enabled     | Settings → Miscellaneous → Intel VT-x | CPU virtualisation                                |
| **Intel VT-d**         | **Enabled** | Settings → Miscellaneous → Intel VT-d | **IOMMU. Without it there is no passthrough.**    |
| Above 4G Decoding      | Enabled     | Settings → Miscellaneous → PCIe       | GPUs need 64-bit BAR space                        |
| Initial Display Output | IGFX        | Settings → Platform Power / Display   | Host boots on the iGPU, leaving the AMD card free |
| Internal Graphics      | Enabled     | Settings → Chipset                    | Your UHD 770 currently reads "disabled"           |

## Recommended

| Setting             | Value    | Why                                                          |
| ------------------- | -------- | ------------------------------------------------------------ |
| Re-Size BAR Support | Disabled | Resizable BAR commonly breaks GPU passthrough reset          |
| CSM Support         | Disabled | UEFI-only; OpenCore expects UEFI                             |
| Secure Boot         | Disabled | Unsigned vfio/OpenCore bits will not load otherwise          |
| CFG Lock / MSR 0xE2 | Disabled | macOS panics if MSR E2 is locked (may be hidden — see below) |

### If CFG Lock is not visible

Gigabyte often hides it. Two options:

- Set `AppleCpuPmCfgLock` and `AppleXcpmCfgLock` to `true` in OpenCore's
  `config.plist` → `Kernel/Quirks` (simplest; already common on Hackintoshes), or
- Unlock the hidden setting with `modGRUBShell`/`setup_var`. Riskier.

## Physical install

1. Power off, unplug, hold the power button 5 s to drain.
2. Fit the AMD card in the **second** x16 slot; keep the 3060 Ti where it is.
3. Connect its 8-pin PCIe power (RX 580 ≈ 185 W — do not use a Molex adapter).
4. Plug your monitor into the **motherboard** output for now (iGPU).
5. Leave a display attached to the AMD card, or fit a dummy HDMI plug —
   macOS may not initialise a headless GPU.

## Verify before continuing

Boot Linux and check:

```bash
dmesg | grep -e DMAR -e IOMMU        # want "DMAR: IOMMU enabled"
lspci -nn | grep -Ei 'vga|audio'     # both GPUs listed, with their PCI IDs
```

If `DMAR: IOMMU enabled` is absent, VT-d is off or the kernel flag is missing.
Fix that before running `02-host-setup.sh`.
