# slidecraft

Branded HTML slide decks that stay editable after Claude writes them.

This folder **is** the skill. Point Claude Code at it (as a plugin, or in `.claude/skills/`) and
ask for a deck. `SKILL.md` is the instruction set; `LAYOUTS.md` is the markup contract;
`BRANDING.md` is how you make it your company's.

## Three modes

| mode | say | you get |
|---|---|---|
| **generate** | "make me a 20-minute deck on X" | a new folder with `deck.html` + runtime + theme |
| **revise** | "apply my notes" / "fix slide 4" | your `deck.html` edited in place, never regenerated |
| **setup** | "set up slidecraft for Acme" + a URL or brand PDF | `themes/acme.css` + a voice file, used from then on |

Claude asks at most one round of questions — occasion, audience, length, tone, and tier
(`template` / `polished` / `bespoke`, which decides motion and speaker notes). Reply "go" to take
the defaults.

## Keys

Open `deck.html` in Chrome. The toolbar fades out after a second of stillness — move the
pointer to the bottom of the window to bring it back.

| key | does |
|---|---|
| `→` `←` `space` | navigate (or click the left/right of the slide) |
| `O` | overview / table of contents |
| `E` | edit mode |
| `S` | presenter view — speaker notes on a second screen |
| `T` | cycle theme (only if the deck offers more than one) |
| `P` | export PDF (asks slides-only vs with-notes when the deck has notes) |
| `D` | download the single shareable file |
| `F` | fullscreen |

## Edit mode (`E`)

One bar, full words. Hover any button for its shortcut; `?` lists them all.

- Click any text to change it in place. Esc finishes.
- In a bullet list, Enter adds a bullet, Backspace in an empty bullet removes it.
- Click an image slot (or drag a file onto it) to replace the picture.
- `⌘V` an image → it lands on the slide as a sticker. Drag to move, corner handles to resize, `⌫` deletes.
- On a callout slide: drag the numbered pins, double-click the image to add a pin + note,
  Backspace in an empty note (or `⌫` on a selected pin) removes the pair. Numbers renumber themselves.
- **Add slide** — pick a layout (it comes with placeholder text), or describe the slide and let Claude write it next pass.
- **Duplicate** / **Delete** (icons). Delete shows an Undo toast; nothing asks "are you sure".
- **Request change** — a change request for the next Claude pass, stored on the slide as `data-note` and shown as a chip while editing.
- **Speaker notes** — a drawer beside the slide; shown in Presenter view.
- **Undo** — ⌘Z / ⌘⇧Z across every edit, including slide operations.
- **Save…** — see below. After the first save it autosaves and just shows "Saved".

## Saving without base64

Press **Save…** and Chrome asks for a folder once. Pick the deck's own folder.
The runtime writes any newly added images into `images/` as real files and rewrites
`deck.html` in place, with markup still pointing at relative paths.

If the File System Access API isn't available (Firefox/Safari) it falls back to
downloading a self-contained `deck-edited.html` (see below).

## One file to share

The deck **folder** is the source of truth — that's what Claude revises cheaply. The share
artifact is one self-contained file named after the deck's title (e.g. `Q3 Platform Review.html`) with the runtime, theme, and every
image baked in. You get it two ways:

- **At generation** — the skill runs `standalone.py` and writes it next to `deck.html`, so in
  Cowork the shareable file exists the moment the deck does.
- **After editing** — press **Download copy** in the toolbar to download a fresh one.

The file is built content-first: your slide markup sits at the top, hand-editable in any text
editor; the minified stylesheet and runtime are appended at the end of `<body>` (a one-line
guard in `<head>` prevents an unstyled flash). Truly minified when `runtime.min.*` exist
(run `./build.sh`, needs esbuild via npx); otherwise conservatively compacted. It opens
anywhere and everything still works in it — presenting, presenter view, PDF export, even
editing: saving a standalone deck writes the single file back, still self-contained.

Without JavaScript — macOS Quick Look (select the file, press space), preview panes — the
file shows its title slide, fitted, instead of a blank page. Finder *icon* thumbnails are an
OS limitation for HTML files and can't be controlled from inside the file.

Caveats:

- The export reads the deck's sibling files, so it works when the deck is served over http(s)
  (any static server, or the browser preview). A deck opened by double-click (`file://`) can't
  read its siblings — the button will tell you; ask Claude for a standalone copy instead.
- Web fonts still come from Google Fonts, so offline the deck falls back to system fonts.
  Brand `@font-face` files referenced inside a theme are not inlined yet.
- A standalone file is big (base64 images) and bakes its theme in — `T` reskinning is disabled
  in it. For revisions, prefer handing Claude the folder deck and re-exporting.

## PDF

`P` → if the deck has speaker notes, pick **Slides only** or **With speaker notes** (notes
print under each slide) → Chrome print dialog. Set **Margins: None** and **Background
graphics: on**. Pages are 16:9 (13.333 × 7.5 in), one per slide — the size comes from the
deck's `@page` rule, whatever paper name the dialog shows. No canvas rasterisation, so text
stays selectable and gradients stay smooth.

## Brand lock

A deck generated from a company install ships one theme and omits `data-themes`, so `T` does
nothing — nobody reskins the company deck to someone else's palette halfway through a talk.
The demo setup here keeps all three themes on purpose. See `BRANDING.md`.

## Files

```
SKILL.md           the skill — modes, brief, generation procedure
LAYOUTS.md         the markup contract Claude follows
BRANDING.md        how to make it your company's
CUSTOMIZING.md     bespoke graphics/animations/layouts that survive runtime updates
deck.html          a generated deck — the ONLY file Claude writes per deck
runtime.css        layout library + print styles   (fixed asset)
runtime.js         nav, overview, edit, presenter, save   (fixed asset)
themes/*.css       nine design tokens each         (one per brand)
themes/*.md        that brand's writing voice
themes/default     one line: which theme to use without asking
images/            deck assets
standalone.py      builds the single shareable file (named from <title>); --explode reverses it
build.sh           assembles the installable skill into dist/ (repo = dev source)
```

This repo is the dev source. `./build.sh` produces `dist/slidecraft/` — the actual skill to
drop into `.claude/skills/` or install in Cowork — plus `dist/slidecraft-skill.zip` to share.
Demo deck, README, and HANDOFF stay out of the shipped skill.

## Known gaps (deliberate, v1)

- No pptx export. HTML→pptx either loses the design or produces uneditable slide images.
- Folder ingestion (point the skill at a directory of images) is not wired up yet.
