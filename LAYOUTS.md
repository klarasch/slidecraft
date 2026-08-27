# Layout contract

This is the model-facing reference. When generating a deck, emit **only** `<section class="slide slide--X">` blocks
using the classes below. Never write CSS or JS — `runtime.css` and `runtime.js` are fixed assets.

Canvas is 1280×720. Every slide is `<section class="slide slide--TYPE" data-title="short label">`.
Add `data-bare` to hide the footer (use on title, section dividers, end card).

---

## Text primitives (usable inside any layout)

| class | use | approx size |
|---|---|---|
| `.eyebrow` | small uppercase mono kicker, neutral — wrap a number/tag in `<b>` for an accent-coloured division: `<b>03</b> Layouts`. Never join eyebrow parts with `·` | 13px |
| `.display` | hero headline | 86–108px |
| `.h1` | slide headline | 62px |
| `.h2` | sub-headline | 40px |
| `.h3` | card title | 24px |
| `.lead` | supporting sentence, muted, max 22ch | 25px |
| `.body` | paragraph, muted | 19px |
| `.caption` | mono footnote | 13px |
| `.serif` | switch to the display serif (quotes) | — |
| `.accent` / `.dim` | colour a `<span>` | — |
| `.chip` | pill-shaped tag | 13px |
| `.stack .stack--sm/md/lg` | vertical flow with gap | — |
| `<code>` | inline mono | — |

---

## Density budgets — hard limits

Type is sized by arithmetic for a 1280×720 canvas. Over these numbers a slide overflows.
These are ceilings, not targets: aim under them. Cut words rather than shrink type — you cannot
change type sizes, only what you write.

| layout | budget |
|---|---|
| `title` | headline ≤ 8 words · eyebrow ≤ 6 words · meta ≤ 4 spans |
| `section` | name ≤ 4 words |
| `statement` | display ≤ 12 words · `.lead` ≤ 20 words |
| `bullets` | ≤ 5 items × ≤ 14 words each · headline ≤ 8 words |
| `agenda` | ≤ 10 items × ≤ 6 words each |
| `cards` | exactly 3 × (`.h3` ≤ 4 words, `.body` ≤ 25 words) |
| `bento` | 5 cells (first `cell--wide`) × (`.h3` ≤ 3 words, `.body` ≤ 14 words; a `.stat__num` cell ≤ 6 chars) |
| `stats` | exactly 3 × (`.stat__num` ≤ 6 characters, `.body` ≤ 12 words) |
| `number` | `.stat__num` ≤ 7 characters · `.lead` ≤ 20 words |
| `compare` | exactly 2 cols × (`.h3` ≤ 3 words, ≤ 4 items × ≤ 10 words) |
| `timeline` | 3–5 steps × (`.caption` ≤ 3 words, `.h3` ≤ 3 words, `.body` ≤ 8 words) |
| `callout` | ≤ 6 pins × note ≤ 12 words · headline ≤ 6 words |
| `callout-full` | ≤ 5 pins × note ≤ 10 words · headline ≤ 5 words |
| `split` | `.split__body` ≤ 60 words total across all paragraphs · headline ≤ 8 words |
| `quote` | quotation ≤ 30 words · attribution ≤ 12 words |
| `full` | headline ≤ 8 words · `.lead` ≤ 20 words |
| `image` | `.credit` ≤ 12 words, or omit it |
| `gallery` | 2–4 images · headline ≤ 8 words |
| `code` | ≤ 14 lines × ≤ 60 characters |
| `end` | display ≤ 8 words · `.lead` ≤ 20 words |

---

## Layouts

### `slide--title` — opener
```html
<section class="slide slide--title" data-bare data-title="Cover">
  <p class="eyebrow">Kicker</p>
  <h1 class="display">Headline with an <span class="accent">accent</span>.</h1>
  <div class="meta"><span>Author</span><span>·</span><span>Date</span></div>
</section>
```

### `slide--section` — divider, fills with the accent colour
```html
<section class="slide slide--section" data-bare data-title="Section: X">
  <p class="index">02</p><p class="eyebrow">Section</p>
  <h2 class="display">Name</h2>
</section>
```

### `slide--statement` — one big idea
`.eyebrow` + `.display` (≤17ch wide) + optional `.lead`.

### `slide--quote`
`<blockquote class="serif">` + `<figcaption>` with optional `<img class="avatar">` and `.caption`.

### `slide--bullets` — auto-numbered, hairline-separated. Max 5 items.
```html
<div class="stack stack--sm"><p class="eyebrow">…</p><h2 class="h1">…</h2></div>
<ul><li>One sentence.</li>…</ul>
```

### `slide--agenda` — two-column index. Max 10 items.
`<ol><li><span class="t">Title</span><span class="n">01</span></li>…</ol>`

### `slide--split` — image bleeding off the left edge + text
Add `is-flipped` to put the image on the right.
```html
<figure class="media split__media"><img src="images/x.png" alt=""></figure>
<div class="split__body">…eyebrow, h1, body, chip…</div>
```

### `slide--callout` — annotated image: numbered pins keyed to notes
For design walkthroughs, screenshot reviews, anatomy-of-X slides. Pins pair with the
notes by DOM order — first pin ↔ first note — and number themselves via CSS counters,
so never write the numbers. `style="left:…%;top:…%"` on `.pin` is the **only** inline
style a deck may carry (percentages of the media box). The image is letterboxed, never
cropped. In edit mode pins drag; double-clicking the image adds a pin + note pair.
```html
<section class="slide slide--callout" data-title="Checkout redesign">
  <figure class="media callout__media">
    <img src="images/checkout.png" alt="">
    <i class="pin" style="left:22%;top:31%"></i>
    <i class="pin" style="left:64%;top:58%"></i>
  </figure>
  <div class="callout__body">
    <p class="eyebrow">Kicker</p>
    <h2 class="h2">Headline goes here</h2>
    <ol class="callout__notes">
      <li>Nav collapses to a single action.</li>
      <li>Price updates inline, no modal.</li>
    </ol>
  </div>
</section>
```
`data-reveal` on the `ol` walks the notes one per keypress (pins stay visible).
Add `is-flipped` on the section to put the image on the right.
If the user supplied no screenshot yet, emit the empty slot and pins near where
they described the features — they can drop the image in and drag the pins.

### `slide--callout-full` — full-screen annotated image
The image fills the slide (letterboxed, never cropped); the notes float in a
glass box. Same pin rules and edit gestures as `callout`. Add `callout__box--left`
to dock the box on the left — pick the side the image leaves emptiest.
```html
<section class="slide slide--callout-full" data-bare data-title="…">
  <figure class="media callout__media">
    <img src="images/dashboard.png" alt="">
    <i class="pin" style="left:28%;top:32%"></i>
    <i class="pin" style="left:56%;top:60%"></i>
  </figure>
  <div class="callout__box">
    <h3 class="h3">Headline goes here</h3>
    <ol class="callout__notes"><li>…</li><li>…</li></ol>
  </div>
</section>
```

### `slide--cards` — exactly 3 cards
`.cards > .card` each with `.num`, `.h3`, `.body`.

### `slide--bento` — 3×2 tile mosaic
Headline stack, then `.bento` with 5 cells: the first spans two columns. A cell holds
`.h3` + `.body`, or a `.stat__num` + `.body`, or (with `cell--media`) a single image.
`cell--accent` fills one cell with the accent colour — use at most one.
```html
<div class="stack stack--sm"><p class="eyebrow">…</p><h2 class="h1">…</h2></div>
<div class="bento">
  <article class="cell cell--wide"><h3 class="h3">Lead idea</h3><p class="body">…</p></article>
  <article class="cell"><p class="stat__num">42</p><p class="body">…</p></article>
  <article class="cell"><h3 class="h3">…</h3><p class="body">…</p></article>
  <article class="cell"><h3 class="h3">…</h3><p class="body">…</p></article>
  <article class="cell cell--accent"><h3 class="h3">…</h3><p class="body">…</p></article>
</div>
```
Variants: `cell--tall` (spans both rows — pair it with four normal cells),
`cell--media` (cell is one edge-to-edge image: `<article class="cell cell--media"><figure class="media"></figure></article>`).

### `slide--stats` — exactly 3 figures
`.stats > .stat` each with `.stat__num` and `.body`.

### `slide--number` — one hero figure, nothing else
```html
<p class="eyebrow">Kicker</p>
<p class="stat__num" data-animate="count">~3,000</p>
<p class="lead">One sentence putting the number in context.</p>
```

### `slide--compare` — two panels side by side (before/after, us/them)
```html
<div class="stack stack--sm"><p class="eyebrow">…</p><h2 class="h1">…</h2></div>
<div class="compare">
  <article class="col"><h3 class="h3">Before</h3><ul><li>…</li></ul></article>
  <article class="col col--accent"><h3 class="h3">After</h3><ul><li>…</li></ul></article>
</div>
```
Put the option you are arguing for in the `col--accent` panel.

### `slide--timeline` — 3–5 horizontal steps on a hairline
```html
<div class="stack stack--sm"><p class="eyebrow">…</p><h2 class="h1">…</h2></div>
<div class="timeline">
  <div class="step"><p class="caption">Q1</p><h3 class="h3">Milestone</h3><p class="body">One line.</p></div>
  …
</div>
```

### `slide--full` — full-bleed image with a bottom gradient and overlay text
```html
<figure class="media bleed"><img src="images/x.jpg" alt=""></figure>
<div class="overlay">…eyebrow, h1, lead…</div>
```

### `slide--image` — full-screen image, no text
The picture is the slide. Optional `.credit` renders a small caption chip bottom-right.
```html
<section class="slide slide--image" data-bare data-title="…">
  <figure class="media bleed"><img src="images/x.jpg" alt=""></figure>
  <p class="credit">Photo: …</p>
</section>
```

### `slide--gallery` — a grid of 2–4 images
Headline stack, then `.gallery` with `figure.media` children. Three sit in a row by
default; add `gallery--2` for two across, `gallery--4` for a 2×2 grid.
```html
<div class="gallery">
  <figure class="media"><img src="images/a.jpg" alt=""></figure>
  <figure class="media"><img src="images/b.jpg" alt=""></figure>
  <figure class="media"><img src="images/c.jpg" alt=""></figure>
</div>
```

### `slide--code` — mono block. Escape `<` as `&lt;`. Max 14 lines.

### `slide--end` — centred closing card.

### `slide--placeholder` — a slide to be written on a later pass
A section carrying only `data-note` and this class. The runtime renders it as a dashed
outline showing the note text. On the next revise pass, replace it with a real slide.
```html
<section class="slide slide--placeholder" data-title="TBD"
         data-note="a slide on pricing tiers goes here"></section>
```

---

## Motion

All motion is attribute-driven. Never write CSS or keyframes.

| attribute | goes on | does | tier |
|---|---|---|---|
| `data-transition="fade\|rise\|push\|wipe\|zoom\|none"` | `<body>` | deck-wide default between slides (default `rise`) | any |
| `data-transition="…"` | `<section>` | override for that one slide | polished, bespoke |
| `data-reveal` | `ul`, `ol`, `.cards`, `.stats`, `.stack`, `.bento`, `.compare`, `.timeline`, `.gallery` | reveals children one per keypress | polished, bespoke |
| `data-reveal` | any single element | that element becomes one step | bespoke |
| `data-animate="count"` | `.stat__num` | counts up on entry; a non-numeric prefix/suffix (`$`, `%`, `×`, `+`) is preserved | polished, bespoke |
| `data-kenburns` | `figure.media` | slow zoom while the slide is shown | bespoke |
| `data-reveal-all` | `<section>` | that slide shows its `data-reveal` content all at once — the presenter's per-slide opt-out, also in the edit-mode Options panel | any |
| `data-list="numbers\|dots"` | `<section class="slide slide--bullets">` | marker style for the list layout (default: numbered) — also in the Options panel | any |

Content-tailored transitions (bespoke tier): stats and big numbers → `zoom`, section
dividers → `wipe`, quotes → `fade`, full-bleed and full-screen images → `zoom` with
`data-kenburns`, everything else → deck default.

`data-reveal` costs the presenter a keypress per child. Never put it on a slide the audience
must read at a glance, and never on `agenda`.

---

## Speaker notes

```html
<section class="slide slide--bullets" data-title="Pricing">
  …
  <aside class="notes">Land the migration cost before the number. Pause after "free tier".</aside>
</section>
```

Hidden in normal view and in PDF. Shown in presenter view (`S`). Two to four sentences,
written as spoken prompts — not a transcript, not a repeat of the slide.

---

## Deck skeleton — copy this shell exactly

Every `deck.html` is this file, with slides inside `.deck`. The `.stage > .deck` wrappers
and the closing script are **load-bearing — without them the runtime never starts and the
deck renders black**. Link order matters: `runtime.css` before the theme, so brand tokens
win the cascade. The font links are what the type system expects; omit them and every deck
falls back to system fonts.

```html
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Deck title</title>
<meta name="slidecraft-brief" content="occasion=…; audience=…; minutes=…; tone=…; tier=…">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter+Tight:wght@400;500;600;700&family=Inter:wght@400;500;600&family=Instrument+Serif:ital@0;1&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
<link rel="stylesheet" href="runtime.css">
<link rel="stylesheet" href="themes/<name>.css" id="theme">
</head>
<body data-deck-label="Deck label" data-transition="rise">
<div class="stage">
<div class="deck">

  <!-- <section class="slide slide--…"> … one per slide … </section> -->

</div>
</div>
<script src="runtime.js"></script>
</body>
</html>
```

After writing the file, confirm: it contains `<div class="deck">`, the theme `<link>` comes
**after** `runtime.css`, and the last thing in `<body>` is the `runtime.js` script.

## Deck-level markup

```html
<body data-deck-label="Q3 Review"
      data-transition="rise"
      data-themes="midnight paper mint"
      data-logo="images/logo.svg">
```

- `data-deck-label` — the footer label, left of the slide number. Also supplies the logo's
  `alt` text when `data-logo` is set, so keep it even then.
- `data-transition` — deck default, above.
- `data-themes` — space-separated theme names `T` cycles through. **Omit it** on a
  brand-locked install so the deck can't be reskinned away from the brand.
- `data-logo` — path to the brand mark (see `BRANDING.md`). When set, the runtime renders it
  in the footer in place of `data-deck-label`'s text. Optional — omit it to keep the text label.

In `<head>`:

```html
<meta name="slidecraft-brief"
      content="occasion=sales pitch; audience=CTO + platform team; minutes=20; tone=direct; tier=polished">
```

The brief the deck was generated from. Read it on a revise pass to stay consistent with the
original tier and tone. Keep it up to date if the user changes the brief.

---

## Images

- Reference files relatively: `<img src="images/name.png" alt="">`.
- To leave an upload placeholder, emit an empty slot: `<figure class="media split__media"></figure>`.
  It renders a dashed "＋ image" target the user can click, drop onto, or paste into.
- Never invent a path to a file that does not exist. An empty slot is always better than a broken image.

---

## Notes from the user

A slide the user has annotated carries `data-note="…"`. On a follow-up pass, read those
attributes, apply the requested change, and remove the attribute.

---

## Derived attributes — never write these

The runtime writes these itself. They are diagnostics, not inputs.

- `data-overflow` — the slide still overflows after the runtime shrank it up to 20%. Fix it by
  cutting words back inside the budgets above.
- `data-empty` — on an image slot with no `<img>`.
- `data-standalone` on `<html>` — marks a single-file export (assets inlined). Written by the
  runtime's Single-file export; when revising such a file, touch only slide markup.

---

## Themes

`<link id="theme" href="themes/midnight.css">` — whichever themes exist in `themes/`.
A new brand theme is a copy of one of these with the nine tokens changed. See `BRANDING.md`.
