#!/usr/bin/env bash
set -euo pipefail
cd /workspace/stock
.venv/bin/python -m pytest backend/tests -q
npm run typecheck
npm run build
# Requires running Auth/Firestore/Storage emulators (scripts/dev.sh).
.venv/bin/python -m pytest tests/integration -q
npm run test:rules
npm run test:e2e:firebase
