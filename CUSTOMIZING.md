<!-- Upstream-owned: every update replaces this file whole (UPDATING.md §1). Don't edit it in a
     fork — what you want to write here goes in themes/<brand>.md or SKILL.fork.md. -->

# Customizing slaydy — and still getting updates

The rule that makes updates painless: **everything slaydy ships is replaceable; everything
yours lives in files an update never touches.**

```
UPDATED (replace byte-for-byte, never edit)     YOURS (an update never touches these)
─────────────────────────────────────────       ─────────────────────────────────────
runtime.js                                      SKILL.fork.md        your skill's name, description, standing orders
runtime.css                                     themes/<yours>.css   your brand: tokens + any CSS
SKILL.md · LAYOUTS.md · BRANDING.md             themes/<yours>.md    your brand's voice AND its rules
build.sh · standalone.py                        themes/default       which theme (or surface) to use
themes/midnight|paper|mint.css (stock)          fonts/               your font files
                                                images/              your mark, ornaments, art
                                                custom.css           bespoke graphics (optional)
                                                custom.js            bespoke behaviour (optional)
                                                custom/              the same, as a folder (optional)
                                                skeleton.html        your deck.html shell: links, fonts, body attrs
```

Taking an update = overwriting the left column with the new release. If the folder is a git
clone, `git pull` does it. Nothing on the right is ever part of a release, so nothing merges.

`UPDATING.md` has the mechanics: syncing a fork from upstream, re-installing the skill, and
refreshing the runtime inside decks that already exist.

## What the runtime promises you

The layout classes, text primitives, and `data-*` attributes documented in `LAYOUTS.md` are a
**stable contract**. Releases add classes and attributes; they don't rename or remove them, and
they don't change what existing markup means. That is why decks generated last year and your
customizations both survive a runtime update.

## Layer 0 — the skill's identity: `SKILL.fork.md`

Claude picks a skill by its `description:`; two installs with the same one compete, and the
loser is whichever you happen to want. So a branded install needs its own name and its own
description — and `SKILL.md`, where those live, is upstream's and gets replaced. Editing it
loses the edit on the next update; patching it from `build.sh` with a regex breaks the first
time upstream rewords the line. Both have happened.

`SKILL.fork.md` is the file that is yours. It has the shape of a `SKILL.md` head — frontmatter,
then markdown — and `./build.sh` composes the shipped `SKILL.md` from it and upstream's body:

```markdown
---
name: acme-decks
description: Generate editable, Acme-branded HTML slide decks and revise existing ones. Use whenever the user wants slides, a deck, a presentation, a keynote, a pitch, a talk — "make me a deck", "put this in slides". Also use to revise an existing deck.html this skill generated. Not for .pptx or Google Slides files.
---

**This install is brand-locked to Acme.** Always copy `themes/acme.css`, `fonts/` and
`images/`; link `acme.css` as `id="theme"`; never set `data-themes`; never ask which theme.
Read `themes/acme.md` before writing a slide — it overrides the defaults below.
```

What happens at build:

- **Frontmatter merges by key.** Every key you write replaces upstream's; keys you leave out
  come through from upstream. Keep each value on one line, as upstream does — skill loaders
  are not all full YAML parsers. `description:` is required — leaving it out ships upstream's,
  which says "slaydy", which is the bug this file exists to fix. Say the brand in the first
  clause, keep the trigger phrases (they are what makes "make me a deck" land here), and
  keep the "Not for .pptx" tail.
- **`name:` is the build's name** — `./build.sh` uses it for `dist/<name>/`, the zip, and the
  frontmatter, all the same. They have to agree: Claude Code keys a local skill on its folder,
  Claude Desktop's upload reads `name:` out of `SKILL.md` — a zip whose frontmatter still says
  `slaydy` installs and matches as slaydy there, whatever the folder was called. An argument overrides it (`./build.sh acme-decks-beta`) so a trial
  build can sit beside the real install; nothing else changes.
- **The body lands right under the title,** before upstream's "Decks are HTML" — the first
  thing read after the frontmatter. Upstream's §3–§4 tell the model to follow it over their own
  defaults, so this is where "always both themes" and "never ask" go. Two to ten lines.
  Anything about *how the deck reads* belongs in `themes/<yours>.md`, not here — and nothing
  about *which files to copy or link* belongs anywhere in prose: the copy rule in `SKILL.md`
  §3 takes everything the install ships, and `skeleton.html` (below) carries the wiring.

**`skeleton.html` — the wiring, as a file, not as instructions.** A deck is branded only if
every stylesheet, script, font and `<body>` attribute is linked, in order. Asking the model to
work that out from a folder listing is the single most common way a correct install still
produces a generic deck. So ship the answer: copy the skeleton out of `LAYOUTS.md`, add your
links — `custom.css`, `custom/*.css`, or whatever your layer is called, after the theme;
scripts after `runtime.js` — replace the Google Fonts line with your own font `<link>`s or
nothing at all when `@font-face` in the theme carries them, set `data-logo`, and set
`data-themes` only if the install deliberately offers several surfaces. Generation copies the
file exactly and fills in the title, brief and slides. It is yours, it ships, no update
touches it — and when upstream changes the skeleton (a new `<meta>`, say), `UPDATING.md`'s
changelog is where you learn to port the change.

**What ships is the repo minus the dev files.** Everything in the folder goes into
`dist/<name>/` except the demo deck and its exports (top-level `.html`), the repo docs
(top-level `.md` other than the four contract docs), shell scripts, dot-files and dot-folders,
`dist/`, and whatever a fork-owned `.skillignore` lists (gitignore-style, one pattern per
line). So a brand layer ships whatever it is called — `custom/`, `brand/`, `assets/`, an
export wrapper in Python — and the build prints what it shipped so you can see a stray file
before it leaves. Name anything non-standard in the standing orders so the model copies it.

Upstream's own build is the degenerate case: no `SKILL.fork.md`, so the repo's `SKILL.md`
ships as is. Install from `dist/<name>/`, never from the repo folder — the folder's `SKILL.md`
is upstream's generic one and registers as "slaydy".

## Layer 1 — brand tokens (covers most needs)

`themes/<yours>.css` restyles every layout at once through nine variables plus `@font-face`.
Colors, typefaces, corner radius, the gradient wash (`--wash-opacity: 0` for corporate).
See `BRANDING.md`. This is the right tool for "make it look like us".

`themes/<yours>.md` is the other half, and it is not limited to tone. It is the per-brand
instruction override: anything you would be tempted to change in `SKILL.md` for this brand —
"ask light or dark before generating", "never use `quote`", "every deck carries both
surfaces" — goes here, and generation reads it before writing a slide. Rules for the *install*
rather than the brand (which files to copy, what the skill is called) go in `SKILL.fork.md`.
If neither file can express what you need, that is a gap in `SKILL.md`: report it upstream
rather than editing the vendored copy, which loses the edit on the next update.

A brand with several surfaces — `acme-dark.css`, `acme-light.css` — keeps one voice file at
`themes/acme.md`: the lookup reads `<name>.md` **and** every hyphen-prefix of it, so
`acme-dark` finds both `acme-dark.md` (what differs on that ground) and `acme.md` (the brand).
Don't name the shared file after one surface. Before this rule existed, one fork's shared
voice file, named after the brand while its stylesheets were named per surface, was never
read on any run — and nothing reported it.

## Layer 2 — theme CSS beyond the tokens

A theme file is a full stylesheet loaded **after** `runtime.css`, so it may contain any CSS,
not just the nine variables: a patterned `.slide__wash`, a different `.slide--section`
treatment, SVG background art as data-URIs, extra `@keyframes`. Any background layer added this
way that fades — alpha varying across the element — prints with a seam in most PDF viewers
unless it ships a flattened print variant; see BRANDING.md's "PDF export: seams, not weight" for
the mechanism and the fixes. Two rules keep it update-safe:

- **Override, don't fork.** Restyle the runtime's selectors from your theme; never copy a block
  out of `runtime.css` and edit it there.
- **Prefix your own classes** (`.acme-…`) so a future runtime class can't collide with them.

## Layer 3 — custom.css / custom.js (bespoke graphics and behaviour)

For things that aren't a "theme" — a hand-drawn arrow sprite, a physics animation on the title
slide, confetti on the end card. Ship `custom.css` and/or `custom.js` in the skill folder;
generation copies them into each deck and links them after the theme and after `runtime.js`
(SKILL.md §3).

**A brand layer is usually a folder, not two files.** Past the confetti stage the layer splits
into concerns — surfaces, gradient, icons, media, layouts — with different reasons to change,
and the assets they reference (a font, an icon set, ornaments) have to travel with them. Ship
a `custom/` folder: every `custom/*.css` is linked in name order after the theme, every
`custom/*.js` in name order after `runtime.js`, and the folder is copied whole into each deck
so `url(fonts/x.woff2)` inside it keeps resolving. Number the files (`10-surfaces.css`,
`20-icons.css`) if order matters. `custom.css` / `custom.js` stay valid as the one-file case,
and load first. `./build.sh` ships the folder; `standalone.py` and the Download-copy export
inline everything it references.

**Lazy-loaded assets.** Both exporters inline what the markup and the stylesheets reference.
An asset your script `fetch()`es at display time is invisible to them and dangles in the
single file. Before reaching for a hook, stop it being invisible: write the set the deck uses
to a real file behind a real `<script src>` (an icon bundle, a data file) at generation or
export time, and the exporters inline it like any other script. The `slaydy:serialize` event
below covers the cases where the set genuinely isn't knowable until display.

The runtime emits events for you to hook:

```js
// custom.js — runs in every deck this install generates
const deck = document.querySelector(".deck");
deck.addEventListener("slaydy:slidechange", ({ detail: { index, slide, dir } }) => {
  if (slide.matches(".slide--end")) launchConfetti(slide);
});
deck.addEventListener("slaydy:step", ({ detail: { index, step, slide } }) => {
  // fired on each progressive-reveal keypress
});
```

`detail.slide` is the live DOM node — decorate it freely, but mark anything you inject with
`data-gen` so the save routine strips it (the runtime removes all `[data-gen]` nodes before
writing `deck.html`; without it your injected DOM gets baked into the saved file).

Beyond events, `window.slaydy` is the extension API:

```js
const { options, serialize, snapshot, toast } = window.slaydy;

// Declare every data-* option your code uses. The axis that matters is
// authored vs derived: DERIVED options are computed at display time and
// stripped from every save — without the declaration they get baked into
// deck.html and read as authored on the next load.
options.declare({ name: "data-surface", derived: true });

// AUTHORED options declared with `values` (or type: "flag") are validated
// at boot — a typo like data-veil="med" warns in the console instead of
// failing silently — and appear in the edit-mode "Options" panel
// automatically, next to the runtime's own Transition and Bare controls.
// `when` (a selector matched against the slide, or a predicate taking it)
// gates the row to slides where the option actually does something; an
// optional `onchange(slide)` runs after the panel applies a change.
options.declare({ name: "data-veil", label: "Veil", values: ["soft", "dense"],
                  when: ".slide--section",
                  hint: "Scrim strength over the brand gradient." });

// Undoable edits: push the current deck state BEFORE mutating, and your
// change lands on the same ⌘Z stack as the runtime's own edits.
snapshot();
icon.remove();

// Talk to the user through the runtime's own message UI.
toast("⌫ to delete");
```

(`slaydy.transient` — the raw derived-attribute Set behind the registry —
is still exported; `transient.add("data-x")` equals declaring `{ derived: true }`.)

Two more hooks round out the contract:

- **`slaydy:serialize`** fires on `.deck` with `{ root, inline, waitUntil }` before the
  save's strip pass. `root` is the cloned document — mutate it, not the live DOM. `inline` is
  true for the single-file export, which is your cue to bake in anything your code normally
  fetches from the folder (an icon bundle, say); `waitUntil(promise)` holds the save open for
  that async work. Note the export also inlines relative `url()` refs inside every linked
  stylesheet, so CSS-referenced assets need no handling at all.
- **`data-runtime="print"`** — chrome you mount with `data-runtime` is stripped from saves
  *and* hidden in print. The `"print"` value keeps it visible in the PDF while still keeping
  it out of saved files.

## Every extension point, in one place

The only other way to learn a hook exists is to grep `runtime.js`, which is how one fork
came to implement an asset-baking hook locally after upstream had already shipped it.

| hook | what it is for | shape |
|---|---|---|
| `SKILL.fork.md` | the install's name, description, standing orders | frontmatter + markdown, Layer 0 |
| `themes/<brand>.md` | the brand's voice and behaviour rules, read before every slide | markdown, Layer 1 |
| `themes/default` | which theme, or which surface, to use without asking | one line |
| `custom.css` `custom.js` `custom/` | CSS after the theme, JS after the runtime, assets alongside | files, Layer 3 |
| `--slide-bg` `--section-fg` | a slide's ground; the divider's text colour when its fill isn't the accent | CSS tokens |
| `--wash-base` `--wash-opacity` | what the gradient wash flattens against in print; `0` turns it off | CSS tokens |
| `--deck-pad` | windowed inset around the deck, `1` for edge-to-edge | CSS token |
| `--sep`, `--marker-*`, `--code-*`, `--font-*` | meta divider glyph, list markers, code colours, typefaces | CSS tokens, `BRANDING.md` |
| `slaydy:slidechange` `slaydy:step` | react to navigation and progressive reveal | events on `.deck` |
| `slaydy:serialize` | rewrite the save/export clone; `inline` says which; `waitUntil` holds it open | event on `.deck` |
| `slaydy.options.declare()` | per-slide `data-*` options: derived ones stripped on save, valued ones get a UI | JS |
| `slaydy.snapshot()` `slaydy.toast()` | undoable extension edits; the runtime's message UI | JS |
| `slaydy.serialize({ inline })` | the deck as a string, folder-relative or single-file | JS |
| `data-gen` `data-runtime` `data-runtime="print"` | mark injected DOM so saves strip it; keep print-only chrome | attributes |
| `data-style` `data-custom` | per-slide styling hook; hand-over the runtime leaves alone | attributes, `SKILL.md` §7 |

## Layer 4 — your own layouts

Add layouts without touching the runtime:

1. Define `.slide--acme-demo { … }` in your theme file or `custom.css`, built **from the
   existing text primitives** (`.h1`, `.body`, `li`, `.caption`…) so edit mode and the overflow
   guard keep working on its text.
2. Document it in `themes/<yours>.md` — that file overrides Claude's defaults, so a line like
   "prefer `slide--acme-demo` (markup: …) for product screenshots" makes generation use it.

The add-slide picker in the browser won't show custom layouts (it's runtime UI), but Claude
will generate and revise them, and users can duplicate one to make more.

## What not to do

- Don't edit `runtime.js` / `runtime.css` — your change dies on the next update, or worse,
  keeps you from ever taking one.
- Don't put per-deck `<style>`/`<script>` in `deck.html` — that breaks the revise loop's
  assumption that decks are pure markup.
- Don't restyle the editor chrome (toolbar, popovers) from a theme; it's not part of the
  contract and its class names may change.

## Sharing your customized install

`./build.sh` writes the installable skill to `dist/<name>/` (and a zip) under the name in
`SKILL.fork.md`: commit the folder and distribute as a Claude Code plugin, or drop the build
into a repo's `.claude/skills/`. Everyone who installs it gets your brand, graphics, and
layouts — and you can still pull runtime updates into it from upstream (`UPDATING.md`).
