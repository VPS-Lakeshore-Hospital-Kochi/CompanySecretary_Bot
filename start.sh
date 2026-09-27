#!/usr/bin/env bash
# Start the CS Assistant (Mac / Linux). Double-click or run: ./start.sh
set -e
cd "$(dirname "$0")"
if [ ! -d .venv ]; then
  echo "First run: setting up (this takes a minute)..."
  python3 -m venv .venv
  .venv/bin/pip install -q -r requirements.txt
fi
( sleep 2; (xdg-open http://localhost:8080 || open http://localhost:8080) >/dev/null 2>&1 ) &
exec .venv/bin/python app.py
