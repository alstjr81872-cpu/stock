#!/usr/bin/env bash
set -euo pipefail
cd /workspace/stock
node -e 'if(Number(process.versions.node.split(".")[0])<24)throw Error("Node.js 24+ required")'
python3 -c 'import sys; assert sys.version_info[:2] in [(3,11),(3,12)], "Python 3.11/3.12 required"'
java -version
npm ci --cache /tmp/novelforge-npm-cache --no-audit --no-fund
if [ ! -x .venv/bin/python ]; then python3 -m venv .venv; fi
.venv/bin/python -m pip install --disable-pip-version-check --cache-dir /tmp/novelforge-pip-cache -r requirements.lock
PIP_CACHE_DIR=/tmp/novelforge-pip-cache .venv/bin/python -m pip check
if [ ! -f .env.local ]; then cp .env.example .env.local; fi
npm run typecheck
npm run build
# Firebase CLI verifies downloaded artifact checksums and HTTPS.
export FIREBASE_EMULATORS_PATH=/workspace/novelforge-runtime/firebase-cache
export XDG_CONFIG_HOME=/workspace/novelforge-runtime/config
mkdir -p "$FIREBASE_EMULATORS_PATH" "$XDG_CONFIG_HOME"
node_modules/.bin/firebase setup:emulators:firestore
node_modules/.bin/firebase setup:emulators:storage

node_modules/.bin/firebase setup:emulators:ui
