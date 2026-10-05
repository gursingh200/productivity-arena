#!/bin/bash
# Creates a self-signed "Arena Local Signing" code-signing certificate in your
# login keychain, once. build-app.sh signs with it so every build has the same
# identity and Keychain's "Always Allow" keeps working across rebuilds.
# Local development only; releases for teammates use a Developer ID.
# Remove it any time in Keychain Access (search "Arena Local Signing").
set -euo pipefail

NAME="Arena Local Signing"
if security find-identity -p codesigning | grep -q "\"$NAME\""; then
  echo "\"$NAME\" already exists."
  exit 0
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
cat > "$TMP/cert.cnf" <<CNF
[req]
distinguished_name = dn
x509_extensions = ext
prompt = no
[dn]
CN = $NAME
[ext]
basicConstraints = critical,CA:false
keyUsage = critical,digitalSignature
extendedKeyUsage = critical,codeSigning
CNF
PASS="$(openssl rand -hex 16)"
/usr/bin/openssl req -x509 -newkey rsa:2048 -keyout "$TMP/key.pem" -out "$TMP/cert.pem" -days 3650 -nodes -config "$TMP/cert.cnf" 2>/dev/null
/usr/bin/openssl pkcs12 -export -out "$TMP/id.p12" -inkey "$TMP/key.pem" -in "$TMP/cert.pem" -passout "pass:$PASS"
security import "$TMP/id.p12" -k "$HOME/Library/Keychains/login.keychain-db" -P "$PASS" -T /usr/bin/codesign
echo "Created \"$NAME\". Rebuild with scripts/build-app.sh; the first launch asks for Keychain access once more."
