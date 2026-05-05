#!/bin/bash
# Survey bloat candidates on the macOS guest.
echo "=== /Applications ==="
ls /Applications/
echo
echo "=== top sizes ==="
du -sh /Applications/* 2>/dev/null | sort -rh | head -30
echo
echo "=== loaded GUI launchd jobs (Apple cloud/services) ==="
launchctl print gui/501 2>/dev/null | grep -iE 'com.apple.(siri|gamec|music|tv|findmy|stocks|news|maps|weather|home|facetime|knowledge|photoanalysis|mediaanalysis|cloudd|bird|assistantd|parsec|suggest|spotlight|search|donotdisturb|continuity|airplay|sidecar)' | sort -u | head -60
echo
echo "=== system disabled report ==="
launchctl print-disabled system 2>/dev/null | grep -i disabled | head -30
