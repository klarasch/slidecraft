# Customizing slaydy — and still getting updates

The rule that makes updates painless: **everything slaydy ships is replaceable; everything
yours lives in files an update never touches.**

```
UPDATED (replace byte-for-byte, never edit)     YOURS (an update never touches these)
─────────────────────────────────────────       ─────────────────────────────────────
runtime.js                                      themes/<yours>.css   your brand: tokens + any CSS
runtime.css                                     themes/<yours>.md    your brand's writing voice
SKILL.md · LAYOUTS.md · BRANDING.md             themes/default       which theme to use
themes/midnight|paper|mint.css (stock)          fonts/               your font files
                                                images/logo.svg      your mark
                                                custom.css           bespoke graphics (optional)
                                                custom.js            bespoke behaviour (optional)
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

## Layer 1 — brand tokens (covers most needs)

`themes/<yours>.css` restyles every layout at once through nine variables plus `@font-face`.
Colors, typefaces, corner radius, the gradient wash (`--wash-opacity: 0` for corporate).
See `BRANDING.md`. This is the right tool for "make it look like us".

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
(SKILL.md §3). The runtime emits events for you to hook:

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

The customized folder is still just a skill: commit it and distribute as a Claude Code plugin,
or drop it into a repo's `.claude/skills/`. Everyone who installs it gets your brand, graphics,
and layouts — and you can still pull runtime updates into it from upstream.
