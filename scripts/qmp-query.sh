#!/bin/bash
{
  echo '{"execute":"qmp_capabilities"}'
  sleep 0.3
  echo '{"execute":"query-status"}'
  sleep 0.3
  echo '{"execute":"query-kvm"}'
  sleep 0.3
  echo '{"execute":"human-monitor-command","arguments":{"command-line":"info registers"}}'
  sleep 0.5
} | nc -q 2 127.0.0.1 4445
