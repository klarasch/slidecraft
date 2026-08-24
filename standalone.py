#!/usr/bin/env python3
"""Build a self-contained single-file deck from a slidecraft deck folder.

Usage:  python3 standalone.py path/to/deck.html [out.html]

Writes deck-standalone.html next to the deck (or to out.html): slide markup
stays at the top of the file, hand-editable; the compacted stylesheet and
runtime are appended at the end of <body>; images and the footer logo become
data: URIs; data-themes is stripped (the theme is baked in) and <html> is
marked data-standalone. Mirrors the runtime's own "Single file" export —
keep the two in sync (see inlineAssets in runtime.js).
"""
import base64, mimetypes, re, sys
from pathlib import Path

mimetypes.add_type("image/svg+xml", ".svg")


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


def build(deck_path: Path, out_path: Path) -> None:
    folder = deck_path.parent
    html = deck_path.read_text(encoding="utf-8")
    css_parts, js_parts = [], []

    def take_link(m):
        tag = m.group(0)
        if 'rel="stylesheet"' not in tag:
            return tag
        href = re.search(r'href="([^"]+)"', tag)
        if not href or not is_rel(href.group(1)):
            return tag
        css_parts.append(read_asset(folder / href.group(1), min_css))
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

    html = re.sub(r'\s*data-themes="[^"]*"', "", html)          # before the JS bundle lands
    html = html.replace("<html", "<html data-standalone", 1)
    html = html.replace(
        "</head>", '<style id="standalone-guard">body{visibility:hidden}</style>\n</head>', 1
    )
    bundle = (
        "<style>\n" + "\n".join(css_parts) + "\nbody{visibility:visible}\n</style>\n"
        "<script>\n" + "\n".join(js_parts) + "\n</script>\n"
    )
    html = html.replace("</body>", bundle + "</body>", 1)

    out_path.write_text(html, encoding="utf-8")
    print(f"{out_path}  ({out_path.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit(__doc__.strip())
    deck = Path(sys.argv[1])
    if not deck.is_file():
        sys.exit(f"not found: {deck}")
    out = Path(sys.argv[2]) if len(sys.argv) > 2 else deck.with_name("deck-standalone.html")
    build(deck, out)
