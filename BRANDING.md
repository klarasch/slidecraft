# Branding slaydy

How to adapt slaydy to a company identity. A brand is four things on disk:

```
themes/<name>.css     nine design tokens + font overrides   ← required
themes/<name>.md      voice rules for writing the deck      ← recommended
themes/default        one line of text: <name>              ← required once >1 theme exists
fonts/                licensed font files + @font-face      ← only if fonts aren't on Google Fonts
images/logo.svg       the mark                              ← optional
```

Nothing else changes. `runtime.js` and `runtime.css` stay untouched — a brand that needs a
runtime change is a bug in the runtime, not a branding task.

---

## 1. The theme file

Copy `themes/midnight.css` to `themes/<yourbrand>.css` and change nine tokens:

```css
:root {
  --app-bg:   /* the surround behind the slide — usually a shade darker/lighter than --bg */
  --bg:       /* slide background */
  --fg:       /* primary text */
  --muted:    /* secondary text — rgba of --fg at ~0.56, not a separate hex */
  --faint:    /* hairline rules and borders — rgba of --fg at ~0.13 */
  --surface:  /* card / code-block fill, one step off --bg */
  --accent:   /* the single vivid brand colour: kickers, numbers, section slides */
  --accent-2: /* secondary, used only in decorative washes and note markers */
  --accent-fg:/* text colour ON --accent — must pass contrast against it */
  --wash-opacity: /* 0 kills the decorative gradient entirely; 0.5–0.9 typical */
}
```

Three rules that save a round trip:

- **Derive `--muted` and `--faint` as `rgba()` of `--fg`**, never as separate hex values. It is
  what makes the deck feel coherent, and it survives a background change.
- **`--accent-fg` is the most common mistake.** Section-divider slides fill with `--accent` and
  set all their text to `--accent-fg`. Check contrast both ways; a mid-tone brand colour usually
  needs white here, not the brand's own dark neutral.
- **Set `--wash-opacity: 0` for corporate and conservative brands.** The radial gradient wash
  reads as "startup deck" and brand teams reject it. Default to `0` unless the brand is
  visibly playful.

Show the user all nine resolved values before writing the file.

Two optional surface tokens exist for brands whose slides are not a single flat colour —
leave them unset otherwise:

```css
--slide-bg:   /* full background composition per slide (gradients, layered images);
                 falls back to --bg. Scope it to slide classes, e.g.
                 .slide--section { --slide-bg: linear-gradient(…) } */
--section-fg: /* text on the section divider when --slide-bg replaced its accent
                 fill; falls back to --accent-fg */
--deck-pad:   /* windowed inset around the deck card, default 0.94. Set 1 for a brand
                 whose deck is meant to fill the window edge-to-edge, no card */
```

One more optional token, for the divider the runtime draws between `.meta` items on the
title card. It is an em dash by default and must never be a middle dot; a brand with its own
divider sets it once here:

```css
--sep: "/";   /* any CSS content string — "\2014" is the default em dash */
```

A deck can also override it per deck or per slide with `data-sep` / `data-sep-text`, or hand
the job to a sprite icon with `data-sep-icon` (LAYOUTS.md).

List markers work the same way. The `bullets` layout and the `compare` columns read one
recipe, so a brand that wants square markers everywhere sets it once — either as the deck
default (`<body data-list="square">`) or, for a shape the named values don't cover, as tokens:

```css
--marker:        "";        /* content — a glyph string, or "" for a drawn shape */
--marker-w:      8px;       /* shape width  (auto for a glyph) */
--marker-h:      8px;       /* shape height (auto for a glyph) */
--marker-radius: 2px;
--marker-bg:     var(--accent);
```

Code slides highlight themselves from the accents above, so a brand normally needs nothing
here. Override a single token only when the derived colour misses:

```css
--code-kw:   /* keywords and tags       — default: --accent */
--code-str:  /* strings                 — default: --accent-2 toward --fg */
--code-num:  /* numbers                 — default: --accent-2 */
--code-lit:  /* true / false / null     — default: --accent-2 */
--code-key:  /* JSON keys               — default: --accent toward --fg */
--code-fn:   /* function names          — default: --fg toward --accent-2 */
--code-attr: /* markup attribute names  — default: --accent toward --fg */
--code-com:  /* comments                — default: --muted */
--code-punc: /* brackets and operators  — default: --fg at ~52% */
```

---

## 1b. PDF export: seams, not weight

Exported decks go through Chrome's print path (`--print-to-pdf`, or the browser's own print
dialog), and a translucent gradient there is not a diet problem — it's a rendering bug. Chrome
emits it as a `/PatternType 1` tiling pattern wrapping a rasterized bitmap, and the pattern's
`XStep`/`YStep` are exactly 2pt larger than the tile's own `BBox` — a dead gutter baked into the
object. macOS Preview, which is how most recipients open an exported deck, paints that gutter as
a seam line that comes and goes as you scroll, because the visible edge depends on zoom-level
sub-pixel geometry. An **opaque** gradient, by contrast, is a `/PatternType 2` vector shading —
free to print and seamless in every viewer. So the old framing was backwards: "keep it lean"
reads as an optimisation you can defer; a seam is a bug you ship.

**A uniform-alpha fill is not the problem.** A flat `rgba()` or `color-mix(...transparent)`
background — translucent, but the same alpha everywhere — composites as a constant-alpha vector
fill, no pattern, no seam, even sitting over a photo. It's specifically a gradient whose alpha
*varies across the element* that rasterizes. In practice: a flat scrim over a photo is free to
leave translucent; a scrim that fades is what seams.

**The flatten recipe, and its hard limit.** For a translucent gradient over an opaque,
runtime-known surface, bake the surface into the stops instead of fading to transparent:
`color-mix(in srgb, C X%, <base>)` fading to `<base>` composites identically to X%-alpha `C` over
that base, and prints as vector. The catch is that this only works when layers don't overlap —
an opaque final stop covers everything beneath it, so if a second translucent layer sits on top,
flattening the first one no longer matches what the eye sees. Measured on an overlapping 4-layer
hero graphic: flattening changed 72% of subpixels against the un-flattened render — reverted. If
your art is stacked translucent layers, flattening isn't hard, it's impossible; the way out is
redrawing with fewer or non-overlapping layers, or pre-rendering the art as a single asset. The
pre-render route has its own caveat: an SVG loaded as a CSS `background-image` is cascade-isolated
— `currentColor` and CSS custom properties inside it don't resolve against the host page — so a
pre-rendered asset can't track theme tokens. It has to be baked once per theme, not written once
against `var(--accent)`.

**The wash token contract.** The runtime's own wash paints `background: var(--wash, <stock>)` on
screen and `background: var(--wash-print, <stock, already flattened>)` in print, against a
`--wash-base` that defaults to `var(--slide-bg, var(--bg))` and is re-pointed on
`.slide--section`. A theme that replaces the wash sets `--wash`, same as always, and should set
`--wash-print` alongside it to a flattened equivalent — the shorthand can carry per-layer
`position / size repeat` if the wash isn't a single layer. No selector overrides, no fighting
upstream's print block. The same discipline generalizes past the wash: any decorative gradient a
theme adds should ship its own print variant in the theme's `@media print` block, not rely on
inheriting the runtime's.

**Upstream's own ledger, honestly.** After the wash fix, the runtime's remaining
`/PatternType 1` count on the demo deck is exactly one: the full-bleed slide's fading scrim over
its photo. Both escape hatches were tried and both failed — oversizing the layer doesn't move the
pattern's `BBox`, because Chrome sizes it to the clipped/visible paint region, not the generating
box; and an SVG swap can't track `var(--bg)` for the reason above. It stays translucent, and it's
documented in the runtime source at the rule that emits it. Expect the same residual on any
full-bleed-style slide you add, and know that a fading scrim you add elsewhere will seam the same
way — where the design can tolerate it, a uniform-alpha scrim (see above) sidesteps the defect
entirely instead of trading it off.

**Measure honestly.** `pdfimages -list` does not descend into pattern content streams — it
reported 38 images on a file that actually contains 296 image XObjects once the patterns are
counted. Don't trust it for this. Two commands do tell the truth, run against a Chrome
`--headless --print-to-pdf` export:

```bash
grep -c '/PatternType 1' deck.pdf
```

Zero is the target. If it reports 0 on a file you expect to be dirty, the pattern objects are
sitting in a compressed stream — decompress first (`pikepdf --qdf` or equivalent) and re-count.
The other check, for full-page bitmaps specifically, still holds:

```bash
python3 - deck.pdf <<'PY'
import re,sys
d=open(sys.argv[1],'rb').read()
full=sum(1 for m in re.finditer(rb'<</Type\s*/XObject\s*/Subtype\s*/Image(.{0,300}?)>>\s*stream',d,re.S)
         if (w:=re.search(rb'/Width (\d+)',m.group(1))) and int(w.group(1))>=900)
print("full-page bitmaps:", full)
PY
```

A few habits from the old measured passes still hold, and are cheaper to just follow than to
re-derive:

- **Draw hairlines as borders, not gradient layers.** A rule built as
  `linear-gradient(...) / 1px 100%` becomes a 1×540 image stretched across the whole page, and
  Preview renders the stretch as a visible seam. A real border (on the element itself or on
  `::before`/`::after`) is vector and has no seam.
- **Use crisp rings, not blurred shadows, on anything meant to print.** A blurred `box-shadow`
  forces Chrome to emit a transparency group per element, and Preview draws the shadow's
  bounding box as an opaque square over whatever's underneath. Stack zero-blur layers instead:
  `0 0 0 4px color-mix(in oklab, var(--accent) 30%, transparent), 0 0 0 5px rgba(8,8,8,.45)`.
- **Strip baked-in noise or grain in `@media print`.** Texture rasterizes at print DPI into
  megabytes of incompressible pixels per page; the runtime already drops its own grain, pins,
  and code-chrome there, and a theme adding texture should do the same.

---

## 2. Fonts

Fonts are declared in `runtime.css` `:root` as `--font-display`, `--font-body`, `--font-serif`,
`--font-mono`. **Override them in the theme file**, never by editing `runtime.css`:

```css
:root {
  --font-display: "Brand Grotesk", "Inter Tight", system-ui, sans-serif;
  --font-body:    "Brand Sans", Inter, system-ui, sans-serif;
}
```

If the brand fonts are licensed files rather than Google Fonts, put the files in `fonts/`, add
`@font-face` rules at the top of the theme file, and drop the Google Fonts `<link>` from the deck
`<head>`. Do this whenever you can — it also makes the deck work offline, which matters on stage.
Single-file exports (the Download-copy button and `standalone.py`) inline relative `url()`
references from every linked stylesheet, so the font files travel with the exported deck.

```css
@font-face {
  font-family: "Brand Grotesk";
  src: url("../fonts/BrandGrotesk-Medium.woff2") format("woff2");
  font-weight: 500; font-display: swap;
}
```

The type scale is tuned for a grotesk at 1280×720. A condensed face, or a serif used for
headlines, changes effective line length: expect to tighten the density budgets in `LAYOUTS.md`
rather than to retune the scale.

---

## 3. Logo

Put the mark at `images/logo.svg` (SVG, single colour where possible, so it can take `--fg`).

The per-slide footer is injected by the runtime and prints `data-deck-label` on the left. To put
the logo there instead, set `data-logo` on `<body>` — no CSS required, the runtime renders it:

```html
<body data-deck-label="Acme" data-logo="images/logo.svg" …>
```

The runtime swaps the text label for `<img class="slide__logo" src="images/logo.svg" alt="Acme">`,
sized to the footer (height ~18px, `object-fit: contain`). `data-deck-label` still supplies the
image's `alt` text, so keep it set even when `data-logo` is present.

Keep the logo off `data-bare` slides (title, section, end) — it is already hidden there, and
that is intentional: a full-bleed opener with a corner logo looks like a template.

---

## 3b. Icons

`icons/` holds the deck-content iconset (see LAYOUTS.md "Icons" for where glyphs may appear).
To brand it, **replace the folder's contents** — nothing else references the set:

- One SVG per icon; the **filename is the id** (`zap.svg` → `#i-zap`), so internal ids in your
  source files don't matter. Keep filenames semantic (`check`, `shield`, `growth`), never
  vendor or style names.
- The rendering contract: `viewBox="0 0 24 24"`, geometry drawn for `stroke: currentColor` at
  `stroke-width: 2` — the `.glyph` rule in `runtime.css` is the single place that contract is
  applied, so a filled iconset means flipping that one rule to `fill: currentColor; stroke: none`.
- Update the "Available names" line in LAYOUTS.md to match the new folder.

Swaps apply at generation time: decks embed the symbols they use, so existing decks keep the
icons they were born with (same as themes). To change icons in an existing deck, ask Claude to
swap the symbols in its sprite.

---

## 4. The voice file — `themes/<name>.md`

The theme controls how the deck looks. This file controls how it reads. Load it whenever the
brand's theme is selected, and follow it over generic instincts.

Five to ten rules. Concrete and checkable — "no exclamation marks" is a rule, "be confident" is
not. Cover: tone, banned words, how headlines are written, any mandatory slide, and which
layouts to prefer or avoid.

**Example — `themes/northwind.md`:**

```markdown
# Northwind — deck voice

- Headlines are claims, not labels. "Latency fell 40%" not "Performance results".
- Sentence case everywhere. Never Title Case, never ALL CAPS outside `.eyebrow`.
- Banned: leverage, unlock, seamless, robust, journey, excited to, revolutionary.
- Never an exclamation mark. Never an em dash in a headline.
- Numbers keep their unit and their baseline: "3.2s → 1.9s", not "41% faster".
- Every customer name needs written approval; use "a European retailer" until it has one.
- Final slide is always `slide--end` with the support address, no call to action.
- Prefer `stats` and `split`. Avoid `quote` — legal reviews every attributed quotation.
- Say "customers", never "users". Say "the platform", never "our solution".
```

---

## 5. `themes/default`

Once more than one theme exists, a one-line text file naming the theme to use without asking:

```
northwind
```

With `themes/default` present, generation never asks about branding. Without it, and with
several themes installed, ask once.

Related: `<body data-themes="a b c">` lists the themes the `T` key cycles through at
presentation time. **Omit `data-themes` entirely on a brand-locked install** — a company deck
should not be reskinnable to someone else's palette mid-talk. Include it only on the demo and
personal setups where several themes are deliberately on offer.

---

## 6. Approved layouts

If the brand team has a real template, map their master slides onto the layout classes and
delete the ones that do not fit. Fewer, well-branded layouts beat ten generic ones, and it
directly improves generation quality because the model has fewer wrong choices available.

Record the decision in the voice file ("Prefer X, avoid Y"), not by editing `LAYOUTS.md` — that
file is shared across every brand installed in the folder.

---

## 7. Sharing a brand

The whole folder is the skill. Commit it and distribute it as a Claude Code plugin, or drop it
into a repo's `.claude/skills/` as a project skill. Everyone who installs it generates decks in
the same brand with no further setup.
