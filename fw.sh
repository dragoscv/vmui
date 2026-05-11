ua="Mozilla/5.0"
for id in 2234173 2194444 2334167 2289029 2334364 2289033; do
  echo "--- $id ---"
  curl -sI -A "$ua" -o /dev/null -w "%{http_code} %{redirect_url}\n" "https://go.microsoft.com/fwlink/?linkid=${id}&clcid=0x409&culture=en-us&country=us"
done
