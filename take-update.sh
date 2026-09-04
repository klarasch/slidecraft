#!/usr/bin/env bash
#
# Take an update from slaydy into a fork. Run it FROM the fork:
#
#     cd ~/Code/my-fork && ~/Code/slaydy/take-update.sh
#
# The script lives upstream on purpose. It knows which files a release owns,
# and that list changes when the runtime does — a copy vendored into each fork
# goes stale the first time upstream adds a file. Running upstream's copy means
# the manifest is always the one that matches the files you are taking.
#
# It copies. It never merges. What it adds over `cp` is the two things a bare
# copy can't do: it refuses to overwrite a file the fork has edited, and it
# records which upstream commit you took so the next run can show you the log.
#
#   --first-run    accept the current state as the baseline (no stamp yet)
#   --force        overwrite fork-edited files anyway
#   --allow-dirty  take from an upstream worktree with uncommitted changes
#   --dry-run      report, copy nothing
#   --check        only say which upstream-owned files the fork has edited
#                  (exit 1 if any) — cheap enough for a pre-commit hook
#
# A file the fork has edited is SKIPPED, not fatal: every clean file is
# taken, the edited ones are named at the end, and the exit code is 1 so a
# script notices. One local patch should not freeze a whole fork in time.
#
set -euo pipefail

UP="$(cd "$(dirname "$0")" && pwd)"
FORK="$PWD"
STAMP="$FORK/.slaydy-upstream"

first_run=0; force=0; allow_dirty=0; dry=0; check=0
for a in "$@"; do case "$a" in
  --first-run)   first_run=1 ;;
  --force)       force=1 ;;
  --allow-dirty) allow_dirty=1 ;;
  --dry-run)     dry=1 ;;
  --check)       check=1; dry=1; allow_dirty=1 ;;
  *) echo "take-update.sh: unknown option $a" >&2; exit 2 ;;
esac; done

die() { echo "" >&2; echo "take-update.sh: $*" >&2; exit 1; }
say() { printf '%s\n' "$*"; }

# ---- the manifest ---------------------------------------------------------
# Three classes, because forks treat these files differently in practice.

# Replaced byte for byte. Yours if you edited them; see CUSTOMIZING.md.
# SKILL.md is here on purpose: the fork's name, description and standing
# orders live in SKILL.fork.md, and build.sh composes the shipped SKILL.md
# from the two — so the generic body updates and the fork's head never moves.
# build.sh is here for the same reason: it takes the skill name from
# SKILL.fork.md (or its argument) and ships fonts/, images/, custom.* when
# present, so a fork has nothing left to patch into it.
CORE=(runtime.js runtime.css runtime.min.js runtime.min.css
      SKILL.md LAYOUTS.md BRANDING.md CUSTOMIZING.md UPDATING.md
      standalone.py build.sh)

# Refreshed only if the fork still carries them. A fork that deleted the stock
# themes deleted them on purpose; an update is not the place to resurrect one.
OPTIONAL=(themes/midnight.css themes/paper.css themes/mint.css)

# Additive: new and changed icons come in, nothing is ever removed. Your own
# icons sit in the same folder and are none of upstream's business.
ADDITIVE_DIRS=(icons)

# ---- sanity ---------------------------------------------------------------
[ "$UP" != "$FORK" ] || die "run this from the fork, not from upstream itself."
[ -d "$FORK/.git" ] || die "$FORK is not a git repository. The fork needs its own history for any of this to be reviewable."
[ -f "$UP/runtime.js" ] || die "$UP does not look like a slaydy checkout."

up_dirty="$(git -C "$UP" status --porcelain --untracked-files=no)"
if [ -n "$up_dirty" ] && [ "$allow_dirty" -eq 0 ]; then
  say "Upstream has uncommitted changes:"
  say "$up_dirty" | sed 's/^/    /'
  die "won't take from a dirty upstream — there is no commit to record, so the
next update can't tell you what changed. Commit upstream first, or pass
--allow-dirty and accept that the stamp is approximate."
fi

fork_dirty="$(git -C "$FORK" status --porcelain --untracked-files=no)"
if [ -n "$fork_dirty" ] && [ "$check" -eq 0 ]; then
  say "Note: the fork has uncommitted changes. After this runs, \`git diff\` will"
  say "show your work and the update mixed together. Committing first makes the"
  say "update reviewable on its own."
  say ""
fi

UP_SHA="$(git -C "$UP" rev-parse HEAD)"
SHORT="${UP_SHA:0:12}"
if [ -n "$up_dirty" ]; then UP_SHA="$UP_SHA-dirty"; SHORT="$SHORT (dirty)"; fi

LAST=""
[ -f "$STAMP" ] && LAST="$(grep -v '^#' "$STAMP" | head -1 | awk '{print $1}')"

# ---- what changed upstream ------------------------------------------------
if [ "$check" -eq 0 ]; then
say "Fork:     $FORK"
say "Upstream: $UP @ $SHORT"
fi
if [ -n "$LAST" ] && [ "$check" -eq 0 ]; then
  say ""
  say "Since you last took ${LAST:0:12}:"
  git -C "$UP" log --oneline "${LAST%-dirty}..HEAD" 2>/dev/null | sed 's/^/    /' || \
    say "    (can't reach that commit — was it rewritten?)"
  say ""
  say "Read those. Some of them let you DELETE code from the fork: an override"
  say "you carry because upstream lacked a hook, a workaround upstream absorbed."
  say "An update that only adds is an update half-taken."
fi

# ---- has the fork edited a file upstream owns? ----------------------------
# Compared against the version you last took, not against upstream's current
# HEAD — otherwise every upstream change looks like a local edit.
edited=()
tmp="$(mktemp -t slaydy-take)"; trap 'rm -f "$tmp"' EXIT
if [ -n "$LAST" ]; then
  for f in "${CORE[@]}" "${OPTIONAL[@]}"; do
    [ -f "$FORK/$f" ] || continue
    # Via a file, not a command substitution: $(...) eats trailing newlines,
    # which makes every text file look edited.
    if git -C "$UP" show "${LAST%-dirty}:$f" > "$tmp" 2>/dev/null; then
      diff -q "$tmp" "$FORK/$f" >/dev/null 2>&1 || edited+=("$f")
    fi
  done
elif [ "$first_run" -eq 0 ]; then
  for f in "${CORE[@]}" "${OPTIONAL[@]}"; do
    [ -f "$FORK/$f" ] || continue
    diff -q "$UP/$f" "$FORK/$f" >/dev/null 2>&1 || edited+=("$f")
  done
  if [ ${#edited[@]} -gt 0 ]; then
    say ""
    say "No .slaydy-upstream stamp, so I can't tell your edits from upstream's"
    say "changes. These differ from upstream's current copy:"
    printf '    %s\n' "${edited[@]}"
    say ""
    die "review those, then re-run with --first-run to record $SHORT as the
baseline. From the next update on, this check is exact."
  fi
  say ""
  say "No stamp yet, but every file a release owns already matches upstream —"
  say "so there is nothing to review and $SHORT is a safe baseline."
fi

where_it_goes() {
  say "Where an edit belongs instead (CUSTOMIZING.md):"
  say "    SKILL.md       → SKILL.fork.md      the install: name, description, standing orders"
  say "    *.md           → themes/<brand>.md  the brand: voice and behaviour rules"
  say "    build.sh       → SKILL.fork.md      the skill name; fonts/ images/ custom* ship on their own"
  say "    runtime.*      → your theme, custom.css, custom.js, custom/, the slaydy:* events"
  say "    standalone.py  → a real <script src> for what you fetch (CUSTOMIZING.md, Layer 3)"
  say "If none of those can express it, that is a gap worth reporting upstream, not editing around."
}

if [ "$check" -eq 1 ]; then
  if [ ${#edited[@]} -eq 0 ]; then
    say "take-update.sh --check: clean — no upstream-owned file is edited in this fork."
    exit 0
  fi
  say "take-update.sh --check: the fork has edited files a release replaces:"
  printf '    %s\n' "${edited[@]}"
  say ""
  where_it_goes
  exit 1
fi

is_edited() { local e; for e in "${edited[@]+"${edited[@]}"}"; do [ "$e" = "$1" ] && return 0; done; return 1; }
skipped=()
if [ ${#edited[@]} -gt 0 ] && [ "$force" -eq 0 ]; then
  say ""
  say "The fork has edited files that a release replaces — they are SKIPPED below, not taken:"
  printf '    %s\n' "${edited[@]}"
fi

# ---- copy -----------------------------------------------------------------
copy() { # src-relative-path
  local f="$1"
  if diff -q "$UP/$f" "$FORK/$f" >/dev/null 2>&1; then return; fi
  if [ "$force" -eq 0 ] && is_edited "$f"; then skipped+=("$f"); return; fi
  say "    $f"
  [ "$dry" -eq 1 ] || { mkdir -p "$(dirname "$FORK/$f")"; cp "$UP/$f" "$FORK/$f"; }
}

say ""
say "Updating:"
for f in "${CORE[@]}"; do copy "$f"; done
for f in "${OPTIONAL[@]}"; do [ -f "$FORK/$f" ] && copy "$f"; done
for d in "${ADDITIVE_DIRS[@]}"; do
  [ -d "$UP/$d" ] || continue
  while IFS= read -r f; do copy "${f#"$UP/"}"; done < <(find "$UP/$d" -type f ! -name '.*')
done
say "    (nothing else — SKILL.fork.md, skeleton.html, your theme, fonts, logo,"
say "    custom.*, your own icons and layouts are untouched, as always.)"

if [ ! -f "$FORK/SKILL.fork.md" ]; then
  say ""
  say "Note: no SKILL.fork.md here, so ./build.sh will ship the skill as \"slaydy\" with"
  say "upstream's description. A fork wants its own — CUSTOMIZING.md, Layer 0."
fi

if [ ${#skipped[@]} -gt 0 ]; then
  say ""
  say "NOT taken — edited in the fork, and upstream changed them too:"
  printf '    %s\n' "${skipped[@]}"
  say "Move the edit out, then \`cp $UP/<file> .\` (or re-run with --force) to catch up."
  where_it_goes
fi

# ---- stamp ----------------------------------------------------------------
if [ "$dry" -eq 0 ]; then
  {
    echo "$UP_SHA"
    echo "# The slaydy commit this fork last took. Written by take-update.sh;"
    echo "# it is what lets the next update show you a changelog and tell your"
    echo "# edits apart from upstream's. Commit it with the update."
  } > "$STAMP"
fi

say ""
if [ "$dry" -eq 1 ]; then
  say "Dry run — nothing written."
else
  say "Stamped .slaydy-upstream at $SHORT. Now UPDATING.md §3-§5:"
  say "  ./build.sh && reinstall the skill — refresh existing decks — open one and check"
fi
[ ${#skipped[@]} -eq 0 ] || exit 1
