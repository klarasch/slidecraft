#!/bin/bash
# Assemble the distributable Claude skill into dist/slidecraft/ (+ a zip).
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

rm -rf dist/slidecraft
mkdir -p dist/slidecraft

cp SKILL.md LAYOUTS.md BRANDING.md CUSTOMIZING.md runtime.js runtime.css standalone.py dist/slidecraft/
[ -f runtime.min.js ] && cp runtime.min.js runtime.min.css dist/slidecraft/
cp -R themes dist/slidecraft/themes
[ -d fonts ] && cp -R fonts dist/slidecraft/fonts

(cd dist && rm -f slidecraft-skill.zip && zip -qr slidecraft-skill.zip slidecraft)

echo "dist/slidecraft/:"
ls dist/slidecraft
echo
echo "→ install by dropping dist/slidecraft into .claude/skills/, or share dist/slidecraft-skill.zip"
