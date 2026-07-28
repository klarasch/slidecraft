# slidecraft — POC

Beautiful, branded HTML decks that stay editable after generation.

Open **`deck.html`** in Chrome.

| key | does |
|---|---|
| `→` `←` `space` | navigate (or click the left/right of the slide) |
| `O` | overview / table of contents |
| `E` | edit mode |
| `T` | cycle theme (midnight → paper → mint) |
| `P` | print → PDF |
| `F` | fullscreen |

## Edit mode (`E`)

- Click any text to edit it in place.
- Click an image slot to swap the picture; drag-and-drop a file works too.
- `⌘V` an image → it lands on the slide as a free-floating sticker. **Drag** to move, **scroll** to resize, `⌫` to delete.
- **note** — leave a change request on a slide for the next Claude pass (stored as `data-note`).
- **dup** / **del** — duplicate or delete the current slide.
- **save** — see below.

## Saving without base64

Press **save** and Chrome asks for a folder once. Pick the deck's own folder.
The runtime writes any newly added images into `images/` as real files and rewrites
`deck.html` in place, with markup still pointing at relative paths.

If the File System Access API isn't available (Firefox/Safari) it falls back to
downloading a standalone `deck-edited.html` with images inlined as base64.

## PDF

`P` → Chrome print dialog. Set **Margins: None** and **Background graphics: on**.
One slide per 13.333 × 7.5 in landscape page. No canvas rasterisation, so text stays
selectable and gradients stay smooth.

## Files

```
deck.html          the generated deck — the ONLY file Claude writes per deck
runtime.css        layout library + print styles   (fixed asset)
runtime.js         nav, overview, edit, save       (fixed asset)
themes/*.css       nine design tokens each         (user-authored brands)
images/            deck assets
LAYOUTS.md         the markup contract Claude follows
```

## Known gaps (deliberate, v1)

- No resize handles on stickers — scroll-to-resize only.
- No pptx export. HTML→pptx either loses the design or produces uneditable slide images.
- Folder ingestion (point the skill at a directory of images) is not wired up yet.
