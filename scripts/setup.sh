#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
node -e 'if (Number(process.versions.node.split(".")[0]) < 24) throw new Error("Node.js 24+ is required")'
npm ci --cache /tmp/stock-studio-npm-cache
if [ ! -x .venv/bin/python ]; then
  python -m venv .venv
fi
.venv/bin/python -m pip install --disable-pip-version-check --cache-dir /tmp/stock-studio-pip-cache -r requirements.txt
python scripts/setup_models.py
npm run build
