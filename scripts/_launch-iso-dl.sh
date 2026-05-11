#!/bin/bash
setsid nohup bash /mnt/e/gh/vmui/scripts/dl-enterprise-iso.sh </dev/null >/tmp/win-iso-dl.log 2>&1 &
disown
echo "launched pid=$!"