/* =========================================================================
   slaydy — runtime.js
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
  /* ------------------------------------------------------- custom content
     A deck may carry content the runtime does not own: an inline SVG
     diagram, an interactive widget, a slide deliberately off-brand because
     its author asked for that. It lives under [data-custom], whose value
     names it and namespaces whatever CSS the deck writes for it.

     The runtime's half of the contract is this pair of helpers. Inside
     [data-custom] it never decorates, edits, highlights, steps, drags or
     navigates — it only carries the markup and hands the keyboard over.
     Because everything a deck authors stays scoped to that subtree, a
     runtime upgrade has nothing of the deck's to collide with; that, not
     good manners, is what makes hand-written CSS and JS safe here. */
  const inCustom = el => !!el?.closest?.("[data-custom]");
  const outside = els => els.filter(el => !inCustom(el));
  // a document loaded via srcdoc (Claude's artifact preview, some embeds)
  // resolves "#n" against the parent frame's URL while document.URL stays
  // "about:srcdoc" — Chrome then rejects the state object as cross-origin.
  // Hash routing is a nicety there, not a requirement, so just skip it.
  function replaceHash(hash) {
    try { history.replaceState(null, "", hash); } catch {}
  }

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
  if (!deck) return console.warn("[slaydy] no .deck found");
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
  // shortcut labels: handlers already accept ⌘ or Ctrl (metaKey || ctrlKey) —
  // this only makes what we DISPLAY match the visitor's keyboard
  const IS_MAC = /Mac|iP(hone|ad|od)/.test(navigator.platform);
  const KEY = IS_MAC
    ? { cmd: "⌘", alt: "⌥", shift: "⇧", del: "⌫" }
    : { cmd: "Ctrl+", alt: "Alt+", shift: "Shift+", del: "Del" };

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

      outside($$(".media", s)).forEach(m => {
        if (!$("img", m)) m.dataset.empty = "";
        else delete m.dataset.empty;
        if (!$(".media-hover", m)) {
          const ov = document.createElement("div");
          ov.className = "media-hover";
          ov.dataset.gen = "";
          ov.innerHTML = `<span><svg class="icon"><use href="#i-image"/></svg>Replace image</span>` +
            `<span class="media-hover__crop"></span>` +
            (m.classList.contains("callout__media")
              ? `<span class="media-hover__hint">Double-click to add a pin · drag pins to move</span>` : "");
          m.append(ov);
          updateCropChip(m);
        }
      });

      ensureNoteChip(s);
      ensureOverflowBadge(s);
      outside($$(".sticker", s)).forEach(ensureStickerHandles);
      if (s.classList.contains("slide--placeholder")) ensurePlaceholderNote(s);
      if (s.classList.contains("slide--code")) outside($$("pre", s)).forEach(highlight);
      outside($$(".meta", s)).forEach(ensureSeparators);
      ensureListMarkers(s);
    });
    markRevealSteps();
  }

  /* ------------------------------------------------------- meta separators */
  // Separators between meta items are RENDERED, never authored: a model that
  // types its own divider reaches for "·" every time, and a deck whose cover
  // reads "Name · Date" announces where it came from. So the markup is bare
  // spans, and the runtime puts a separator between them — an em dash by
  // default, a theme's --sep glyph, a custom string, or a sprite icon.
  const LEGACY_SEP = /^[·•‧∙‒–—―|\/\\*+~-]$/;   // authored dividers, swept up on load
  function ensureSeparators(m) {
    $$(".meta__sep", m).forEach(n => n.remove());
    $$(":scope > span", m).forEach(sp => {
      if (LEGACY_SEP.test(sp.textContent.trim())) sp.remove();
    });
    const custom = m.closest("[data-sep-text]");
    if (custom) m.style.setProperty("--sep", JSON.stringify(custom.dataset.sepText));
    else m.style.removeProperty("--sep");
    const mode = m.closest("[data-sep]")?.dataset.sep;
    if (mode === "none") return;
    const icon = m.closest("[data-sep-icon]")?.dataset.sepIcon;
    const items = $$(":scope > span", m);
    items.slice(1).forEach(sp => {
      const sep = document.createElement("i");
      sep.className = "meta__sep";
      sep.dataset.gen = "";
      sep.setAttribute("aria-hidden", "true");
      if (icon) sep.innerHTML = `<svg class="glyph"><use href="#i-${escapeHtml(icon)}"/></svg>`;
      sp.before(sep);
    });
  }

  /* ----------------------------------------------------------- list markers */
  // Markers are a token, not a layout decision: the bullets list and the
  // compare columns read the same --marker recipe, so one data-list harmonises
  // them (each keeps its own default when nothing is set). data-list-text
  // supplies any glyph, data-list-icon a sprite icon — both on <body> for the
  // whole deck or on a single slide, like data-list itself.
  const LIST_SELECTOR = ".slide--bullets li, .slide--compare .col li";
  function ensureListMarkers(s) {
    const items = outside($$(LIST_SELECTOR, s));
    if (!items.length) return;
    const text = s.closest("[data-list-text]")?.dataset.listText;   // closest() reaches <body>
    if (text) {
      s.style.setProperty("--marker", JSON.stringify(text));
      s.style.setProperty("--marker-w", "auto");
      s.style.setProperty("--marker-h", "auto");
      s.style.setProperty("--marker-bg", "none");
    } else {
      ["--marker", "--marker-w", "--marker-h", "--marker-bg"].forEach(v => s.style.removeProperty(v));
    }
    const icon = s.closest("[data-list-icon]")?.dataset.listIcon;
    items.forEach(li => {
      $$(":scope > .glyph[data-gen]", li).forEach(g => g.remove());
      if (!icon || $(":scope > .glyph", li)) return;              // an authored glyph wins
      li.insertAdjacentHTML("afterbegin",
        `<svg class="glyph" data-gen><use href="#i-${escapeHtml(icon)}"/></svg>`);
    });
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

  // --deck-pad is read once (and again on theme swap) rather than per fit():
  // fit() runs un-debounced on every resize event, and a getComputedStyle
  // right after fit()'s own :root writes forces a full-document style recalc
  let deckPad = 0.94;
  function readDeckPad() {
    const t = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--deck-pad"));
    deckPad = Number.isFinite(t) ? t : 0.94;
  }
  readDeckPad();

  function fit() {
    const pad = overviewOpen || document.fullscreenElement ? 1 : deckPad;
    const rightGutter = notesOpen ? 340 : 0;
    const raw = Math.min((innerWidth - rightGutter) / W, innerHeight / H) * pad;
    // snap to the pixel grid: floor the scaled width to a whole multiple of 16
    // (1280/16 and 720/16 are integral, so both scaled dimensions land on whole
    // pixels — costs at most 16px of width) and centre with an integer translate.
    // The matching transform lives on .deck in runtime.css.
    const scale = Math.max(16, Math.floor((W * raw) / 16) * 16) / W;
    const st = document.documentElement.style;
    st.setProperty("--scale", String(scale));
    st.setProperty("--deck-x", Math.round((innerWidth - rightGutter - W * scale) / 2) + "px");
    st.setProperty("--deck-y", Math.round((innerHeight - H * scale) / 2) + "px");
    st.setProperty("--notes-gutter", rightGutter + "px");
  }

  /* -------------------------------------------------------- progressive reveal */
  // data-reveal on a container (ul/ol/.cards/.stats/.stack) makes its direct
  // children steps; on a single element it is its own step. Marked with the
  // derived [data-step] attribute so CSS can hide un-revealed steps.
  function markRevealSteps() {
    slides.forEach(s => {
      outside($$("[data-step]", s)).forEach(n => n.removeAttribute("data-step"));
      if (s.hasAttribute("data-reveal-all")) return;   // per-slide option: no steps, show everything
      outside($$("[data-reveal]", s)).forEach(host => {
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
    if (push) replaceHash("#" + (index + 1));
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
  const emit = (name, detail) => deck.dispatchEvent(new CustomEvent("slaydy:" + name, { detail, bubbles: true }));
  function updateCount() {
    const t = `${index + 1} / ${slides.length}`;
    $$(".js-count").forEach(el => el.textContent = t);
  }

  /* ------------------------------------------------------------- overview */
  let ovSelected = 0;                 // keyboard cursor over the thumbnail grid
  let ovJumpBuf = "", ovJumpTimer;    // typed slide number, e.g. "1" "4" → 14

  function toggleOverview(force) {
    overviewOpen = force ?? !overviewOpen;
    document.body.classList.toggle("is-overview", overviewOpen);
    if (overviewOpen) {
      // a text box focused under the grid would swallow the arrow keys
      document.activeElement?.blur?.();
      ovSelected = index;
      buildOverview();
      requestAnimationFrame(() => ovThumbs()[ovSelected]?.scrollIntoView({ block: "nearest" }));
    } else {
      ovJumpBuf = ""; clearTimeout(ovJumpTimer);
    }
    fit();
  }

  const ovThumbs = () => $$(".thumb", $("#ov-grid"));
  // the grid is auto-fill, so the column count is a fact of layout, not CSS.
  // Cached — reading offsetTop per keypress forces a layout pass and the
  // selection should land the same frame the key goes down
  let ovCols = 0;
  function ovColumns() {
    if (!ovCols) {
      const t = ovThumbs();
      let n = 1;
      while (n < t.length && t[n].offsetTop === t[0].offsetTop) n++;
      ovCols = n;
    }
    return ovCols;
  }
  function ovSelect(i) {
    const t = ovThumbs();
    if (!t.length) return;
    ovSelected = Math.max(0, Math.min(t.length - 1, i));
    t.forEach((el, j) => el.classList.toggle("is-selected", j === ovSelected));
    t[ovSelected].scrollIntoView({ block: "nearest" });
  }
  function renderOvCount() {
    $("#ov-count").textContent = ovJumpBuf ? `go to ${ovJumpBuf}…` : `${slides.length} slides`;
  }

  function ovMoveSlide(from, to) {
    if (to === from || to < 0 || to >= slides.length) return;
    snapshot();
    const s = slides[from], cur = slides[index];
    to > from ? slides[to].after(s) : slides[to].before(s);
    decorate();                        // refreshes `slides` + page numbers
    index = slides.indexOf(cur);       // current slide may have shifted
    updateCount();
    replaceHash("#" + (index + 1));
    ovSelected = to;
    buildOverview();
    requestAnimationFrame(() => ovThumbs()[ovSelected]?.scrollIntoView({ block: "nearest" }));
    syncState();
  }

  // returns true when the key was handled (caller preventDefaults)
  function overviewKeydown(e) {
    if (/^\d$/.test(e.key)) {
      clearTimeout(ovJumpTimer);
      ovJumpBuf = (ovJumpBuf + e.key).slice(-3);
      ovJumpTimer = setTimeout(() => { ovJumpBuf = ""; renderOvCount(); }, 1500);
      const n = parseInt(ovJumpBuf, 10);
      if (n >= 1) ovSelect(n - 1);
      renderOvCount();
      return true;
    }
    const delta = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -ovColumns(), ArrowDown: ovColumns() }[e.key];
    if (delta) {
      if (e.altKey || e.shiftKey) {           // ⌥ matches the list-item reorder; ⇧ kept as an alias
        if (!editing) toast("Turn on Edit mode (E) to reorder slides.");
        else ovMoveSlide(ovSelected, Math.max(0, Math.min(slides.length - 1, ovSelected + delta)));
      } else ovSelect(ovSelected + delta);
      return true;
    }
    if (e.key === "Enter") { toggleOverview(false); show(ovSelected); return true; }
    if (e.key === "Home") { ovSelect(0); return true; }
    if (e.key === "End") { ovSelect(slides.length - 1); return true; }
    return false;
  }

  function buildOverview() {
    const grid = $("#ov-grid");
    grid.innerHTML = "";
    ovCols = 0;
    ovSelected = Math.min(ovSelected, slides.length - 1);
    $("#ov-hint").innerHTML = editing
      ? `<kbd>↑↓←→</kbd> select · <kbd>${KEY.alt}arrows</kbd> reorder · <kbd>Enter</kbd> open`
      : `<kbd>↑↓←→</kbd> select · <kbd>Enter</kbd> open · type a number to jump`;
    slides.forEach((s, i) => {
      const t = document.createElement("div");
      t.className = "thumb" + (i === index ? " is-current" : "") + (i === ovSelected ? " is-selected" : "");
      t.innerHTML =
        `<div class="thumb__frame"><div class="thumb__scaler"></div></div>` +
        `<div class="thumb__label"><span>${String(i + 1).padStart(2, "0")}</span><b></b></div>`;
      const clone = s.cloneNode(true);
      // a slide cloned mid-transition keeps is-entering/is-leaving, and the
      // child transforms they trigger are not neutralized by the thumb CSS —
      // the detached clone never gets the timer that clears them
      clone.classList.remove("is-entering", "is-leaving");
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
    renderOvCount();
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
    unhighlightAll();                                // token spans can't survive a caret
    outside($$(EDITABLE, deck)).forEach(el => {
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
    highlightAll();
  }

  function toggleEdit(force) {
    editing = force ?? !editing;
    document.body.classList.toggle("is-editing", editing);
    renderToolbar();
    if (editing) settleCounts();
    editing ? enableEditing() : disableEditing();
    if (editing) renderNotesDrawer(); else { commitNotes(); closeNotesDrawer(); }
    if (!editing) { closePopover(); closePicker(); }
    if (editing) {
      toast(`Edit mode — click any text to change it. ${KEY.cmd}V pastes an image onto the slide.`);
    } else if (document.documentElement.hasAttribute("data-standalone") && dirty && !dirHandle) {
      // standalone + unsaved + no folder handle: the edits only exist in this
      // tab. Replaces the plain "Edit mode off" toast — never both.
      toast("Your edits live only in this tab — Download copy saves an updated file.", { key: "D" });
    } else {
      toast("Edit mode off");
    }
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

  // per-slot crop override: data-crop is authored, so it survives saves.
  // The default is the layout's own — callout media letterboxes, the rest cover.
  const cropOf = m => m.getAttribute("data-crop") ||
    (m.classList.contains("callout__media") ? "contain" : "cover");
  function updateCropChip(m) {
    const chip = $(".media-hover__crop", m);
    if (chip) chip.textContent = `Crop: ${cropOf(m)}`;
  }
  function toggleCrop(m) {
    snapshot();
    m.setAttribute("data-crop", cropOf(m) === "cover" ? "contain" : "cover");
    updateCropChip(m);
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
    toast(`Drag to move · corner handles to resize · ${KEY.del} to delete · [ ] to layer`);
  }

  function selectSticker(el) {
    $$(".sticker.is-sel", deck).forEach(s => s.classList.remove("is-sel"));
    selectedSticker = el;
    el?.classList.add("is-sel");
  }

  // arrow-key nudge for the selected sticker or pin. One undo entry per
  // burst of keypresses, not one per press — mirrors how a drag snapshots once
  let nudgeTimer = null;
  function nudgeSelected(key, big) {
    const el = selectedSticker || selectedPin;
    if (!el) return;
    if (!nudgeTimer) snapshot();
    clearTimeout(nudgeTimer);
    nudgeTimer = setTimeout(() => nudgeTimer = null, 800);
    const step = big ? 2.5 : 0.5;
    const dx = { ArrowLeft: -step, ArrowRight: step }[key] || 0;
    const dy = { ArrowUp: -step, ArrowDown: step }[key] || 0;
    // pins clamp to their image (like drag); stickers may hang off the slide
    const clamp = el === selectedPin ? v => Math.max(0, Math.min(100, v)) : v => v;
    if (dx) el.style.left = clamp((parseFloat(el.style.left) || 0) + dx).toFixed(1) + "%";
    if (dy) el.style.top = clamp((parseFloat(el.style.top) || 0) + dy).toFixed(1) + "%";
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
      if (inCustom(e.target)) { selectSticker(null); selectPin(null); return; }
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

  /* ---------------------------------------------------- syntax highlight */
  // A ~60-line tokenizer instead of a highlighter library: decks must stay a
  // single offline file, and a code slide is at most 14 lines. Highlighting
  // is a VIEW of the <pre> — the plain text stays authoritative. It is
  // stripped while editing (contenteditable would shred the spans) and
  // flattened back to text on save, so a deck file never carries token markup.
  const HL_KEYWORDS = {
    js: "as async await break case catch class const continue debugger default delete do else export extends finally for from function get if import in instanceof let new of return set static super switch this throw try typeof var void while with yield",
    ts: "abstract as async await break case catch class const continue declare default delete do else enum export extends finally for from function get if implements import in instanceof interface let namespace new of private protected public readonly return set static super switch this throw try type typeof var void while yield",
    py: "and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield",
    sh: "case do done elif else esac export fi for function if in local read return source then until while",
    go: "break case chan const continue default defer else fallthrough for func go goto if import interface map package range return select struct switch type var",
    rust: "as async await break const continue crate dyn else enum extern fn for if impl in let loop match mod move mut pub ref return static struct super trait type unsafe use where while",
    sql: "select from where group by order having join left right inner outer full on as insert into values update set delete create table drop alter add index and or not null is limit offset distinct union case when then end",
    css: "important from to and not only",
    json: "",
  };
  const HL_LITERAL = /\b(?:true|false|null|undefined|None|True|False|nil|self|this)\b/;
  const HL_HASH = /^(?:py|sh|yaml|yml|rb|toml|ini|conf)$/;

  const hlCache = new Map();          // lang -> compiled regex
  function hlRegex(lang) {
    if (hlCache.has(lang)) return hlCache.get(lang);
    const words = (HL_KEYWORDS[lang] ?? HL_KEYWORDS.js).trim().split(/\s+/).filter(Boolean);
    const parts = [
      ["com", HL_HASH.test(lang) ? /#[^\n]*/ : lang === "sql" ? /--[^\n]*|\/\*[\s\S]*?\*\// : /\/\/[^\n]*|\/\*[\s\S]*?\*\//],
      ["key", lang === "json" ? /"(?:\\.|[^"\\])*"(?=\s*:)/ : /(?!)/],
      ["str", /"""[\s\S]*?"""|'''[\s\S]*?'''|`(?:\\.|[^`\\])*`|"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'/],
      ["num", /#[0-9a-fA-F]{3,8}\b|\b0[xXbB][\da-fA-F]+\b|\b\d+(?:\.\d+)?(?:e[-+]?\d+)?(?:px|em|rem|%|s|ms|vh|vw)?\b/],
      ["lit", HL_LITERAL],
      ["kw", words.length ? new RegExp(`\\b(?:${words.join("|")})\\b`, "i") : /(?!)/],
      ["fn", /\b[A-Za-z_$][\w$]*(?=\s*\()/],
      ["punc", /[{}()[\];,.:=+\-*/%<>!&|?~^]+/],
    ];
    const re = new RegExp(parts.map(([n, r]) => `(?<${n}>${r.source})`).join("|"), "g");
    hlCache.set(lang, re);
    return re;
  }

  // walk a compiled regex over the source, wrapping each match, escaping the rest
  function hlRun(src, re) {
    let out = "", last = 0, m;
    re.lastIndex = 0;
    while ((m = re.exec(src))) {
      if (m[0] === "") { re.lastIndex++; continue; }
      out += escapeHtml(src.slice(last, m.index));
      const g = Object.keys(m.groups).find(k => m.groups[k] !== undefined);
      out += `<span class="tok tok--${g}">${escapeHtml(m[0])}</span>`;
      last = m.index + m[0].length;
    }
    return out + escapeHtml(src.slice(last));
  }

  // markup needs a two-level pass: text outside tags is content, not code
  const HL_TAG = /(?<str>"[^"]*"|'[^']*')|(?<tag>^<\/?[A-Za-z][\w:.-]*)|(?<attr>[A-Za-z_:][\w:.-]*(?=\s*=))|(?<punc>\/?>$|=)/g;
  function hlMarkup(src) {
    let out = "", last = 0, m;
    const re = /<!--[\s\S]*?-->|<\/?[A-Za-z][^>]*>?|<\/?[A-Za-z][\w:.-]*>/g;
    while ((m = re.exec(src))) {
      out += escapeHtml(src.slice(last, m.index));
      out += m[0].startsWith("<!--")
        ? `<span class="tok tok--com">${escapeHtml(m[0])}</span>`
        : hlRun(m[0], HL_TAG);
      last = m.index + m[0].length;
    }
    return out + escapeHtml(src.slice(last));
  }

  function detectLang(src) {
    if (/^\s*</.test(src) || /<\/[A-Za-z][\w:.-]*>/.test(src)) return "html";
    if (/^\s*[{[]/.test(src) && /"[^"]*"\s*:/.test(src)) return "json";
    if (/^\s*(?:def |class |import |from |@\w)/m.test(src) && /:\s*$/m.test(src)) return "py";
    if (/^\s*(?:#!|\$ |sudo |apt |brew |npm |npx |yarn |pip |git |curl |cd |echo )/m.test(src)) return "sh";
    if (/^\s*[.#@a-zA-Z\[][^\n{;]*\{[^}]*:/m.test(src) && !/=>|\bfunction\b/.test(src)) return "css";
    if (/\bpackage\s+\w+|\bfunc\s+\w+\s*\(/.test(src)) return "go";
    if (/\bfn\s+\w+\s*\(|\blet\s+mut\b/.test(src)) return "rust";
    if (/^\s*select\b[\s\S]*\bfrom\b/i.test(src)) return "sql";
    return "js";
  }

  // data-lang pins the language; data-lang="none" opts out entirely
  function highlight(pre) {
    if (editing || pre.isContentEditable) return;
    const src = pre.textContent;
    const lang = (pre.dataset.lang || detectLang(src)).toLowerCase();
    if (lang === "none" || lang === "text" || !src.trim()) { unhighlight(pre); return; }
    if (pre.dataset.hl === lang && pre.dataset.hlSrc === src) return;
    pre.innerHTML = /^(?:html|xml|svg|vue|jsx?-markup)$/.test(lang) ? hlMarkup(src) : hlRun(src, hlRegex(lang));
    pre.dataset.hl = lang;
    pre.dataset.hlSrc = src;
  }
  function unhighlight(pre) {
    if (!pre.dataset.hl) return;
    pre.textContent = pre.textContent;
    delete pre.dataset.hl;
    delete pre.dataset.hlSrc;
  }
  const highlightAll = () => outside($$(".slide--code pre", deck)).forEach(highlight);
  const unhighlightAll = () => outside($$("pre[data-hl]", deck)).forEach(unhighlight);

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

  // rewrite a stylesheet's relative url() references (fonts, ornaments,
  // icons) to data: URIs, resolving against the stylesheet's own folder —
  // themes/x.css referring to ../assets/y.woff2 must resolve correctly.
  // Anything with a #fragment passes through untouched — a data: URI can't
  // address a fragment (url(file.svg#filter) inlined would resolve to the
  // whole document, silently killing the filter/mask) — and so does anything
  // isRelSrc rejects, or a target that fails to fetch.
  const CSS_URL = /url\(\s*(['"]?)([^)'"]+)\1\s*\)/g;
  async function inlineCSSUrls(css, baseHref) {
    const base = new URL(baseHref, location.href);
    const done = new Map();
    for (const [raw, , u] of css.matchAll(CSS_URL)) {
      if (done.has(raw) || u.includes("#") || !isRelSrc(u)) continue;
      try {
        const res = await fetch(new URL(u, base));
        if (res.ok) done.set(raw, `url(${await toDataURL(await res.blob())})`);
      } catch { /* leave the reference as written */ }
    }
    return css.replace(CSS_URL, m => done.get(m) ?? m);
  }

  async function inlineAssets(root) {
    const css = [], js = [];
    // the deck's declared themes travel with the single file so the recipient
    // keeps the T key: each becomes its own <style data-theme> block, only the
    // active one enabled. Falls back to baking in just the active theme when
    // the list can't be resolved (missing files, no data-themes).
    const themeBlocks = [];
    let activeTheme = null;
    for (const link of [...root.querySelectorAll('link[rel="stylesheet"]')]) {
      const href = link.getAttribute("href");
      if (!isRelSrc(href)) continue;
      if (link.id === "theme") {
        activeTheme = href.match(/([^/]+)\.css$/)?.[1] ?? null;
        const names = [...new Set((root.querySelector("body").dataset.themes || "").trim().split(/\s+/).filter(Boolean))];
        for (const name of names.length ? names : [activeTheme].filter(Boolean)) {
          try {
            themeBlocks.push({ name, css: await inlineCSSUrls(await fetchAsset(`themes/${name}.css`, minifyCSS), `themes/${name}.css`) });
          } catch { /* theme file missing — leave it out */ }
        }
        // the active theme must be present even if data-themes forgot it
        if (activeTheme && !themeBlocks.some(t => t.name === activeTheme)) {
          try { themeBlocks.push({ name: activeTheme, css: await inlineCSSUrls(await fetchAsset(href, minifyCSS), href) }); } catch {}
        }
        link.remove();
        continue;
      }
      css.push(await inlineCSSUrls(await fetchAsset(href, minifyCSS), href));
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
    if (themeBlocks.length < 2) body.removeAttribute("data-themes");   // one theme baked in — nothing to cycle
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
    // theme blocks come after the main bundle so they keep overriding runtime.css;
    // cycleTheme flips `media` between "" and "not all" to swap them
    for (const t of themeBlocks) {
      const st = document.createElement("style");
      st.dataset.theme = t.name;
      if (t.name !== activeTheme) st.media = "not all";
      st.textContent = t.css;
      body.append(st);
    }
    if (js.length) {
      const sc = document.createElement("script");
      sc.textContent = js.join("\n");
      body.append(sc);
    }
    root.dataset.standalone = "";
  }

  /* ---------------------------------------------------- per-slide options */
  // Every data-* option the runtime uses is declared here, split on the one
  // axis that matters: AUTHORED options are part of the deck and survive a
  // save; DERIVED ones are computed at display time and stripped from every
  // save, wherever they appear. Extensions declare theirs the same way:
  //   window.slaydy.options.declare({ name: "data-surface", derived: true })
  //   window.slaydy.options.declare({ name: "data-veil", label: "Veil",
  //     values: ["soft", "dense"], hint: "Scrim strength over the gradient." })
  // A declaration with `values` is validated at boot (typos warn instead of
  // failing silently) and gets a control in the edit-mode Slide-options panel
  // for free; `type: "flag"` renders an on/off toggle there. TRANSIENT is the
  // derived set — window.slaydy.transient.add() still works and is
  // equivalent to declaring { name, derived: true }.
  // "does this slide have one the runtime actually drives?" — the qualifier is
  // the point: an option whose targets all sit under [data-custom] has nothing
  // to change, and a control that silently does nothing is worse than one that
  // isn't offered. Every `when` below goes through this.
  const hasOwn = (s, sel) => outside($$(sel, s)).length > 0;

  const TRANSIENT = new Set();
  const OPTIONS = new Map();
  function declareOption(def) {
    const d = { on: "slide", type: def.values ? "enum" : (def.type || "text"), ...def };
    OPTIONS.set(d.name, d);
    if (d.derived) TRANSIENT.add(d.name);
    // extensions declare after boot (custom.js loads after runtime.js), so the
    // boot-time validateOptions() pass has already run — validate late arrivals
    // here or the documented typo warning never fires for exactly them
    if (booted) validateOption(d);
    return d;
  }
  [
    { name: "data-fit", derived: true },
    { name: "data-overflow", derived: true },
    { name: "data-tx", derived: true },
    { name: "data-step", derived: true },
    { name: "data-empty", derived: true },
    { name: "data-title", label: "Title", type: "text" },
    { name: "data-note", label: "Change request", type: "text" },
    { name: "data-transition", label: "Transition", values: ["fade", "rise", "zoom", "push", "wipe", "none"], hint: "How this slide enters. Default follows the deck." },
    { name: "data-bare", label: "Bare", type: "flag", hint: "Hide the footer — logo, label, page number." },
    { name: "data-reveal-all", label: "Reveal at once", type: "flag",
      hint: "Show progressive-reveal content immediately instead of step by step.",
      when: s => hasOwn(s, "[data-reveal]"),
      onchange: s => { markRevealSteps(); step = getSteps(s).length ? step : 0; applyReveal(s); } },
    { name: "data-sep", label: "Separator", values: ["dash", "en-dash", "slash", "pipe", "colon", "none"],
      when: s => hasOwn(s, ".meta"),
      hint: "Divider drawn between meta items. Deck-wide default lives on <body>.",
      onchange: s => $$(".meta", s).forEach(ensureSeparators) },
    { name: "data-list", label: "List style", values: ["numbers", "dots", "square", "dash", "chevron", "none"],
      // ...and not when every item already carries a glyph: on the bullets
      // layout a glyph replaces that item's marker outright
      // (.slide--bullets li:has(> .glyph)::before { content: none }), so the
      // picker would be choosing between markers nothing renders.
      when: s => outside($$(LIST_SELECTOR, s)).some(li =>
        !(li.closest(".slide--bullets") && li.querySelector(":scope > .glyph"))),
      hint: "Marker style for this slide's lists. Default is the layout's own — numbers for the list layout, a dash in compare columns.",
      onchange: ensureListMarkers },
    { name: "data-crop", on: "media", label: "Crop", values: ["cover", "contain"],
      hint: "How an image fills its slot — cover crops to fill, contain letterboxes. Toggled from the image's hover chip." },
    { name: "data-clean", label: "Blank canvas", type: "flag",
      when: ".slide--placeholder",
      hint: "Hide the placeholder prompt and dashed frame — e.g. to stack pasted images on an empty slide." },
  ].forEach(declareOption);

  function validateOption(o) {
    if (o.on !== "slide" || !o.values) return;
    slides.forEach((s, i) => {
      const v = s.getAttribute(o.name);
      if (v !== null && v !== "" && !o.values.includes(v))
        console.warn(`slaydy: slide ${i + 1} has ${o.name}="${v}" — expected one of: ${o.values.join(", ")}`);
    });
  }
  const validateOptions = () => OPTIONS.forEach(validateOption);

  async function serialize({ inline }) {
    const root = document.documentElement.cloneNode(true);
    // an in-flight count-up leaves a mid-animation value in the DOM — the
    // clone must get the pristine text, not the partial number
    const liveCounts = document.querySelectorAll('[data-animate="count"]');
    root.querySelectorAll('[data-animate="count"]').forEach((n, i) => {
      const live = liveCounts[i];
      if (live?._countRaf) n.textContent = countOriginal.get(live) ?? n.textContent;
    });
    // extensions get the clone before the strip pass — e.g. to bake an asset
    // bundle into a single-file export. waitUntil() defers the save for async
    // work (fetching assets to inline).
    const jobs = [];
    emit("serialize", { root, inline: !!inline, waitUntil: p => jobs.push(p) });
    await Promise.all(jobs);
    root.querySelectorAll("[data-runtime],[data-gen]").forEach(n => n.remove());
    root.querySelectorAll(".slide").forEach(s => {
      s.classList.remove("is-active", "is-entering", "is-leaving");
    });
    TRANSIENT.forEach(a =>
      root.querySelectorAll(`[${a}]`).forEach(n => n.removeAttribute(a)));
    // a placeholder saves empty — except stickers, which ride along as
    // reference material for whoever fills the slide later
    root.querySelectorAll(".slide--placeholder").forEach(s => {
      [...s.children].forEach(c => { if (!c.classList.contains("sticker")) c.remove(); });
    });
    root.querySelectorAll(".is-revealed").forEach(n => n.classList.remove("is-revealed"));   // data-step itself is in TRANSIENT
    root.querySelector("body")?.removeAttribute("data-dir");
    root.querySelectorAll("[contenteditable]").forEach(n => {
      n.removeAttribute("contenteditable"); n.removeAttribute("spellcheck");
    });
    root.querySelectorAll(".sticker, .pin").forEach(n => n.classList.remove("is-sel"));
    root.querySelectorAll("[data-grain]").forEach(n => n.removeAttribute("data-grain"));   // re-derived at boot
    // --sep / --marker are painted onto the element from data-sep-text and
    // data-list-text at boot; the attributes are the source of truth, so the
    // resolved values never belong in the file
    root.querySelectorAll("[style*='--sep'], [style*='--marker']").forEach(n => {
      ["--sep", "--marker", "--marker-w", "--marker-h", "--marker-bg"]
        .forEach(v => n.style.removeProperty(v));
      if (!n.getAttribute("style")?.trim()) n.removeAttribute("style");
    });
    root.querySelectorAll("pre[data-hl]").forEach(p => {                                   // ditto: tokens are a view
      p.textContent = p.textContent;
      p.removeAttribute("data-hl"); p.removeAttribute("data-hl-src");
    });
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
          dirHandle = await showDirectoryPicker({ mode: "readwrite", id: "slaydy" });
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
    closePopover();   // an open popover holds references into the DOM being replaced
    deck.innerHTML = html;
    decorate();
    slides = $$(".slide", deck);
    show(Math.min(at, slides.length - 1), true, null, true);
    if (editing) enableEditing();
    if (overviewOpen) { ovSelected = index; buildOverview(); }  // undo of an overview reorder
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
    // the edited text is the new pristine value — a stale cache would make the
    // next count-up restore the old number over the edit
    $$('[data-animate="count"]', deck).forEach(el => countOriginal.set(el, el.textContent));
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
    { key: "title", label: "Title", html: () => `<section class="slide slide--title" data-bare data-title="Title"><p class="eyebrow">Kicker</p><h1 class="display">Headline goes here</h1><div class="meta"><span>Author</span><span>Date</span></div></section>` },
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
    toast("Slide deleted", { action: "Undo", key: KEY.cmd + "Z", onAction: () => restore(html), duration: 8000 });
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

  // is the caret on the first (top) / last (bottom) visual line of `el`?
  // Compared via client rects, so it works inside the scaled deck — both
  // the caret box and the text box shrink by the same factor.
  function caretAtEdge(el, top) {
    const sel = getSelection();
    if (!sel.rangeCount) return true;
    const r = sel.getRangeAt(0).cloneRange();
    r.collapse(top);
    const rect = r.getBoundingClientRect();
    if (!rect.height) return true;                 // empty element — no caret box
    const full = document.createRange();
    full.selectNodeContents(el);
    const fRect = full.getBoundingClientRect();
    if (!fRect.height) return true;
    return top ? rect.top - fRect.top < rect.height * .5
               : fRect.bottom - rect.bottom < rect.height * .5;
  }

  // find the nearest <strong> ancestor of `node`, stopping at `leaf` — used
  // to test whether a selection endpoint already sits inside emphasis
  function closestStrongWithin(node, leaf) {
    let n = node.nodeType === 1 ? node : node.parentElement;
    while (n && n !== leaf) {
      if (n.tagName === "STRONG") return n;
      n = n.parentElement;
    }
    return null;
  }

  // un-nest: a <strong> that lands fully or partially inside `frag` (from
  // Range#extractContents, which already splits boundary elements) gets
  // replaced by its children — emphasis never nests
  function stripStrongs(root) {
    root.querySelectorAll("strong").forEach(s => {
      const p = s.parentNode;
      while (s.firstChild) p.insertBefore(s.firstChild, s);
      p.removeChild(s);
    });
  }

  function pruneEmptyStrongs(el) {
    $$("strong", el).forEach(s => { if (!s.textContent) s.remove(); });
  }

  // wrap `range` in a fresh <strong>, absorbing any strong siblings it now
  // touches so two adjacent emphasis runs collapse into one element
  function wrapStrong(range) {
    const frag = range.extractContents();
    stripStrongs(frag);
    let strong = document.createElement("strong");
    strong.appendChild(frag);
    range.insertNode(strong);
    const prev = strong.previousSibling;
    if (prev?.nodeType === 1 && prev.tagName === "STRONG") {
      while (strong.firstChild) prev.appendChild(strong.firstChild);
      strong.remove();
      strong = prev;
    }
    const next = strong.nextSibling;
    if (next?.nodeType === 1 && next.tagName === "STRONG") {
      while (next.firstChild) strong.appendChild(next.firstChild);
      next.remove();
    }
    return strong;
  }

  // remove `strong`, splitting it so any part of it outside `range` stays
  // emphasised — the part inside `range` is what the selection asked to unbold
  function unwrapStrong(strong, range) {
    const parent = strong.parentNode;
    const beforeRange = document.createRange();
    beforeRange.setStart(strong, 0);
    beforeRange.setEnd(range.startContainer, range.startOffset);
    const beforeFrag = beforeRange.extractContents();
    const afterRange = document.createRange();
    afterRange.setStart(range.endContainer, range.endOffset);
    afterRange.setEnd(strong, strong.childNodes.length);
    const afterFrag = afterRange.extractContents();

    if (beforeFrag.hasChildNodes()) {
      const beforeStrong = document.createElement("strong");
      beforeStrong.appendChild(beforeFrag);
      parent.insertBefore(beforeStrong, strong);
    }
    // empty text-node markers bracket the unwrapped run so the selection
    // can be rebuilt around it once the strong tag is gone
    const selStart = document.createTextNode("");
    parent.insertBefore(selStart, strong);
    while (strong.firstChild) parent.insertBefore(strong.firstChild, strong);
    const selEnd = document.createTextNode("");
    parent.insertBefore(selEnd, strong);
    const afterAnchor = strong.nextSibling;
    parent.removeChild(strong);
    if (afterFrag.hasChildNodes()) {
      const afterStrong = document.createElement("strong");
      afterStrong.appendChild(afterFrag);
      parent.insertBefore(afterStrong, afterAnchor);
    }
    return { selStart, selEnd };
  }

  // ⌘A selects at the element level, leaving both endpoints outside any
  // strong — if the range still holds exactly one emphasis run (and nothing
  // else), the intent is to unwrap it, not re-wrap what's already emphasised
  function soleStrongIn(range, el) {
    let sole = null;
    for (const n of range.cloneContents().childNodes) {
      if (n.nodeType === 3 && !n.textContent) continue;
      if (n.nodeType === 1 && n.tagName === "STRONG" && !sole) { sole = n; continue; }
      return null;
    }
    return sole ? $$("strong", el).find(s => range.intersectsNode(s)) || null : null;
  }

  // ⌘/Ctrl+B: toggle <strong> emphasis on the current selection. One leaf
  // only — a selection crossing leaves, or collapsed to a caret, is a no-op.
  function toggleEmphasis(el) {
    const sel = getSelection();
    if (!sel.rangeCount || sel.isCollapsed) return;
    const range = sel.getRangeAt(0);
    if (!el.contains(range.startContainer) || !el.contains(range.endContainer)) return;

    snapshot();

    const startStrong = closestStrongWithin(range.startContainer, el);
    const endStrong = closestStrongWithin(range.endContainer, el);
    const target = startStrong && startStrong === endStrong
      ? startStrong : soleStrongIn(range, el);

    if (target) {
      const { selStart, selEnd } = unwrapStrong(target, range);
      pruneEmptyStrongs(el);
      // set the selection around the markers BEFORE normalizing — normalize()
      // is spec'd to keep live ranges valid through the merges/removals it does
      const newRange = document.createRange();
      newRange.setStartAfter(selStart);
      newRange.setEndBefore(selEnd);
      sel.removeAllRanges();
      sel.addRange(newRange);
      el.normalize();
    } else {
      const strong = wrapStrong(range);
      pruneEmptyStrongs(el);
      el.normalize();
      const newRange = document.createRange();
      newRange.selectNodeContents(strong);
      sel.removeAllRanges();
      sel.addRange(newRange);
    }
    measureOverflow(slides[index]);
  }

  function initBulletEditing() {
    deck.addEventListener("keydown", e => {
      if (!editing) return;
      const el = e.target;
      if (!isEditableLeaf(el)) return;
      const tag = el.tagName;
      const notesOl = tag === "LI" ? el.closest(".callout__notes") : null;
      // any list in any layout — compare columns, agenda, bullets alike
      const listEl = tag === "LI" && !notesOl ? el.closest("ul, ol") : null;

      // ⌘/Ctrl+B: emphasis toggle — see toggleEmphasis for the wrap/unwrap logic
      if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === "b") {
        e.preventDefault();
        toggleEmphasis(el);
        return;
      }

      // A line break within the element, in any editable leaf. Shift+Enter is
      // the documented gesture; plain Enter lands here too once no list is
      // waiting for it (a <pre> keeps its own newlines) — the browser would
      // otherwise insert a bare "\n", which renders while plaintext-only puts
      // white-space: pre-wrap on the element and silently collapses the moment
      // editing stops, so the break would vanish on save.
      // plaintext-only blocks insertHTML, so place the <br> via the range API
      if (e.key === "Enter" &&
          (e.shiftKey || (!listEl && !notesOl && tag !== "PRE"))) {
        e.preventDefault();
        const sel = getSelection();
        if (!sel.rangeCount) return;
        const range = sel.getRangeAt(0);
        range.deleteContents();
        const br = document.createElement("br");
        range.insertNode(br);
        // a lone trailing <br> doesn't render a caret line — pad with a twin
        if (!br.nextSibling) br.after(document.createElement("br"));
        range.setStartAfter(br);
        range.collapse(true);
        sel.removeAllRanges();
        sel.addRange(range);
        measureOverflow(slides[index]);
        return;
      }

      // ⌥↑ / ⌥↓ moves a list item within its list. Callout notes carry
      // their pin along (pins pair with notes by DOM order — swapping the
      // two pins renumbers them while each keeps its spot on the image)
      if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown") && (listEl || notesOl)) {
        e.preventDefault();
        const up = e.key === "ArrowUp";
        const sib = up ? el.previousElementSibling : el.nextElementSibling;
        if (sib?.tagName !== "LI") return;
        snapshot();
        up ? sib.before(el) : sib.after(el);
        if (notesOl) {
          const fig = $(".callout__media", el.closest(".slide"));
          const lo = Math.min([...notesOl.children].indexOf(el), [...notesOl.children].indexOf(sib));
          const pins = fig ? $$(".pin", fig) : [];
          if (pins[lo] && pins[lo + 1]) pins[lo].before(pins[lo + 1]);
        }
        markRevealSteps();
        placeCaret(el, true);
        measureOverflow(slides[index]);
        return;
      }

      // Tab / ⇧Tab cycles every text box on the slide, in any layout
      if (e.key === "Tab") {
        e.preventDefault();
        const leaves = $$("[contenteditable]", slides[index]);
        const i = leaves.indexOf(el);
        const target = leaves[(i + (e.shiftKey ? -1 : 1) + leaves.length) % leaves.length];
        if (target) placeCaret(target, true);
        return;
      }

      // plain ↑ / ↓ on the caret's first / last line jumps to the text
      // element directly above / below — vertical stacks and lists only.
      // The target must actually sit above/below (horizontal overlap), so
      // grids like cards or stats don't zig-zag; those navigate with Tab
      if (!e.altKey && !e.metaKey && !e.ctrlKey && !e.shiftKey &&
          (e.key === "ArrowUp" || e.key === "ArrowDown")) {
        const up = e.key === "ArrowUp";
        if (caretAtEdge(el, up)) {
          const r = el.getBoundingClientRect();
          const target = $$("[contenteditable]", slides[index])
            .filter(o => o !== el)
            .map(o => ({ o, b: o.getBoundingClientRect() }))
            .filter(({ b }) => b.right > r.left && b.left < r.right &&
              (up ? b.bottom <= r.top + 1 : b.top >= r.bottom - 1))
            .sort((a, b) => up ? b.b.bottom - a.b.bottom : a.b.top - b.b.top)[0]?.o;
          if (target) { e.preventDefault(); placeCaret(target, up); }
        }
        return;
      }

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

      if (e.key === "Enter" && listEl) {
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
        if (listEl) {
          if (listEl.children.length <= 1) return;         // never remove the last li
          e.preventDefault();
          snapshot();
          const prevLi = el.previousElementSibling;
          el.remove();
          markRevealSteps();
          placeCaret(prevLi || listEl.querySelector("li"), true);
          measureOverflow(slides[index]);
          return;
        }
        // any empty leaf deletes — except headlines, which anchor the slide
        if (tag !== "H1" && tag !== "H2" &&
            !["display", "h1", "h2"].some(c => el.classList.contains(c))) {
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
  const ICONS = `<svg width="0" height="0" style="position:absolute" aria-hidden="true" data-runtime><symbol id="i-prev" viewBox="0 0 24 24"><path d="M15 6l-6 6 6 6"/></symbol><symbol id="i-next" viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></symbol><symbol id="i-grid" viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></symbol><symbol id="i-theme" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor" stroke="none"/></symbol><symbol id="i-present" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/></symbol><symbol id="i-pdf" viewBox="0 0 24 24"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M12 11v6M9.5 14.5L12 17l2.5-2.5"/></symbol><symbol id="i-edit" viewBox="0 0 24 24"><path d="M4 20h4l10.5-10.5a2.1 2.1 0 0 0-3-3L5 17z"/><path d="M13 7l3 3"/></symbol><symbol id="i-plus" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></symbol><symbol id="i-dup" viewBox="0 0 24 24"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></symbol><symbol id="i-trash" viewBox="0 0 24 24"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></symbol><symbol id="i-spark" viewBox="0 0 24 24"><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="M19 16l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7z"/></symbol><symbol id="i-undo" viewBox="0 0 24 24"><path d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/></symbol><symbol id="i-save" viewBox="0 0 24 24"><path d="M5 3h11l3 3v15H5z"/><path d="M8 3v6h8V3M8 21v-7h8v7"/></symbol><symbol id="i-check" viewBox="0 0 24 24"><path d="M5 12l5 5L20 7"/></symbol><symbol id="i-help" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 1-1 1.7M12 17h.01"/></symbol><symbol id="i-notes" viewBox="0 0 24 24"><path d="M5 4h14v16H5z"/><path d="M8 9h8M8 13h8M8 17h5"/></symbol><symbol id="i-image" viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="8.5" cy="10" r="1.5"/><path d="M21 16l-5-5-8 8"/></symbol><symbol id="i-warn" viewBox="0 0 24 24"><path d="M12 4l9 16H3z"/><path d="M12 10v4M12 17h.01"/></symbol><symbol id="i-close" viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></symbol><symbol id="i-sliders" viewBox="0 0 24 24"><path d="M4 8h9M17 8h3M4 16h3M11 16h9"/><circle cx="15" cy="8" r="2"/><circle cx="9" cy="16" r="2"/></symbol><symbol id="i-first" viewBox="0 0 24 24"><path d="M17 6l-6 6 6 6"/><path d="M11 6l-6 6 6 6"/></symbol></svg>`;

  const SHORTCUTS = [
    ["→ / space", "Next"], ["←", "Previous"], ["R / Home", "Restart from slide 1"], ["End", "Last slide"],
    ["O", "Overview"], ["E", "Edit mode"], ["S", "Presenter view"], ["T", "Cycle theme"],
    ["P", "Export PDF"], ["D", "Download single file"], ["F", "Fullscreen"], ["?", "This sheet"], ["Esc", "Close / finish editing"],
    ["↑↓←→", "Overview: select slide"], ["Enter", "Overview: open selected slide"],
    ["1…9", "Overview: type a slide number"], [`${KEY.alt}arrows`, "Overview: reorder slide (edit mode)"],
    [`${KEY.cmd}Z`, "Undo"], [`${KEY.cmd}${KEY.shift}Z`, "Redo"], [`${KEY.cmd}D`, "Duplicate slide"], [KEY.del, "Delete selected sticker"],
    ["[ / ]", "Layer selected sticker"], ["Arrows", `Nudge selected sticker / pin (${KEY.shift} = bigger)`],
    ["Tab", "Next text box on the slide"], ["↑ / ↓", "At text edge: jump to text above / below"],
    [`${KEY.cmd}B`, "Emphasise selection (edit mode)"],
    [`${KEY.alt}↑ / ${KEY.alt}↓`, "Move list item up / down"],
    ["Enter", "New list item — or a line break outside a list"],
    [`${KEY.shift}Enter`, "Line break"], ["Backspace", "Delete empty item / element"],
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
          <span class="ov-hint" id="ov-hint"></span>
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

    // the slide counter doubles as the Overview button — clicking "3 / 23"
    // is the natural place to ask for the grid of everything
    const counter = `<button id="btn-ov" class="tb-btn tb-count js-count" data-key="O" data-tip="Overview — see every slide as a grid" aria-label="Overview">${index + 1} / ${slides.length}</button>`;
    const restart = btn({ id: "btn-first", icon: "first", cls: "icon-only", key: "R", tip: "Restart from the first slide" });

    bar.innerHTML = !editing ? `
      ${restart}
      ${btn({ id: "btn-prev", icon: "prev", cls: "icon-only", key: "←", tip: "Previous slide" })}
      ${counter}
      ${btn({ id: "btn-next", icon: "next", cls: "icon-only", key: "→", tip: "Next slide" })}
      <span class="tb-sep"></span>
      ${showTheme ? btn({ id: "btn-theme", icon: "theme", label: "Theme", key: "T", tip: "Switch light/dark theme" }) : ""}
      ${btn({ id: "btn-presenter", icon: "present", label: "Presenter", key: "S", tip: "Open presenter view with speaker notes" })}
      ${btn({ id: "btn-print", icon: "pdf", label: "Export PDF", key: "P", tip: "Print or save the deck as a PDF" })}
      ${btn({ id: "btn-single", icon: "save", label: "Download copy", key: "D", tip: "Download the deck with your changes as one self-contained .html" })}
      <span class="tb-sep"></span>
      ${btn({ id: "btn-edit", icon: "edit", label: "Edit", key: "E", tip: "Switch to edit mode" })}
      ${btn({ id: "btn-help", icon: "help", cls: "icon-only", key: "?", tip: "Keyboard shortcuts" })}
    ` : `
      ${restart}
      ${btn({ id: "btn-prev", icon: "prev", cls: "icon-only", key: "←", tip: "Previous slide" })}
      ${counter}
      ${btn({ id: "btn-next", icon: "next", cls: "icon-only", key: "→", tip: "Next slide" })}
      <span class="tb-sep"></span>
      ${btn({ id: "btn-add", icon: "plus", label: "Add slide", tip: "Insert a new slide after this one" })}
      ${btn({ id: "btn-dup", icon: "dup", cls: "icon-only", key: KEY.cmd + "D", tip: "Duplicate slide" })}
      ${btn({ id: "btn-del", icon: "trash", cls: "icon-only", key: KEY.del, tip: "Delete slide" })}
      <span class="tb-sep"></span>
      ${btn({ id: "btn-opts", icon: "sliders", label: "Options", tip: "Per-slide options — transition, footer, brand extras" })}
      ${btn({ id: "btn-note", icon: "spark", label: "Request change", tip: "Flag this slide for Claude to revise later" })}
      ${btn({ id: "btn-notes", icon: "notes", label: "Speaker notes", tip: "Add notes for presenter view and printed PDFs" })}
      <span class="tb-sep"></span>
      ${btn({ id: "btn-undo", icon: "undo", cls: "icon-only", key: KEY.cmd + "Z", tip: "Undo" })}
      <button id="btn-save" class="tb-btn" data-tip="Save changes to this file" aria-label="Save"><svg class="icon"><use href="#i-save"/></svg><span class="js-save-label">Save</span></button>
      <span class="tb-sep"></span>
      ${btn({ id: "btn-done", icon: "check", label: "Done", cls: "primary", tip: "Exit edit mode" })}
    `;

    $("#btn-first").onclick = () => show(0, true, "fwd");
    $("#btn-prev").onclick = prev;
    $("#btn-next").onclick = next;
    $("#btn-ov").onclick = () => toggleOverview();
    if (!editing) {
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
      $("#btn-opts").onclick = e => openPopover("options", e.currentTarget);
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
    // standalone decks carry their themes as embedded <style data-theme>
    // blocks — cycle by flipping which one's `media` matches
    const embedded = $$("style[data-theme]");
    if (embedded.length > 1) {
      const names = embedded.map(s => s.dataset.theme);
      const cur = embedded.find(s => s.media !== "not all")?.dataset.theme;
      const nextTheme = names[(names.indexOf(cur) + 1) % names.length];
      embedded.forEach(s => s.media = s.dataset.theme === nextTheme ? "" : "not all");
      readDeckPad(); fit();
      toast(`Theme: ${nextTheme}`);
      if (overviewOpen) buildOverview();
      return;
    }
    const link = $("#theme");
    if (!link) return toast("This deck has one theme.");
    if (THEMES.length < 2) return toast("This deck has one theme.");
    const cur = link.getAttribute("href").match(/([^/]+)\.css$/)?.[1];
    const nextTheme = THEMES[(THEMES.indexOf(cur) + 1) % THEMES.length];
    link.setAttribute("href", `themes/${nextTheme}.css`);
    // the new theme may declare a different --deck-pad — refit once it loads
    link.addEventListener("load", () => { readDeckPad(); fit(); }, { once: true });
    toast(`Theme: ${nextTheme}`);
    if (overviewOpen) buildOverview();
  }

  /* -------------------------------------------------------------- popovers */
  let popAnchor = null;   // the element that opened the current popover — its own
                          // clicks toggle, so the outside-click closer ignores them
  function closePopover() { $("#pop-layer").innerHTML = ""; popAnchor = null; }

  // clicking the opening button again closes; renderPopover bypasses the
  // toggle so option clicks can re-render in place
  function openPopover(kind, anchor) {
    if ($(kind === "note" ? "#note-pop" : "#opts-pop")) return closePopover();
    renderPopover(kind, anchor);
  }

  function renderPopover(kind, anchor) {
    closePicker();
    popAnchor = anchor || null;
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
    if (kind === "options") {
      // one row per declared slide option that can be picked from a list —
      // enum options as a segmented control (plus Default = attribute unset),
      // flags as Off/On. Brand extensions land here automatically.
      // an option's `when` (selector string or predicate) gates it to slides
      // where it actually does something — irrelevant rows never render
      const relevant = o => !o.when || (typeof o.when === "function" ? !!o.when(cur) : cur.matches(o.when));
      const editable = [...OPTIONS.values()].filter(o => o.on === "slide" && !o.derived && (o.values || o.type === "flag") && relevant(o));
      const row = o => {
        const curV = cur.getAttribute(o.name);
        const seg = o.type === "flag"
          ? [["", "Off"], ["on", "On"]].map(([v, lab]) =>
              `<button class="opt${(curV !== null) === (v === "on") ? " is-on" : ""}" data-name="${o.name}" data-v="${v}">${lab}</button>`).join("")
          : [["", "Default"], ...o.values.map(v => [v, v])].map(([v, lab]) =>
              `<button class="opt${(curV ?? "") === v ? " is-on" : ""}" data-name="${o.name}" data-v="${escapeHtml(v)}">${escapeHtml(lab)}</button>`).join("");
        return `<div class="opt-row"><span class="opt-row__label"${o.hint ? ` data-tip="${escapeHtml(o.hint)}"` : ""}>${escapeHtml(o.label || o.name)}</span><span class="opt-row__seg">${seg}</span></div>`;
      };
      layer.innerHTML = `
        <div class="pop" id="opts-pop">
          <h4>Slide options</h4>
          <p class="pop__sub">Saved on the slide's markup. Slide ${index + 1} of ${slides.length}.</p>
          <div class="opt-rows">${editable.map(row).join("")}</div>
        </div>`;
      positionPopover($("#opts-pop"), anchor);
      $$(".opt", layer).forEach(b => b.onclick = () => {
        const { name, v } = b.dataset;
        const def = OPTIONS.get(name);
        // resolve the slide at click time — `cur` may be detached if the deck
        // was rebuilt (⌘D, ⌫) while the popover stayed open
        const s = slides[index];
        // "" sets a valueless attribute (flag on), null removes it
        const next = def.type === "flag" ? (v === "on" ? "" : null) : (v || null);
        if (s.getAttribute(name) === next) return;   // no-op click: don't snapshot/autosave
        snapshot();
        if (next === null) s.removeAttribute(name); else s.setAttribute(name, next);
        def.onchange?.(s);                         // option-specific side effects (e.g. re-marking reveal steps)
        renderPopover("options", anchor);          // re-render with the new state
      });
    }
  }
  // PDF export: pages are 16:9 by @page rule in Chromium; Safari ignores
  // @page size and prints on the dialog's paper, so it always gets the
  // popover with steps for a custom 16:9 paper size. When the deck carries
  // speaker notes, also offer slides-only vs with-notes.
  const isSafari = /apple/i.test(navigator.vendor || "");
  function exportPDF(anchor) {
    if ($("#pdf-pop")) return closePopover();      // second click toggles
    const hasNotes = !!$(".notes", deck);
    if (!hasNotes && !isSafari) return print();
    closePicker();
    popAnchor = anchor || null;
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
    // centre on the anchor, clamped so the popover stays on-screen (it is
    // translateX(-50%)-centred, so clamp the centre point by half its width)
    const half = el.offsetWidth / 2;
    const x = Math.min(Math.max(r ? r.left + r.width / 2 : innerWidth / 2, half + 16), innerWidth - half - 16);
    el.style.left = x + "px";
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
    if ($("#add-pop")) return closePopover();      // second click toggles
    closePopover();
    popAnchor = anchor || null;
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
    const prev = !aside ? "" : [...aside.children].length
      ? [...aside.children].map(p => p.textContent).join("\n\n")
      : aside.textContent.trim();
    if (text === prev) return;
    if (!text) { aside.remove(); markDirty(); return; }
    if (!aside) { aside = document.createElement("aside"); aside.className = "notes"; slides[index].append(aside); }
    aside.innerHTML = "";
    text.split(/\n{2,}/).forEach(par => {
      const p = document.createElement("p");
      p.textContent = par.trim();
      aside.append(p);
    });
    // the drawer lives outside the deck, so the deck's input listener never
    // sees these edits — without this, typed notes don't autosave and the
    // beforeunload guard stays silent
    markDirty();
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
        else { el.textContent = src; el._countRaf = null; }
      };
      el._countRaf = requestAnimationFrame(tick);
    });
  }
  // an in-flight count-up keeps ticking after edit mode opens and would
  // overwrite (or snapshot over) a user edit — settle it to the pristine text
  function settleCounts() {
    $$('[data-animate="count"]', deck).forEach(el => {
      if (!el._countRaf) return;
      cancelAnimationFrame(el._countRaf);
      el._countRaf = null;
      el.textContent = countOriginal.get(el) ?? el.textContent;
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
    const win = window.open(url, "slaydy-presenter", "width=1100,height=700");
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
    const chan = new BroadcastChannel("slaydy:" + location.pathname);
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
    mainChan = new BroadcastChannel("slaydy:" + location.pathname);
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
    addEventListener("resize", () => ovCols = 0);   // auto-fill grid may reflow
    addEventListener("resize", debounce(measureAll, 150));
    addEventListener("fullscreenchange", fit);

    // clicking outside an open popover dismisses it. The anchor that opened
    // it is exempt — its own click handler toggles, and closing here first
    // would make that click reopen instead
    document.addEventListener("pointerdown", e => {
      if (!$("#pop-layer").innerHTML) return;
      if (e.target.closest("#pop-layer")) return;
      if (popAnchor && popAnchor.contains(e.target)) return;
      closePopover();
    });

    // overflow guard: re-measure the current slide as its content changes,
    // and any slide once its images finish loading
    deck.addEventListener("input", debounce(() => measureOverflow(slides[index]), 250));
    deck.addEventListener("load", e => {
      if (e.target.tagName === "IMG") measureOverflow(e.target.closest(".slide"));
    }, true);

    addEventListener("keydown", e => {
      const typing = e.target.isContentEditable ||
        /^(INPUT|TEXTAREA)$/.test(e.target.tagName);
      // focus inside a custom widget: the keyboard is its own, so a game or
      // a chart that reads arrow keys isn't fighting slide navigation.
      // Escape is handled above this and still gets the user back out.
      const widget = !typing && inCustom(e.target);
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
      if (typing || widget) {
        if (e.key === "Escape") e.target.blur();
        return;
      }
      if (overviewOpen && overviewKeydown(e)) { e.preventDefault(); return; }
      if (editing && !meta && (selectedSticker || selectedPin) &&
          /^Arrow(Left|Right|Up|Down)$/.test(e.key)) {
        e.preventDefault();
        nudgeSelected(e.key, e.shiftKey);
        return;
      }
      switch (e.key.toLowerCase()) {
        case "arrowright": case " ": case "pagedown": e.preventDefault(); advance(); break;
        case "arrowleft": case "pageup": e.preventDefault(); retreat(); break;
        case "home": case "r": show(0, true, "fwd"); break;
        case "end": show(slides.length - 1, true, "fwd"); break;
        case "o": toggleOverview(); break;
        // preventDefault matters: entering edit mode makes text editable
        // synchronously, and without it the same keystroke's default text
        // insertion can land an "e" wherever a caret was left behind
        case "e": e.preventDefault(); toggleEdit(); break;
        case "t": cycleTheme(); break;
        case "p": e.preventDefault(); exportPDF($("#btn-print")); break;
        case "d": if (!meta) downloadStandalone(); break;
        case "s": openPresenter(); break;
        case "f": document.fullscreenElement ? document.exitFullscreen()
          : document.documentElement.requestFullscreen(); break;
        case "?": toggleShortcuts(); break;
        case "tab":
          // nothing focused yet — Tab dives into the slide's first text box
          // (once inside, the deck handler cycles box to box)
          if (editing && !overviewOpen) {
            e.preventDefault();
            placeCaret($("[contenteditable]", slides[index]), true);
          }
          break;
        case "backspace": case "delete":
          if (!editing) break;
          if (selectedSticker) { snapshot(); selectedSticker.remove(); selectSticker(null); }
          else if (selectedPin) { deletePin(selectedPin); selectPin(null); }
          break;
        case "[": case "]": {
          // layer the selected sticker: stickers share z-index 4, so DOM
          // order among .sticker siblings is the stacking order — and it
          // serializes for free
          if (!editing || !selectedSticker) break;
          const sib = e.key === "]" ? selectedSticker.nextElementSibling : selectedSticker.previousElementSibling;
          if (!sib?.classList.contains("sticker")) break;
          snapshot();
          e.key === "]" ? sib.after(selectedSticker) : sib.before(selectedSticker);
          break;
        }
      }
    });

    // click-through navigation (view mode only)
    deck.addEventListener("click", e => {
      if (editing || overviewOpen) return;
      // a click inside a custom widget is the widget's — advancing the deck
      // out from under someone using an interactive slide is never right.
      // The rest of the slide still advances, as do the arrow keys.
      if (inCustom(e.target)) return;
      const r = deck.getBoundingClientRect();
      (e.clientX - r.left) / r.width > 0.35 ? next() : prev();
    });

    // image slots. On a callout media that already has an image, plain clicks
    // belong to pins — replacing the image goes through the hover overlay's
    // button, and double-click adds a pin.
    deck.addEventListener("click", e => {
      const slot = e.target.closest(".media");
      if (!editing || !slot || inCustom(e.target)) return;
      if (e.target.closest(".pin")) return;
      if (e.target.closest(".media-hover__crop")) { e.stopPropagation(); toggleCrop(slot); return; }
      if (slot.classList.contains("callout__media") && $("img", slot) && !e.target.closest(".media-hover")) return;
      e.stopPropagation();
      lastSlot = slot;
      pickFile(slot);
    }, true);

    // double-click a callout image to drop a pin there (+ its note)
    deck.addEventListener("dblclick", e => {
      if (!editing) return;
      const fig = e.target.closest(".callout__media");
      if (!fig || inCustom(e.target)) return;
      if (!$("img", fig) || e.target.closest(".pin,.media-hover")) return;
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
    validateOptions();
    // programmatic access for tooling, tests and brand extensions:
    // options   — per-slide option registry (declare / get / all); declared
    //             derived options are stripped on save, declared values get
    //             boot validation and a Slide-options control for free
    // transient — the derived-attribute set behind it (add() still works)
    // snapshot  — push the current deck state onto the undo stack (call
    //             BEFORE mutating, so ⌘Z lands on the extension's edit)
    // toast     — the runtime's own transient message UI
    window.slaydy = {
      serialize, snapshot, toast, transient: TRANSIENT,
      options: { declare: declareOption, get: n => OPTIONS.get(n), all: () => [...OPTIONS.values()] },
    };
    measureAll();
    document.fonts?.ready?.then(measureAll);
    initMainChannel();
  }
})();
