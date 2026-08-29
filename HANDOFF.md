# slaydy — handoff

Context for continuing this project in a fresh session. Read this, then `SKILL.md`, then
`LAYOUTS.md`. `BRANDING.md` is for making it a company's own.

---

## 1. What this is

A Claude Code skill that generates **branded HTML slide decks that stay editable after
generation**, and revises them from change requests left in the browser. This folder is the
skill: `SKILL.md` is the instruction set, `runtime.js` / `runtime.css` are the fixed runtime,
`themes/` holds brands, `deck.html` is a demo deck that doubles as the test bed.

State as of 2026-08-24: runtime is visually verified in Chrome (all layouts, three themes,
portrait viewports, fullscreen). Features: navigation, overview, transitions, progressive
reveal, count-up stats, Ken Burns, speaker notes, presenter view, overflow guard, edit mode
with save-back to the folder, print-to-PDF. The UI rebuild has landed (auto-hiding bar with a
bottom hover zone, full-word labels, undo, request-change popover, add-slide picker, notes
drawer, autosave). The layout library is 20 classes (added: bento, number, compare, timeline,
image, gallery, and the callout family — annotated images with draggable numbered pins paired
to a notes list: `callout` split view with `is-flipped`, and `callout-full` full-screen with a
floating `callout__box`; pins carry the only sanctioned inline style, `left`/`top`). In edit
mode arrow keys jump whole slides (reveal steps only play in view mode). Sticker resize is corner-handle
drag with anchored opposite corners; wheel-resize was removed as awkward.
Single-file export: the standalone file (named after the deck's `<title>`) is the sole user-facing
deliverable on every surface; `standalone.py --explode` reverses it for base64-free revisions. Two producers, kept in sync by hand: `standalone.py` (run by the skill at generation,
SKILL.md §3) and the runtime's "Download copy" toolbar button / `inlineAssets()` (post-edit).
Both emit the same shape: slide markup at the top (hand-editable), compacted stylesheet +
runtime appended at the end of `<body>`, a `#standalone-guard` style in `<head>` against
unstyled flash, images/logo as data: URIs, `data-themes` stripped, `<html data-standalone>`.
Both exporters prefer pre-minified `runtime.min.js`/`runtime.min.css` built by `build.sh`
(esbuild via npx; standalone.py checks mtime freshness, the browser can't); without them they
fall back to conservative compaction (comments/indent/blank lines only — line-interior
whitespace is never touched, protecting CSS content strings and JS template HTML).
`runtime.min.*` are generated artifacts — always rebuild after touching runtime files.
A no-JS fallback in runtime.css shows the fitted title slide before boot / in Quick Look.
PDF export: `@page 13.333in 7.5in` verified correct (headless print = 960×540pt, notes
variant included); a "with/without speaker notes" chooser popover fronts `print()` when notes
exist (`show-notes` class, cleared on afterprint unless `?notes`). Known observation: the demo's
mesh-gradient SVGs rasterize huge in Chrome's PDF pipeline (~56 MB) — revisit if real decks hit it.
Standalone decks re-save and re-export themselves without fetch. The
browser inlining needs http(s) — file:// decks can't fetch siblings, the button toasts guidance.
`window.slaydy = { serialize, options, transient, snapshot, toast }` is exposed for
tooling and brand extensions (CUSTOMIZING.md layer 3). `options.declare` registers per-slide
data-* options — derived ones are stripped on save, authored ones with `values` get boot
validation plus a control in the edit-mode Options panel; a `when` selector/predicate keeps
each row on the slides it's relevant to, `onchange` runs side effects. Multi-theme decks
export their whole theme list into single files as `<style data-theme>` blocks (T keeps
working; `--explode` restores `themes/*.css`). Saves emit `slaydy:serialize`
on `.deck`, and both single-file exporters inline relative `url()` refs inside linked
stylesheets. Transitions move slide content, never the slide box (translucent-slide themes), and only the
leaving slide fades — on top of the already-opaque entering one, so identical backgrounds
stay pixel-steady instead of dipping mid-cross-fade;
fit() snaps the deck to whole pixels, `--deck-pad` controls the windowed inset.
Repo vs skill: this repo is the dev source; `./build.sh` assembles the installable skill into
`dist/slaydy/` (+ zip) — SKILL/LAYOUTS/BRANDING/CUSTOMIZING, runtime, themes, standalone.py;
demo deck and repo docs excluded.
First real skill-install test (2026-08-24, `~/Code/slidecraft-testbed`) caught a contract hole:
with the demo deck excluded from the build, nothing documented the deck.html shell, and the
generating model omitted `.stage > .deck` (fatal black screen), put the theme link before
runtime.css, and skipped the font links. Fixed three ways: LAYOUTS.md now opens Deck-level
docs with a copy-exactly skeleton; SKILL.md §3 requires it (and §2/§4 now require the one
brief message + never picking a theme silently); runtime.js boot self-repairs missing
wrappers and theme-link order (repairs persist through save). Lesson: anything only the demo
deck demonstrated is invisible to the shipped skill — the contract docs must be self-sufficient.
`CUSTOMIZING.md` defines the update-safe bespoke story: theme-layer CSS,
per-install `custom.css`/`custom.js`, and the `slaydy:slidechange` / `slaydy:step`
runtime events.

---

## 2. The one architectural decision everything rests on

**The runtime is a fixed asset. The model never writes JavaScript or CSS.**

```
runtime.js      nav, overview, transitions, reveal, edit mode, presenter, save, export
runtime.css     layout library + motion + chrome + print styles
themes/*.css    nine design tokens each (+ font overrides)   ← one per brand
themes/*.md     that brand's writing voice
deck.html       semantic markup + attributes                  ← the ONLY file generated per deck
LAYOUTS.md      the markup contract the model follows
```

Why, in order of importance:

1. **Consistency.** A bug in the runtime is fixed once, everywhere. Regenerated per-deck code
   would mean a different set of bugs in every deck.
2. **Cost.** A deck is ~200 lines of markup instead of ~1500 lines of markup+CSS+JS.
3. **Revisability.** Small, semantic, diffable output; targeted in-place edits are possible.

Everything the model can "design" — transitions, reveals, animations, logo, theme list — is an
**attribute the runtime already supports**. When a new capability is wanted, add it to the
runtime and document it in `LAYOUTS.md`; never let a deck carry its own `<style>` or `<script>`.

---

## 3. Decisions already made, and why

| Decision | Rationale | Reversible? |
|---|---|---|
| Fixed 1280×720 canvas, CSS-transform scaled; absolutely centred (not grid) | Predictable typography; what you see is what prints. Grid centring broke on portrait viewports | Hard |
| Print stylesheet for PDF, not html2canvas | Rasterisers mangle fonts and gradients; print CSS keeps text selectable | Easy |
| File System Access API for saving; base64 only as fallback | Real files in `images/`, no 2 MB photos becoming 2.7 MB of text. Also why handing a deck back to Claude costs ~3k tokens | Medium |
| `contenteditable="plaintext-only"` | Plain contenteditable injects junk markup into the saved file | Easy, but output gets dirty |
| Layout classes as master slides | The model *selects* a layout; this is the real source of visual consistency | Hard |
| Motion as attributes (`data-transition`, `data-reveal`, …), tiers decided by the brief | "Bespoke" keynotes without per-deck code | Hard |
| Change requests stored as `data-note` on the slide, no sidecar file | One source of truth; the request lives next to the slide it's about | — |
| Theme list from `<body data-themes>`; brand-locked decks omit it | Brand lock is a markup matter, controlled by the skill, not a code edit | Easy |
| No pptx export yet | HTML→pptx generic conversion fails. If demanded: a per-layout mapper via pptxgenjs (fixed asset, ~70 % fidelity, fonts must be installed) | Easy to add |
| Verify step is opt-in | Overflow is prevented by density budgets + the runtime's auto-shrink; a headless `--dump-dom | grep data-overflow` is the cheap check for bespoke tier | — |

---

## 4. How the cycle works

1. **Generate** — the skill gathers a five-field brief (occasion, audience, minutes, tone,
   tier), copies the runtime + theme into a new folder, writes `deck.html`. See `SKILL.md` §2–3.
2. **Edit in the browser** — `E`: text in place, image slots, pasted stickers, add/duplicate/
   delete slides, speaker notes, **Request change** on a slide (→ `data-note`), save to folder.
3. **Hand back** — "Apply the requests in `deck.html`." The model greps `data-note`, edits
   those sections in place, removes the attribute. Never regenerates. See `SKILL.md` §5.

---

## 5. What to build next, in value order

1. **Finish the UI rebuild** (in progress) and re-verify every layout in all three themes.
2. **Setup mode end-to-end test** — run `SKILL.md` §7 against a real website and check the
   resulting theme on every layout. This is the feature that makes it shareable.
3. **Folder ingestion** — point the skill at a directory of images; it lays out slides around
   what it finds. Low complexity, high perceived value.
4. **Sticker z-order / alignment guides** — only if people actually use stickers.
5. **pptx mapper** — only on real demand. See §3.

### Known gaps, deliberate

- `plaintext-only` means no bold-a-single-word inside a paragraph.
- Structural editing is limited to: add/duplicate/delete slide, add/remove bullet, remove an
  empty element, stickers. No drag-reorder.
- Actual file save can't be automated in tests (needs a real folder-picker gesture); verify it
  by hand after touching `serialize()` or `save()`.

---

## 6. Working on it

- A static server config exists in `.claude/launch.json` (`python3 -m http.server 8765`).
  `file://` works too, but the server is what the preview pane needs.
- The server sends no cache headers — after editing runtime files, force-reload with
  `fetch(url, {cache: "reload"})` then `location.reload()`, or you'll test stale code.
- Headless check: `Chrome --headless=new --dump-dom http://127.0.0.1:8765/deck.html | grep data-overflow`.
- Model choice: runtime/layout/theme code → Sonnet, high effort; `SKILL.md` and layout-system
  taste calls → Opus; visual fix rounds → Sonnet, medium.
- Remote: https://github.com/klarasch/slaydy (public), branch `master`. Renamed from
  `slidecraft` on 2026-08-28; GitHub redirects the old URL, but update any clone's origin.

## 7. Releasing a runtime change

`runtime.js` and `runtime.css` are the only runtime files, and every deck ever generated
carries a copy of them. A change here reaches decks written a year ago, so the bar is the
contract in `CUSTOMIZING.md`: **releases add; they never rename, remove, or redefine.** A
class or `data-*` that means one thing today means the same thing after the update.

The procedure, in order:

1. **Build it as a token or an attribute, not a special case.** A new knob is a CSS custom
   property with a default, or a `data-*` read through `closest()` so it works on `<body>`
   deck-wide and on one `<section>`. Both, if it could reasonably be either.
2. **Declare it.** Per-slide options go through `declareOption()` — that buys boot-time typo
   warnings and an Options-panel control for free. Anything the runtime derives rather than the
   author writes gets `derived: true`, so it is stripped on save.
3. **Keep the deck file authored-only.** Whatever the runtime renders — generated nodes, token
   spans, resolved custom properties — is a view, not content. Generated DOM gets `data-gen`;
   anything else needs an explicit line in `serialize()` that puts it back. The test is
   mechanical: save the deck, diff it, and see nothing you did not type.
4. **Verify in the browser, both directions.** A light theme and a dark one, edit mode on and
   off (contenteditable shreds anything clever inside an editable element), then the save
   round-trip and a single-file export from `standalone.py`.
5. **Run `./build.sh`.** It regenerates `runtime.min.*`, which the exporters prefer over the
   readable files. Committing a runtime change without it ships a stale runtime inside every
   single-file export — the failure is silent and only shows up in the deliverable.
6. **Document it where it is read.** `LAYOUTS.md` for anything the model may write,
   `BRANDING.md` for anything a theme may override. A feature absent from both does not exist
   as far as the next deck is concerned.
7. **Before shipping anything that paints translucent, export and count.** Export the demo deck
   to PDF and count `/PatternType 1` (`grep -c '/PatternType 1' deck.pdf` — see BRANDING.md
   §1b for why `pdfimages -list` lies). A new spatially-varying translucent gradient must either
   be flattened in the print block or documented in place as an accepted residual. This
   release's code panel is the cautionary example: the terminal-ring chrome shipped translucent
   and had to be caught after the fact.
8. **Commit, push, and let forks take it.** `UPDATING.md` is the recipe they follow; the commit
   message is what tells them whether this release lets them delete an override.

---

## 8. Prompt to start the next session

> I'm continuing work on `slaydy`, a Claude Code skill that generates editable branded
> HTML slide decks. Read `HANDOFF.md`, then `SKILL.md` and `LAYOUTS.md` in this folder.
> The critical constraint: `runtime.js` and `runtime.css` are fixed assets — per deck we
> generate only `deck.html`. Never let the model write per-deck CSS or JS.
> Today I want to: <task>
