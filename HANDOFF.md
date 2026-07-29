# slidecraft — handoff

Context for continuing this project in a fresh session (or on a different account).
Read this first, then `LAYOUTS.md`, then skim `runtime.js`.

---

## 1. What this is

A system for generating **beautiful, branded HTML slide decks that stay editable after
generation**. Eventually packaged as a Claude skill; right now it's a working proof of concept.

The problem it solves: a model-generated deck is normally dead on arrival — you can't fix a
typo without going back to the model, so nobody uses it twice.

Current state: **POC complete, visually unverified.** Everything below the "Open questions"
line is unbuilt.

---

## 2. The one architectural decision everything rests on

**The runtime is a fixed asset. The model never writes JavaScript or CSS.**

```
runtime.js      nav, overview, edit mode, save, export     ← written once, shipped with the skill
runtime.css     layout library + print styles              ← written once
themes/*.css    nine design tokens each                    ← authored per brand, by a human or once by Claude
deck.html       semantic markup only                       ← the ONLY file generated per deck
images/         assets
LAYOUTS.md      the markup contract the model must follow
```

Why this matters, in order of importance:

1. **Consistency.** If the model regenerates the navigation and export code each run, you get a
   different set of bugs in every deck. With a fixed runtime, a bug is fixed once, everywhere.
2. **Cost.** Generating a deck is ~200 lines of markup instead of ~1500 lines of markup+CSS+JS.
   That's the difference between a cheap skill and an expensive one.
3. **Revisability.** Small, semantic, diffable output. Targeted edits are possible without
   re-reading and re-emitting the whole file.

If you change nothing else, preserve this boundary. Every temptation to "just let the model
customise the CSS for this one deck" erodes all three benefits at once.

---

## 3. Design decisions already made, and why

| Decision | Rationale | Reversible? |
|---|---|---|
| Fixed 1280×720 canvas, CSS-transform scaled to viewport | Predictable typography; what you see is what prints | Hard to reverse |
| **Print stylesheet** for PDF, not html2canvas/html2pdf | Canvas rasterisers mangle web fonts and gradients. `@page` + print CSS keeps text selectable and vectors smooth | Easy |
| **File System Access API** for saving, base64 only as fallback | A browser file picker never gives you a real path. Rather than inline every image as base64 (a 2 MB photo → 2.7 MB of text), grab a folder handle once and write real files into `images/` | Medium |
| `contenteditable="plaintext-only"` | Plain `contenteditable` injects junk markup (`<font>`, nested spans, stray divs) that pollutes the saved file | Easy — but you lose clean output |
| Layout classes as "master slides" | The model *selects* a layout rather than designing one. This is the actual source of visual consistency, more than the theme is | Hard to reverse |
| **No pptx export** | HTML→pptx is either a pile of unstyled text boxes, or one full-bleed image per slide which is uneditable and defeats the purpose. Build only on real demand | Easy to add later |
| **No markdown sidecar** for content | Was considered and rejected: two sources of truth for the same content desync the moment the user edits in the browser. Replaced by `data-note` (see §5) | — |

---

## 4. Branding it — adapting to your company's identity

### 4a. The theme file (30 minutes, covers 80% of brand fit)

Copy `themes/midnight.css` to `themes/<yourbrand>.css` and change nine tokens:

```css
:root {
  --app-bg:   /* the surround behind the slide — usually a shade darker/lighter than --bg */
  --bg:       /* slide background */
  --fg:       /* primary text */
  --muted:    /* secondary text — use rgba of --fg at ~0.56, not a separate hex */
  --faint:    /* hairline rules and borders — rgba of --fg at ~0.13 */
  --surface:  /* card / code-block fill, one step off --bg */
  --accent:   /* the single vivid brand colour: kickers, numbers, section slides */
  --accent-2: /* secondary, used only in decorative washes and note markers */
  --accent-fg:/* text colour ON --accent — must pass contrast against it */
  --wash-opacity: /* 0 kills the decorative gradient entirely; 0.5–0.9 typical */
}
```

Notes that will save you a round trip:

- Derive `--muted` and `--faint` as `rgba()` of `--fg`, never as separate hex values. It's what
  makes the whole thing feel coherent, and it survives a background change.
- `--accent-fg` is the most common mistake. Section-divider slides fill with `--accent` and set
  text to `--accent-fg`. If your brand colour is mid-tone, check contrast both ways.
- Set `--wash-opacity: 0` for conservative/corporate brands. The radial gradient wash reads as
  "startup deck" and some brand teams will hate it.

Register the new name in the `THEMES` array in `runtime.js` (~line 300) so `T` cycles it.

### 4b. Brand fonts

Fonts live in `runtime.css` `:root` as `--font-display`, `--font-body`, `--font-serif`,
`--font-mono`. Override them in your theme file rather than editing `runtime.css`.

If your brand fonts are licensed files rather than Google Fonts, put them in `fonts/`, add
`@font-face` rules to the theme file, and drop the Google Fonts `<link>` from the deck template.
**Do this** — it also makes the deck work offline, which matters when presenting.

Type scale is tuned for a grotesk at 1280×720. If you swap in a font with a very different
x-height or width (a condensed or a serif for headlines), expect to retune `.display`, `.h1`
and `.lead` sizes in `runtime.css`. Budget an hour and check every layout in overview mode.

### 4c. Logo and footer

`runtime.js` → `decorate()` builds `.slide__chrome` (the per-slide footer). It currently prints
`data-deck-label` on the left and the slide number on the right. Swap the left span for an
`<img>` pointing at your logo. Keep it in `decorate()` rather than in the markup — that way it's
runtime-injected, stays out of the saved file, and updates everywhere at once.

### 4d. Approved layouts

If your brand team has a real template, map their master slides onto the layout classes and
delete the ones that don't fit. Fewer, well-branded layouts beat ten generic ones — and it
directly improves generation quality, because the model has fewer wrong choices available.
Update `LAYOUTS.md` to match, since that file is the model's entire view of what's possible.

---

## 5. How the iteration cycle works

### Pass 1 — generate

The skill reads `LAYOUTS.md`, gathers content, and emits `deck.html` only. It copies
`runtime.js`, `runtime.css`, and the chosen theme into the output folder unchanged.

### Pass 2 — the human edits in the browser

Open `deck.html` in Chrome, press `E`:

- click any text to edit in place
- click / drag-drop onto an image slot to swap the picture
- `⌘V` an image → free-floating sticker, drag to move, scroll to resize, `⌫` to delete
- **note** button → leaves a change request on the current slide
- **save** → writes `deck.html` and any new images back into the folder

### Pass 3 — hand it back to Claude

The key mechanism: the **note** button writes `data-note="make this punchier"` onto the
`<section>`. On the next pass, the model greps for `data-note`, applies the change, and removes
the attribute. So the revision prompt is simply:

> Apply the notes in `deck.html` and clear them.

This is deliberately cheap — the model doesn't need to be told what changed or re-read the whole
deck's intent, and the request lives physically next to the slide it's about.

**Rule for whoever continues this:** the user's edited `deck.html` is the source of truth. Never
regenerate a deck from scratch when notes exist — edit in place. Losing someone's hand-tuned
wording is the fastest way to make them stop using the tool.

### Verifying visually

Neither the sandbox nor the Chrome extension could render the deck in the session that built it,
so **it has never actually been looked at.** Before building anything new: open it, page through
all 15 slides, and check all three themes. Expect a headline or two to overflow — the type scale
was sized by arithmetic, not by eye. Fixes are one-line changes in `runtime.css`.

If you have the Claude in Chrome extension connected, this is easy to automate: navigate to the
`file://` URL, screenshot each slide, fix, repeat.

---

## 6. What to build next, roughly in value order

1. **`SKILL.md`** — the actual skill. Doesn't exist yet. Needs: when to trigger, the "copy fixed
   assets, write only `deck.html`" instruction, a pointer to `LAYOUTS.md`, content-density rules
   (word counts per layout), and the `data-note` revision protocol. This is the highest-leverage
   remaining work and the part most worth spending real thought on.
2. **Visual verification pass** — see above. Cheap, and everything else is built on it.
3. **Folder ingestion** — point the skill at a directory, it reads the images, and lays out
   slides around what it finds. Low complexity, high perceived magic.
4. **Resize handles on stickers** — scroll-to-resize is undiscoverable. Corner handles are ~40
   lines.
5. **Speaker notes** — a `data-notes` attribute plus a presenter view on a second window. Also
   makes the PDF export more useful if you print notes pages.
6. **Theme generator** — "here's our brand guide PDF / our website" → Claude writes the theme
   file. Turns a 30-minute setup into a 30-second one, and it's the feature that makes this
   shareable across teams.
7. **pptx export** — only if someone actually demands it. See the table in §3 for why it's a trap.

### Known gaps, deliberate

- Sticker positions are percentage-based against the slide, so they survive scaling — but there's
  no z-order control or alignment guides.
- `plaintext-only` means no bold-a-single-word inside a paragraph. Trade accepted for clean output.
- Edit mode makes text *leaves* editable, not structure. You can't reorder bullets by dragging;
  you can duplicate and delete whole slides only.
- No undo beyond the browser's native per-field undo. If someone deletes a slide, it's gone.
  Worth fixing before this goes wide.

---

## 7. Prompt to start the next session

> I'm continuing work on `slidecraft`, a system for generating editable branded HTML slide decks.
> Read `HANDOFF.md` then `LAYOUTS.md` in this folder before doing anything.
>
> The critical constraint: `runtime.js` and `runtime.css` are fixed assets — per deck we generate
> only `deck.html` (semantic markup using the layout classes) plus a theme file. Never let the
> model write per-deck CSS or JS.
>
> Today I want to: <task>

### Model choice

- **Building and iterating on the runtime, layouts, theme files:** Sonnet, high effort. It's
  well-scoped code against a clear spec — Opus is overkill and slower.
- **Writing `SKILL.md`, or reworking the layout system:** Opus. Prompt design and taste calls are
  where the better model actually pays for itself.
- **Visual fix rounds after screenshotting:** Sonnet, medium effort.

---

## 8. Git

Repo is initialised in this folder with two commits. It has no remote — push it somewhere before
you build on it.

Note: if you're running through Cowork on a mounted folder and git complains about
`Unable to create '.git/index.lock': File exists` after a failed command, the sandbox may lack
delete permission on the mount. Grant it and `rm -f .git/*.lock .git/objects/*/tmp_obj_*`.
