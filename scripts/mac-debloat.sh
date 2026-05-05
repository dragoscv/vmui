#!/bin/bash
# Debloat the macOS guest by disabling Apple LaunchAgents/Daemons that:
#   - Never work in a VM with no iCloud / no AppleID / no GPU
#   - Eat RAM and CPU even when their app is closed
#
# SIP forbids removing /System/Library LaunchAgents, but `launchctl disable`
# adds them to ~/var/db/com.apple.xpc.launchd/disabled.501.plist and they
# never start again until re-enabled.
#
# Reversible: `launchctl enable gui/501/<label>` and reboot.
set -u

UID_=501

# Per-user GUI agents that are pure cloud/AppleID/iPad/voice features.
# Anything that requires iCloud login will spin idle here forever.
GUI_DISABLE=(
  # Siri / voice
  com.apple.assistantd
  com.apple.siriactionsd
  com.apple.siriinferenced
  com.apple.sirittsd
  com.apple.SiriTTSTrainingAgent

  # Maps (no use if you don't open Maps.app)
  com.apple.Maps.mapspushd
  com.apple.Maps.mapssyncd
  com.apple.maps.destinationd

  # News (UK/EU often have it removed already; daemon still loads)
  com.apple.newsd

  # FindMy needs iCloud
  com.apple.findmymacmessenger
  com.apple.findmy.findmylocateagent

  # HomeKit
  com.apple.homeenergyd

  # Sidecar (iPad-as-display, useless in QEMU)
  com.apple.sidecar-display-agent
  com.apple.sidecar-relay

  # Spotlight Suggestions / knowledge graph (privacy-leaky and CPU heavy)
  com.apple.spotlightknowledged
  com.apple.spotlightknowledged.importer
  com.apple.knowledgeconstructiond
  com.apple.knowledge-agent
  com.apple.suggestd

  # iCloud Drive / Photos analysis
  com.apple.cloudd
  com.apple.bird
  com.apple.mediaanalysisd

  # Weather widget
  com.apple.weatherd

  # Focus modes / DnD
  com.apple.donotdisturbd

  # Game controllers
  com.apple.GameController.gamecontrolleragentd

  # Photos / Music / TV cloud sync (no AppleID)
  com.apple.photoanalysisd
  com.apple.amp.mediasharingd
  com.apple.amsaccountsd
  com.apple.amsengagementd
  com.apple.itunescloudd
  com.apple.iTunesHelper
  com.apple.tipsd

  # FaceTime / iMessage / continuity (no AppleID, no nearby Apple devices)
  com.apple.imagent
  com.apple.imautomatichistorydeletionagent
  com.apple.imtransferagent
  com.apple.identityservicesd
  com.apple.continuityidsd
  com.apple.rapportd
  com.apple.sharingd
  com.apple.AirPlayXPCHelper

  # Translation / on-device dictation (no useful UI in our setup)
  com.apple.translationd
  com.apple.corespeechd

  # Apple Wallet / passes
  com.apple.passd

  # Game Center
  com.apple.gamed

  # Family Sharing / Screen Time
  com.apple.familycircled
  com.apple.familycontrols.useragent
  com.apple.ScreenTimeAgent

  # AskPermission (parental approvals)
  com.apple.askpermissiond

  # Universal Clipboard / Handoff
  com.apple.UserNotificationCenter
)

echo "=== disabling ${#GUI_DISABLE[@]} GUI agents ==="
for label in "${GUI_DISABLE[@]}"; do
  launchctl disable "gui/${UID_}/${label}" 2>&1 \
    | grep -vE "^$|Service is already disabled" \
    | sed "s|^|  ${label}: |" || true
done

echo
echo "=== killing currently-running instances (they're already disabled, so they won't restart) ==="
for label in "${GUI_DISABLE[@]}"; do
  proc=${label##*.}
  killall -9 "$proc" 2>/dev/null && echo "  killed $proc" || true
done

echo
echo "=== verifying ==="
disabled=$(launchctl print-disabled "gui/${UID_}" 2>/dev/null | grep -c "=> disabled")
echo "Total disabled in gui/${UID_}: ${disabled}"

echo
echo "=== before/after RAM (pages of ~4 KB) ==="
vm_stat | head -8

echo "DONE — log out and back in (or reboot) for full effect."
