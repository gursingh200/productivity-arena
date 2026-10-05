#!/bin/bash
# Runs the ArenaCore tests with Command Line Tools only (no Xcode).
# Swift Testing ships in the CLT frameworks folder; its Foundation overlay has
# no module files there, so cross-import overlays are disabled.
set -euo pipefail
cd "$(dirname "$0")/.."
FW=/Library/Developer/CommandLineTools/Library/Developer/Frameworks
if [ -d "$FW/Testing.framework" ]; then
    swift test \
        -Xswiftc "-F$FW" -Xswiftc -Xfrontend -Xswiftc -disable-cross-import-overlays \
        -Xlinker "-F$FW" -Xlinker -rpath -Xlinker "$FW" "$@"
else
    swift test "$@"
fi
