#!/usr/bin/env bash
set -euo pipefail
cd /workspace/stock
export XDG_CONFIG_HOME=/workspace/novelforge-runtime/config
export WRANGLER_SEND_METRICS=false
mkdir -p "$XDG_CONFIG_HOME"
# .dev.vars is ignored. Supply secrets securely; never echo its contents.
if [ ! -d out ]; then npm run build:cloud; fi
exec node_modules/.bin/wrangler dev --port 8787
