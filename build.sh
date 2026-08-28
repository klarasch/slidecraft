#!/bin/bash
# Assemble the distributable Claude skill into dist/slaydy/ (+ a zip).
# The repo is the dev source — demo deck, HANDOFF, README stay out of the
# shipped skill; what ships is the instruction set, the contract docs, the
# runtime, the stock themes, and the standalone builder.
set -euo pipefail
cd "$(dirname "$0")"

# Real minification for the single-file export. The exporters (standalone.py
# and the runtime's Single-file button) prefer runtime.min.* when present and
# fresh; without esbuild they fall back to conservative compaction.
if command -v esbuild >/dev/null 2>&1; then ESBUILD=esbuild
elif command -v npx >/dev/null 2>&1; then ESBUILD="npx --yes esbuild"
else ESBUILD=""; fi
if [ -n "$ESBUILD" ]; then
  $ESBUILD runtime.js  --minify --outfile=runtime.min.js  --log-level=warning
  $ESBUILD runtime.css --minify --outfile=runtime.min.css --log-level=warning
  echo "minified: runtime.min.js ($(du -k runtime.min.js | cut -f1)K) runtime.min.css ($(du -k runtime.min.css | cut -f1)K)"
else
  echo "warning: esbuild unavailable — no runtime.min.*; exports fall back to compaction"
  rm -f runtime.min.js runtime.min.css
fi

rm -rf dist/slaydy
mkdir -p dist/slaydy

cp SKILL.md LAYOUTS.md BRANDING.md CUSTOMIZING.md UPDATING.md runtime.js runtime.css standalone.py dist/slaydy/
[ -f runtime.min.js ] && cp runtime.min.js runtime.min.css dist/slaydy/
cp -R themes dist/slaydy/themes
cp -R icons dist/slaydy/icons
[ -d fonts ] && cp -R fonts dist/slaydy/fonts

(cd dist && rm -f slaydy-skill.zip && zip -qr slaydy-skill.zip slaydy)

echo "dist/slaydy/:"
ls dist/slaydy
echo
echo "→ install by dropping dist/slaydy into .claude/skills/, or share dist/slaydy-skill.zip"
