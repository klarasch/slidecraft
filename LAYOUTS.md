# Layout contract

This is the model-facing reference. When generating a deck, emit **only** `<section class="slide slide--X">` blocks
using the classes below. Never write CSS or JS — `runtime.css` and `runtime.js` are fixed assets.

Canvas is 1280×720. Every slide is `<section class="slide slide--TYPE" data-title="short label">`.
Add `data-bare` to hide the footer (use on title, section dividers, end card).

---

## Text primitives (usable inside any layout)

| class | use | approx size |
|---|---|---|
| `.eyebrow` | small uppercase mono kicker, accent-coloured | 13px |
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

Keep headlines under ~10 words. `.lead` under ~20 words. `.body` under ~40 words.

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

### `slide--cards` — exactly 3 cards
`.cards > .card` each with `.num`, `.h3`, `.body`.

### `slide--stats` — exactly 3 figures
`.stats > .stat` each with `.stat__num` and `.body`.

### `slide--full` — full-bleed image with a bottom gradient
```html
<figure class="media bleed"><img src="images/x.jpg" alt=""></figure>
<div class="overlay">…eyebrow, h1, lead…</div>
```

### `slide--code` — mono block. Escape `<` as `&lt;`. Max ~14 lines.

### `slide--end` — centred closing card.

---

## Images

- Reference files relatively: `<img src="images/name.png" alt="">`.
- To leave an upload placeholder, emit an empty slot: `<figure class="media split__media"></figure>`.
  It renders a dashed "＋ image" target the user can click, drop onto, or paste into.

## Notes from the user

A slide the user has annotated carries `data-note="…"`. On a follow-up pass, read those
attributes, apply the requested change, and remove the attribute.

## Themes

`<link id="theme" href="themes/midnight.css">` — one of `midnight`, `paper`, `mint`.
A new brand theme is a copy of one of these with the nine tokens changed.
