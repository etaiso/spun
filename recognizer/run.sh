#!/usr/bin/env bash
# Start the Shazam recognizer sidecar. Creates a local venv + installs deps on
# first run, then launches uvicorn on 127.0.0.1:8755.
set -euo pipefail
cd "$(dirname "$0")"

if [ ! -d .venv ]; then
  echo "Creating venv + installing deps (first run)…"
  python3 -m venv .venv
  ./.venv/bin/pip install --quiet --upgrade pip
  ./.venv/bin/pip install --quiet -r requirements.txt
fi

# Point Python's SSL at certifi so ShazamIO's internal HTTPS calls verify too.
export SSL_CERT_FILE="$(./.venv/bin/python -c 'import certifi; print(certifi.where())')"

PORT="${RECOGNIZER_PORT:-8755}"
echo "Recognizer listening on http://127.0.0.1:${PORT}"
exec ./.venv/bin/uvicorn main:app --host 127.0.0.1 --port "${PORT}"
