#!/bin/bash
for i in {1..40}; do
  echo "try $i"
  if SSHPASS=REDACTED_GUEST_PASSWORD sshpass -e ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o ConnectTimeout=5 -o PreferredAuthentications=password -p 10024 dragos@127.0.0.1 'echo OK; uname -a'; then
    echo SSH_READY
    exit 0
  fi
  sleep 5
done
exit 1
