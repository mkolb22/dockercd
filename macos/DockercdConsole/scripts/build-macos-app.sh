#!/usr/bin/env bash
set -euo pipefail

swift build -c debug

APP_PATH=".build/debug/DockercdConsole.app"
CONTENTS_PATH="${APP_PATH}/Contents"
mkdir -p "${CONTENTS_PATH}/MacOS"
cp ".build/debug/DockercdConsole" "${CONTENTS_PATH}/MacOS/DockercdConsole"
cp "Resources/Info.plist" "${CONTENTS_PATH}/Info.plist"

# SwiftPM may sign its build product before this script replaces bundle
# contents. Sign the finished bundle last so macOS accepts the packaged app.
xattr -cr "${APP_PATH}"
codesign --force --deep --sign - "${APP_PATH}"
codesign --verify --deep --strict --verbose=2 "${APP_PATH}"

echo "Built ${APP_PATH}"
