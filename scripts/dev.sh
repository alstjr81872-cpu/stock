#!/usr/bin/env bash
set -euo pipefail
cd /workspace/stock
runtime=/workspace/novelforge-runtime
mkdir -p "$runtime/firebase-cache" "$runtime/config"
export FIREBASE_EMULATORS_PATH="$runtime/firebase-cache" XDG_CONFIG_HOME="$runtime/config"
export NF_MODE=emulator NF_AI_MODE="${NF_AI_MODE:-mock}" GCLOUD_PROJECT=demo-novelforge
export FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 STORAGE_EMULATOR_HOST=http://127.0.0.1:9199
if [ ! -f .env.local ]; then cp .env.example .env.local; fi
# Do not reuse unknown services or kill unrelated listeners.
python3 - <<'PY'
import socket
for p in [3000,8000,8080,9099,9199,4000,4400,4500]:
 with socket.socket() as s:
  if s.connect_ex(('127.0.0.1',p))==0:raise SystemExit(f'Port {p} is occupied. Reuse or stop only a verified NovelForge process before restarting.')
PY
export NEXT_PUBLIC_USE_EMULATORS=1 NEXT_PUBLIC_FIREBASE_API_KEY=demo-key NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=demo-novelforge.firebaseapp.com NEXT_PUBLIC_FIREBASE_PROJECT_ID=demo-novelforge NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=demo-novelforge.appspot.com NEXT_PUBLIC_FIREBASE_APP_ID=demo-app
pids=()
cleanup(){ trap - EXIT INT TERM; for pid in "${pids[@]}"; do kill "$pid" 2>/dev/null || true; done; wait || true; }
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
emulator_args=()
if [ -d "$runtime/emulator-data" ]; then emulator_args+=(--import "$runtime/emulator-data"); fi
node_modules/.bin/firebase emulators:start --only auth,firestore,storage --project demo-novelforge --export-on-exit "$runtime/emulator-data" "${emulator_args[@]}" > "$runtime/emulators.log" 2>&1 &
pids+=("$!")
.venv/bin/python - <<'PY'
import socket,time
for _ in range(90):
 ready=True
 for p in [8080,9099,9199]:
  with socket.socket() as s:
   s.settimeout(.2)
   if s.connect_ex(('127.0.0.1',p)):ready=False
 if ready:break
 time.sleep(1)
else:raise SystemExit('Firebase emulators did not become ready. Inspect /workspace/novelforge-runtime/emulators.log. Download requires storage.googleapis.com.')
PY
.venv/bin/python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000 > "$runtime/backend.log" 2>&1 &
pids+=("$!")
# Verify the actual local Auth/Firestore/Storage path before serving the frontend.
.venv/bin/python -m pytest tests/integration -q
NEXT_DIST_DIR=.next-dev node_modules/.bin/next dev --hostname 127.0.0.1 --port 3000 &
pids+=("$!")
wait -n "${pids[@]}"
