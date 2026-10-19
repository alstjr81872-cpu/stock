#!/usr/bin/env bash
set -euo pipefail
cd /workspace/stock
export XDG_CONFIG_HOME=/workspace/novelforge-runtime/config
export WRANGLER_SEND_METRICS=false
mkdir -p "$XDG_CONFIG_HOME"
node -e 'if(Number(process.versions.node.split(".")[0])<24)throw Error("Node.js 24+ required")'
npm ci --cache /tmp/novelforge-npm-cache --no-audit --no-fund
npm run test:cloud
npm run build:cloud
npm run check:cloud
