HASH=$(grep "password:" /tmp/u.txt | sed -E 's/.*password: "([^"]+)".*/\1/')
echo "HASH=[$HASH]"
export HASH
python3 -c 'import os,crypt; h=os.environ["HASH"]; print("computed:", crypt.crypt("REDACTED_GUEST_PASSWORD", h)); print("match:", crypt.crypt("REDACTED_GUEST_PASSWORD", h)==h)'
