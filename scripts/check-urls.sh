for u in https://cloud-images.ubuntu.com/releases/26.04/release/ubuntu-26.04-server-cloudimg-amd64.img https://cloud-images.ubuntu.com/releases/24.04/release/ubuntu-24.04-server-cloudimg-amd64.img https://cloud-images.ubuntu.com/releases/25.10/release/ubuntu-25.10-server-cloudimg-amd64.img; do
  code=$(curl -m 20 -sI -o /dev/null -w "%{http_code}" "$u")
  echo "code=[$code]  $u"
done