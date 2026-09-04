#!/usr/bin/env python3
"""Build a self-contained single-file deck from a slaydy deck folder,
or take one apart again.

UPSTREAM-OWNED. Every update replaces this file whole, and an edit here is
skipped by take-update.sh from then on (UPDATING.md §1). If the export can't
see an asset of yours, make the asset visible instead of patching this: put
what your script fetches behind a real <script src> and it is inlined like
any other script (CUSTOMIZING.md, Layer 3). Export-time transforms belong in
the slaydy:serialize event, which the in-browser export honours.

Usage:  python3 standalone.py path/to/deck.html [out.html]
        python3 standalone.py --explode path/to/standalone.html [out.html]

Build writes one file next to the deck, named after the deck's <title> (or
to out.html): slide markup stays at the top of the file, hand-editable; the
compacted stylesheet and runtime are appended at the end of <body>; images
and the footer logo become data: URIs; data-themes is stripped (the theme
is baked in) and <html> is marked data-standalone. Mirrors the runtime's
own "Single file" export — keep the two in sync (see inlineAssets in
runtime.js).

Explode is the inverse, for revising a deck when only the standalone file
exists: inlined images come out as files in images/ (byte-identical files
already there are reused, so a round trip restores original names), the
bundled stylesheet and runtime come out as bundle.css / bundle.js, and the
result (deck-work.html by default) is a small, grep-able markup file that
build accepts straight back. Base64 never passes through a revision.
"""
import base64, hashlib, mimetypes, re, sys
from pathlib import Path
from urllib.parse import unquote_to_bytes

mimetypes.add_type("image/svg+xml", ".svg")
mimetypes.add_type("font/woff2", ".woff2")
mimetypes.add_type("font/woff", ".woff")
mimetypes.add_type("image/avif", ".avif")  # only in the stdlib map from 3.9


def min_css(t: str) -> str:
    t = re.sub(r"/\*.*?\*/", "", t, flags=re.S)
    return "\n".join(l.strip() for l in t.splitlines() if l.strip())


def min_js(t: str) -> str:
    t = re.sub(r"^[ \t]*/\*.*?\*/", "", t, flags=re.S | re.M)
    lines = (l.strip() for l in t.splitlines())
    return "\n".join(l for l in lines if l and not l.startswith("//"))


def is_rel(u: str) -> bool:
    return bool(u) and not re.match(r"^(data:|blob:|https?:|//)", u)


def read_asset(p: Path, minifier) -> str:
    """Prefer a pre-minified sibling (runtime.min.js, built by build.sh) when
    it is at least as new as the source; otherwise compact the source."""
    m = p.with_name(re.sub(r"\.(css|js)$", r".min.\1", p.name))
    if m.is_file() and m.stat().st_mtime >= p.stat().st_mtime:
        return m.read_text(encoding="utf-8")
    return minifier(p.read_text(encoding="utf-8"))


def data_uri(p: Path) -> str:
    mime = mimetypes.guess_type(p.name)[0] or "application/octet-stream"
    return f"data:{mime};base64,{base64.b64encode(p.read_bytes()).decode()}"


CSS_URL = re.compile(r"""url\(\s*(['"]?)([^)'"]+)\1\s*\)""")


def inline_css_urls(css: str, base: Path) -> str:
    """Rewrite a stylesheet's relative url() references (fonts, ornaments,
    icons) to data: URIs, resolving against the stylesheet's own folder —
    themes/x.css referring to ../assets/y.woff2 must resolve correctly.
    Anything with a #fragment passes through untouched (a data: URI can't
    address a fragment, so inlining url(file.svg#filter) would kill the
    filter), as do root-absolute /paths (they resolve against a server root
    this builder doesn't have — and `base / "/x"` would escape the deck
    folder entirely), anything is_rel rejects, and targets missing on disk.
    Mirrors the runtime's inlineCSSUrls — keep the two in sync."""
    def swap(m):
        u = m.group(2).strip()
        if "#" in u or u.startswith("/") or not is_rel(u):
            return m.group(0)
        target = base / re.sub(r"\?.*$", "", u)
        if not target.is_file():
            return m.group(0)
        return f"url({data_uri(target)})"
    return CSS_URL.sub(swap, css)


DECK_BLOCK = re.compile(r"<(style|script)([^>]*\bdata-deck\b[^>]*)>([\s\S]*?)</\1>")


def check_deck_blocks(html: str) -> None:
    """A deck may carry its own <style data-deck> / <script data-deck> for
    content under [data-custom]. Two placement rules make that safe, and both
    are cheap to get wrong silently, so they fail loudly here instead.

    1. Both live in <head>. The bundle this script appends sits at the end of
       <body>, and --explode reclaims it by position (see the regex below) —
       a deck block sitting next to it would be swallowed as runtime.
    2. No relative url() in deck CSS. Nothing inlines it, and inlining it
       would drag base64 back through the next revision, which the explode
       side exists to prevent."""
    head = html.split("</head>", 1)[0]
    for m in DECK_BLOCK.finditer(html):
        tag = m.group(1)
        if m.start() > len(head):
            sys.exit(f"error: <{tag} data-deck> must live in <head> — found one in <body>.\n"
                     f"       The runtime bundle is appended at the end of <body>; a deck block\n"
                     f"       there is indistinguishable from it on the way back out.")
        if tag == "style":
            rel = [u for _q, u in CSS_URL.findall(m.group(3)) if is_rel(u.strip())]
            if rel:
                sys.exit(f"error: <style data-deck> references a relative url({rel[0]}).\n"
                         f"       Custom CSS can't carry assets — use an <img> or inline SVG\n"
                         f"       in the slide instead, so images keep travelling as files.")


def deck_title(html: str) -> str:
    m = re.search(r"<title>(.*?)</title>", html, re.S)
    name = re.sub(r'[\\/:*?"<>|\x00-\x1f]', "", m.group(1)).strip() if m else ""
    return name or "deck"


def build(deck_path: Path, out_path: Path) -> None:
    folder = deck_path.parent
    html = deck_path.read_text(encoding="utf-8")
    check_deck_blocks(html)
    css_parts, js_parts = [], []
    theme_blocks: list[tuple[str, str]] = []
    active_name = {"v": None}
    themes_m = re.search(r'data-themes="([^"]*)"', html)
    theme_names = themes_m.group(1).split() if themes_m else []

    def take_link(m):
        tag = m.group(0)
        if 'rel="stylesheet"' not in tag:
            return tag
        href = re.search(r'href="([^"]+)"', tag)
        if not href or not is_rel(href.group(1)):
            return tag
        sheet = folder / href.group(1)
        if 'id="theme"' in tag:
            # themes travel with the file (mirrors the runtime's inlineAssets):
            # every declared theme becomes its own <style data-theme> block,
            # only the active one enabled — cycleTheme flips `media`
            active = re.search(r"([^/]+)\.css$", href.group(1))
            active_name["v"] = active.group(1) if active else None
            names = list(dict.fromkeys(theme_names or [active_name["v"]]))
            for name in filter(None, names):
                f = folder / "themes" / f"{name}.css"
                if f.is_file():
                    theme_blocks.append((name, inline_css_urls(read_asset(f, min_css), f.parent)))
            if active_name["v"] and active_name["v"] not in [n for n, _ in theme_blocks] and sheet.is_file():
                theme_blocks.append((active_name["v"], inline_css_urls(read_asset(sheet, min_css), sheet.parent)))
            return ""
        css_parts.append(inline_css_urls(read_asset(sheet, min_css), sheet.parent))
        return ""

    def take_script(m):
        src = m.group(1)
        if not is_rel(src):
            return m.group(0)
        js = read_asset(folder / src, min_js)
        js_parts.append(js.replace("</script", "<\\/script"))
        return ""

    def inline_img(m):
        src = m.group(1)
        if not is_rel(src):
            return m.group(0)
        return m.group(0).replace(f'src="{src}"', f'src="{data_uri(folder / src)}"', 1)

    html = re.sub(r"<link[^>]*>\n?", take_link, html)
    html = re.sub(r'<script src="([^"]+)"></script>\n?', take_script, html)
    html = re.sub(r'<img[^>]*src="([^"]+)"[^>]*>', inline_img, html)

    logo = re.search(r'data-logo="([^"]+)"', html)
    if logo and is_rel(logo.group(1)):
        html = html.replace(logo.group(0), f'data-logo="{data_uri(folder / logo.group(1))}"')

    if len(theme_blocks) < 2:                                   # one theme baked in — nothing to cycle
        html = re.sub(r'\s*data-themes="[^"]*"', "", html)      # before the JS bundle lands
    html = html.replace("<html", "<html data-standalone", 1)
    html = html.replace(
        "</head>", '<style id="standalone-guard">body{visibility:hidden}</style>\n</head>', 1
    )
    disabled = ' media="not all"'
    theme_css = "".join(
        f'<style data-theme="{n}"{"" if n == active_name["v"] else disabled}>\n{c}\n</style>\n'
        for n, c in theme_blocks
    )
    bundle = (
        "<style>\n" + "\n".join(css_parts) + "\nbody{visibility:visible}\n</style>\n"
        + theme_css
        + "<script>\n" + "\n".join(js_parts) + "\n</script>\n"
    )
    html = html.replace("</body>", bundle + "</body>", 1)

    out_path.write_text(html, encoding="utf-8")
    print(f"{out_path}  ({out_path.stat().st_size // 1024} KB)")


# guess_extension says ".jpe" for jpeg and similar oddities — pin the common ones
EXT = {"image/jpeg": ".jpg", "image/png": ".png", "image/svg+xml": ".svg",
       "image/webp": ".webp", "image/gif": ".gif", "image/avif": ".avif"}


def store_asset(imgdir: Path, uri: str) -> str:
    """Write one data: URI out as a file in images/, returning its relative
    path. A byte-identical file already there is reused, so exploding a deck
    whose images came from this folder restores the original names."""
    header, _, payload = uri.partition(",")
    mime = header[5:].split(";")[0]
    data = base64.b64decode(payload) if header.endswith(";base64") else unquote_to_bytes(payload)
    imgdir.mkdir(exist_ok=True)
    for f in sorted(imgdir.iterdir()):
        if f.is_file() and f.stat().st_size == len(data) and f.read_bytes() == data:
            return f"images/{f.name}"
    name = f"asset-{hashlib.sha1(data).hexdigest()[:8]}{EXT.get(mime) or mimetypes.guess_extension(mime) or '.bin'}"
    (imgdir / name).write_bytes(data)
    return f"images/{name}"


def explode(src: Path, html: str, out: Path) -> None:
    folder = src.parent
    # the appended bundle: one <style> ending in the visibility marker, then
    # any embedded theme blocks (<style data-theme>, added when the deck
    # declares several themes), then one <script> holding the runtime (its
    # own </script instances are escaped as <\/script, so the first real
    # close tag ends it)
    m = re.search(
        r"<style>([\s\S]*?body\{visibility:visible\}[\s\S]*?)</style>\s*"
        r"((?:<style data-theme=[\s\S]*?</style>\s*)*)"
        r"<script>([\s\S]*?)</script>\s*(?=</body>)", html)
    if not m:
        sys.exit("no inlined bundle found — is this a standalone (data-standalone) deck?")
    css = m.group(1).replace("body{visibility:visible}", "").strip() + "\n"
    js = m.group(3).replace("<\\/script", "</script").strip() + "\n"
    (folder / "bundle.css").write_text(css, encoding="utf-8")
    (folder / "bundle.js").write_text(js, encoding="utf-8")
    active = None
    for tm in re.finditer(r'<style data-theme="([^"]+)"( media="not all")?>\n?([\s\S]*?)\n?</style>', m.group(2)):
        name, disabled, theme_css = tm.group(1), tm.group(2), tm.group(3)
        (folder / "themes").mkdir(exist_ok=True)
        (folder / "themes" / f"{name}.css").write_text(theme_css.strip() + "\n", encoding="utf-8")
        if not disabled:
            active = name
    html = html[:m.start()] + '<script src="bundle.js"></script>\n' + html[m.end():]
    html = re.sub(r'\s*<style id="standalone-guard">[^<]*</style>', "", html)
    theme_link = f'<link rel="stylesheet" href="themes/{active}.css" id="theme">\n' if active else ""
    html = html.replace("</head>", '<link rel="stylesheet" href="bundle.css">\n' + theme_link + "</head>", 1)
    html = re.sub(r'<html([^>]*?) data-standalone(="")?', r"<html\1", html, count=1)
    imgdir = folder / "images"
    count = [0]

    def swap(mm):
        count[0] += 1
        return mm.group(0).replace(mm.group(1), store_asset(imgdir, mm.group(1)), 1)

    html = re.sub(r'src="(data:[^"]+)"', swap, html)
    html = re.sub(r'data-logo="(data:[^"]+)"', swap, html)
    out.write_text(html, encoding="utf-8")
    print(f"{out}  ({out.stat().st_size // 1024} KB) + bundle.css + bundle.js, {count[0]} image ref(s) → images/")


if __name__ == "__main__":
    args = sys.argv[1:]
    mode = "explode" if args and args[0] == "--explode" else "build"
    if mode == "explode":
        args = args[1:]
    if not args or len(args) > 2 or any(a.startswith("-") for a in args):
        sys.exit(__doc__.strip())
    src = Path(args[0])
    if not src.is_file():
        sys.exit(f"not found: {src}")
    html = src.read_text(encoding="utf-8")
    if mode == "explode":
        explode(src, html, Path(args[1]) if len(args) > 1 else src.with_name("deck-work.html"))
    else:
        out = Path(args[1]) if len(args) > 1 else src.with_name(deck_title(html) + ".html")
        if out.resolve() == src.resolve():
            sys.exit("output would overwrite the input — pass a different out.html")
        build(src, out)
