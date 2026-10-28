#!/usr/bin/env bash
# Builds the Mac App Store edition and wraps it in a signed installer package.
#   scripts/appstore-pkg.sh            -> build + Reviewly-<version>-appstore.pkg
#   scripts/appstore-pkg.sh --upload   -> also uploads it to App Store Connect
# Upload needs an App Store Connect API key: APPLE_API_KEY (key id) and
# APPLE_API_ISSUER, with AuthKey_<id>.p8 in ~/.appstoreconnect/private_keys.
set -euo pipefail
cd "$(dirname "$0")/.."

version=$(node -p 'require("./src-tauri/tauri.conf.json").version')
bundle=src-tauri/target/universal-apple-darwin/release/bundle/macos/Reviewly.app
pkg=src-tauri/target/universal-apple-darwin/release/bundle/Reviewly-$version-appstore.pkg

bun run tauri build --config src-tauri/tauri.appstore.conf.json --target universal-apple-darwin \
  -- --no-default-features --features custom-protocol,appstore

productbuild --component "$bundle" /Applications \
  --sign "${APPLE_INSTALLER_IDENTITY:-3rd Party Mac Developer Installer}" "$pkg"
echo "built $pkg"

if [[ "${1:-}" == "--upload" ]]; then
  xcrun altool --upload-app -f "$pkg" -t macos \
    --apiKey "$APPLE_API_KEY" --apiIssuer "$APPLE_API_ISSUER"
fi
