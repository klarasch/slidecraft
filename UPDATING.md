# Taking an update from slaydy

Upstream is **github.com/klarasch/slaydy**. This page is for whoever runs a copy of it — a
company fork with its own theme, or a plain install someone dropped into `.claude/skills/`.

The short version: **updates are a file copy, never a merge.** `CUSTOMIZING.md` explains why —
everything slaydy ships is replaceable and everything yours lives in files a release never
touches. What follows is the mechanics, and the three places a copy hides.

---

## 1. What actually needs replacing

```
runtime.js  runtime.css  runtime.min.js  runtime.min.css     the runtime
SKILL.md  LAYOUTS.md  BRANDING.md  CUSTOMIZING.md            the instruction set
standalone.py  build.sh  icons/  themes/{midnight,paper,mint}.css
```

Everything else in a fork — your theme, your fonts, your logo, `custom.css`, `custom.js`,
`themes/default`, your own icons — is yours, and no update touches it. If you have edited a
file in the list above, that edit is the thing that will hurt; move it into the extension layer
(`CUSTOMIZING.md`) before updating, not after.

## 2. Update the fork

**If the fork is a git clone of upstream** — one time:

```bash
git remote add upstream https://github.com/klarasch/slaydy.git
```

then, for each update:

```bash
git fetch upstream && git merge upstream/master
```

Conflicts should only appear in files from §1. That is the signal you edited something you
were meant to override instead.

**If the fork is a copy with no upstream remote** (a folder someone handed you — this is what
`s1-slaydy` is today), copy the files in:

```bash
cd /path/to/your-fork && cp ~/Code/slaydy/{runtime.js,runtime.css,runtime.min.js,runtime.min.css,SKILL.md,LAYOUTS.md,BRANDING.md,CUSTOMIZING.md,standalone.py} .
```

Worth doing once: `git remote add upstream …` and switching to the first form. A copy that can
`git fetch` tells you *what* changed; a copy that can't leaves you diffing folders.

**Then read the log.** `git log --oneline <last-update>..upstream/master` — the commits say
what landed, and some of them let you *delete* code from your fork: an override you carry
because upstream lacked a hook, a workaround upstream has now absorbed. An update that only
adds is an update half-taken.

## 3. Update the install

The skill in `.claude/skills/` is a **copy of a build**, not a link to the fork. Pulling the
repo changes nothing until you rebuild and re-install:

```bash
./build.sh && rm -rf ~/.claude/skills/slaydy && cp -R dist/slaydy ~/.claude/skills/slaydy
```

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
