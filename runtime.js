/* =========================================================================
   slidecraft — runtime.js
   Fixed asset. Ships with the skill. Never regenerated per-deck.

   Responsibilities:
     · fit a fixed 1280×720 canvas to any viewport
     · keyboard / click navigation + hash routing
     · overview (table of contents)
     · edit mode: contenteditable text, image slots, pasted stickers,
       request-change popover, speaker-notes drawer, add-slide picker,
       undo/redo, autosave
     · save: writes deck.html + images/ back to the folder via the File System
       Access API (no base64), falling back to an inlined standalone download
     · print → PDF
   ========================================================================= */
(() => {
  "use strict";

  const W = 1280, H = 720;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];

  /* ------------------------------------------------------ markup repair */
  // the runtime is the fixed asset; generated markup varies. Silently fix
  // the two fatal authoring mistakes: slides written straight into <body>
  // without the .stage/.deck wrappers, and a theme <link> placed before
  // runtime.css (which would let the runtime's token defaults override the
  // brand). Both repairs persist through save().
  (() => {
    if (!$(".deck")) {
      const strays = $$("body > section.slide");
      if (strays.length) {
        const stage = document.createElement("div");
        stage.className = "stage";
        const d = document.createElement("div");
        d.className = "deck";
        stage.append(d);
        document.body.prepend(stage);
        strays.forEach(s => d.append(s));
      }
    }
    const theme = $("link#theme");
    const rt = $$('link[rel="stylesheet"]').find(l => /runtime(\.min)?\.css$/.test(l.getAttribute("href") || ""));
    if (theme && rt && theme.compareDocumentPosition(rt) & Node.DOCUMENT_POSITION_FOLLOWING) {
      rt.after(theme);
    }
  })();

  const deck = $(".deck");
  if (!deck) return console.warn("[slidecraft] no .deck found");
  let slides = $$(".slide", deck);
  let index = 0;
  let step = 0;                       // current reveal step on the active slide
  let booted = false;
  let editing = false;
  let overviewOpen = false;
  let notesOpen = false;
  let dirHandle = null;
  const pending = new Map();          // "images/x.png" -> Blob
  let lastSlot = null;                // last clicked image slot
  let selectedSticker = null;
  let selectedPin = null;             // selected callout pin
  let mainChan = null;                // BroadcastChannel, main window only
  const countOriginal = new WeakMap(); // el -> pristine text, for data-animate="count"
  const TX_MS = 450;                  // slide transition duration, keep in sync with CSS --tx-dur
  let txGen = 0;                      // bumped per show(); guards stale rAF callbacks from rapid nav
  const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
  const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

  /* ---------------------------------------------------------------- setup */
  function decorate() {
    slides = $$(".slide", deck);
    slides.forEach((s, i) => {
      if (!$(".slide__wash", s)) {
        const wash = document.createElement("div");
        wash.className = "slide__wash";
        wash.dataset.gen = "";
        s.prepend(wash);
      }
      let chrome = $(".slide__chrome", s);
      if (!chrome) {
        chrome = document.createElement("div");
        chrome.className = "slide__chrome";
        chrome.dataset.gen = "";
        s.append(chrome);
      }
      chrome.innerHTML = "";
      const left = document.createElement("span");
      const logo = document.body.dataset.logo;
      if (logo) {
        left.innerHTML = `<img class="slide__logo" src="${escapeHtml(logo)}" alt="${escapeHtml(document.body.dataset.deckLabel || document.title)}">`;
      } else {
        left.textContent = document.body.dataset.deckLabel || document.title;
      }
      const right = document.createElement("span");
      right.textContent = String(i + 1).padStart(2, "0");
      chrome.append(left, right);

      $$(".media", s).forEach(m => {
        if (!$("img", m)) m.dataset.empty = "";
        else delete m.dataset.empty;
        if (!$(".media-hover", m)) {
          const ov = document.createElement("div");
          ov.className = "media-hover";
          ov.dataset.gen = "";
          ov.innerHTML = `<span><svg class="icon"><use href="#i-image"/></svg>Replace image</span>` +
            (m.classList.contains("callout__media")
              ? `<span class="media-hover__hint">Double-click to add a pin · drag pins to move</span>` : "");
          m.append(ov);
        }
      });

      ensureNoteChip(s);
      ensureOverflowBadge(s);
      $$(".sticker", s).forEach(ensureStickerHandles);
      if (s.classList.contains("slide--placeholder")) ensurePlaceholderNote(s);
    });
    markRevealSteps();
  }

  function ensurePlaceholderNote(s) {
    let ph = $(".slide__placeholder-note", s);
    if (!ph) {
      ph = document.createElement("div");
      ph.className = "slide__placeholder-note";
      ph.dataset.gen = "";
      ph.innerHTML = `<svg class="icon"><use href="#i-spark"/></svg><span></span>`;
      ph.onclick = () => { if (editing && s === slides[index]) openPopover("note", ph); };
      s.append(ph);
    }
    const has = !!s.dataset.note;
    ph.classList.toggle("has-note", has);
    $("span", ph).textContent = has ? s.dataset.note : "Click to describe this slide";
  }

  function ensureNoteChip(s) {
    let chip = $(".badge.req", s);
    if (s.dataset.note) {
      if (!chip) {
        chip = document.createElement("div");
        chip.className = "badge req";
        chip.dataset.gen = "";
        chip.innerHTML = `<svg class="icon"><use href="#i-spark"/></svg><span></span>`;
        s.append(chip);
      }
      $("span", chip).textContent = s.dataset.note;
    } else if (chip) {
      chip.remove();
    }
  }

  function ensureOverflowBadge(s) {
    if ($(".slide__overflow-badge", s)) return;
    const b = document.createElement("div");
    b.className = "slide__overflow-badge";
    b.dataset.gen = "";
    b.innerHTML = `<svg class="icon"><use href="#i-warn"/></svg><span>Too much text — trim or split</span>`;
    s.append(b);
  }

  function ensureStickerHandles(el) {
    if ($$(".handle", el).length) return;
    ["nw", "ne", "sw", "se"].forEach(c => {
      const i = document.createElement("i");
      i.className = "handle";
      i.dataset.gen = "";
      i.dataset.c = c;
      el.append(i);
    });
  }

  function fit() {
    const pad = overviewOpen || document.fullscreenElement ? 1 : 0.94;
    const rightGutter = notesOpen ? 340 : 0;
    const scale = Math.min((innerWidth - rightGutter) / W, innerHeight / H) * pad;
    document.documentElement.style.setProperty("--scale", scale.toFixed(4));
    document.documentElement.style.setProperty("--notes-gutter", rightGutter + "px");
  }

  /* -------------------------------------------------------- progressive reveal */
  // data-reveal on a container (ul/ol/.cards/.stats/.stack) makes its direct
  // children steps; on a single element it is its own step. Marked with the
  // derived [data-step] attribute so CSS can hide un-revealed steps.
  function markRevealSteps() {
    slides.forEach(s => {
      $$("[data-step]", s).forEach(n => n.removeAttribute("data-step"));
      $$("[data-reveal]", s).forEach(host => {
        const isContainer = ["UL", "OL"].includes(host.tagName) || host.matches(".cards,.stats,.stack,.bento,.compare,.timeline,.gallery");
        (isContainer ? [...host.children] : [host]).forEach(el => el.dataset.step = "");
      });
    });
  }
  const getSteps = slide => $$("[data-step]", slide);
  function applyReveal(slide) {
    getSteps(slide).forEach((el, i) => el.classList.toggle("is-revealed", i < step));
  }

  /* ----------------------------------------------------------- navigation */
  function effectiveTx(slide) {
    let tx = slide.dataset.transition || document.body.dataset.transition || "rise";
    if (tx !== "none" && reducedMotion()) tx = "fade";
    return tx;
  }

  // mode: null (auto, based on direction of travel) | "fwd" | "back".
  // Home/End/cold-boot force "fwd" so steps start hidden (forward semantics);
  // only stepping backwards with ← reveals everything on arrival.
  function show(i, push = true, mode = null, force = false) {
    const to = Math.max(0, Math.min(slides.length - 1, i));
    const from = index;
    const changing = to !== from || !booted || force;   // force: the slide at this index was replaced (delete / undo)
    const dir = mode || (!booted ? "fwd" : (to >= from ? "fwd" : "back"));
    document.body.dataset.dir = dir;
    index = to;
    const cur = slides[index];

    if (changing) {
      const prevSlide = slides[from];
      const tx = effectiveTx(cur);
      slides.forEach(s => { if (s !== cur && s !== prevSlide) s.classList.remove("is-active", "is-entering", "is-leaving"); });

      if (prevSlide && prevSlide !== cur) {
        clearTimeout(prevSlide._txTimer);
        if (tx !== "none") {
          prevSlide.dataset.tx = tx;
          prevSlide.classList.remove("is-active");
          prevSlide.classList.add("is-leaving");
          prevSlide._txTimer = setTimeout(() => prevSlide.classList.remove("is-leaving"), TX_MS);
        } else {
          prevSlide.classList.remove("is-active", "is-leaving", "is-entering");
        }
      }

      clearTimeout(cur._txTimer);
      cur.dataset.tx = tx;
      if (tx !== "none") {
        cur.classList.remove("is-leaving");
        cur.classList.add("is-entering");
        const gen = ++txGen;               // guards against rapid repeat navigation
        requestAnimationFrame(() => {
          if (gen !== txGen) return;        // superseded by a later show() before paint
          cur.classList.add("is-active");
          cur._txTimer = setTimeout(() => cur.classList.remove("is-entering"), TX_MS);
        });
      } else {
        cur.classList.remove("is-entering", "is-leaving");
        cur.classList.add("is-active");
      }

      step = dir === "back" ? getSteps(cur).length : 0;
      applyReveal(cur);
      animateCounts(cur);
      emit("slidechange", { index, slide: cur, dir });
    }

    updateCount();
    if (push) history.replaceState(null, "", "#" + (index + 1));
    if (editing) { enableEditing(); renderNotesDrawer(); }
    measureOverflow(cur);
    syncState();
  }
  const gotoNext = () => show(index + 1);
  const gotoPrev = () => show(index - 1);
  // edit mode shows every reveal step at once, so stepping through them would
  // be invisible keypresses — arrows jump whole slides there. Presenting
  // (view mode) walks the steps as authored.
  function advance() {
    if (editing) return gotoNext();
    const steps = getSteps(slides[index]);
    if (step < steps.length) { step++; applyReveal(slides[index]); emit("step", { index, step, slide: slides[index] }); syncState(); return; }
    gotoNext();
  }
  function retreat() {
    if (editing) return gotoPrev();
    if (step > 0) { step--; applyReveal(slides[index]); emit("step", { index, step, slide: slides[index] }); syncState(); return; }
    gotoPrev();
  }
  const next = advance;
  const prev = gotoPrev;
  function syncState() { mainChan?.postMessage({ index, step }); }
  // public events — the stable hook surface for an install's custom.js
  // (see CUSTOMIZING.md); detail carries live DOM nodes, never clones
  const emit = (name, detail) => deck.dispatchEvent(new CustomEvent("slidecraft:" + name, { detail, bubbles: true }));
  function updateCount() {
    const t = `${index + 1} / ${slides.length}`;
    $$(".js-count").forEach(el => el.textContent = t);
  }

  /* ------------------------------------------------------------- overview */
  function toggleOverview(force) {
    overviewOpen = force ?? !overviewOpen;
    document.body.classList.toggle("is-overview", overviewOpen);
    if (overviewOpen) buildOverview();
    fit();
  }

  function buildOverview() {
    const grid = $("#ov-grid");
    grid.innerHTML = "";
    slides.forEach((s, i) => {
      const t = document.createElement("div");
      t.className = "thumb" + (i === index ? " is-current" : "");
      t.innerHTML =
        `<div class="thumb__frame"><div class="thumb__scaler"></div></div>` +
        `<div class="thumb__label"><span>${String(i + 1).padStart(2, "0")}</span><b></b></div>`;
      const clone = s.cloneNode(true);
      clone.classList.add("is-active");
      $(".thumb__scaler", t).append(clone);
      $(".thumb__label b", t).textContent = slideTitle(s);
      t.onclick = () => { toggleOverview(false); show(i); };
      grid.append(t);
    });
    requestAnimationFrame(() => {
      $$(".thumb__frame", grid).forEach(f => {
        $(".thumb__scaler", f).style.transform = `scale(${f.clientWidth / W})`;
      });
    });
    $("#ov-count").textContent = `${slides.length} slides`;
  }

  const slideTitle = s =>
    (s.dataset.title ||
      $(".display, .h1, .h2, blockquote", s)?.textContent ||
      "Untitled").trim().slice(0, 46);

  /* ----------------------------------------------------------- edit mode */
  const EDITABLE = [
    "h1", "h2", "h3", "h4", "p", "li", "blockquote", "figcaption", "pre", "td", "th",
    ".eyebrow", ".display", ".h1", ".h2", ".h3", ".lead", ".body", ".caption",
    ".stat__num", ".chip", ".index", ".num", ".t", ".n", ".meta > span"
  ].join(",");

  function enableEditing() {
    $$(EDITABLE, deck).forEach(el => {
      if (el.querySelector(EDITABLE)) return;        // container, not a leaf
      el.setAttribute("contenteditable", "plaintext-only");
      el.setAttribute("spellcheck", "false");
    });
  }
  function disableEditing() {
    $$("[contenteditable]", deck).forEach(el => {
      el.removeAttribute("contenteditable");
      el.removeAttribute("spellcheck");
    });
  }

  function toggleEdit(force) {
    editing = force ?? !editing;
    document.body.classList.toggle("is-editing", editing);
    renderToolbar();
    editing ? enableEditing() : disableEditing();
    if (editing) renderNotesDrawer(); else { commitNotes(); closeNotesDrawer(); }
    if (!editing) { closePopover(); closePicker(); }
    toast(editing
      ? "Edit mode — click any text to change it. ⌘V pastes an image onto the slide."
      : "Edit mode off");
  }

  /* -------------------------------------------------------------- images */
  function fileName(file) {
    const ext = (file.name?.split(".").pop() || file.type.split("/")[1] || "png")
      .toLowerCase().replace(/[^a-z0-9]/g, "");
    const base = (file.name?.replace(/\.[^.]+$/, "") || "pasted")
      .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 32);
    return `images/${base || "image"}-${Date.now().toString(36).slice(-4)}.${ext}`;
  }

  function attachImage(file, slot) {
    snapshot();
    const rel = fileName(file);
    pending.set(rel, file);
    const url = URL.createObjectURL(file);
    let img = $("img", slot);
    if (!img) { img = document.createElement("img"); img.alt = ""; slot.prepend(img); }
    img.src = url;
    img.dataset.src = rel;               // relative path used when saving
    delete slot.dataset.empty;
  }

  function addSticker(file) {
    snapshot();
    const rel = fileName(file);
    pending.set(rel, file);
    const wrap = document.createElement("div");
    wrap.className = "sticker";
    wrap.style.cssText = "left:40%;top:32%;width:34%";
    const img = document.createElement("img");
    img.src = URL.createObjectURL(file);
    img.dataset.src = rel;
    img.alt = "";
    wrap.append(img);
    ensureStickerHandles(wrap);
    slides[index].append(wrap);
    selectSticker(wrap);
    toast("Drag to move · corner handles to resize · ⌫ to delete");
  }

  function selectSticker(el) {
    $$(".sticker.is-sel", deck).forEach(s => s.classList.remove("is-sel"));
    selectedSticker = el;
    el?.classList.add("is-sel");
  }

  /* --------------------------------------------------- callout pins */
  // numbered markers on a .callout__media, paired by DOM order with the
  // <li>s of the slide's .callout__notes. Numbers come from CSS counters,
  // so add / delete / reorder renumber themselves.
  function selectPin(el) {
    $$(".pin.is-sel", deck).forEach(p => p.classList.remove("is-sel"));
    selectedPin = el;
    el?.classList.add("is-sel");
  }

  function startPinDrag(pin, e) {
    e.preventDefault();
    selectSticker(null);
    selectPin(pin);
    const box = pin.closest(".media").getBoundingClientRect();
    const preDrag = deck.innerHTML;
    let moved = false;
    const move = ev => {
      moved = true;
      pin.style.left = Math.max(0, Math.min(100, (ev.clientX - box.left) / box.width * 100)).toFixed(1) + "%";
      pin.style.top = Math.max(0, Math.min(100, (ev.clientY - box.top) / box.height * 100)).toFixed(1) + "%";
    };
    const up = () => {
      removeEventListener("pointermove", move); removeEventListener("pointerup", up);
      if (moved) pushSnapshotRaw(preDrag);
    };
    addEventListener("pointermove", move);
    addEventListener("pointerup", up);
  }

  function makeNoteLi() {
    const li = document.createElement("li");
    li.setAttribute("contenteditable", "plaintext-only");
    li.setAttribute("spellcheck", "false");
    return li;
  }

  function addPinAt(fig, clientX, clientY) {
    snapshot();
    const box = fig.getBoundingClientRect();
    const pin = document.createElement("i");
    pin.className = "pin";
    pin.style.left = Math.max(0, Math.min(100, (clientX - box.left) / box.width * 100)).toFixed(1) + "%";
    pin.style.top = Math.max(0, Math.min(100, (clientY - box.top) / box.height * 100)).toFixed(1) + "%";
    fig.append(pin);
    const notes = $(".callout__notes", fig.closest(".slide"));
    let li = null;
    if (notes) { li = makeNoteLi(); notes.append(li); }
    markRevealSteps();
    measureOverflow(fig.closest(".slide"));
    if (li) placeCaret(li, true);
  }

  function deletePin(pin) {
    const fig = pin.closest(".media");
    const slide = fig.closest(".slide");
    const idx = $$(".pin", fig).indexOf(pin);
    snapshot();
    const notes = $(".callout__notes", slide);
    pin.remove();
    notes?.children[idx]?.remove();
    markRevealSteps();
    measureOverflow(slide);
  }

  function initStickerDrag() {
    deck.addEventListener("pointerdown", e => {
      if (!editing) return;
      const pin = e.target.closest(".pin");
      if (pin) return startPinDrag(pin, e);
      const handle = e.target.closest(".handle");
      const el = e.target.closest(".sticker");
      if (!el) { selectSticker(null); selectPin(null); return; }
      e.preventDefault();
      selectPin(null);
      selectSticker(el);
      const slide = el.parentElement;
      const box = slide.getBoundingClientRect();
      const s = box.width / W;                      // account for canvas scale
      const preDrag = deck.innerHTML;

      if (handle) {
        e.stopPropagation();
        const corner = handle.dataset.c;
        const startW = parseFloat(el.style.width) || 30;
        const startL = parseFloat(el.style.left) || 0;
        const startT = parseFloat(el.style.top) || 0;
        const aspect = el.offsetHeight / el.offsetWidth || 1;   // height is auto — track it to anchor the opposite corner
        const startX = e.clientX;
        const move = ev => {
          const dx = (ev.clientX - startX) / s / W * 100;
          let w = corner === "se" || corner === "ne" ? startW + dx : startW - dx;
          w = Math.max(4, Math.min(100, w));
          el.style.width = w.toFixed(1) + "%";
          if (corner === "nw" || corner === "sw") el.style.left = (startL + (startW - w)).toFixed(2) + "%";
          if (corner === "nw" || corner === "ne") el.style.top = (startT - (w - startW) * aspect * W / H).toFixed(2) + "%";
        };
        const up = () => {
          removeEventListener("pointermove", move); removeEventListener("pointerup", up);
          pushSnapshotRaw(preDrag);
        };
        addEventListener("pointermove", move);
        addEventListener("pointerup", up);
        return;
      }

      const start = { x: e.clientX, y: e.clientY, l: parseFloat(el.style.left), t: parseFloat(el.style.top) };
      const move = ev => {
        el.style.left = (start.l + ((ev.clientX - start.x) / s / W) * 100).toFixed(2) + "%";
        el.style.top = (start.t + ((ev.clientY - start.y) / s / H) * 100).toFixed(2) + "%";
      };
      const up = () => {
        removeEventListener("pointermove", move); removeEventListener("pointerup", up);
        pushSnapshotRaw(preDrag);
      };
      addEventListener("pointermove", move);
      addEventListener("pointerup", up);
    });

  }

  function pickFile(slot) {
    const inp = document.createElement("input");
    inp.type = "file";
    inp.accept = "image/*";
    inp.onchange = () => inp.files[0] && attachImage(inp.files[0], slot);
    inp.click();
  }

  /* --------------------------------------------------------- serialization */
  const isRelSrc = src => !!src && !/^(data:|blob:|https?:|\/\/)/i.test(src);

  async function relToDataURL(rel) {
    if (pending.has(rel)) return toDataURL(pending.get(rel));
    const res = await fetch(rel);
    if (!res.ok) throw new Error("fetch failed: " + rel);
    return toDataURL(await res.blob());
  }

  /* ------------------------------------------------- print-safe SVG grain */
  // feTurbulence grain baked into an SVG asset rasterizes at print resolution
  // into megabytes of incompressible noise per page — a 20-slide deck can top
  // 50MB and stall PDF viewers. At boot, strip turbulence layers out of SVG
  // <img>s (the original path stays in data-src, so saves and single-file
  // exports keep the untouched asset) and tag the figure data-grain; the
  // stylesheet paints an equivalent screen-only grain overlay that @media
  // print drops.
  async function degrainImages() {
    const cache = new Map();               // src -> sanitized blob URL | null
    for (const img of $$("img", deck)) {
      const src = img.dataset.src || img.getAttribute("src") || "";
      if (!/\.svg(\?|#|$)/i.test(src) && !/^data:image\/svg/i.test(src)) continue;
      let url = cache.get(src);
      if (url === undefined) {
        url = null;
        try {
          const text = await (await fetch(img.currentSrc || img.src)).text();
          if (/<feTurbulence/i.test(text)) {
            const doc = new DOMParser().parseFromString(text, "image/svg+xml");
            if (!doc.querySelector("parsererror")) {
              const noisy = [...doc.querySelectorAll("filter")]
                .filter(f => f.querySelector("feTurbulence") && f.id)
                .map(f => `(#${f.id})`);
              doc.querySelectorAll("[filter]").forEach(el => {
                const ref = el.getAttribute("filter");
                if (noisy.some(id => ref.includes(id))) el.remove();
              });
              // never swap in an image the strip emptied out
              const hasArt = [...doc.documentElement.children]
                .some(n => !/^(defs|style|title|desc|metadata|filter)$/i.test(n.localName));
              if (hasArt) url = URL.createObjectURL(new Blob(
                [new XMLSerializer().serializeToString(doc)], { type: "image/svg+xml" }));
            }
          }
        } catch { /* file:// page — fetch is blocked, leave the asset alone */ }
        cache.set(src, url);
      }
      if (!url) continue;
      if (!img.dataset.src) img.dataset.src = src;
      img.src = url;
      img.closest(".media")?.setAttribute("data-grain", "");
    }
  }

  // conservative compaction: strip comments, indentation and blank lines.
  // Line-interior whitespace is never touched, so CSS content strings and
  // JS template-literal HTML survive byte-meaningfully.
  const minifyCSS = css => css.replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n").map(l => l.trim()).filter(Boolean).join("\n");
  const minifyJS = js => js.replace(/^[ \t]*\/\*[\s\S]*?\*\//gm, "")
    .split("\n").map(l => l.trim()).filter(l => l && !l.startsWith("//")).join("\n");

  // bake every local asset into the clone. The slide markup stays at the top
  // of the file, hand-editable; the compacted stylesheet and runtime go to
  // the END of <body>, with a tiny guard in <head> so slides don't flash
  // unstyled while the tail parses. Images and the footer logo become
  // data: URIs. Absolute URLs (Google Fonts) stay as links. Throws when a
  // local file can't be read — e.g. a deck opened via file://, where fetch
  // is blocked.
  // prefer a pre-minified sibling (runtime.min.js, built by build.sh) over
  // compacting the readable source ourselves
  async function fetchAsset(path, compact) {
    try {
      const r = await fetch(path.replace(/\.(css|js)$/i, ".min.$1"));
      if (r.ok) return await r.text();
    } catch {}
    return compact(await (await fetch(path)).text());
  }

  async function inlineAssets(root) {
    const css = [], js = [];
    for (const link of [...root.querySelectorAll('link[rel="stylesheet"]')]) {
      const href = link.getAttribute("href");
      if (!isRelSrc(href)) continue;
      css.push(await fetchAsset(href, minifyCSS));
      link.remove();
    }
    for (const s of [...root.querySelectorAll("script[src]")]) {
      const src = s.getAttribute("src");
      if (!isRelSrc(src)) continue;
      // "<\/" is byte-identical inside JS strings/regexes, and keeps the
      // inlined source from terminating its own <script> tag
      js.push((await fetchAsset(src, minifyJS)).replace(/<\/script/gi, "<\\/script"));
      s.remove();
    }
    for (const img of [...root.querySelectorAll("img")]) {
      const rel = img.dataset.src || img.getAttribute("src");
      img.removeAttribute("data-src");
      if (isRelSrc(rel)) img.setAttribute("src", await relToDataURL(rel));
      else if (/^data:/i.test(rel)) img.setAttribute("src", rel);   // degrained standalone: restore the original data: URI
    }
    const body = root.querySelector("body");
    if (isRelSrc(body.dataset.logo)) body.dataset.logo = await relToDataURL(body.dataset.logo);
    body.removeAttribute("data-themes");   // the theme is baked in — a single file can't reskin
    if (css.length && !root.querySelector("#standalone-guard")) {
      const g = document.createElement("style");
      g.id = "standalone-guard";
      g.textContent = "body{visibility:hidden}";
      root.querySelector("head").append(g);
    }
    if (css.length) {
      const st = document.createElement("style");
      st.textContent = css.join("\n") + "\nbody{visibility:visible}";
      body.append(st);
    }
    if (js.length) {
      const sc = document.createElement("script");
      sc.textContent = js.join("\n");
      body.append(sc);
    }
    root.dataset.standalone = "";
  }

  async function serialize({ inline }) {
    const root = document.documentElement.cloneNode(true);
    root.querySelectorAll("[data-runtime],[data-gen]").forEach(n => n.remove());
    root.querySelectorAll(".slide").forEach(s => {
      s.classList.remove("is-active", "is-entering", "is-leaving");
      s.removeAttribute("data-fit");
      s.removeAttribute("data-overflow");
      s.removeAttribute("data-tx");
    });
    root.querySelectorAll(".slide--placeholder").forEach(s => { s.innerHTML = ""; });
    root.querySelectorAll("[data-step]").forEach(n => { n.removeAttribute("data-step"); n.classList.remove("is-revealed"); });
    root.querySelector("body")?.removeAttribute("data-dir");
    root.querySelectorAll("[contenteditable]").forEach(n => {
      n.removeAttribute("contenteditable"); n.removeAttribute("spellcheck");
    });
    root.querySelectorAll(".sticker, .pin").forEach(n => n.classList.remove("is-sel"));
    root.querySelectorAll("[data-grain]").forEach(n => n.removeAttribute("data-grain"));   // re-derived at boot
    if (inline) {
      await inlineAssets(root);
    } else {
      root.querySelectorAll("img[data-src]").forEach(img => {
        img.setAttribute("src", img.dataset.src);
        img.removeAttribute("data-src");
      });
    }
    root.removeAttribute("style");
    root.querySelector("body").className = "";
    return "<!doctype html>\n" + root.outerHTML + "\n";
  }

  const toDataURL = blob => new Promise(res => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.readAsDataURL(blob);
  });

  async function save() {
    // a standalone deck (single file, everything inlined) saves itself as a
    // single file again — no images/ folder, assets stay baked in
    const standalone = document.documentElement.hasAttribute("data-standalone");
    if (window.showDirectoryPicker) {
      try {
        if (!dirHandle) {
          dirHandle = await showDirectoryPicker({ mode: "readwrite", id: "slidecraft" });
        }
        if (!standalone && pending.size) {
          const imgs = await dirHandle.getDirectoryHandle("images", { create: true });
          for (const [rel, blob] of pending) {
            const fh = await imgs.getFileHandle(rel.replace("images/", ""), { create: true });
            const w = await fh.createWritable();
            await w.write(blob);
            await w.close();
          }
        }
        let name = location.pathname.split("/").pop() || "deck.html";
        if (!/\.html?$/i.test(name)) name = "deck.html";
        const fh = await dirHandle.getFileHandle(name, { create: true });
        const w = await fh.createWritable();
        await w.write(await serialize({ inline: standalone }));
        await w.close();
        pending.clear();
        return true;
      } catch (err) {
        if (err.name === "AbortError") return false;
        console.warn(err);
        toast("Folder write unavailable — falling back to a standalone download.");
      }
    }
    const blob = new Blob([await serialize({ inline: true })], { type: "text/html" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "deck-edited.html";
    a.click();
    toast("Downloaded a self-contained copy — runtime, theme and images baked in.");
    return true;
  }

  // explicit single-file export: one .html that opens anywhere, no siblings
  async function downloadStandalone() {
    try {
      const blob = new Blob([await serialize({ inline: true })], { type: "text/html" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      // name the file after the deck, like standalone.py does
      a.download = ((document.title || "").replace(/[\\/:*?"<>|]/g, "").trim() || "deck") + ".html";
      a.click();
      const pendingCount = $$("[data-note]").length;
      toast(pendingCount
        ? `Downloaded a copy with your changes — ${pendingCount} change request${pendingCount === 1 ? "" : "s"} still open. Hand this .html back to Claude to have them made.`
        : "Downloaded a copy with your changes — everything baked in, opens anywhere.");
    } catch (err) {
      console.warn(err);
      toast("Can't read the deck's files from a file:// page. Serve the folder, or ask Claude for a standalone copy.");
    }
  }

  /* -------------------------------------------------------------- autosave */
  let dirty = false, saving = false;
  const scheduleAutosave = debounce(async () => {
    if (!dirHandle || saving) return;
    saving = true; updateSaveUI();
    const ok = await save();
    saving = false;
    if (ok) dirty = false;
    updateSaveUI();
  }, 1500);

  function markDirty() {
    dirty = true;
    updateSaveUI();
    if (dirHandle) scheduleAutosave();
  }

  function updateSaveUI() {
    const el = $("#btn-save");
    if (!el) return;
    const label = $(".js-save-label", el);
    if (!label) return;
    if (!window.showDirectoryPicker) { label.textContent = "Download copy"; el.classList.remove("is-status"); return; }
    if (!dirHandle) { label.textContent = "Save…"; el.classList.remove("is-status"); return; }
    el.classList.add("is-status");
    label.textContent = saving || dirty ? "Saving…" : "Saved";
  }

  async function onSaveClick() {
    if (window.showDirectoryPicker && dirHandle) return; // now a passive status, not a button
    const ok = await save();
    if (ok) { dirty = false; updateSaveUI(); if (dirHandle) toast("Saved. Autosaving from now on."); }
  }

  /* ------------------------------------------------------------ undo / redo */
  let undoStack = [];
  let redoStack = [];
  const UNDO_CAP = 100;

  function pushSnapshotRaw(html) {
    undoStack.push({ html, index });
    if (undoStack.length > UNDO_CAP) undoStack.shift();
    redoStack = [];
    markDirty();
    updateUndoUI();
  }
  const snapshot = () => pushSnapshotRaw(deck.innerHTML);

  function restore(snap) {
    const { html, index: at } = typeof snap === "string" ? { html: snap, index } : snap;
    deck.innerHTML = html;
    decorate();
    slides = $$(".slide", deck);
    show(Math.min(at, slides.length - 1), true, null, true);
    if (editing) enableEditing();
    fit();
    markDirty();
    updateUndoUI();
  }
  function undo() {
    if (!undoStack.length) return;
    redoStack.push({ html: deck.innerHTML, index });
    restore(undoStack.pop());
  }
  function redo() {
    if (!redoStack.length) return;
    undoStack.push({ html: deck.innerHTML, index });
    restore(redoStack.pop());
  }
  function updateUndoUI() {
    $("#btn-undo")?.classList.toggle("is-disabled", !undoStack.length);
  }

  // text edits: commit the pre-edit state to the undo stack on blur, or after
  // 800ms of idle typing (whichever comes first) — not on every keystroke.
  let preEditHTML = null;
  function commitTextEdit() {
    if (preEditHTML !== null && preEditHTML !== deck.innerHTML) pushSnapshotRaw(preEditHTML);
    preEditHTML = deck.innerHTML;
  }
  const idleCommit = debounce(() => { if (preEditHTML !== null) commitTextEdit(); }, 800);

  function initTextUndo() {
    deck.addEventListener("focusin", e => {
      if (e.target.isContentEditable) preEditHTML ??= deck.innerHTML;
    });
    deck.addEventListener("focusout", e => {
      if (e.target.isContentEditable) { commitTextEdit(); preEditHTML = null; }
    });
    deck.addEventListener("input", () => { if (editing) idleCommit(); });
  }

  /* ------------------------------------------------------------ slide ops */
  const LAYOUTS = [
    { key: "title", label: "Title", html: () => `<section class="slide slide--title" data-bare data-title="Title"><p class="eyebrow">Kicker</p><h1 class="display">Headline goes here</h1><div class="meta"><span>Author</span><span>·</span><span>Date</span></div></section>` },
    { key: "section", label: "Section", html: () => `<section class="slide slide--section" data-bare data-title="Section"><p class="index">01</p><p class="eyebrow">Section</p><h2 class="display">Name</h2></section>` },
    { key: "statement", label: "Statement", html: () => `<section class="slide slide--statement" data-title="Statement"><p class="eyebrow">Kicker</p><h2 class="display">Headline goes here</h2><p class="lead">One sentence of support.</p></section>` },
    { key: "quote", label: "Quote", html: () => `<section class="slide slide--quote" data-title="Quote"><blockquote class="serif">Quotation goes here.</blockquote><figcaption><span class="caption">Attribution</span></figcaption></section>` },
    { key: "bullets", label: "Bullets", html: () => `<section class="slide slide--bullets" data-title="Bullets"><div class="stack stack--sm"><p class="eyebrow">Kicker</p><h2 class="h1">Headline goes here</h2></div><ul><li>One sentence per bullet.</li><li>One sentence per bullet.</li><li>One sentence per bullet.</li></ul></section>` },
    { key: "agenda", label: "Agenda", html: () => `<section class="slide slide--agenda" data-title="Agenda"><div class="stack stack--sm"><p class="eyebrow">Contents</p><h2 class="h1">Headline goes here</h2></div><ol><li><span class="t">Item one</span><span class="n">01</span></li><li><span class="t">Item two</span><span class="n">02</span></li></ol></section>` },
    { key: "split", label: "Split", html: () => `<section class="slide slide--split" data-title="Split"><figure class="media split__media"></figure><div class="split__body"><p class="eyebrow">Kicker</p><h2 class="h1">Headline goes here</h2><p class="body">One sentence of support.</p></div></section>` },
    { key: "callout", label: "Callout", html: () => `<section class="slide slide--callout" data-title="Callout"><figure class="media callout__media"><i class="pin" style="left:30%;top:30%"></i><i class="pin" style="left:62%;top:58%"></i></figure><div class="callout__body"><p class="eyebrow">Kicker</p><h2 class="h2">Headline goes here</h2><ol class="callout__notes"><li>One sentence per pin.</li><li>One sentence per pin.</li></ol></div></section>` },
    { key: "callout-full", label: "Full callout", html: () => `<section class="slide slide--callout-full" data-bare data-title="Full callout"><figure class="media callout__media"><i class="pin" style="left:28%;top:32%"></i><i class="pin" style="left:56%;top:60%"></i></figure><div class="callout__box"><h3 class="h3">Headline goes here</h3><ol class="callout__notes"><li>One sentence per pin.</li><li>One sentence per pin.</li></ol></div></section>` },
    { key: "cards", label: "Cards", html: () => `<section class="slide slide--cards" data-title="Cards"><div class="stack stack--sm"><p class="eyebrow">Kicker</p><h2 class="h1">Headline goes here</h2></div><div class="cards"><article class="card"><p class="num">01</p><h3 class="h3">Card title</h3><p class="body">One sentence per card.</p></article><article class="card"><p class="num">02</p><h3 class="h3">Card title</h3><p class="body">One sentence per card.</p></article><article class="card"><p class="num">03</p><h3 class="h3">Card title</h3><p class="body">One sentence per card.</p></article></div></section>` },
    { key: "bento", label: "Bento", html: () => `<section class="slide slide--bento" data-title="Bento"><div class="stack stack--sm"><p class="eyebrow">Kicker</p><h2 class="h1">Headline goes here</h2></div><div class="bento"><article class="cell cell--wide"><h3 class="h3">Lead cell</h3><p class="body">One sentence for the biggest idea.</p></article><article class="cell"><p class="stat__num">0</p><p class="body">One line.</p></article><article class="cell"><h3 class="h3">Cell title</h3><p class="body">One line.</p></article><article class="cell"><h3 class="h3">Cell title</h3><p class="body">One line.</p></article><article class="cell cell--accent"><h3 class="h3">Cell title</h3><p class="body">One line.</p></article></div></section>` },
    { key: "stats", label: "Stats", html: () => `<section class="slide slide--stats" data-title="Stats"><div class="stack stack--sm"><p class="eyebrow">Kicker</p><h2 class="h1">Headline goes here</h2></div><div class="stats"><div class="stat"><p class="stat__num">0</p><p class="body">One sentence per stat.</p></div><div class="stat"><p class="stat__num">0</p><p class="body">One sentence per stat.</p></div><div class="stat"><p class="stat__num">0</p><p class="body">One sentence per stat.</p></div></div></section>` },
    { key: "number", label: "Big number", html: () => `<section class="slide slide--number" data-title="Big number"><p class="eyebrow">Kicker</p><p class="stat__num">0</p><p class="lead">One sentence putting the number in context.</p></section>` },
    { key: "compare", label: "Compare", html: () => `<section class="slide slide--compare" data-title="Compare"><div class="stack stack--sm"><p class="eyebrow">Kicker</p><h2 class="h1">Headline goes here</h2></div><div class="compare"><article class="col"><h3 class="h3">Before</h3><ul><li>One sentence per point.</li><li>One sentence per point.</li><li>One sentence per point.</li></ul></article><article class="col col--accent"><h3 class="h3">After</h3><ul><li>One sentence per point.</li><li>One sentence per point.</li><li>One sentence per point.</li></ul></article></div></section>` },
    { key: "timeline", label: "Timeline", html: () => `<section class="slide slide--timeline" data-title="Timeline"><div class="stack stack--sm"><p class="eyebrow">Kicker</p><h2 class="h1">Headline goes here</h2></div><div class="timeline"><div class="step"><p class="caption">Q1</p><h3 class="h3">Milestone</h3><p class="body">One line.</p></div><div class="step"><p class="caption">Q2</p><h3 class="h3">Milestone</h3><p class="body">One line.</p></div><div class="step"><p class="caption">Q3</p><h3 class="h3">Milestone</h3><p class="body">One line.</p></div><div class="step"><p class="caption">Q4</p><h3 class="h3">Milestone</h3><p class="body">One line.</p></div></div></section>` },
    { key: "full", label: "Image + text", html: () => `<section class="slide slide--full" data-title="Image + text"><figure class="media bleed"></figure><div class="overlay"><p class="eyebrow">Kicker</p><h2 class="h1">Headline goes here</h2><p class="lead">One sentence of support.</p></div></section>` },
    { key: "image", label: "Full image", html: () => `<section class="slide slide--image" data-bare data-title="Image"><figure class="media bleed"></figure><p class="credit">Caption or credit — clear this to remove it.</p></section>` },
    { key: "gallery", label: "Gallery", html: () => `<section class="slide slide--gallery" data-title="Gallery"><div class="stack stack--sm"><p class="eyebrow">Kicker</p><h2 class="h1">Headline goes here</h2></div><div class="gallery"><figure class="media"></figure><figure class="media"></figure><figure class="media"></figure></div></section>` },
    { key: "code", label: "Code", html: () => `<section class="slide slide--code" data-title="Code"><div class="stack stack--sm"><p class="eyebrow">Kicker</p><h2 class="h1">Headline goes here</h2></div><pre>code goes here</pre></section>` },
    { key: "end", label: "End", html: () => `<section class="slide slide--end" data-bare data-title="End"><p class="eyebrow">Fin</p><h2 class="display">Headline goes here</h2></section>` },
  ];

  function insertSlideHTML(html) {
    snapshot();
    slides[index].insertAdjacentHTML("afterend", html);
    decorate(); slides = $$(".slide", deck); show(index + 1);
  }
  function insertLayout(key) {
    const l = LAYOUTS.find(l => l.key === key);
    if (l) insertSlideHTML(l.html());
  }
  function insertPlaceholder(note) {
    const t = (note || "").trim();
    insertSlideHTML(`<section class="slide slide--placeholder" data-title="TBD"${t ? ` data-note="${escapeHtml(t)}"` : ""}></section>`);
  }

  function duplicateSlide() {
    snapshot();
    const clone = slides[index].cloneNode(true);
    clone.removeAttribute("data-note");
    $(".badge.req", clone)?.remove();
    slides[index].after(clone);
    decorate(); slides = $$(".slide", deck); show(index + 1);
  }
  function deleteSlide() {
    if (slides.length < 2) return toast("Can't delete the last slide.");
    snapshot();
    const doomedIndex = index;
    const html = { html: deck.innerHTML, index };
    slides[index].remove();
    slides = $$(".slide", deck); decorate();
    show(Math.min(doomedIndex, slides.length - 1), true, null, true);
    toast("Slide deleted", { action: "Undo", key: "⌘Z", onAction: () => restore(html), duration: 8000 });
  }

  /* ------------------------------------------------------- bullets / delete-element */
  function isEditableLeaf(el) {
    return el?.nodeType === 1 && el.hasAttribute("contenteditable");
  }
  function placeCaret(el, atEnd) {
    if (!el) return;
    el.focus();
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(!atEnd);
    const sel = getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }

  function initBulletEditing() {
    deck.addEventListener("keydown", e => {
      if (!editing) return;
      const el = e.target;
      if (!isEditableLeaf(el)) return;
      const tag = el.tagName;
      const bulletsUl = tag === "LI" ? el.closest(".slide--bullets ul") : null;
      const notesOl = tag === "LI" ? el.closest(".callout__notes") : null;

      // callout notes: Enter adds a pin + note pair, Backspace in an empty
      // note removes the pair (pins pair with notes by DOM order)
      if (e.key === "Enter" && notesOl) {
        e.preventDefault();
        snapshot();
        const idx = [...notesOl.children].indexOf(el);
        const li = makeNoteLi();
        el.after(li);
        const fig = $(".callout__media", el.closest(".slide"));
        if (fig) {
          const ref = $$(".pin", fig)[idx];
          const pin = document.createElement("i");
          pin.className = "pin";
          pin.style.left = (ref ? Math.min(94, parseFloat(ref.style.left) + 6) : 50) + "%";
          pin.style.top = (ref ? Math.min(94, parseFloat(ref.style.top) + 6) : 50) + "%";
          ref ? ref.after(pin) : fig.append(pin);
        }
        markRevealSteps();
        placeCaret(li, true);
        measureOverflow(slides[index]);
        return;
      }
      if (e.key === "Backspace" && !el.textContent.trim() && notesOl) {
        if (notesOl.children.length <= 1) return;          // never remove the last pair
        e.preventDefault();
        snapshot();
        const idx = [...notesOl.children].indexOf(el);
        const prevLi = el.previousElementSibling;
        const fig = $(".callout__media", el.closest(".slide"));
        if (fig) $$(".pin", fig)[idx]?.remove();
        el.remove();
        markRevealSteps();
        placeCaret(prevLi || notesOl.querySelector("li"), true);
        measureOverflow(slides[index]);
        return;
      }

      if (e.key === "Enter" && bulletsUl) {
        e.preventDefault();
        snapshot();
        const li = document.createElement("li");
        li.setAttribute("contenteditable", "plaintext-only");
        li.setAttribute("spellcheck", "false");
        el.after(li);
        markRevealSteps();
        placeCaret(li, true);
        measureOverflow(slides[index]);
        return;
      }

      if (e.key === "Backspace" && !el.textContent.trim()) {
        if (bulletsUl) {
          if (bulletsUl.children.length <= 1) return;      // never remove the last li
          e.preventDefault();
          snapshot();
          const prevLi = el.previousElementSibling;
          el.remove();
          markRevealSteps();
          placeCaret(prevLi || bulletsUl.querySelector("li"), true);
          measureOverflow(slides[index]);
          return;
        }
        if (["P", "LI", "H3"].includes(tag)) {
          if (el.classList.contains("display") || el.classList.contains("h1")) return; // protected
          const parent = el.parentElement;
          if (!parent) return;
          const siblings = [...parent.children].filter(c => c !== el &&
            !c.classList.contains("slide__wash") && !c.classList.contains("slide__chrome") &&
            !c.classList.contains("badge") && !c.classList.contains("slide__overflow-badge"));
          if (!siblings.length) return;                    // never remove the only child
          e.preventDefault();
          snapshot();
          const prevEl = el.previousElementSibling;
          el.remove();
          if (prevEl && isEditableLeaf(prevEl)) placeCaret(prevEl, true);
          measureOverflow(slides[index]);
        }
      }
    });
  }

  /* --------------------------------------------------------- request change */
  function addNote() {
    openPopover("note");
  }

  /* ---------------------------------------------------------------- chrome */
  const ICONS = `<svg width="0" height="0" style="position:absolute" aria-hidden="true" data-runtime><symbol id="i-prev" viewBox="0 0 24 24"><path d="M15 6l-6 6 6 6"/></symbol><symbol id="i-next" viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></symbol><symbol id="i-grid" viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></symbol><symbol id="i-theme" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor" stroke="none"/></symbol><symbol id="i-present" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/></symbol><symbol id="i-pdf" viewBox="0 0 24 24"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M12 11v6M9.5 14.5L12 17l2.5-2.5"/></symbol><symbol id="i-edit" viewBox="0 0 24 24"><path d="M4 20h4l10.5-10.5a2.1 2.1 0 0 0-3-3L5 17z"/><path d="M13 7l3 3"/></symbol><symbol id="i-plus" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></symbol><symbol id="i-dup" viewBox="0 0 24 24"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></symbol><symbol id="i-trash" viewBox="0 0 24 24"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></symbol><symbol id="i-spark" viewBox="0 0 24 24"><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="M19 16l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7z"/></symbol><symbol id="i-undo" viewBox="0 0 24 24"><path d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/></symbol><symbol id="i-save" viewBox="0 0 24 24"><path d="M5 3h11l3 3v15H5z"/><path d="M8 3v6h8V3M8 21v-7h8v7"/></symbol><symbol id="i-check" viewBox="0 0 24 24"><path d="M5 12l5 5L20 7"/></symbol><symbol id="i-help" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 1-1 1.7M12 17h.01"/></symbol><symbol id="i-notes" viewBox="0 0 24 24"><path d="M5 4h14v16H5z"/><path d="M8 9h8M8 13h8M8 17h5"/></symbol><symbol id="i-image" viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="8.5" cy="10" r="1.5"/><path d="M21 16l-5-5-8 8"/></symbol><symbol id="i-warn" viewBox="0 0 24 24"><path d="M12 4l9 16H3z"/><path d="M12 10v4M12 17h.01"/></symbol><symbol id="i-close" viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></symbol></svg>`;

  const SHORTCUTS = [
    ["→ / space", "Next"], ["←", "Previous"], ["Home", "First slide"], ["End", "Last slide"],
    ["O", "Overview"], ["E", "Edit mode"], ["S", "Presenter view"], ["T", "Cycle theme"],
    ["P", "Export PDF"], ["D", "Download single file"], ["F", "Fullscreen"], ["?", "This sheet"], ["Esc", "Close / finish editing"],
    ["⌘Z", "Undo"], ["⌘⇧Z", "Redo"], ["⌘D", "Duplicate slide"], ["⌫", "Delete selected sticker"],
    ["Enter", "New bullet (in a list)"], ["Backspace", "Delete empty bullet / element"],
    ["2×click image", "Add a pin (callout slide)"],
  ];

  function mountChrome() {
    document.body.insertAdjacentHTML("beforeend", ICONS + `
      <div class="toolbar" id="toolbar" data-runtime></div>
      <div class="tip" id="tip" data-runtime style="display:none"></div>
      <div class="toast" id="toast" data-runtime></div>
      <div class="overview" data-runtime>
        <div class="overview__head">
          <h2>${escapeHtml(document.title)}</h2>
          <span id="ov-count"></span>
        </div>
        <div class="overview__grid" id="ov-grid"></div>
      </div>
      <div class="pop-layer" id="pop-layer" data-runtime></div>
      <div class="drawer" id="notes-drawer" data-runtime style="display:none">
        <h4>Speaker notes <small class="js-notes-slide"></small></h4>
        <div class="drawer__body" contenteditable="plaintext-only" spellcheck="false"></div>
        <div class="drawer__hint">Shown in Presenter view and in the PDF when you choose "with notes". Saved in the deck as <code>&lt;aside class="notes"&gt;</code>.</div>
      </div>
      <div class="sheet" id="shortcuts-sheet" data-runtime style="display:none">
        <div class="sheet__card">
          <div class="sheet__head"><h3>Keyboard shortcuts</h3><button class="icon-btn" id="sheet-close"><svg class="icon"><use href="#i-close"/></svg></button></div>
          <div class="sheet__grid">
            ${SHORTCUTS.map(([k, d]) => `<div class="sheet__row"><kbd>${escapeHtml(k)}</kbd><span>${escapeHtml(d)}</span></div>`).join("")}
          </div>
        </div>
      </div>
    `);

    const notesBody = $("#notes-drawer .drawer__body");
    notesBody.addEventListener("input", debounce(commitNotes, 300));
    notesBody.addEventListener("focusin", () => preEditHTML ??= deck.innerHTML);
    notesBody.addEventListener("blur", () => { commitNotes(); commitTextEdit(); preEditHTML = null; });

    $("#sheet-close").onclick = () => toggleShortcuts(false);
    $("#shortcuts-sheet").addEventListener("click", e => { if (e.target.id === "shortcuts-sheet") toggleShortcuts(false); });

    renderToolbar();
  }

  function btn({ id, icon, label, key, cls = "", tip }) {
    const a11y = tip || label;                        // icon-only buttons carry their name in `tip`
    return `<button id="${id}" class="tb-btn ${cls}"${key ? ` data-key="${key}"` : ""}${tip ? ` data-tip="${escapeHtml(tip)}"` : ""}${a11y ? ` aria-label="${escapeHtml(a11y)}"` : ""}>` +
      (icon ? `<svg class="icon"><use href="#i-${icon}"/></svg>` : "") +
      (label ? `<span>${escapeHtml(label)}</span>` : "") + `</button>`;
  }

  function renderToolbar() {
    const bar = $("#toolbar");
    if (!bar) return;
    const showTheme = (document.body.dataset.themes || "").trim().split(/\s+/).filter(Boolean).length >= 2;

    bar.innerHTML = !editing ? `
      ${btn({ id: "btn-prev", icon: "prev", cls: "icon-only", key: "←", tip: "Previous slide" })}
      <span class="tb-count js-count">${index + 1} / ${slides.length}</span>
      ${btn({ id: "btn-next", icon: "next", cls: "icon-only", key: "→", tip: "Next slide" })}
      <span class="tb-sep"></span>
      ${btn({ id: "btn-ov", icon: "grid", label: "Overview", key: "O", tip: "See every slide as a grid" })}
      ${showTheme ? btn({ id: "btn-theme", icon: "theme", label: "Theme", key: "T", tip: "Switch light/dark theme" }) : ""}
      ${btn({ id: "btn-presenter", icon: "present", label: "Presenter", key: "S", tip: "Open presenter view with speaker notes" })}
      ${btn({ id: "btn-print", icon: "pdf", label: "Export PDF", key: "P", tip: "Print or save the deck as a PDF" })}
      ${btn({ id: "btn-single", icon: "save", label: "Download copy", key: "D", tip: "Download the deck with your changes as one self-contained .html" })}
      <span class="tb-sep"></span>
      ${btn({ id: "btn-edit", icon: "edit", label: "Edit", key: "E", tip: "Switch to edit mode" })}
      ${btn({ id: "btn-help", icon: "help", cls: "icon-only", key: "?", tip: "Keyboard shortcuts" })}
    ` : `
      ${btn({ id: "btn-prev", icon: "prev", cls: "icon-only", key: "←", tip: "Previous slide" })}
      <span class="tb-count js-count">${index + 1} / ${slides.length}</span>
      ${btn({ id: "btn-next", icon: "next", cls: "icon-only", key: "→", tip: "Next slide" })}
      <span class="tb-sep"></span>
      ${btn({ id: "btn-add", icon: "plus", label: "Add slide", tip: "Insert a new slide after this one" })}
      ${btn({ id: "btn-dup", icon: "dup", cls: "icon-only", key: "⌘D", tip: "Duplicate slide" })}
      ${btn({ id: "btn-del", icon: "trash", cls: "icon-only", key: "⌫", tip: "Delete slide" })}
      <span class="tb-sep"></span>
      ${btn({ id: "btn-note", icon: "spark", label: "Request change", tip: "Flag this slide for Claude to revise later" })}
      ${btn({ id: "btn-notes", icon: "notes", label: "Speaker notes", tip: "Add notes for presenter view and printed PDFs" })}
      <span class="tb-sep"></span>
      ${btn({ id: "btn-undo", icon: "undo", cls: "icon-only", key: "⌘Z", tip: "Undo" })}
      <button id="btn-save" class="tb-btn" data-tip="Save changes to this file" aria-label="Save"><svg class="icon"><use href="#i-save"/></svg><span class="js-save-label">Save</span></button>
      <span class="tb-sep"></span>
      ${btn({ id: "btn-done", icon: "check", label: "Done", cls: "primary", tip: "Exit edit mode" })}
    `;

    $("#btn-prev").onclick = prev;
    $("#btn-next").onclick = next;
    if (!editing) {
      $("#btn-ov").onclick = () => toggleOverview();
      $("#btn-theme")?.addEventListener("click", cycleTheme);
      $("#btn-presenter").onclick = openPresenter;
      $("#btn-print").onclick = e => exportPDF(e.currentTarget);
      $("#btn-single").onclick = downloadStandalone;
      $("#btn-edit").onclick = () => toggleEdit();
      $("#btn-help").onclick = () => toggleShortcuts();
    } else {
      $("#btn-add").onclick = e => openPicker(e.currentTarget);
      $("#btn-dup").onclick = duplicateSlide;
      $("#btn-del").onclick = deleteSlide;
      $("#btn-note").onclick = e => openPopover("note", e.currentTarget);
      $("#btn-notes").onclick = toggleNotesDrawer;
      $("#btn-undo").onclick = undo;
      $("#btn-save").onclick = onSaveClick;
      $("#btn-done").onclick = () => toggleEdit(false);
    }
    updateSaveUI();
    updateUndoUI();
    bindTooltips();
  }

  /* --------------------------------------------------------------- tooltips */
  function bindTooltips() {
    $$(".tb-btn", $("#toolbar")).forEach(b => {
      b.addEventListener("mouseenter", () => showTip(b));
      b.addEventListener("focus", () => showTip(b));
      b.addEventListener("mouseleave", hideTip);
      b.addEventListener("blur", hideTip);
    });
  }
  function showTip(el) {
    const tip = $("#tip");
    const label = el.dataset.tip || el.querySelector("span")?.textContent || el.title;
    const key = el.dataset.key;
    if (!label) return;
    tip.innerHTML = `${escapeHtml(label)}${key ? ` <kbd>${escapeHtml(key)}</kbd>` : ""}`;
    tip.style.display = "flex";
    const r = el.getBoundingClientRect();
    tip.style.left = (r.left + r.width / 2) + "px";
    tip.style.top = (r.top - 12) + "px";
    tip.style.transform = "translate(-50%, -100%)";
  }
  function hideTip() { $("#tip").style.display = "none"; }

  /* --------------------------------------------------------------- shortcuts sheet */
  function toggleShortcuts(force) {
    const el = $("#shortcuts-sheet");
    const open = force ?? el.style.display === "none";
    el.style.display = open ? "flex" : "none";
  }

  /* ---------------------------------------------------------------- toast */
  let toastTimer;
  function toast(msg, opts = {}) {
    const t = $("#toast");
    const { action, key, onAction, duration } = opts;
    t.innerHTML = `<span>${escapeHtml(msg)}</span>` +
      (action ? `<button class="toast__action">${escapeHtml(action)}</button>` : "") +
      (key ? `<kbd>${escapeHtml(key)}</kbd>` : "");
    if (action && onAction) {
      $(".toast__action", t).onclick = () => { onAction(); t.classList.remove("is-shown"); };
    }
    t.classList.add("is-shown");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove("is-shown"), duration || (action ? 8000 : 3600));
  }

  // the deck declares its own theme list: <body data-themes="midnight paper mint">
  const THEMES = (document.body.dataset.themes || "").trim().split(/\s+/).filter(Boolean);
  function cycleTheme() {
    const link = $("#theme");
    if (!link) return;
    if (THEMES.length < 2) return toast("This deck has one theme.");
    const cur = link.getAttribute("href").match(/([^/]+)\.css$/)?.[1];
    const nextTheme = THEMES[(THEMES.indexOf(cur) + 1) % THEMES.length];
    link.setAttribute("href", `themes/${nextTheme}.css`);
    toast(`Theme: ${nextTheme}`);
    if (overviewOpen) buildOverview();
  }

  /* -------------------------------------------------------------- popovers */
  function closePopover() { $("#pop-layer").innerHTML = ""; }

  function openPopover(kind, anchor) {
    closePicker();
    const layer = $("#pop-layer");
    const cur = slides[index];
    if (kind === "note") {
      const existing = cur.dataset.note || "";
      layer.innerHTML = `
        <div class="pop" id="note-pop">
          <h4>Request a change to this slide</h4>
          <p class="pop__sub">Saved with the deck. Applied the next time you hand it to Claude.</p>
          <textarea class="pop__ta" placeholder="What should change on this slide?">${escapeHtml(existing)}</textarea>
          <div class="pop__row">
            <small>Slide ${index + 1} of ${slides.length}</small>
            <span>
              <button class="btn btn--quiet" id="note-remove">Remove</button>
              <button class="btn btn--primary" id="note-save">Save request</button>
            </span>
          </div>
        </div>`;
      positionPopover($("#note-pop"), anchor);
      const ta = $(".pop__ta", layer);
      ta.focus();
      ta.setSelectionRange(ta.value.length, ta.value.length);
      $("#note-remove").onclick = () => { setNote(""); closePopover(); };
      $("#note-save").onclick = () => { setNote(ta.value); closePopover(); };
    }
  }
  // PDF export: pages are 16:9 by @page rule in Chromium; Safari ignores
  // @page size and prints on the dialog's paper, so it always gets the
  // popover with steps for a custom 16:9 paper size. When the deck carries
  // speaker notes, also offer slides-only vs with-notes.
  const isSafari = /apple/i.test(navigator.vendor || "");
  function exportPDF(anchor) {
    const hasNotes = !!$(".notes", deck);
    if (!hasNotes && !isSafari) return print();
    closePicker();
    const layer = $("#pop-layer");
    const sub = isSafari
      ? `Safari prints on the dialog's paper, not the deck's 16:9 page. For true 16:9 pages: Paper Size → <b>Manage Custom Sizes…</b> → 13.33 × 7.5 in (338.7 × 190.5 mm), margins 0 — and tick <b>Print backgrounds</b>. Chrome exports 16:9 automatically.`
      : `16:9 pages, one per slide — the page size comes from the deck, whatever paper the dialog names. Set margins <b>None</b> and background graphics <b>on</b>.`;
    const actions = hasNotes
      ? `<button class="btn" id="pdf-notes">With speaker notes</button>
          <button class="btn btn--primary" id="pdf-plain">Slides only</button>`
      : `<button class="btn btn--primary" id="pdf-plain">Open print dialog</button>`;
    layer.innerHTML = `
      <div class="pop" id="pdf-pop">
        <h4>Export PDF</h4>
        <p class="pop__sub">${sub}</p>
        <div class="pop__actions">${actions}</div>
      </div>`;
    positionPopover($("#pdf-pop"), anchor);
    $("#pdf-plain").onclick = () => { closePopover(); print(); };
    const notesBtn = $("#pdf-notes");
    if (notesBtn) notesBtn.onclick = () => {
      closePopover();
      document.body.classList.add("show-notes");
      print();
    };
  }

  function setNote(text) {
    snapshot();
    const cur = slides[index];
    const v = text.trim();
    if (v) cur.dataset.note = v; else delete cur.dataset.note;
    ensureNoteChip(cur);
    if (cur.classList.contains("slide--placeholder")) ensurePlaceholderNote(cur);
  }
  function positionPopover(el, anchor) {
    const r = anchor?.getBoundingClientRect();
    const bar = $("#toolbar").getBoundingClientRect();
    el.style.left = ((r ? r.left + r.width / 2 : innerWidth / 2)) + "px";
    el.style.bottom = (innerHeight - bar.top + 14) + "px";
  }

  /* ---------------------------------------------------------- add-slide picker */
  function tileWireframe(key) {
    const WF = {
      title: `<i style="left:10%;top:30%;width:55%;height:9%"></i><i style="left:10%;top:44%;width:40%;height:9%"></i><i class="a" style="left:10%;top:20%;width:14%;height:4%"></i>`,
      section: `<i style="left:10%;top:45%;width:45%;height:12%;background:var(--bg)"></i>`,
      statement: `<i style="left:10%;top:28%;width:70%;height:11%"></i><i style="left:10%;top:44%;width:50%;height:11%"></i>`,
      quote: `<i style="left:14%;top:30%;width:72%;height:7%"></i><i style="left:14%;top:42%;width:60%;height:7%"></i><i style="left:14%;top:62%;width:6%;height:11%;border-radius:50%"></i>`,
      bullets: `<i style="left:10%;top:16%;width:50%;height:9%"></i><i style="left:10%;top:38%;width:80%;height:5%"></i><i style="left:10%;top:52%;width:80%;height:5%"></i><i style="left:10%;top:66%;width:80%;height:5%"></i>`,
      agenda: `<i style="left:10%;top:18%;width:36%;height:5%"></i><i style="left:10%;top:32%;width:36%;height:5%"></i><i style="left:10%;top:46%;width:36%;height:5%"></i><i style="left:54%;top:18%;width:36%;height:5%"></i><i style="left:54%;top:32%;width:36%;height:5%"></i>`,
      split: `<i class="img" style="left:0;top:0;width:44%;height:100%"></i><i style="left:54%;top:30%;width:36%;height:9%"></i><i style="left:54%;top:48%;width:32%;height:5%"></i>`,
      callout: `<i class="img" style="left:6%;top:14%;width:54%;height:72%"></i><i class="a" style="left:16%;top:28%;width:5%;height:9%;border-radius:50%"></i><i class="a" style="left:42%;top:56%;width:5%;height:9%;border-radius:50%"></i><i style="left:66%;top:22%;width:26%;height:7%"></i><i style="left:66%;top:38%;width:26%;height:4%"></i><i style="left:66%;top:48%;width:26%;height:4%"></i>`,
      "callout-full": `<i class="img" style="inset:0;width:100%;height:100%"></i><i class="a" style="left:20%;top:26%;width:5%;height:9%;border-radius:50%"></i><i class="a" style="left:44%;top:52%;width:5%;height:9%;border-radius:50%"></i><i style="left:60%;top:44%;width:32%;height:44%;background:var(--tile-card,#22222b)"></i><i style="left:64%;top:54%;width:24%;height:4%"></i><i style="left:64%;top:64%;width:24%;height:4%"></i>`,
      cards: `<i style="left:8%;top:22%;width:26%;height:56%;background:var(--tile-card,#22222b)"></i><i style="left:37%;top:22%;width:26%;height:56%;background:var(--tile-card,#22222b)"></i><i style="left:66%;top:22%;width:26%;height:56%;background:var(--tile-card,#22222b)"></i>`,
      bento: `<i style="left:8%;top:22%;width:52%;height:32%;background:var(--tile-card,#22222b)"></i><i style="left:64%;top:22%;width:28%;height:32%;background:var(--tile-card,#22222b)"></i><i style="left:8%;top:58%;width:24%;height:24%;background:var(--tile-card,#22222b)"></i><i style="left:36%;top:58%;width:24%;height:24%;background:var(--tile-card,#22222b)"></i><i class="a" style="left:64%;top:58%;width:28%;height:24%"></i>`,
      stats: `<i style="left:8%;top:40%;width:18%;height:18%"></i><i style="left:41%;top:40%;width:18%;height:18%"></i><i style="left:74%;top:40%;width:18%;height:18%"></i>`,
      number: `<i style="left:10%;top:28%;width:38%;height:30%"></i><i style="left:10%;top:66%;width:52%;height:5%"></i>`,
      compare: `<i style="left:8%;top:24%;width:41%;height:56%;background:var(--tile-card,#22222b)"></i><i style="left:51%;top:24%;width:41%;height:56%;background:var(--tile-card,#22222b)"></i>`,
      timeline: `<i style="left:8%;top:40%;width:84%;height:2.5%"></i><i class="a" style="left:12%;top:36%;width:4%;height:9%;border-radius:50%"></i><i class="a" style="left:40%;top:36%;width:4%;height:9%;border-radius:50%"></i><i class="a" style="left:68%;top:36%;width:4%;height:9%;border-radius:50%"></i><i style="left:10%;top:54%;width:16%;height:4%"></i><i style="left:38%;top:54%;width:16%;height:4%"></i><i style="left:66%;top:54%;width:16%;height:4%"></i>`,
      full: `<i class="img" style="inset:0;width:100%;height:100%"></i><i style="left:10%;top:70%;width:50%;height:9%;background:#fff"></i>`,
      image: `<i class="img" style="inset:0;width:100%;height:100%"></i>`,
      gallery: `<i class="img" style="left:8%;top:28%;width:26%;height:52%"></i><i class="img" style="left:37%;top:28%;width:26%;height:52%"></i><i class="img" style="left:66%;top:28%;width:26%;height:52%"></i>`,
      code: `<i style="left:10%;top:20%;width:80%;height:62%;background:var(--tile-card,#1d1d26)"></i><i style="left:16%;top:30%;width:30%;height:4%"></i><i style="left:16%;top:40%;width:45%;height:4%"></i><i style="left:16%;top:50%;width:25%;height:4%"></i>`,
      end: `<i style="left:25%;top:42%;width:50%;height:10%"></i>`,
    };
    const bg = key === "section" ? " style=\"background:var(--accent)\"" : "";
    return `<div class="wf"${bg}>${WF[key] || ""}</div>`;
  }

  function openPicker(anchor) {
    closePopover();
    const layer = $("#pop-layer");
    layer.innerHTML = `
      <div class="pop picker" id="add-pop">
        <h4>Add a slide after ${index + 1}</h4>
        <p class="pop__sub">Layouts from your brand. Each comes with placeholder text in the right places.</p>
        <div class="picker__grid">
          ${LAYOUTS.map(l => `<button class="tile" data-key="${l.key}">${tileWireframe(l.key)}<span>${escapeHtml(l.label)}</span></button>`).join("")}
        </div>
        <div class="describe">
          <svg class="icon"><use href="#i-spark"/></svg>
          <input class="describe__input" type="text" placeholder="Or describe it for Claude — “a slide comparing our pricing tiers”">
          <button class="btn btn--ghost" id="add-placeholder">Add placeholder</button>
        </div>
      </div>`;
    positionPopover($("#add-pop"), anchor);
    $$(".tile", layer).forEach(t => t.onclick = () => { insertLayout(t.dataset.key); closePopover(); });
    $("#add-placeholder").onclick = () => {
      insertPlaceholder($(".describe__input", layer).value);
      closePopover();
    };
  }
  function closePicker() { if ($("#add-pop")) closePopover(); }

  /* --------------------------------------------------------------- speaker notes drawer */
  function notesAside(slide) { return $(".notes", slide); }
  function toggleNotesDrawer(force) {
    notesOpen = force ?? !notesOpen;
    $("#notes-drawer").style.display = notesOpen ? "flex" : "none";
    $("#btn-notes")?.classList.toggle("is-on", notesOpen);
    document.body.classList.toggle("has-notes-drawer", notesOpen);
    if (notesOpen) renderNotesDrawer();
    fit();
  }
  function closeNotesDrawer() { toggleNotesDrawer(false); }
  function renderNotesDrawer() {
    const body = $("#notes-drawer .drawer__body");
    if (!body) return;
    $(".js-notes-slide") && ($(".js-notes-slide").textContent = `SLIDE ${String(index + 1).padStart(2, "0")}`);
    const aside = notesAside(slides[index]);
    const paras = aside ? [...aside.children] : [];
    body.textContent = !aside ? "" : paras.length ? paras.map(p => p.textContent).join("\n\n") : aside.textContent.trim();
  }
  function commitNotes() {
    const body = $("#notes-drawer .drawer__body");
    if (!body) return;
    const text = body.textContent.trim();
    let aside = notesAside(slides[index]);
    if (!text) return aside?.remove();
    if (!aside) { aside = document.createElement("aside"); aside.className = "notes"; slides[index].append(aside); }
    aside.innerHTML = "";
    text.split(/\n{2,}/).forEach(par => {
      const p = document.createElement("p");
      p.textContent = par.trim();
      aside.append(p);
    });
  }

  /* ------------------------------------------------------- content animations */
  // data-animate="count" on an element: count up from 0 on slide entry,
  // preserving any non-numeric prefix/suffix and thousands separators.
  function animateCounts(slide) {
    if (editing || overviewOpen || reducedMotion()) return;
    $$('[data-animate="count"]', slide).forEach(el => {
      if (!countOriginal.has(el)) countOriginal.set(el, el.textContent);
      const src = countOriginal.get(el);
      const m = src.match(/^(\D*)([\d,]*\.?\d+)(\D*)$/);
      if (!m) return;
      const [, prefix, numStr, suffix] = m;
      const decimals = (numStr.split(".")[1] || "").length;
      const target = parseFloat(numStr.replace(/,/g, ""));
      const grouped = numStr.includes(",");
      const fmt = v => grouped
        ? Number(v.toFixed(decimals)).toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
        : v.toFixed(decimals);
      if (!target) { el.textContent = src; return; }
      cancelAnimationFrame(el._countRaf);
      const dur = 1200, t0 = performance.now();
      const tick = now => {
        const p = Math.min(1, (now - t0) / dur);
        const eased = 1 - Math.pow(1 - p, 3);
        el.textContent = prefix + fmt(target * eased) + suffix;
        if (p < 1) el._countRaf = requestAnimationFrame(tick);
        else el.textContent = src;
      };
      el._countRaf = requestAnimationFrame(tick);
    });
  }

  /* ------------------------------------------------------------- overflow guard */
  // after any content change, shrink a slide's content in steps until it fits
  // its box, flagging it if it still doesn't at the smallest step
  function overflows(slide) {
    const cs = getComputedStyle(slide);
    // the footer sits inside the slide's own bottom padding by design (bottom:34px,
    // ~14px tall, well under the default 84px pad), so no extra space needs
    // reserving beyond the padding already subtracted here
    const limitH = slide.clientHeight - parseFloat(cs.paddingBottom);
    const limitW = slide.clientWidth - parseFloat(cs.paddingRight);
    const kids = [...slide.children].filter(c =>
      !c.classList.contains("slide__wash") && !c.classList.contains("slide__chrome") &&
      !c.classList.contains("sticker") && !c.classList.contains("badge") &&
      !c.classList.contains("slide__overflow-badge") &&
      !(c.tagName === "ASIDE" && c.classList.contains("notes")));
    if (!kids.length) return false;
    const last = kids[kids.length - 1];
    const vOverflow = last.offsetTop + last.offsetHeight > limitH + 1;
    const hOverflow = kids.some(c => c.offsetLeft + c.offsetWidth > limitW + 1);
    return vOverflow || hOverflow;
  }
  function measureOverflow(slide) {
    if (!slide) return;
    slide.removeAttribute("data-fit");
    slide.removeAttribute("data-overflow");
    for (const f of [0.95, 0.9, 0.85, 0.8]) {
      if (!overflows(slide)) return;
      slide.dataset.fit = f;
    }
    if (overflows(slide)) slide.dataset.overflow = "";
  }
  const measureAll = () => slides.forEach(measureOverflow);

  /* ----------------------------------------------------------------- presenter */
  function openPresenter() {
    const sep = location.search ? "&" : "?";
    const url = location.pathname + location.search + sep + "presenter" + location.hash;
    const win = window.open(url, "slidecraft-presenter", "width=1100,height=700");
    if (!win) toast("Presenter view needs a popup — allow popups for this page, then try again.");
  }

  function mountPresenterUI() {
    document.body.insertAdjacentHTML("beforeend", ICONS + `
      <div class="presenter" data-runtime>
        <div class="presenter__alert" id="pv-alert" hidden></div>
        <div class="presenter__main">
          <div class="thumb__frame presenter__frame"><div class="thumb__scaler" id="pv-current"></div></div>
        </div>
        <div class="presenter__side">
          <div class="presenter__block">
            <div class="presenter__lbl" id="pv-next-label">Next</div>
            <div class="thumb__frame presenter__frame--sm"><div class="thumb__scaler" id="pv-next"></div></div>
          </div>
          <div class="presenter__block presenter__block--grow">
            <div class="presenter__lbl">Notes</div>
            <div class="presenter__notes" id="pv-notes"></div>
          </div>
        </div>
        <div class="presenter__foot">
          <b id="pv-elapsed">00:00</b><span>elapsed</span>
          <span class="presenter__spacer"></span>
          <b id="pv-count" class="presenter__count"></b>
          <span class="presenter__spacer"></span>
          <span id="pv-clock"></span>
          <span class="presenter__keys"><kbd>→</kbd><span>next</span><kbd>R</kbd><span>reset</span><kbd>B</kbd><span>black</span></span>
        </div>
      </div>`);
  }
  function fillScaler(id, slide, revealed = Infinity) {
    const host = $(id);
    host.innerHTML = "";
    if (!slide) return;
    const clone = slide.cloneNode(true);
    clone.classList.add("is-active");
    $$("[data-step]", clone).forEach((n, i) => n.classList.toggle("is-revealed", i < revealed));
    host.append(clone);
    requestAnimationFrame(() => {
      host.style.transform = `scale(${host.closest(".thumb__frame").clientWidth / W})`;
    });
  }
  function renderPresenter() {
    // "current" mirrors the live build state; "next" is what the next keypress shows:
    // the next build step of this slide, or the following slide at its first state
    const cur = slides[index];
    const steps = cur ? getSteps(cur).length : 0;
    const shown = Math.min(step, steps);
    fillScaler("#pv-current", cur, shown);
    const building = shown < steps;
    fillScaler("#pv-next", building ? cur : slides[index + 1], building ? shown + 1 : 0);
    const nextLbl = $("#pv-next-label");
    if (nextLbl) nextLbl.textContent = building ? `Next · build ${shown + 1} of ${steps}` : slides[index + 1] ? "Next slide" : "Next · end of deck";
    const aside = notesAside(cur);
    $("#pv-notes").innerHTML = aside ? aside.innerHTML : `<p class="presenter__no-notes">No notes for this slide.</p>`;
    $("#pv-count").textContent = `${index + 1} / ${slides.length}` + (steps ? ` · build ${shown}/${steps}` : "");
  }
  const fmtElapsed = ms => {
    const s = Math.floor(ms / 1000);
    return String(Math.floor(s / 60)).padStart(2, "0") + ":" + String(s % 60).padStart(2, "0");
  };
  function initPresenter() {
    document.body.classList.add("is-presenter");
    mountPresenterUI();
    let elapsedStart = null, synced = false;
    setInterval(() => {
      $("#pv-clock").textContent = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      $("#pv-elapsed").textContent = elapsedStart ? fmtElapsed(Date.now() - elapsedStart) : "00:00";
    }, 1000);
    const chan = new BroadcastChannel("slidecraft:" + location.pathname);
    // heartbeat: hello every second → any deck window answers with its state.
    // While no answer lands, keys go nowhere (deck closed, popup became the
    // only window, Safari file:// isolation) — say so instead of failing
    // silently; a deck window appearing later reconnects automatically.
    const alertEl = $("#pv-alert");
    const showDisconnected = () => {
      alertEl.hidden = false;
      alertEl.innerHTML = isSafari && location.protocol === "file:"
        ? `Can't reach the deck window — Safari isolates <code>file://</code> pages from each other, so presenter view can't drive the deck. Open the deck in Chrome, or serve its folder over http.`
        : `Can't reach the deck window. Presenter view is a remote control — keep the deck open in its own window or tab.`;
    };
    let lastSeen = 0;
    chan.onmessage = e => {
      const d = e.data;
      if (typeof d?.index !== "number") return;
      lastSeen = Date.now();
      const changed = d.index !== index || (d.step || 0) !== step;
      index = d.index; step = d.step || 0;
      if (!synced) { synced = true; alertEl.hidden = true; renderPresenter(); return; }
      if (!changed) return;                             // heartbeat echo, nothing new
      if (elapsedStart === null) elapsedStart = Date.now();
      renderPresenter();
    };
    chan.postMessage({ hello: true });
    setInterval(() => {
      chan.postMessage({ hello: true });
      if (synced && Date.now() - lastSeen > 2500) { synced = false; showDisconnected(); }
    }, 1000);
    setTimeout(() => { if (!synced) showDisconnected(); }, 1500);
    addEventListener("keydown", e => {
      const typing = e.target.isContentEditable || /^(INPUT|TEXTAREA)$/.test(e.target.tagName);
      if (typing) return;
      switch (e.key.toLowerCase()) {
        case "arrowright": case " ": case "pagedown": e.preventDefault(); chan.postMessage({ action: "next" }); break;
        case "arrowleft": case "pageup": e.preventDefault(); chan.postMessage({ action: "prev" }); break;
        case "home": chan.postMessage({ action: "home" }); break;
        case "end": chan.postMessage({ action: "end" }); break;
        case "r": elapsedStart = Date.now(); break;
        case "b": chan.postMessage({ action: "black" }); break;
      }
    });
    renderPresenter();
  }
  function initMainChannel() {
    mainChan = new BroadcastChannel("slidecraft:" + location.pathname);
    mainChan.onmessage = e => {
      const d = e.data;
      if (d?.hello) return syncState();
      if (d?.action === "next") advance();
      else if (d?.action === "prev") retreat();
      else if (d?.action === "home") show(0, true, "fwd");
      else if (d?.action === "end") show(slides.length - 1, true, "fwd");
      else if (d?.action === "black") document.body.classList.toggle("is-black");
    };
  }

  const escapeHtml = s => String(s).replace(/[&<>"]/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  /* --------------------------------------------------------------- events */
  function bind() {
    addEventListener("resize", fit);
    addEventListener("resize", debounce(measureAll, 150));
    addEventListener("fullscreenchange", fit);

    // overflow guard: re-measure the current slide as its content changes,
    // and any slide once its images finish loading
    deck.addEventListener("input", debounce(() => measureOverflow(slides[index]), 250));
    deck.addEventListener("load", e => {
      if (e.target.tagName === "IMG") measureOverflow(e.target.closest(".slide"));
    }, true);

    addEventListener("keydown", e => {
      const typing = e.target.isContentEditable ||
        /^(INPUT|TEXTAREA)$/.test(e.target.tagName);
      const meta = e.metaKey || e.ctrlKey;

      if (meta && !typing && e.key.toLowerCase() === "z") {
        e.preventDefault();
        e.shiftKey ? redo() : undo();
        return;
      }
      if (meta && !typing && e.key.toLowerCase() === "d" && editing) {
        e.preventDefault(); duplicateSlide(); return;
      }

      if (e.key === "Escape") {
        if ($("#shortcuts-sheet").style.display !== "none") return toggleShortcuts(false);
        if ($("#pop-layer").innerHTML) return closePopover();
        if (overviewOpen) return toggleOverview(false);
        if (editing) return toggleEdit(false);
      }
      if (typing) {
        if (e.key === "Escape") e.target.blur();
        return;
      }
      switch (e.key.toLowerCase()) {
        case "arrowright": case " ": case "pagedown": e.preventDefault(); advance(); break;
        case "arrowleft": case "pageup": e.preventDefault(); retreat(); break;
        case "home": show(0, true, "fwd"); break;
        case "end": show(slides.length - 1, true, "fwd"); break;
        case "o": toggleOverview(); break;
        case "e": toggleEdit(); break;
        case "t": cycleTheme(); break;
        case "p": e.preventDefault(); exportPDF($("#btn-print")); break;
        case "d": if (!meta) downloadStandalone(); break;
        case "s": openPresenter(); break;
        case "f": document.fullscreenElement ? document.exitFullscreen()
          : document.documentElement.requestFullscreen(); break;
        case "?": toggleShortcuts(); break;
        case "backspace": case "delete":
          if (!editing) break;
          if (selectedSticker) { snapshot(); selectedSticker.remove(); selectSticker(null); }
          else if (selectedPin) { deletePin(selectedPin); selectPin(null); }
          break;
      }
    });

    // click-through navigation (view mode only)
    deck.addEventListener("click", e => {
      if (editing || overviewOpen) return;
      const r = deck.getBoundingClientRect();
      (e.clientX - r.left) / r.width > 0.35 ? next() : prev();
    });

    // image slots. On a callout media that already has an image, plain clicks
    // belong to pins — replacing the image goes through the hover overlay's
    // button, and double-click adds a pin.
    deck.addEventListener("click", e => {
      const slot = e.target.closest(".media");
      if (!editing || !slot) return;
      if (e.target.closest(".pin")) return;
      if (slot.classList.contains("callout__media") && $("img", slot) && !e.target.closest(".media-hover")) return;
      e.stopPropagation();
      lastSlot = slot;
      pickFile(slot);
    }, true);

    // double-click a callout image to drop a pin there (+ its note)
    deck.addEventListener("dblclick", e => {
      if (!editing) return;
      const fig = e.target.closest(".callout__media");
      if (!fig || !$("img", fig) || e.target.closest(".pin,.media-hover")) return;
      e.preventDefault();
      addPinAt(fig, e.clientX, e.clientY);
    });

    // paste an image anywhere in edit mode
    addEventListener("paste", e => {
      if (!editing) return;
      const item = [...(e.clipboardData?.items || [])].find(i => i.type.startsWith("image/"));
      if (!item) return;
      e.preventDefault();
      const file = item.getAsFile();
      const slot = document.activeElement?.closest?.(".media") || null;
      slot ? attachImage(file, slot) : addSticker(file);
    });

    // drag & drop an image file onto a slot or a slide
    deck.addEventListener("dragover", e => { if (editing) e.preventDefault(); });
    deck.addEventListener("drop", e => {
      if (!editing) return;
      const file = e.dataTransfer?.files?.[0];
      if (!file || !file.type.startsWith("image/")) return;
      e.preventDefault();
      const slot = e.target.closest(".media");
      slot ? attachImage(file, slot) : addSticker(file);
    });

    // toolbar visibility: fades after 1s of stillness; hovering the bottom
    // edge of the window (where the bar lives) reveals it and pins it while
    // the pointer stays there. In fullscreen any movement also wakes it, so
    // the cursor and the bar come back together mid-presentation.
    const HOT_ZONE = 130;                // px from the bottom edge
    let idleTimer;
    const armIdle = () => {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => document.body.classList.add("is-idle"), 1000);
    };
    addEventListener("mousemove", e => {
      const hot = innerHeight - e.clientY <= HOT_ZONE;
      if (hot || document.fullscreenElement) document.body.classList.remove("is-idle");
      hot ? clearTimeout(idleTimer) : armIdle();
    });
    armIdle();

    addEventListener("beforeprint", () => toggleOverview(false));
    addEventListener("afterprint", () => {
      // show-notes set by the export popover is one-shot; ?notes in the URL keeps it
      if (!location.search.includes("notes")) document.body.classList.remove("show-notes");
    });
    addEventListener("beforeunload", e => {
      if (dirty && !dirHandle) { e.preventDefault(); e.returnValue = ""; }
    });

    initBulletEditing();
    initTextUndo();
  }

  /* ----------------------------------------------------------------- boot */
  const params = new URLSearchParams(location.search);
  decorate();
  if (params.has("presenter")) {
    initPresenter();
  } else {
    if (params.has("notes")) document.body.classList.add("show-notes");
    mountChrome();
    bind();
    initStickerDrag();
    fit();
    show(Math.max(0, (parseInt(location.hash.slice(1), 10) || 1) - 1), false, "fwd");
    booted = true;
    document.body.classList.add("is-ready");
    degrainImages();
    window.slidecraft = { serialize };     // programmatic access for tooling and tests
    measureAll();
    document.fonts?.ready?.then(measureAll);
    initMainChannel();
  }
})();
