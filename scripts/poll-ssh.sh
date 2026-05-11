for i in $(seq 1 20); do
  echo "=== try $i (t=$((i*30))s) ==="
  banner=$(timeout 5 bash -c "exec 3<>/dev/tcp/127.0.0.1/10024 && head -c 200 <&3" 2>/dev/null || true)
  if echo "$banner" | grep -q SSH; then
    echo "SSH_BANNER: $banner"
    break
  fi
  echo "  no SSH yet"
  sleep 30
done
