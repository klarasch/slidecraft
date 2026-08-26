# Branding slidecraft

How to adapt slidecraft to a company identity. A brand is four things on disk:

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
