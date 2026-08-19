#!/bin/bash
# Guest-side performance tuning. Idempotent.
#
# The repo's scripts/mac-perf-tune.sh does the same thing over SSH from the
# host; this is the in-guest twin the menu-bar app calls.
set -u

echo "=== disabling window animations ==="
defaults write NSGlobalDomain NSAutomaticWindowAnimationsEnabled -bool false
defaults write NSGlobalDomain NSWindowResizeTime -float 0.001
defaults write com.apple.dock launchanim -bool false
defaults write com.apple.dock expose-animation-duration -float 0.1
defaults write com.apple.finder DisableAllAnimations -bool true
echo "  done"

echo
echo "=== disabling transparency (cheaper to encode over a remote display) ==="
defaults write com.apple.universalaccess reduceMotion -bool true
echo "  done"

echo
echo "=== Dock: no autohide delay ==="
defaults write com.apple.dock autohide-delay -float 0
defaults write com.apple.dock autohide-time-modifier -float 0.15
echo "  done"

echo
echo "=== preventing sleep (a sleeping guest drops the remote session) ==="
if sudo -n true 2>/dev/null; then
  sudo pmset -a sleep 0 displaysleep 0 disksleep 0 2>/dev/null && echo "  done"
else
  echo "  SKIPPED — needs an interactive sudo; run scripts/mac-perf-tune.sh from the host"
fi

echo
echo "=== Spotlight indexing ==="
if sudo -n true 2>/dev/null; then
  sudo mdutil -a -i off 2>/dev/null | sed 's/^/  /'
else
  echo "  SKIPPED — needs sudo"
fi

echo
echo "=== restarting Dock and Finder to apply ==="
killall Dock 2>/dev/null || true
killall Finder 2>/dev/null || true
echo "  done"

echo
echo "Tuning applied."
