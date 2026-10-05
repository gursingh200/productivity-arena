#!/bin/bash
# Creates the code-signing certificate CI signs releases with, once.
# Writes ~/.arena/release-signing.p12 and its password; does not touch your keychain.
# Every release must be signed with this same certificate: installed apps only
# accept updates signed like themselves. Keep both files safe.
set -euo pipefail

DIR="$HOME/.arena"
P12="$DIR/release-signing.p12"
PASSFILE="$DIR/release-signing.password"
NAME="Arena Release Signing"

mkdir -p "$DIR"
chmod 700 "$DIR"
if [ -e "$P12" ] || [ -e "$PASSFILE" ]; then
  echo "$P12 or $PASSFILE already exists; not overwriting." >&2
  exit 1
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
PASS="$(openssl rand -hex 24)"
/usr/bin/openssl req -x509 -newkey rsa:2048 -keyout "$TMP/key.pem" -out "$TMP/cert.pem" -days 3650 -nodes -config "$TMP/cert.cnf" 2>/dev/null
( umask 077; /usr/bin/openssl pkcs12 -export -out "$P12" -inkey "$TMP/key.pem" -in "$TMP/cert.pem" -name "$NAME" -passout "pass:$PASS" )
( umask 077; printf '%s' "$PASS" > "$PASSFILE" )
chmod 600 "$P12" "$PASSFILE"

cat <<MSG
Created:
  $P12
  $PASSFILE

Add them to your private source repo's GitHub secrets:
  base64 -i "$P12" | gh secret set MAC_SIGNING_P12 --repo <owner>/<source-repo>
  gh secret set MAC_SIGNING_PASSWORD --repo <owner>/<source-repo> < "$PASSFILE"
MSG
