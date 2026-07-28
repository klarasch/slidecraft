/* =========================================================================
   slidecraft — runtime.js
   Fixed asset. Ships with the skill. Never regenerated per-deck.

   Responsibilities:
     · fit a fixed 1280×720 canvas to any viewport
     · keyboard / click navigation + hash routing
     · overview (table of contents)
     · edit mode: contenteditable text, image slots, pasted stickers, notes
     · save: writes deck.html + images/ back to the folder via the File System
       Access API (no base64), falling back to an inlined standalone download
     · print → PDF
   ========================================================================= */
(() => {
  "use strict";

  const W = 1280, H = 720;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];

  const deck = $(".deck");
  if (!deck) return console.warn("[slidecraft] no .deck found");
  let slides = $$(".slide", deck);
  let index = 0;
  let editing = false;
  let overviewOpen = false;
  let dirHandle = null;
  const pending = new Map();          // "images/x.png" -> Blob
  let lastSlot = null;                // last clicked image slot
  let selectedSticker = null;

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
      chrome.innerHTML =
        `<span>${escapeHtml(document.body.dataset.deckLabel || document.title)}</span>` +
        `<span>${String(i + 1).padStart(2, "0")}</span>`;
      $$(".media", s).forEach(m => {
        if (!$("img", m)) m.dataset.empty = "";
        else delete m.dataset.empty;
      });
    });
  }

  function fit() {
    const pad = overviewOpen ? 1 : 0.94;
    const scale = Math.min(innerWidth / W, innerHeight / H) * pad;
    document.documentElement.style.setProperty("--scale", scale.toFixed(4));
  }

  /* ----------------------------------------------------------- navigation */
  function show(i, push = true) {
    index = Math.max(0, Math.min(slides.length - 1, i));
    slides.forEach((s, n) => s.classList.toggle("is-active", n === index));
    $("#bar-fill").style.width = ((index + 1) / slides.length) * 100 + "%";
    $("#count").textContent = `${index + 1} / ${slides.length}`;
    if (push) history.replaceState(null, "", "#" + (index + 1));
    if (editing) enableEditing();
  }
  const next = () => show(index + 1);
  const prev = () => show(index - 1);

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
    ".stat__num", ".chip", ".index", ".num", ".t", ".n"
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
    $("#btn-edit").classList.toggle("is-on", editing);
    $$(".edit-only").forEach(b => b.style.display = editing ? "" : "none");
    editing ? enableEditing() : disableEditing();
    toast(editing
      ? "Edit mode — click any text. Click an image slot to swap. ⌘V pastes an image you can drag."
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
    const rel = fileName(file);
    pending.set(rel, file);
    const url = URL.createObjectURL(file);
    let img = $("img", slot);
    if (!img) { img = document.createElement("img"); img.alt = ""; slot.append(img); }
    img.src = url;
    img.dataset.src = rel;               // relative path used when saving
    delete slot.dataset.empty;
  }

  function addSticker(file) {
    const rel = fileName(file);
    pending.set(rel, file);
    const img = document.createElement("img");
    img.className = "sticker";
    img.src = URL.createObjectURL(file);
    img.dataset.src = rel;
    img.style.cssText = "left:40%;top:32%;width:34%";
    slides[index].append(img);
    selectSticker(img);
    toast("Drag to move · scroll to resize · ⌫ to delete");
  }

  function selectSticker(el) {
    $$(".sticker.is-sel", deck).forEach(s => s.classList.remove("is-sel"));
    selectedSticker = el;
    el?.classList.add("is-sel");
  }

  function initStickerDrag() {
    deck.addEventListener("pointerdown", e => {
      const el = e.target.closest(".sticker");
      if (!editing || !el) { if (editing) selectSticker(null); return; }
      e.preventDefault();
      selectSticker(el);
      const slide = el.parentElement;
      const box = slide.getBoundingClientRect();
      const s = box.width / W;                      // account for canvas scale
      const start = { x: e.clientX, y: e.clientY, l: parseFloat(el.style.left), t: parseFloat(el.style.top) };
      const move = ev => {
        el.style.left = (start.l + ((ev.clientX - start.x) / s / W) * 100).toFixed(2) + "%";
        el.style.top = (start.t + ((ev.clientY - start.y) / s / H) * 100).toFixed(2) + "%";
      };
      const up = () => { removeEventListener("pointermove", move); removeEventListener("pointerup", up); };
      addEventListener("pointermove", move);
      addEventListener("pointerup", up);
    });

    deck.addEventListener("wheel", e => {
      if (!editing || !selectedSticker) return;
      e.preventDefault();
      const w = parseFloat(selectedSticker.style.width) || 30;
      selectedSticker.style.width = Math.max(4, Math.min(100, w - e.deltaY * 0.05)).toFixed(1) + "%";
    }, { passive: false });
  }

  function pickFile(slot) {
    const inp = document.createElement("input");
    inp.type = "file";
    inp.accept = "image/*";
    inp.onchange = () => inp.files[0] && attachImage(inp.files[0], slot);
    inp.click();
  }

  /* --------------------------------------------------------- serialization */
  async function serialize({ inline }) {
    let inlined = new Map();
    if (inline) {
      for (const [rel, blob] of pending) inlined.set(rel, await toDataURL(blob));
    }
    const root = document.documentElement.cloneNode(true);
    root.querySelectorAll("[data-runtime],[data-gen]").forEach(n => n.remove());
    root.querySelectorAll(".slide").forEach(s => s.classList.remove("is-active"));
    root.querySelectorAll("[contenteditable]").forEach(n => {
      n.removeAttribute("contenteditable"); n.removeAttribute("spellcheck");
    });
    root.querySelectorAll(".sticker").forEach(n => n.classList.remove("is-sel"));
    root.querySelectorAll("img[data-src]").forEach(img => {
      const rel = img.dataset.src;
      img.setAttribute("src", inline && inlined.has(rel) ? inlined.get(rel) : rel);
      if (!inline) img.removeAttribute("data-src");
      else img.removeAttribute("data-src");
    });
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
    if (window.showDirectoryPicker) {
      try {
        if (!dirHandle) {
          dirHandle = await showDirectoryPicker({ mode: "readwrite", id: "slidecraft" });
        }
        if (pending.size) {
          const imgs = await dirHandle.getDirectoryHandle("images", { create: true });
          for (const [rel, blob] of pending) {
            const fh = await imgs.getFileHandle(rel.replace("images/", ""), { create: true });
            const w = await fh.createWritable();
            await w.write(blob);
            await w.close();
          }
        }
        const name = (location.pathname.split("/").pop() || "deck.html");
        const fh = await dirHandle.getFileHandle(name, { create: true });
        const w = await fh.createWritable();
        await w.write(await serialize({ inline: false }));
        await w.close();
        pending.clear();
        return toast(`Saved ${name} + ${"images/"} into the deck folder. No base64, images stay as files.`);
      } catch (err) {
        if (err.name === "AbortError") return;
        console.warn(err);
        toast("Folder write unavailable — falling back to a standalone download.");
      }
    }
    const blob = new Blob([await serialize({ inline: true })], { type: "text/html" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "deck-edited.html";
    a.click();
    toast("Downloaded a standalone copy (images inlined as base64).");
  }

  /* ------------------------------------------------------------ slide ops */
  function duplicateSlide() {
    const clone = slides[index].cloneNode(true);
    clone.removeAttribute("data-note");
    slides[index].after(clone);
    decorate(); slides = $$(".slide", deck); show(index + 1);
  }
  function deleteSlide() {
    if (slides.length < 2) return toast("Can't delete the last slide.");
    slides[index].remove();
    slides = $$(".slide", deck); decorate();
    show(Math.min(index, slides.length - 1));
  }
  function addNote() {
    const cur = slides[index].dataset.note || "";
    const v = prompt("Note for the next Claude pass on this slide:", cur);
    if (v === null) return;
    v.trim() ? slides[index].dataset.note = v.trim() : delete slides[index].dataset.note;
  }

  /* ---------------------------------------------------------------- chrome */
  function mountChrome() {
    document.body.insertAdjacentHTML("beforeend", `
      <div class="bar" data-runtime><div class="bar__fill" id="bar-fill"></div></div>
      <div class="toolbar" id="toolbar" data-runtime>
        <button id="btn-prev" title="Previous (←)">‹</button>
        <span class="count" id="count">1 / 1</span>
        <button id="btn-next" title="Next (→)">›</button>
        <span class="sep"></span>
        <button id="btn-ov" title="Overview (O)">overview</button>
        <button id="btn-theme" title="Cycle theme (T)">theme</button>
        <button id="btn-print" title="Print → PDF (P)">pdf</button>
        <span class="sep"></span>
        <button id="btn-edit" title="Edit mode (E)">edit</button>
        <button id="btn-note" class="edit-only" style="display:none">note</button>
        <button id="btn-dup" class="edit-only" style="display:none">dup</button>
        <button id="btn-del" class="edit-only" style="display:none">del</button>
        <button id="btn-save" class="edit-only" style="display:none">save</button>
      </div>
      <div class="hint" data-runtime>← → navigate · O overview · E edit · P pdf</div>
      <div class="toast" id="toast" data-runtime></div>
      <div class="overview" data-runtime>
        <div class="overview__head">
          <h2>${escapeHtml(document.title)}</h2>
          <span id="ov-count"></span>
        </div>
        <div class="overview__grid" id="ov-grid"></div>
      </div>
    `);

    $("#btn-prev").onclick = prev;
    $("#btn-next").onclick = next;
    $("#btn-ov").onclick = () => toggleOverview();
    $("#btn-edit").onclick = () => toggleEdit();
    $("#btn-print").onclick = () => print();
    $("#btn-save").onclick = save;
    $("#btn-note").onclick = addNote;
    $("#btn-dup").onclick = duplicateSlide;
    $("#btn-del").onclick = deleteSlide;
    $("#btn-theme").onclick = cycleTheme;
  }

  let toastTimer;
  function toast(msg) {
    const t = $("#toast");
    t.textContent = msg;
    t.classList.add("is-shown");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove("is-shown"), 3600);
  }

  const THEMES = ["midnight", "paper", "mint"];
  function cycleTheme() {
    const link = $("#theme");
    if (!link) return;
    const cur = link.getAttribute("href").match(/([^/]+)\.css$/)?.[1];
    const nextTheme = THEMES[(THEMES.indexOf(cur) + 1) % THEMES.length];
    link.setAttribute("href", `themes/${nextTheme}.css`);
    toast(`Theme: ${nextTheme}`);
    if (overviewOpen) buildOverview();
  }

  const escapeHtml = s => String(s).replace(/[&<>"]/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  /* --------------------------------------------------------------- events */
  function bind() {
    addEventListener("resize", fit);

    addEventListener("keydown", e => {
      const typing = e.target.isContentEditable ||
        /^(INPUT|TEXTAREA)$/.test(e.target.tagName);
      if (e.key === "Escape") {
        if (overviewOpen) return toggleOverview(false);
        if (editing) return toggleEdit(false);
      }
      if (typing) {
        if (e.key === "Escape") e.target.blur();
        return;
      }
      switch (e.key.toLowerCase()) {
        case "arrowright": case " ": case "pagedown": e.preventDefault(); next(); break;
        case "arrowleft": case "pageup": e.preventDefault(); prev(); break;
        case "home": show(0); break;
        case "end": show(slides.length - 1); break;
        case "o": toggleOverview(); break;
        case "e": toggleEdit(); break;
        case "t": cycleTheme(); break;
        case "p": e.preventDefault(); print(); break;
        case "f": document.fullscreenElement ? document.exitFullscreen()
          : document.documentElement.requestFullscreen(); break;
        case "backspace": case "delete":
          if (editing && selectedSticker) { selectedSticker.remove(); selectSticker(null); }
          break;
      }
    });

    // click-through navigation (view mode only)
    deck.addEventListener("click", e => {
      if (editing || overviewOpen) return;
      const r = deck.getBoundingClientRect();
      (e.clientX - r.left) / r.width > 0.35 ? next() : prev();
    });

    // image slots
    deck.addEventListener("click", e => {
      const slot = e.target.closest(".media");
      if (!editing || !slot) return;
      e.stopPropagation();
      lastSlot = slot;
      pickFile(slot);
    }, true);

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

    // reveal toolbar near the bottom of the screen
    addEventListener("mousemove", e => {
      $("#toolbar").classList.toggle("is-shown", e.clientY > innerHeight - 110);
    });

    addEventListener("beforeprint", () => toggleOverview(false));
  }

  /* ----------------------------------------------------------------- boot */
  decorate();
  mountChrome();
  bind();
  initStickerDrag();
  fit();
  show(Math.max(0, (parseInt(location.hash.slice(1), 10) || 1) - 1), false);
  document.body.classList.add("is-ready");
})();
