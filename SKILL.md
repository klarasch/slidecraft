---
name: slaydy
description: Generate branded, editable HTML slide decks, revise existing ones, and train a company brand theme. Use whenever the user wants slides, a slide deck, a presentation, a keynote, a pitch deck, a talk, or a deck for a meeting, all-hands, workshop, lecture or conference — including "make me a deck", "put this in slides", "turn this into a presentation". Also use to revise an existing slaydy deck.html (applying data-note change requests, rewriting or adding slides in place), and to set up a brand from a website URL, brand guidelines PDF, or logo. Not for .pptx or Google Slides files.
---

# slaydy

Decks are HTML. The runtime is a fixed asset; you write markup and nothing else.

```
runtime.js     nav, overview, edit mode, presenter, save, export   ← copy verbatim, never edit
runtime.css    layout library + print styles                       ← copy verbatim, never edit
themes/*.css   nine design tokens each                             ← copy verbatim, never edit
deck.html      the ONLY file you write per deck
```

Read `LAYOUTS.md` in this skill's folder before writing any markup. It is the complete list of
what exists. If a layout is not in it, it does not exist — do not invent one, and never solve a
layout problem with inline styles or a `<style>` block.

---

## 1. Pick the mode

| mode | trigger |
|---|---|
| **generate** | default — the user wants a new deck |
| **revise** | a `deck.html` with slaydy markup exists in the target folder, or the user points at one ("apply my notes", "fix slide 4", "make the intro punchier") |
| **setup** | the user wants a brand: "set up slaydy for Acme", or hands over a website URL, brand PDF, or logo |

Check for an existing `deck.html` before assuming generate. If one exists and the user's request
could be a revision, it is a revision.

---

## 2. The brief (generate mode)

Five fields:

| field | values |
|---|---|
| **occasion** | team update · all-hands · conference keynote · sales pitch · workshop · lecture · other |
| **audience** | who is in the room, and what they already know |
| **minutes** | duration → slide count |
| **tone** | plain · direct · warm · playful |
| **tier** | `template` · `polished` · `bespoke` |

**Slide count from minutes.** Keynote and pitch: ~1 slide/minute. Dense internal material:
1.5–2 slides/minute. Cap at 40 regardless. State the number you landed on.

**Tiers.**

- `template` — internal, colleagues, throwaway. No motion beyond the default `rise`. No speaker
  notes unless asked.
- `polished` — external or leadership. Progressive reveal on lists and card grids, `wipe` on
  section dividers, count-up stats, speaker notes throughout.
- `bespoke` — a keynote someone rehearses. Per-slide transitions chosen for content, kenburns on
  full-bleeds, staged builds, notes required, plus the verify step in §6.

**Rules for gathering it.**

1. Infer what the request already implies, and **state your assumptions in one line**.
   "Assuming: sales pitch, 20 min ≈ 18 slides, direct tone, polished tier."
2. **Send one brief message before generating** whenever two or more fields were inferred
   rather than stated: your assumptions plus a question for each genuinely open field, each
   with a default so the user can reply "go". Skip this only when the request pins down
   essentially the whole brief, or the user says to just go.
3. Never ask about colour or brand details. Branding comes from the installed themes (§4) —
   but when §4 says the theme choice itself is open, that question rides along in the same
   message; never pick a theme silently.
4. Never ask a second round. After the reply (or "go"), make defensible calls and generate.

Store the settled brief in `<head>`:

```html
<meta name="slaydy-brief"
      content="occasion=sales pitch; audience=CTO + platform team; minutes=20; tone=direct; tier=polished">
```

---

## 3. Generate

**Set up the folder.** Create an output folder named from the topic in kebab-case
(`q3-platform-review/`) next to the user's working files (in Cowork: inside the folder the user
shared with you) — never inside this skill's folder.
Copy in, byte for byte:

- `runtime.js`
- `runtime.css`
- `runtime.min.js` and `runtime.min.css` if the skill has them (used by the single-file
  export; skip silently if absent)
- `themes/<brand>.css` (only the chosen theme, unless `data-themes` applies — see §4)
- `custom.css` / `custom.js` if the install ships them (see `CUSTOMIZING.md`) — link
  `custom.css` after the theme `<link>`, `custom.js` after the `runtime.js` `<script>`
- `fonts/` if the brand has one
- `images/logo.svg` if the theme references it
- any images the user supplied

Then write `deck.html` — the only file you author — **starting from the deck skeleton in
`LAYOUTS.md`, copied exactly**. The `.stage > .deck` wrappers, the link order (runtime.css
before the theme), the font links, and the closing `runtime.js` script are all load-bearing;
a deck without them renders black.

**Deck structure.**

- Open with `slide--title`.
- Add `slide--agenda` only if there are more than 8 content slides.
- A `slide--section` divider every 4–7 slides.
- Vary layouts. Never two `bullets` in a row — reach for `bento`, `compare` or `timeline`
  instead of a second list. At most one `stats`, one `number` and one `quote` per 10 slides.
- Close with `slide--end`.
- One idea per slide. If a slide needs two headlines, it is two slides.

**Density budgets — hard.** Over these, the slide overflows.

| layout | budget |
|---|---|
| title | headline ≤ 8 words |
| section | name ≤ 4 words |
| statement | display ≤ 12 words · lead ≤ 20 words |
| bullets | ≤ 5 items × ≤ 14 words |
| agenda | ≤ 10 items × ≤ 6 words |
| cards | 3 × (title ≤ 4 words, body ≤ 25 words) |
| bento | 5 cells × (title ≤ 3 words, body ≤ 14 words) |
| stats | 3 × (number ≤ 6 chars, body ≤ 12 words) |
| number | number ≤ 7 chars · lead ≤ 20 words |
| compare | 2 cols × (title ≤ 3 words, ≤ 4 items × ≤ 10 words) |
| timeline | 3–5 steps × (title ≤ 3 words, body ≤ 8 words) |
| callout | ≤ 6 pins × note ≤ 12 words |
| callout-full | ≤ 5 pins × note ≤ 10 words |
| split | body ≤ 60 words total |
| quote | ≤ 30 words |
| code | ≤ 14 lines × ≤ 60 chars |
| gallery | 2–4 images · headline ≤ 8 words |
| full / image / end | headline ≤ 8 words · lead ≤ 20 words |

Count the words. When content will not fit, split the slide or cut the content — never shrink
the type, which you cannot do anyway.

**Tier → motion.**

| | template | polished | bespoke |
|---|---|---|---|
| `<body data-transition>` | `rise` | `rise` | `rise` |
| per-slide `data-transition` | — | `wipe` on section dividers | content-tailored (below) |
| `data-reveal` on `ul` / `ol` | — | yes | yes |
| `data-reveal` on `.cards` / `.stats` / `.bento` / `.compare` / `.timeline` | — | yes | yes |
| `data-animate="count"` on `.stat__num` | — | yes | yes |
| `data-kenburns` on full-bleed `figure.media` | — | — | yes |
| `<aside class="notes">` | only if asked | every content slide | every slide, required |

Content-tailored (bespoke): stats and big numbers → `zoom`, section dividers → `wipe`,
quotes → `fade`, full-bleed and full-screen images → `zoom` + `data-kenburns`,
everything else → deck default. Never put `data-reveal`
on an agenda, and never on a slide the audience must absorb at a glance.

**Speaker notes.** Two to four sentences of spoken prompts — what to land, where to pause, the
number to say out loud. Never a transcript. Never a restatement of the slide.

**Images.**

- User supplied files or a folder → use them, relative paths (`images/name.jpg`), one image per
  concept, and put the strongest one on a `slide--full`.
- Nothing supplied → emit empty slots (`<figure class="media split__media"></figure>`). They
  render as click-to-upload targets.
- **Never invent an image path.** A broken image is worse than an empty slot.
- If you author decorative SVG assets, don't bake `feTurbulence` grain into them — printed to
  PDF it rasterizes into megabytes of noise per page. The runtime strips such grain at boot and
  substitutes a screen-only CSS overlay, but SVGs that are clean to begin with also print
  correctly from `file://` pages, where the runtime can't rewrite them.

**Build the share file.** After writing `deck.html`, run:

```
python3 <this skill's folder>/standalone.py <deck folder>/deck.html
```

It writes one self-contained file beside the deck, **named after the deck's `<title>`**
(e.g. `Q3 Platform Review.html`) — runtime, theme, images baked in; markup on top, compacted
runtime at the end — that the user can send as is.
**This is the deliverable, on every surface** — the only file you hand the user. The folder
deck (`deck.html` + assets) is your workspace: it keeps revisions cheap (no base64 in context),
diffs small, and picks up runtime fixes — but the user never needs to open it, and opened via
`file://` it can't even export itself. Don't present it as an alternative. **Never inline
assets yourself** — the script exists so base64 never enters your context. If `python3` is
genuinely unavailable, say so and point at the deck's **Download copy** toolbar button instead.

**Hand off in four lines, no more.**

```
Deck: ./q3-platform-review/Q3 Platform Review.html — 18 slides, one file. Open it (Chrome), send it as is.
Source: ./q3-platform-review/deck.html — I edit this for revisions; you don't need to open it.
Keys: → ← navigate · E edit · O overview · S presenter · P PDF · F fullscreen.
```

When no folder outlives the session (chat), skip the Source line — the standalone is also the
file revisions start from.

---

## 4. Brand selection

List `themes/*.css` in this skill's folder.

- **Exactly one** → use it, say nothing about it.
- **Several** → use the name in `themes/default` (a one-line text file) if it exists. Otherwise
  the choice is the user's: **ask, in the same message as the brief questions — never pick
  silently**, even when everything else was inferable.

Set `<link rel="stylesheet" href="themes/<name>.css" id="theme">`.

If `themes/<name>.md` exists, read it. It is the brand's voice: tone, banned words, how headlines
are written, mandatory slides, layouts to prefer or avoid. It overrides your defaults.

Include `<body data-themes="a b c">` **only** on demo and personal setups where several themes
are deliberately on offer. A brand-locked install omits the attribute entirely, so the deck
cannot be reskinned away from the brand mid-talk.

---

## 5. Revise

The user's `deck.html` is the source of truth. **Never regenerate it.** Edit in place.

One exception: if a standalone export beside it (any `.html` carrying `data-standalone`) is
**newer** than `deck.html`, the user edited the deck in the browser and saved — the standalone
holds their latest slides and `data-note` requests. Run
`standalone.py --explode <that file>` (§3): images come back out as files (byte-identical ones
under their original names), and the slide markup lands in a small `deck-work.html`. Port that
markup into `deck.html`, then revise as usual.

1. Read `<meta name="slaydy-brief">` to recover the tier and tone. Stay consistent with them.
2. `grep -o 'data-note="[^"]*"' deck.html` — every hit is a change request from the user, written
   next to the slide it concerns.
3. Apply each one, then **remove that `data-note` attribute**. Leaving it behind means the change
   gets applied twice next pass.
4. A section carrying `data-note` with no content, or class `slide--placeholder`, means "write
   this slide here". Replace the whole section with a real slide at the deck's tier.
5. Leave everything else exactly as written. The user's wording is theirs, including phrasing you
   would not have chosen. Only touch slides you were asked about.
6. Never touch `src` attributes on `<img>`, and never remove `.sticker` elements — those are the
   user's pasted images.
7. Re-check the density budget on any slide you rewrote.
8. Rebuild the share file (`standalone.py`, §3) — a stale share file is worse than none.
   Delete any old export left under a previous title.

If the user asks for something that needs a new asset (a new theme, a new layout), say so rather
than writing per-deck CSS.

**Standalone files.** A deck marked `<html data-standalone>` is a single-file export: runtime,
theme, and images are inlined. **Never read or edit one directly** — the inlined images and
runtime would flood your context. When the folder deck exists, revise that and re-export (§3).
When only the standalone exists (chat, a file the user sent back), run

```
python3 <this skill's folder>/standalone.py --explode <file>.html
```

It writes a small `deck-work.html` (slide markup only, grep-able), `bundle.css`/`bundle.js`,
and the images as real files. Revise `deck-work.html` like any deck, then rebuild:
`standalone.py deck-work.html` — the output is again one self-contained file named after the
deck's title.

---

## 6. Verify (opt-in)

Run only for `bespoke` tier, or when the user asks for a check. Skip it otherwise — speed matters
more than certainty at the lower tiers.

```bash
cd <deck folder> && python3 -m http.server 8765 >/dev/null 2>&1 &
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --headless --disable-gpu --virtual-time-budget=5000 \
  --dump-dom http://localhost:8765/deck.html > /tmp/dom.html
grep -o '<section[^>]*data-overflow[^>]*>' /tmp/dom.html
```

(`file:///abs/path/deck.html` works too and skips the server; use it if `python3` is unavailable.)

The runtime auto-shrinks an overflowing slide by up to 20% before flagging it, so anything still
carrying `data-overflow` is badly over budget. Fix it by **cutting words or splitting the slide**.
Never by editing `runtime.css`. Kill the server when done.

Do not screenshot every slide by default. One overview screenshot, if the user wants to see it.

---

## 7. Setup — training a brand

Inputs: a website URL, brand guidelines PDF, and/or a logo file. Any one is enough.

**Extract** — colours (accent, background, text), typefaces, and the logo. From a URL, read the
rendered page and its CSS custom properties; from a PDF, the palette and type pages.

**Show before writing.** Present the nine resolved tokens and the draft voice rules for review in
one message. Two things to say while you do:

- `--accent-fg` must have real contrast against `--accent` — section dividers fill with the accent
  and set all their text to `--accent-fg`.
- Corporate brands almost always want `--wash-opacity: 0`. The gradient wash reads as
  "startup deck".

**Then write** into this skill's folder. If that folder is not writable (an installed skill in
Cowork or Claude.ai is), write the same files into `slaydy-brand/` next to the user's working
files instead, and finish by saying: "Add the contents of `slaydy-brand/` to the slaydy
skill folder and re-install it — from then on every deck uses this brand."

Files:

- `themes/<name>.css` — the nine tokens plus font overrides. Follow `BRANDING.md`.
- `themes/<name>.md` — voice: 5–10 concrete, checkable rules covering tone, banned words, how
  headlines are written, any mandatory slide, layouts to prefer or avoid.
- `fonts/` + `@font-face` in the theme file, if fonts were supplied as files.
- `images/logo.svg`, if supplied.
- `themes/default` — one line, this brand's name.

**Close by telling them how to share it:** commit this folder and distribute it as a Claude Code
plugin, or drop it into a repo's `.claude/skills/`. Everyone who installs it generates decks in
the brand with no further setup.

`BRANDING.md` has the details — token semantics, `@font-face`, logo placement, a worked voice
file. Read it before writing a theme.

---

## 8. Hard rules

- Never write CSS or JavaScript for a deck. No `<style>`, no `<script>`, and no `style=` —
  with one exception: `left`/`top` percentages on a callout `.pin` (see `LAYOUTS.md`).
- Never edit `runtime.js`, `runtime.css`, or a theme file to make one deck work.
- Never inline images as base64. Relative paths or empty slots.
- Never exceed the density budgets. Cut words instead.
- Never regenerate a deck that carries `data-note` or hand edits. Edit in place.
- Never ask more than one round of questions.
- Never invent a layout class, a theme name, or an image path.
- Never type a separator character to join two phrases — no `·`, `•`, `|`, `—` or `/` in a
  `.meta` line, eyebrow, chip or caption. The middle dot in particular is the loudest tell
  that a deck was machine-written. `.meta` holds bare `<span>`s; the runtime draws the
  divider (`data-sep`, see `LAYOUTS.md`).
