#!/bin/bash
# Builds a signed Arena release for the public releases repo (run by CI).
#
# Required env:
#   ARENA_VERSION             e.g. 0.1.42
#   ARENA_BUILD               e.g. 42 (must grow with every release)
#   ARENA_SIGN_IDENTITY       code-signing identity already in the keychain
#   ARENA_UPDATE_REPO         owner/repo of the public releases repo
#   ARENA_UPDATE_PUBLIC_KEY   base64 Ed25519 public key, built into the app
#   ARENA_UPDATE_SIGNING_KEY  base64 Ed25519 private key (secret; never printed)
# Optional: ARENA_BUNDLE_ID
#
# Output (upload both to the release tagged v$ARENA_VERSION):
#   mac/dist/release/Arena-$ARENA_VERSION.zip
#   mac/dist/release/latest.json
set -euo pipefail

for name in ARENA_VERSION ARENA_BUILD ARENA_SIGN_IDENTITY ARENA_UPDATE_REPO ARENA_UPDATE_PUBLIC_KEY ARENA_UPDATE_SIGNING_KEY; do
  if [ -z "${!name:-}" ]; then
    echo "release.sh: $name is not set" >&2
    exit 1
  fi
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MAC_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
OUT="$MAC_DIR/dist/release"
ZIP_NAME="Arena-$ARENA_VERSION.zip"

cd "$MAC_DIR"
rm -rf "$OUT"
mkdir -p "$OUT"

echo "Building arena-sign..."
swift build -c release --product arena-sign
SIGN="$(swift build -c release --show-bin-path)/arena-sign"

# The update base URL is for local testing only; releases always use GitHub.
unset ARENA_UPDATE_BASE_URL
"$SCRIPT_DIR/build-app.sh"
codesign --verify --strict --verbose=1 "$MAC_DIR/dist/Arena.app"

echo "Packaging $ZIP_NAME..."
ditto -c -k --keepParent "$MAC_DIR/dist/Arena.app" "$OUT/$ZIP_NAME"
SHA256="$(shasum -a 256 "$OUT/$ZIP_NAME" | awk '{print $1}')"
SIGNATURE="$("$SIGN" sign "$OUT/$ZIP_NAME")"
"$SIGN" verify "$OUT/$ZIP_NAME" "$SIGNATURE" "$ARENA_UPDATE_PUBLIC_KEY" >/dev/null

cat > "$OUT/latest.json" <<JSON
{"version":"$ARENA_VERSION","build":$ARENA_BUILD,"zip":"$ZIP_NAME","sha256":"$SHA256","signature":"$SIGNATURE","minimumSystemVersion":"14.0"}
JSON

echo "Release ready in $OUT:"
ls -lh "$OUT"
