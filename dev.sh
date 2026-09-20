#!/usr/bin/env bash
# Spin up the whole Groundtruth stack locally: pipeline API (FastAPI) + web UI (Vite).
#
#   ./dev.sh                 fixture provider — synthetic assets, no credits, no network
#   ./dev.sh --meshy         live Meshy provider — SPENDS REAL CREDITS (needs server/.env)
#   ./dev.sh --sim           frontend only, browser simulation mode (no backend at all)
#   ./dev.sh --api-port 8001 --web-port 5174
#   ./dev.sh --fixture-delay 10     fake queued->running->succeeded transitions
#
# Ctrl-C stops both processes.
set -euo pipefail
set -m   # own process group per background job, so cleanup kills uvicorn's children too

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVER="$ROOT/server"
WEB="$ROOT/web"

PROVIDER=fixture
API_PORT=8000
WEB_PORT=5173
FIXTURE_DELAY=0
RUN_API=1

while [[ $# -gt 0 ]]; do
  case "$1" in
    --meshy)         PROVIDER=meshy; shift ;;
    --fixture)       PROVIDER=fixture; shift ;;
    --sim)           RUN_API=0; shift ;;
    --api-port)      API_PORT="$2"; shift 2 ;;
    --web-port)      WEB_PORT="$2"; shift 2 ;;
    --fixture-delay) FIXTURE_DELAY="$2"; shift 2 ;;
    -h|--help)       sed -n '2,10p' "$0" | cut -c3-; exit 0 ;;
    *) echo "unknown flag: $1 (try --help)" >&2; exit 2 ;;
  esac
done

say()  { printf '\033[35m[dev]\033[0m %s\n' "$*"; }
die()  { printf '\033[31m[dev] %s\033[0m\n' "$*" >&2; exit 1; }

port_busy() { (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null && { exec 3<&-; return 0; } || return 1; }

# ---------------------------------------------------------------- dependencies
command -v node >/dev/null || die "node is not installed"
if [[ ! -d "$WEB/node_modules" ]]; then
  say "installing frontend deps (npm install)…"
  (cd "$WEB" && npm install)
fi

PY="$SERVER/.venv/bin/python"
if [[ $RUN_API -eq 1 ]]; then
  if [[ ! -x "$PY" ]]; then
    say "creating server/.venv…"
    command -v python3 >/dev/null || die "python3 is not installed"
    python3 -m venv "$SERVER/.venv"
    # Deps only — the package is deliberately NOT pip-installed; imports resolve from server/.
    "$PY" -m pip install --quiet --upgrade pip
    "$PY" -m pip install --quiet \
      "fastapi>=0.115,<1" "uvicorn>=0.30,<1" "pydantic>=2.9,<3" "httpx>=0.28,<1" \
      "python-multipart>=0.0.20,<1" "numpy>=2,<3" "shapely>=2.1,<3" "trimesh>=4.6,<6" \
      "pyproj>=3.7,<4" "pillow>=11,<13" "pytest>=8,<10" "ruff>=0.11,<1"
  fi
fi

# ---------------------------------------------------------------- environment
if [[ $RUN_API -eq 1 && $PROVIDER == meshy ]]; then
  [[ -f "$SERVER/.env" ]] || die "--meshy needs server/.env (copy server/.env.example and add MESHY_API_KEY)"
  # Nothing in app/ loads a dotenv file and `uvicorn --env-file` crashes without python-dotenv,
  # so the only way the key reaches the process is exporting it here.
  set -a; . "$SERVER/.env"; set +a
  [[ -n "${MESHY_API_KEY:-}" ]] || die "MESHY_API_KEY is empty in server/.env"
  export PIPELINE_PROVIDER=meshy
  say "provider: meshy — THIS SPENDS REAL CREDITS (cap: ${PIPELINE_MAX_SUBMISSIONS:-12} submissions)"
else
  export PIPELINE_PROVIDER=fixture
  export PIPELINE_FIXTURE_DELAY_SECONDS="$FIXTURE_DELAY"
  unset MESHY_API_KEY
fi
export PIPELINE_CORS_ORIGINS="http://localhost:$WEB_PORT,http://127.0.0.1:$WEB_PORT"

# The frontend reads VITE_API_BASE at build/dev-server start; unset == browser simulation mode.
ENV_LOCAL="$WEB/.env.local"
if [[ $RUN_API -eq 1 ]]; then
  printf '# written by dev.sh — unset VITE_API_BASE for browser simulation mode\nVITE_API_BASE=http://localhost:%s\n' "$API_PORT" > "$ENV_LOCAL"
else
  printf '# written by dev.sh --sim — simulation mode, no backend\n' > "$ENV_LOCAL"
fi

# ---------------------------------------------------------------- backend
API_JOB=""
WEB_JOB=""
cleanup() {
  # Each background job has its own process group (set -m), so the negative pid reaches
  # uvicorn's reloader children and vite's esbuild workers, not just the head of the pipe.
  for job in "$WEB_JOB" "$API_JOB"; do
    [[ -n "$job" ]] && kill -- "-$job" 2>/dev/null || true
  done
  wait 2>/dev/null || true
}
trap cleanup EXIT INT TERM

if [[ $RUN_API -eq 1 ]]; then
  if port_busy "$API_PORT"; then die "port $API_PORT is already in use (try --api-port)"; fi
  say "starting pipeline API on :$API_PORT (provider=$PIPELINE_PROVIDER)…"
  ( cd "$SERVER" && exec .venv/bin/uvicorn app.main:app --reload --port "$API_PORT" 2>&1 \
      | sed -u 's/^/\x1b[36m[api]\x1b[0m /' ) &
  API_JOB=$!

  HEALTH=""
  for _ in $(seq 1 60); do
    HEALTH="$(curl -fsS "http://localhost:$API_PORT/v1/health" 2>/dev/null || true)"
    [[ -n "$HEALTH" ]] && break
    sleep 0.5
  done
  [[ -n "$HEALTH" ]] || die "API did not answer /v1/health on :$API_PORT — see the [api] output above"
  say "health: $HEALTH"
  # `provider` alone proves nothing: it reads "meshy" by default even with no key. `live` is the proof.
  if [[ $PROVIDER == meshy && "$HEALTH" != *'"live":true'* ]]; then
    die "provider reports live=false — the key did not arrive; nothing generated would be real"
  fi
fi

# ---------------------------------------------------------------- frontend
if port_busy "$WEB_PORT"; then die "port $WEB_PORT is already in use (try --web-port)"; fi
if [[ $RUN_API -eq 1 ]]; then
  say "web → http://localhost:$WEB_PORT  (wired to the API; header chip should read 'Pipeline API connected')"
else
  say "web → http://localhost:$WEB_PORT  (LOCAL SIMULATION — output is not AI generation)"
fi
( cd "$WEB" && exec npm run dev -- --port "$WEB_PORT" --strictPort ) &
WEB_JOB=$!

# Wait on whichever side exits first; the EXIT trap tears the other one down. Waiting (rather
# than running vite in the foreground) is what lets Ctrl-C run the trap right away.
wait -n $API_JOB $WEB_JOB   # unquoted: in --sim mode API_JOB is empty and drops out 2>/dev/null || true
say "a process exited — shutting the other one down"
