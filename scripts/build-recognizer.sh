#!/usr/bin/env bash
# Freeze the recognizer into dist-recognizer/recognizer (per-OS/arch).
# Run on EACH target platform — PyInstaller output is not cross-platform.
#
# Also place a platform ffmpeg binary at dist-ffmpeg/ffmpeg (LGPL/GPL-clean
# static build), which the recognizer needs for audio decoding.
set -euo pipefail
cd "$(dirname "$0")/.."

echo "==> Freezing recognizer with PyInstaller"
cd recognizer
python3 -m venv .build-venv
./.build-venv/bin/pip install --quiet --upgrade pip pyinstaller
./.build-venv/bin/pip install --quiet -r requirements.txt
./.build-venv/bin/pyinstaller recognizer.spec \
  --distpath ../dist-recognizer --workpath /tmp/pyi-recognizer -y
cd ..

echo "==> Frozen binary: dist-recognizer/recognizer"
echo "==> Reminder: place an ffmpeg binary at dist-ffmpeg/ffmpeg"
echo "    e.g. (macOS):  mkdir -p dist-ffmpeg && cp \"\$(which ffmpeg)\" dist-ffmpeg/"
echo "    Use a static LGPL/GPL-clean build for redistribution."
