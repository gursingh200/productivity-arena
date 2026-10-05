#!/bin/bash
# Build Arena.app for macOS release.
# Output: mac/dist/Arena.app
# Requires: Swift Command Line Tools (no Xcode IDE needed), macOS 14+
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MAC_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
DIST_DIR="$MAC_DIR/dist"
APP_DIR="$DIST_DIR/Arena.app"
CONTENTS_DIR="$APP_DIR/Contents"
MACOS_DIR="$CONTENTS_DIR/MacOS"
RESOURCES_DIR="$CONTENTS_DIR/Resources"
# Build-time settings (all optional for a local build):
#   ARENA_VERSION            CFBundleShortVersionString, default 0.1.0
#   ARENA_BUILD              CFBundleVersion, an integer that grows with each release, default 1
#   ARENA_BUNDLE_ID          default io.clueso.arena
#   ARENA_UPDATE_REPO        owner/repo of the public releases repo; with
#   ARENA_UPDATE_PUBLIC_KEY  the base64 Ed25519 public key (arena-sign keygen),
#                            the app updates itself. Without both, updates are off.
#   ARENA_UPDATE_BASE_URL    only for testing against a local server
#   ARENA_SIGN_IDENTITY      code-signing identity (see "Code signing" below)
#   ARENA_SERVER_URL         your Arena website, e.g. https://arena.example.com; lets
#                            "Connect to Arena…" open it without asking for the address
BUNDLE_ID="${ARENA_BUNDLE_ID:-io.clueso.arena}"
APP_VERSION="${ARENA_VERSION:-0.1.0}"
APP_BUILD="${ARENA_BUILD:-1}"
UPDATE_REPO="${ARENA_UPDATE_REPO:-}"
UPDATE_KEY="${ARENA_UPDATE_PUBLIC_KEY:-}"
UPDATE_BASE_URL="${ARENA_UPDATE_BASE_URL:-}"

[[ "$BUNDLE_ID" =~ ^[A-Za-z0-9.-]+$ ]] || { echo "ARENA_BUNDLE_ID is invalid" >&2; exit 1; }
[[ "$APP_VERSION" =~ ^[0-9A-Za-z.+-]+$ ]] || { echo "ARENA_VERSION is invalid" >&2; exit 1; }
[[ "$APP_BUILD" =~ ^[0-9]+$ ]] || { echo "ARENA_BUILD must be an integer" >&2; exit 1; }
if [ -n "$UPDATE_REPO" ] || [ -n "$UPDATE_KEY" ]; then
  [[ "$UPDATE_REPO" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]] || { echo "ARENA_UPDATE_REPO must be owner/repo" >&2; exit 1; }
  [[ "$UPDATE_KEY" =~ ^[A-Za-z0-9+/]{43}=$ ]] || { echo "ARENA_UPDATE_PUBLIC_KEY must be a base64 Ed25519 public key" >&2; exit 1; }
fi

cd "$MAC_DIR"

echo "Building Arena (release)..."
swift build -c release --product Arena

BINARY="$(swift build -c release --show-bin-path)/Arena"

echo "Assembling Arena.app..."
rm -rf "$APP_DIR"
mkdir -p "$MACOS_DIR"
mkdir -p "$RESOURCES_DIR"

# Copy binary.
cp "$BINARY" "$MACOS_DIR/Arena"

# Write Info.plist.
cat > "$CONTENTS_DIR/Info.plist" << PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleIdentifier</key>
    <string>${BUNDLE_ID}</string>
    <key>CFBundleName</key>
    <string>Arena</string>
    <key>CFBundleDisplayName</key>
    <string>Arena</string>
    <key>CFBundleVersion</key>
    <string>${APP_BUILD}</string>
    <key>CFBundleShortVersionString</key>
    <string>${APP_VERSION}</string>
    <key>CFBundleExecutable</key>
    <string>Arena</string>
    <key>CFBundlePackageType</key>
    <string>APPL</string>
    <key>NSPrincipalClass</key>
    <string>NSApplication</string>
    <key>LSUIElement</key>
    <true/>
    <key>LSMinimumSystemVersion</key>
    <string>14.0</string>
    <key>CFBundleURLTypes</key>
    <array>
        <dict>
            <key>CFBundleURLSchemes</key>
            <array>
                <string>arena</string>
            </array>
            <key>CFBundleURLName</key>
            <string>${BUNDLE_ID}</string>
        </dict>
    </array>
    <key>NSHumanReadableCopyright</key>
    <string>Internal tool</string>
</dict>
</plist>
PLIST

# The website "Connect to Arena…" opens.
if [ -n "${ARENA_SERVER_URL:-}" ]; then
  [[ "$ARENA_SERVER_URL" =~ ^https?://[A-Za-z0-9.:-]+/?$ ]] || { echo "ARENA_SERVER_URL must be like https://arena.example.com" >&2; exit 1; }
  /usr/libexec/PlistBuddy -c "Add :ArenaServerURL string ${ARENA_SERVER_URL%/}" "$CONTENTS_DIR/Info.plist"
fi

# Self-update settings (see Sources/Arena/Updater.swift).
if [ -n "$UPDATE_REPO" ]; then
  /usr/libexec/PlistBuddy -c "Add :ArenaUpdateRepo string $UPDATE_REPO" "$CONTENTS_DIR/Info.plist"
  /usr/libexec/PlistBuddy -c "Add :ArenaUpdatePublicKey string $UPDATE_KEY" "$CONTENTS_DIR/Info.plist"
  if [ -n "$UPDATE_BASE_URL" ]; then
    /usr/libexec/PlistBuddy -c "Add :ArenaUpdateBaseURL string $UPDATE_BASE_URL" "$CONTENTS_DIR/Info.plist"
  fi
  echo "Updates: $UPDATE_REPO"
else
  echo "Updates: off (no ARENA_UPDATE_REPO)"
fi

# PkgInfo.
printf "APPL????" > "$CONTENTS_DIR/PkgInfo"

# Code signing. Keychain trusts an app by its signing identity: an ad-hoc
# signature changes on every build, so macOS asks for the Keychain password
# after each rebuild. A stable certificate keeps "Always Allow" working.
# Order: $ARENA_SIGN_IDENTITY (e.g. a Developer ID), then the local
# "Arena Local Signing" certificate (scripts/setup-signing.sh), then ad-hoc.
IDENTITY="${ARENA_SIGN_IDENTITY:-}"
if [ -z "$IDENTITY" ] && security find-identity -p codesigning | grep -q '"Arena Local Signing"'; then
  IDENTITY="Arena Local Signing"
fi
if [ -n "$IDENTITY" ]; then
  echo "Code signing with \"$IDENTITY\"..."
  codesign --force --sign "$IDENTITY" --options runtime "$APP_DIR"
else
  echo "Code signing (ad-hoc). Run scripts/setup-signing.sh once to stop Keychain prompts after rebuilds."
  codesign --force --sign - --options runtime "$APP_DIR"
fi

echo ""
echo "Arena.app built at: $APP_DIR"
ls -lh "$MACOS_DIR/Arena"
