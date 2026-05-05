#!/bin/bash
PID=$(cat /tmp/vmui-mac.pid)
CLK=$(getconf CLK_TCK)
read_ust() { awk '{n=index($0,")"); s=substr($0,n+1); split(s,a," "); print a[12]+a[13]}' /proc/$PID/stat; }
A=$(read_ust)
sleep 2
B=$(read_ust)
DELTA=$((B-A))
echo "pid=$PID clk=$CLK utime+stime delta over 2s: $DELTA ticks"
echo "cpu_seconds: $(echo "scale=3; $DELTA/$CLK" | bc)"
echo "busy_cores: $(echo "scale=3; $DELTA/$CLK/2" | bc)"
echo "--cmdline-smp--"
tr '\0' ' ' < /proc/$PID/cmdline | grep -oE -- '-smp [^ ]+'
echo "--threads--"
ls /proc/$PID/task | wc -l
