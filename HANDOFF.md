# slidecraft — handoff

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
SKILL.md §3) and the runtime's "Single file" toolbar button / `inlineAssets()` (post-edit).
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
`window.slidecraft = { serialize }` is exposed for tooling.
Repo vs skill: this repo is the dev source; `./build.sh` assembles the installable skill into
`dist/slidecraft/` (+ zip) — SKILL/LAYOUTS/BRANDING/CUSTOMIZING, runtime, themes, standalone.py;
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
per-install `custom.css`/`custom.js`, and the `slidecraft:slidechange` / `slidecraft:step`
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
- Remote: https://github.com/klarasch/slidecraft (private), branch `master`.

## 7. Prompt to start the next session

> I'm continuing work on `slidecraft`, a Claude Code skill that generates editable branded
> HTML slide decks. Read `HANDOFF.md`, then `SKILL.md` and `LAYOUTS.md` in this folder.
> The critical constraint: `runtime.js` and `runtime.css` are fixed assets — per deck we
> generate only `deck.html`. Never let the model write per-deck CSS or JS.
> Today I want to: <task>
