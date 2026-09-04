#!/bin/bash
# Assemble the distributable Claude skill into dist/<name>/ (+ a zip).
#
#     ./build.sh              → dist/slaydy/, dist/slaydy-skill.zip
#     ./build.sh acme-decks   → dist/acme-decks/, dist/acme-decks-skill.zip
#
# The repo is the dev source, and the skill is the repo minus the dev files:
# everything ships except the demo deck and its exports (top-level .html),
# the repo docs (top-level .md other than the four contract docs), the
# scripts that only make sense here (.sh), dot-files and dot-folders, dist/,
# and whatever .skillignore lists. skeleton.html is the one .html that ships. So a fork's brand layer ships whatever it
# is called — custom/, brand/, assets/ — with nothing to add here.
#
# A fork never edits this file, and never edits SKILL.md. Its identity lives
# in SKILL.fork.md (CUSTOMIZING.md "Layer 0"): the frontmatter there — name,
# description — replaces upstream's, and whatever it says below the
# frontmatter is inserted under the title as the install's standing orders.
# The shipped SKILL.md is composed from that plus upstream's generic body, so
# an update to the body lands without touching a word that is yours.
set -euo pipefail
cd "$(dirname "$0")"

FORK=""; [ -f SKILL.fork.md ] && FORK=SKILL.fork.md

# Skill name: argument > SKILL.fork.md `name:` > slaydy. It names the dist
# folder, the zip, and the `name:` frontmatter, all three the same — Claude
# Code keys the skill on the folder, the frontmatter says what it should be.
NAME="${1:-}"
if [ -z "$NAME" ] && [ -n "$FORK" ]; then
  NAME="$(sed -n 's/^name:[[:space:]]*//p' "$FORK" | head -1)"
fi
NAME="${NAME:-slaydy}"
case "$NAME" in
  *[!a-zA-Z0-9._-]*|"") echo "build.sh: skill name '$NAME' — letters, digits, . _ - only" >&2; exit 2 ;;
esac

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

OUT="dist/$NAME"
rm -rf "$OUT"
mkdir -p "$OUT"

# ---- SKILL.md: upstream's body under the install's own head ---------------
python3 - "$NAME" SKILL.md "$OUT/SKILL.md" $FORK <<'COMPOSE'
import re, sys
from pathlib import Path

name, src, out = sys.argv[1], Path(sys.argv[2]), Path(sys.argv[3])
fork = Path(sys.argv[4]) if len(sys.argv) > 4 else None

def split(path):
    """(frontmatter lines, body) — the frontmatter is the block between the
    opening '---' line and the next one; nothing is parsed inside it."""
    text = path.read_text()
    if not text.startswith("---\n"):
        sys.exit(f"build.sh: {path} does not start with a frontmatter block")
    end = text.find("\n---\n", 4)
    if end < 0:
        sys.exit(f"build.sh: {path}: frontmatter never closes")
    return text[4:end].split("\n"), text[end + 5:]

def keyed(lines):
    """Group frontmatter lines by top-level key so a fork can replace one
    key at a time. An indented (or blank) line continues the previous key."""
    groups = []
    for ln in lines:
        if groups and (ln[:1] in (" ", "\t") or not ln.strip()):
            groups[-1][1].append(ln); continue
        m = re.match(r"([A-Za-z_][\w-]*)\s*:", ln)
        groups.append((m.group(1) if m else ln, [ln]))
    return groups

up_fm, up_body = split(src)
body = up_body.lstrip("\n")
title, nl, body = body.partition("\n")
if not title.startswith("# "):
    sys.exit(f"build.sh: {src}: expected the title line right after the frontmatter, got {title!r}")
body = body.lstrip("\n")

fm = keyed(up_fm)
brand = ""
if fork:
    fk_fm, fk_body = split(fork)
    fk = keyed(fk_fm)
    if "description" not in {k for k, _ in fk}:
        sys.exit(f"build.sh: {fork} has no description: — the description is what "
                 "makes the skill trigger, and upstream's says 'slaydy'. Write your own.")
    for k, lines in fk:
        fm = [(gk, gl) for gk, gl in fm if gk != k]
        fm.append((k, lines))
    brand = fk_body.strip("\n")
fm = [(k, l) for k, l in fm if k != "name"]
fm.insert(0, ("name", [f"name: {name}"]))

parts = ["---\n", "\n".join(l for _, ls in fm for l in ls), "\n---\n\n", f"# {name}\n\n"]
if brand:
    parts += [brand, "\n\n"]
parts.append(body)
out.write_text("".join(parts))
print(f"SKILL.md: name={name}" + (f", head + brand section from {fork}" if fork else ", generic"))
COMPOSE

# ---- everything else: the repo minus the dev files -------------------------
python3 - "$OUT" <<'SHIP'
import fnmatch, shutil, sys
from pathlib import Path

out = Path(sys.argv[1]); root = Path(".")
CONTRACT_DOCS = {"LAYOUTS.md", "BRANDING.md", "CUSTOMIZING.md", "UPDATING.md"}
NEVER = {"dist", "node_modules", "__pycache__", "SKILL.md", "SKILL.fork.md"}

def dev_only(rel: Path) -> bool:
    top = rel.parts[0]
    if top in NEVER or top.startswith("."):
        return True
    if rel.name == ".DS_Store" or rel.suffix in (".pdf", ".log", ".zip"):
        return True
    if len(rel.parts) == 1:                      # top-level files only
        if rel.suffix == ".html" and rel.name != "skeleton.html":
            return True                          # the demo deck and its exports
        if rel.suffix == ".sh":
            return True
        if rel.suffix == ".md" and rel.name not in CONTRACT_DOCS:
            return True
    return False

# .skillignore — gitignore-flavoured, fork-owned: one pattern per line,
# '/' anchors at the repo root, a trailing '/' means a folder, '#' comments.
ignore = []
if Path(".skillignore").exists():
    for line in Path(".skillignore").read_text().splitlines():
        line = line.strip()
        if line and not line.startswith("#"):
            ignore.append(line.rstrip("/"))

def ignored(rel: Path) -> bool:
    s = rel.as_posix()
    for pat in ignore:
        if pat.startswith("/"):
            p = pat[1:]
            if s == p or s.startswith(p + "/") or fnmatch.fnmatch(s, p):
                return True
        elif any(fnmatch.fnmatch(part, pat) for part in rel.parts) or fnmatch.fnmatch(s, pat):
            return True
    return False

shipped = []
for path in sorted(root.rglob("*")):
    rel = path.relative_to(root)
    if any(dev_only(Path(*rel.parts[:i + 1])) for i in range(len(rel.parts))):
        continue
    if ignored(rel):
        continue
    if path.is_file():
        (out / rel).parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(path, out / rel)
        shipped.append(rel)

for name in ("runtime.js", "runtime.css", "standalone.py", "LAYOUTS.md", "themes"):
    if not (out / name).exists():
        sys.exit(f"build.sh: {name} did not ship — is this a slaydy checkout?")
tops = {}
for rel in shipped:
    tops.setdefault(rel.parts[0], 0)
    tops[rel.parts[0]] += 1
print("shipping: " + "  ".join(f"{k}/ ({n})" if n > 1 or (root / k).is_dir() else k
                               for k, n in sorted(tops.items())))
SHIP

(cd dist && rm -f "$NAME-skill.zip" && zip -qr "$NAME-skill.zip" "$NAME")

echo "$OUT/:"
ls "$OUT"
echo
echo "→ install by dropping $OUT into .claude/skills/, or share dist/$NAME-skill.zip"
