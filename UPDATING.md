<!-- Upstream-owned: every update replaces this file whole (UPDATING.md §1). -->

# Taking an update from slaydy

Upstream is **github.com/klarasch/slaydy**. This page is for whoever runs a copy of it — a
company fork with its own theme, or a plain install someone dropped into `.claude/skills/`.

The short version: **updates are a file copy, never a merge.** `CUSTOMIZING.md` explains why —
everything slaydy ships is replaceable and everything yours lives in files a release never
touches. What follows is the mechanics, and the three places a copy hides.

---

## 1. What a release owns

```
runtime.js  runtime.css  runtime.min.js  runtime.min.css     replaced
SKILL.md  LAYOUTS.md  BRANDING.md  CUSTOMIZING.md            replaced
UPDATING.md  standalone.py  build.sh                         replaced
icons/                                                       added to, never pruned
themes/{midnight,paper,mint}.css                             refreshed only if you kept them
```

Everything else in a fork — `SKILL.fork.md`, `skeleton.html`, `.skillignore`, your theme,
your fonts, your logo, `custom.css`, `custom.js`, `custom/` or whatever your brand layer is
called, `themes/default`, your own icons — is yours, and no update touches it, and all of it
ships. One duty comes with `skeleton.html`: when the changelog says the skeleton changed, port
the change into yours by hand.

Two of those lines are not "replaced" for a reason. A fork that **deleted** the stock themes
deleted them on purpose, and an update is not the place to resurrect one. New **icons** are
additive and land beside your own.

**`SKILL.md` is replaced, and that is fine, because the shipped one is composed.** The repo's
`SKILL.md` is upstream's generic instruction set and stays that way. Your skill's *identity* —
its `name:`, the `description:` that makes it trigger, and the brand's standing orders — lives
in `SKILL.fork.md`, which no update touches. `./build.sh` puts the two together: your head on
upstream's body (`CUSTOMIZING.md`, Layer 0). An install that instead edits `SKILL.md`, or
patches its frontmatter from `build.sh`, ships as "slaydy" the first time upstream rewords a
line — which is how this arrangement came to be.

If you have edited anything on a **replaced** line, that edit is the thing that will hurt. Move
it into the extension layer (`CUSTOMIZING.md`) before updating, not after. §2 stops and tells
you when you haven't.

## 2. Update the fork

Keep an upstream checkout as a **sibling** of your fork:

```bash
cd ~/Code && git clone https://github.com/klarasch/slaydy.git
```

Your fork keeps its own history, its own remote, its own branches — nothing about it changes.
What the sibling adds is *history*: a folder of files tells you what upstream has, a git
checkout tells you what upstream **changed**, which is the difference between copying an update
and understanding one.

Then, from inside the fork:

```bash
cd ~/Code/my-fork && git -C ~/Code/slaydy pull && ~/Code/slaydy/take-update.sh
```

The script lives upstream on purpose — it carries the §1 manifest, so it can never be out of
date with the files it is copying. It copies; it never merges. What it adds over `cp`:

- **It prints the log** since your last update, and says which commits let you *delete* code
  from the fork. An update that only adds is an update half-taken.
- **It skips a file you edited, and takes everything else** — comparing against the version
  you last took, not against upstream's HEAD, so an upstream change never looks like your edit.
  This is the signal `git merge` gave you as a conflict, without the merge. Skipped files are
  named at the end with where the edit belongs instead, and the exit code is 1. One local
  patch no longer freezes the whole fork; `--force` overwrites it if you meant to drop it.
- **`--check` reports drift and nothing else** — exit 1 if any upstream-owned file is edited.
  Cheap enough for a pre-commit hook or a fork's `CLAUDE.md`: drift found the day it happens is
  a five-minute move, drift found at update time is an archaeology session.
- **It refuses to copy from a dirty upstream.** There is no commit to record, so the *next*
  update would have nothing to diff against. (`--allow-dirty` if you must; the stamp then says
  so.)
- **It records what you took**, in `.slaydy-upstream`. Commit that file with the update — it is
  what makes every bullet above work next time.

First run has no stamp, so it can't tell your edits from upstream's changes: it lists what
differs, you review, and `--first-run` records the baseline. Exact from then on.

**Why not `git merge upstream/master`?** It works only for a fork that was born as a clone. A
fork that started as a folder someone handed you has no shared ancestor — the merge needs
`--allow-unrelated-histories` and conflicts on essentially every file. And even where it works,
a merge is the wrong verb for a system in which nothing is merged: every file is either wholly
upstream's or wholly yours. Submodules and subtrees fail the same test.

## 3. Update the install

The skill in `.claude/skills/` is a **copy of a build**, not a link to the fork. Pulling the
repo changes nothing until you rebuild and re-install:

```bash
./build.sh && rm -rf ~/.claude/skills/slaydy && cp -R dist/slaydy ~/.claude/skills/slaydy
```

A fork builds under its own name — `./build.sh` reads it from `SKILL.fork.md`, so `dist/<name>/`
and `dist/<name>-skill.zip` come out branded with no arguments. Pass a name to build under a
different one (`./build.sh acme-decks-beta` for a trial install beside the real one); the
folder, the zip and the `name:` frontmatter always agree. Never install the repo folder itself
as the skill: its `SKILL.md` is upstream's generic one, and it registers as "slaydy".

> **Coming from a pre-rename install:** the skill used to be called `slidecraft`. Copying in
> `slaydy/` leaves the old folder in place, and two skills with near-identical descriptions
> compete to trigger. Delete `.claude/skills/slidecraft/` once the new one is in.

New decks now generate with the new runtime. Decks that already exist do not — see §4.

## 4. Refresh existing decks

Every deck folder carries its own copy of the runtime, taken when the deck was generated. That
is what makes a deck portable and a revision cheap, and it is also why a deck from three months
ago still behaves like the runtime it was born with — including the bugs.

```bash
cd /path/to/some-deck && cp ~/.claude/skills/slaydy/{runtime.js,runtime.css,runtime.min.js,runtime.min.css} .
```

Nothing else changes. `deck.html` is untouched, the markup contract is stable, and the deck
picks up every runtime feature added since it was written. Slaydy also re-copies these files
whenever it revises a deck, so a deck you keep working on stays current on its own.

**Single-file exports are frozen.** A standalone has the runtime baked inside it; it can never
update in place. Rebuild it from the folder deck (`standalone.py`, `SKILL.md` §3) and re-send.

## 5. Check it landed

Open a deck that already existed before the update, and confirm in this order:

1. It still renders — theme, fonts, logo, every custom layout you added.
2. Your extension layer still runs: `custom.js` behaviour, `custom.css` treatments.
3. The new thing from the changelog actually shows up. If it doesn't, you are looking at a deck
   whose runtime you didn't refresh (§4) — the most common outcome by far.
4. Save the deck (`⌘S` / **Download copy**) and diff it. A clean update changes nothing in the
   markup you didn't ask for.
