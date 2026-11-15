/* Practice Pad — app logic. All state lives on this device (localStorage). */
(function () {
  "use strict";
  const NAMES = ["Yellow", "Green", "Blue", "Purple"];
  const NUM = ["no", "one", "two", "three", "four"];
  // Original sample puzzle (not from the NYT). Red herrings: BASS, CARP, SOLE.
  const SAMPLE = ["PIKE", "AIR", "HEEL", "CARP", "STEEL", "PERCH", "GRIPE", "LACE", "BASS", "MOAN", "TONGUE", "LEAD", "TROUT", "SOLE", "BEEF", "ELECTRIC"];
  const KEY = "practice-pad-v2";      // { tabs:[{id,made,s,draft}], active, seq }
  const OLD_KEY = "practice-pad-v1";  // one board, before tabs (1.1.x); migrated into the first tab
  const VERSION = window.PP_VERSION || "dev";

  const $ = s => document.querySelector(s);
  const app = $("#app");
  // S, draft and hist always belong to the active tab. sync() copies them back into the tab object;
  // use() loads another tab's. Undo history stays in memory per tab, as before.
  let S, hist = [], draft = null, pasteText = "";
  let tabs = [], active = 0, seq = 0, closed = null;

  /* ---------- state ---------- */
  function blank() {
    return { screen: "start", words: [], order: [], groups: 4, locked: [false, false, false, false], labels: ["", "", "", ""],
      cur: 0, erase: false, mode: "sure", arrange: false, date: "" };
  }
  function fresh(words, date) {
    const s = blank();
    s.screen = "board"; s.groups = words.length / 4; s.date = date || "";
    s.words = words.map((t, i) => ({ id: i, t, c: null, m: [] }));
    s.order = words.map((_, i) => i);
    return s;
  }
  function newTab(s) { seq++; return { id: seq, made: seq, s: s || blank(), draft: null, hist: [] }; }
  // Rebuild one saved tab, fixing anything a reload interrupted.
  function revive(t) {
    if (!t || !t.s || !Array.isArray(t.s.words)) return null;
    t.s.words.forEach(w => { if (!Array.isArray(w.m)) w.m = []; });
    const s = Object.assign(blank(), t.s);
    const d = t.draft && Array.isArray(t.draft.words) ? { words: t.draft.words, shot: null, date: t.draft.date || "", dateFrom: t.draft.dateFrom || "" } : null;
    if (s.screen === "reading") s.screen = d ? "confirm" : "start";
    if (s.screen === "confirm" && !d) s.screen = "start";
    if (s.screen === "board" && !s.words.length) s.screen = "start";
    return { id: t.id, made: t.made || t.id, s, draft: d, hist: [] };
  }
  function load() {
    try {
      const v = JSON.parse(localStorage.getItem(KEY) || "null");
      if (v && Array.isArray(v.tabs)) {
        tabs = v.tabs.map(revive).filter(Boolean);
        seq = Math.max(v.seq || 0, ...tabs.map(t => t.id), 0);
        active = v.active;
      } else {
        const old = JSON.parse(localStorage.getItem(OLD_KEY) || "null");
        const t = old && revive({ id: 1, made: 1, s: old.s, draft: old.draft });
        if (t) { tabs = [t]; seq = 1; active = 1; }
      }
    } catch (e) { tabs = []; /* storage unavailable or corrupt */ }
    if (!tabs.length) { tabs = [newTab()]; active = tabs[0].id; }
    if (!tabs.some(t => t.id === active)) active = sorted()[0].id;
    use(tab());
  }
  const tab = () => tabs.find(t => t.id === active);
  function sync() { const t = tab(); if (t) { t.s = S; t.draft = draft; t.hist = hist; } }
  function use(t) { active = t.id; S = t.s; draft = t.draft; hist = t.hist || []; }
  function save() {
    sync();
    const out = tabs.map(t => ({ id: t.id, made: t.made, s: t.s,
      draft: t.draft ? { words: t.draft.words, date: t.draft.date, dateFrom: t.draft.dateFrom } : null }));
    try { localStorage.setItem(KEY, JSON.stringify({ tabs: out, active, seq })); } catch (e) { /* ignore */ }
  }

  /* ---------- tabs ---------- */
  // Order: tabs without a board yet (new) first, then boards by puzzle date, newest on the left.
  // Boards with no date sit with the new ones. Fixed order: tapping a tab never moves it.
  const tabDate = t => t.s.screen === "board" ? t.s.date || "" : "";
  function sorted() {
    return tabs.slice().sort((a, b) => {
      const da = tabDate(a), db = tabDate(b);
      if (!da !== !db) return da ? 1 : -1;
      if (da !== db) return da < db ? 1 : -1;
      return b.made - a.made;
    });
  }
  const isEmpty = t => (t.s.screen === "start" || t.s.screen === "paste") && !t.draft;
  // Another open board with this puzzle date, if any.
  const sameDate = (date, exceptId) => date ? tabs.find(t => t.id !== exceptId && t.s.screen === "board" && t.s.date === date) : null;
  function switchTo(id) {
    if (id === active) return;
    sync(); use(tabs.find(t => t.id === id)); pasteText = ""; save(); render();
  }
  // A fresh tab at the left. Reuses an empty one rather than piling up "New" tabs.
  function openNew() {
    sync();
    const empty = tabs.find(isEmpty);
    if (empty) { use(empty); empty.s.screen = "start"; }
    else { const t = newTab(); tabs.push(t); use(t); }
    pasteText = ""; save(); render();
  }
  function closeTab(id) {
    sync();
    const order = sorted(), i = order.findIndex(t => t.id === id), gone = order[i];
    tabs = tabs.filter(t => t.id !== id);
    let filler = null;
    if (!tabs.length) { filler = newTab(); tabs.push(filler); }
    const rest = sorted();
    use(rest[Math.min(i, rest.length - 1)]);
    closed = { tab: gone, filler };
    save(); render();
    toast(`${tabName(gone)} closed`, { label: "Undo", ms: 5000, fn: () => {
      if (!closed || closed.tab !== gone) return;
      sync();
      if (closed.filler && isEmpty(closed.filler)) tabs = tabs.filter(t => t !== closed.filler);
      tabs.push(gone); use(gone); closed = null; save(); render();
    } });
  }
  function tabName(t) {
    if (t.s.screen === "board") return t.s.date ? shortDate(t.s.date) : t.s.sample ? "Sample" : "Board";
    return t.s.screen === "reading" ? "Reading…" : "New";
  }
  function shortDate(iso) {
    const d = parseIso(iso);
    if (!d) return "";
    const s = d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
    return d.getFullYear() === new Date().getFullYear() ? s : `${s} ’${String(d.getFullYear()).slice(2)}`;
  }
  function rTabs() {
    sync();
    const bar = $("#tabs");
    bar.innerHTML = `<button class="newtab" id="plus" aria-label="New puzzle" title="New puzzle">+</button>` + sorted().map(t => {
      const on = t.id === active, s = t.s;
      const dots = s.screen === "board" ? `<span class="tdots" aria-hidden="true">${[0, 1, 2, 3].slice(0, s.groups).map(c => `<i ${s.locked[c] ? `data-c="${c}"` : ""}></i>`).join("")}</span>` : "";
      const wk = s.screen === "board" && s.date ? `<span class="wk">${esc(parseIso(s.date).toLocaleDateString(undefined, { weekday: "short" }))}</span>` : "";
      const name = esc(tabName(t));
      return `<div class="tab ${s.screen === "board" ? "" : "fresh"}" data-on="${on}">
        <button class="tabbtn" role="tab" aria-selected="${on}" data-tab="${t.id}">${dots}<span class="tname">${name}</span>${wk}</button>
        ${on ? `<button class="tclose" data-close="${t.id}" aria-label="Close ${name}" title="Close">×</button>` : ""}</div>`;
    }).join("");
    $("#plus").onclick = openNew;
    bar.querySelectorAll("[data-tab]").forEach(b => b.onclick = () => switchTo(+b.dataset.tab));
    bar.querySelectorAll("[data-close]").forEach(b => b.onclick = () => closeTab(+b.dataset.close));
    const on = bar.querySelector('.tab[data-on="true"]');
    if (on && on.scrollIntoView) on.scrollIntoView({ block: "nearest", inline: "nearest" });
  }

  const snap = () => JSON.stringify(S);
  function pushHist(s) { hist.push(s); if (hist.length > 150) hist.shift(); }
  function commit(fn) { pushHist(snap()); fn(); save(); render(); }
  function go(screen) { S.screen = screen; save(); render(); }

  // A short message. With act = { label, fn, ms }, it also carries a button (used for Undo after closing a tab).
  function toast(m, act) {
    const t = $("#toast"); t.textContent = m; t.classList.toggle("act", !!act);
    if (act) {
      const b = document.createElement("button"); b.textContent = act.label; b.id = "toastAct";
      b.onclick = () => { t.classList.remove("show", "act"); act.fn(); };
      t.appendChild(b);
    }
    t.classList.add("show");
    clearTimeout(toast.h); toast.h = setTimeout(() => t.classList.remove("show", "act"), act ? act.ms || 5000 : 2000);
  }
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const G = () => [0, 1, 2, 3].slice(0, S.groups);
  const count = c => S.words.filter(w => w.c === c).length;
  const dots = '<span class="dots" aria-hidden="true"><i style="background:var(--g0)"></i><i style="background:var(--g1)"></i><i style="background:var(--g2)"></i><i style="background:var(--g3)"></i></span>';
  /* ---------- puzzle date ---------- */
  const pad2 = n => String(n).padStart(2, "0");
  const isoLocal = d => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  const today = () => isoLocal(new Date());
  function parseIso(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || "");
    return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
  }
  function niceDate(iso) {
    const d = parseIso(iso);
    return d ? d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }) : "";
  }
  // Best guess at the day a screenshot was taken: a date in the file name (Android names screenshots
  // Screenshot_YYYYMMDD_...), else the file's modified date, else today. Always editable on Check words.
  function guessDate(name, lastModified) {
    const m = /(20\d{2})[-_.]?(0[1-9]|1[0-2])[-_.]?(0[1-9]|[12]\d|3[01])/.exec(name || "");
    if (m) return { date: `${m[1]}-${m[2]}-${m[3]}`, from: "file name" };
    if (lastModified && lastModified > 1e12 && lastModified <= Date.now() + 864e5) return { date: isoLocal(new Date(lastModified)), from: "file date" };
    return { date: today(), from: "today" };
  }
  const dateField = (id, value) => `<label class="datefield" for="${id}"><span>Puzzle date</span><input type="date" id="${id}" value="${esc(value || "")}" max="${today()}"></label>`;

  const top = (title, back) => `<div class="top">${dots}<h1>${esc(title)}</h1>${back ? `<button class="iconbtn" id="back">Back</button>` : ""}</div>`;

  /* ---------- render ---------- */
  function render() {
    rTabs();
    ({ start: rStart, paste: rPaste, reading: rReading, confirm: rConfirm, board: rBoard })[S.screen](app);
  }

  function rStart() {
    app.innerHTML = `${top("Practice Pad")}
    <p class="hint">Bring in today's 16 words, sort them into four groups here, then go play your answers in Connections.</p>
    <div class="choices">
      <button class="choice primary" id="cShot"><svg viewBox="0 0 40 40" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="7" y="5" width="26" height="30" rx="3"/><rect x="11" y="12" width="7" height="5" rx="1"/><rect x="22" y="12" width="7" height="5" rx="1"/><rect x="11" y="21" width="7" height="5" rx="1"/><rect x="22" y="21" width="7" height="5" rx="1"/></svg>
        <div><strong>Load screenshot</strong><span>Pick your Connections screenshot from Gallery or Photos. The app reads the words.</span></div></button>
      <button class="choice" id="cPaste"><svg viewBox="0 0 40 40" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="9" y="8" width="22" height="27" rx="3"/><rect x="15" y="5" width="10" height="6" rx="2"/><path d="M14 19h12M14 24h12M14 29h7"/></svg>
        <div><strong>Paste words</strong><span>Copied text from "Extract text" or Live Text.</span></div></button>
      <button class="choice" id="cSample"><svg viewBox="0 0 40 40" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="20" cy="20" r="13"/><path d="M17 14l9 6-9 6z"/></svg>
        <div><strong>Try a sample puzzle</strong><span>Practice the controls with made-up words.</span></div></button>
    </div>
    <p class="foot">Version ${esc(VERSION)} · Works offline · To update, close and reopen the app.</p>`;
    $("#cShot").onclick = () => $("#fileIn").click();
    $("#cPaste").onclick = () => go("paste");
    $("#cSample").onclick = () => { hist = []; S = fresh(SAMPLE.slice()); S.sample = true; save(); render(); };
  }

  function rPaste() {
    app.innerHTML = `${top("Paste words", true)}
    <p class="hint">One word per line works best. Commas also work.</p>
    <label class="sr" for="pasteBox">Words</label>
    <textarea id="pasteBox" placeholder="PIKE&#10;AIR&#10;HEEL&#10;…" autocapitalize="characters" spellcheck="false">${esc(pasteText)}</textarea>
    <div class="row"><button class="btn solid" id="split">Check words</button></div>`;
    $("#back").onclick = () => go("start");
    $("#pasteBox").oninput = e => { pasteText = e.target.value; };
    $("#split").onclick = () => {
      const parts = splitWords(pasteText);
      if (!parts.length) return toast("Paste some words first");
      if (parts.length > 16) toast(`Found ${parts.length} words. Kept the first 16.`);
      setDraft(parts.slice(0, 16), null, { date: today(), from: "today" });
      go("confirm");
    };
  }

  function splitWords(text) {
    let parts = text.split(/\r?\n/).flatMap(l => l.split(/[,;\t]+/)).map(s => s.trim()).filter(Boolean);
    if (parts.length === 1) parts = parts[0].split(/\s+/);
    return parts.map(s => s.replace(/\s+/g, " ").toUpperCase());
  }

  function setDraft(words, shot, d) {
    const n = Math.min(16, Math.max(4, Math.ceil(words.length / 4) * 4));
    const w = words.slice(0, n); while (w.length < n) w.push("");
    draft = { words: w, shot, date: d ? d.date : today(), dateFrom: d ? d.from : "today" };
  }

  function rReading() {
    app.innerHTML = `${top("Reading words")}
    ${tab().shot ? `<img class="shot" src="${tab().shot}" alt="Your screenshot">` : ""}
    <div class="reading" aria-live="polite"><div class="spinner" aria-hidden="true"></div><div class="msg" id="rmsg">${esc(tab().reading || "Reading words…")}</div>
    <p class="hint">Everything happens on this device. Nothing is uploaded.</p></div>`;
  }

  function rConfirm() {
    if (!draft) return go("start");
    const n = draft.words.length;
    const filled = draft.words.filter(w => w.trim()).length;
    app.innerHTML = `${top("Check words", true)}
    ${draft.shot ? `<img class="shot" src="${draft.shot}" alt="Your screenshot">` : ""}
    ${draft.note ? `<p class="note">${esc(draft.note)}</p>` : ""}
    <div id="dup"></div>
    <div class="daterow">${dateField("pdate", draft.date)}
      <p class="hint" id="dhint">${draft.dateFrom === "file name" ? "Taken from the screenshot's name." : draft.dateFrom === "file date" ? "Taken from the screenshot's file date. Check it." : draft.dateFrom === "today" ? "Set to today. Change it if this is an older puzzle." : ""}</p></div>
    <p class="hint">Tap any word to fix a misread. <span id="fc">${filled}</span> of ${n} filled.${n < 16 ? " Solved groups in the game are left out." : ""}</p>
    <div class="editgrid">${draft.words.map((w, i) => `<input id="w${i}" aria-label="Word ${i + 1}" value="${esc(w)}" class="${w.trim() ? "" : "bad"}" autocapitalize="characters" autocomplete="off" autocorrect="off" spellcheck="false" enterkeyhint="next">`).join("")}</div>
    <div class="row">
      ${n > 4 ? `<button class="btn quiet" id="rmRow">Remove last row</button>` : ""}
      ${n < 16 ? `<button class="btn quiet" id="addRow">Add a row</button>` : ""}
      <span class="spacer"></span>
      <button class="btn solid" id="goBtn" ${filled === n ? "" : "disabled"}>Start sorting</button>
    </div>`;
    $("#back").onclick = () => go("start");
    // Same puzzle date already open in another tab: warn here; Start sorting goes to that board instead.
    const dupNote = () => {
      const other = sameDate(draft.date, active);
      $("#dup").innerHTML = other ? `<p class="note dupe">You already have <b>${esc(shortDate(other.s.date))}</b> open in another tab. <b>Start sorting</b> takes you to that board and closes this one. If the date is wrong, change it below. <button id="goDup">Go there now</button></p>` : "";
      if (other) $("#goDup").onclick = () => toExisting(other);
      return other;
    };
    dupNote();
    $("#pdate").onchange = e => { draft.date = e.target.value; draft.dateFrom = "you"; $("#dhint").textContent = ""; save(); dupNote(); };
    const inputs = [...app.querySelectorAll(".editgrid input")];
    inputs.forEach((inp, i) => {
      inp.oninput = () => {
        draft.words[i] = inp.value.toUpperCase();
        inp.classList.toggle("bad", !inp.value.trim());
        const f = draft.words.filter(w => w.trim()).length;
        $("#fc").textContent = f; $("#goBtn").disabled = f !== n; save();
      };
      inp.onkeydown = e => { if (e.key === "Enter") { e.preventDefault(); (inputs[i + 1] || $("#goBtn")).focus(); } };
    });
    if ($("#addRow")) $("#addRow").onclick = () => { draft.words.push("", "", "", ""); save(); render(); };
    if ($("#rmRow")) $("#rmRow").onclick = () => { draft.words.splice(-4); save(); render(); };
    $("#goBtn").onclick = () => {
      const other = sameDate(draft.date, active);
      if (other) return toExisting(other);
      hist = [];
      S = fresh(draft.words.map(w => w.trim().replace(/\s+/g, " ").toUpperCase()), draft.date);
      draft = null; save(); render();
    };
  }

  // Leave this (new) tab for the board that already has its puzzle date.
  function toExisting(other) {
    const me = tab();
    if (me.shot) URL.revokeObjectURL(me.shot);
    tabs = tabs.filter(t => t !== me);
    use(other); save(); render();
    toast(`${shortDate(other.s.date)} was already open. Switched to it.`);
  }

  function rBoard() {
    if (!S.words.length) return go("start");
    const gs = G(), total = S.words.length;
    const counts = [0, 1, 2, 3].map(count);
    const free = S.order.map(i => S.words[i]).filter(w => !(w.c !== null && S.locked[w.c]));
    const lockedCs = gs.filter(c => S.locked[c]);
    let st = "", cls = "";
    const over = gs.filter(c => counts[c] > 4 && !S.locked[c]);
    const placed = gs.reduce((a, c) => a + counts[c], 0);
    if (over.length) { st = over.map(c => `${NAMES[c]} has ${counts[c]}. One or more don't belong.`).join(" "); cls = "warn"; }
    else if (gs.every(c => counts[c] === 4)) {
      st = `All ${NUM[gs.length]} group${gs.length > 1 ? "s are" : " is"} set. Go enter them in Connections.`; cls = "ok";
    } else {
      const need = gs.filter(c => counts[c] < 4).map(c => `${NAMES[c]} ${4 - counts[c]}`);
      st = `${placed} of ${total} placed · still needed: ${need.join(", ")}`;
    }
    const maybe = S.mode === "maybe";
    const curOn = c => !S.erase && S.cur === c;

    app.innerHTML = `<div class="top">${dots}<h1>Practice Pad</h1></div>
    <div class="daterow board-date">${dateField("bdate", S.date)}</div>
    <div class="board" data-arrange="${S.arrange}">
      <div class="main">
        ${lockedCs.length ? `<div class="locked">${lockedCs.map(c => `<div class="lockbar" data-c="${c}">
          <span class="lname">${esc(S.labels[c] || NAMES[c])}</span><span class="lwords">${S.words.filter(w => w.c === c).map(w => esc(w.t)).join(", ")}</span>
          <button data-unlock="${c}">Unlock</button></div>`).join("")}</div>` : ""}
        <div class="grid" role="group" aria-label="Words">${free.map(w => {
          const ms = w.m.filter(c => c < S.groups && !S.locked[c]);
          const lab = esc(w.t) + (w.c !== null ? ", " + NAMES[w.c] : "") + (ms.length ? ", maybe " + ms.map(c => NAMES[c]).join(" or ") : "");
          return `<button class="tile ${w.c !== null && counts[w.c] > 4 ? "over" : ""}" data-id="${w.id}" ${w.c !== null ? `data-c="${w.c}"` : ""} aria-label="${lab}">${esc(w.t)}${ms.length ? `<span class="flags" aria-hidden="true">${ms.map(c => `<i data-c="${c}"></i>`).join("")}</span>` : ""}</button>`;
        }).join("")}</div>
        <div class="modes" role="group" aria-label="Marking mode">
          <button data-mode="sure" aria-pressed="${!maybe}">Sure</button><button data-mode="maybe" aria-pressed="${maybe}">Maybe</button>
        </div>
        <div class="palette ${maybe ? "maybe" : ""}" role="group" aria-label="Pick a color, then tap words" style="--ng:${gs.length}">
          ${gs.map(c => `<button class="sw ${counts[c] === 4 ? "full" : ""} ${counts[c] > 4 ? "over" : ""} ${S.locked[c] ? "locked" : ""}" data-c="${c}" data-pick="${c}" aria-pressed="${curOn(c)}" ${S.locked[c] ? "disabled" : ""}>
            <span class="n">${NAMES[c]}</span><span class="cnt">${counts[c]}/4</span></button>`).join("")}
          <button class="sw erase" data-pick="x" aria-pressed="${S.erase}" title="Eraser: tap words to clear their color and maybes"><span class="n">Clear</span><span class="cnt" aria-hidden="true">⌫</span></button>
        </div>
        <p class="status ${cls}" aria-live="polite">${st}</p>
        <div class="tools">
          <button class="iconbtn" id="undo" ${hist.length ? "" : "disabled"}>Undo</button>
          <button class="iconbtn" id="shuf">Shuffle</button>
          <button class="iconbtn arrange-btn" id="arr" aria-pressed="${S.arrange}">${S.arrange ? "Show board" : "Show groups"}</button>
          <button class="iconbtn" id="clr">Clear colors</button>
        </div>
      </div>
      <div class="groups">
        <p class="panelhead">Your groups</p>
        ${gs.filter(c => !S.locked[c]).map(c => {
          const ws = S.order.map(i => S.words[i]).filter(w => w.c === c);
          const mw = S.order.map(i => S.words[i]).filter(w => w.m.includes(c) && !(w.c !== null && S.locked[w.c]));
          return `<section class="group ${curOn(c) ? "cur" : ""}">
          <div class="ghead"><span class="gdot" data-c="${c}"></span><span class="gname">${NAMES[c]}</span><span class="gcount ${ws.length > 4 ? "over" : ""}">${ws.length}/4</span></div>
          <label class="sr" for="lab${c}">What connects the ${NAMES[c]} group</label>
          <input class="glabel" id="lab${c}" data-lab="${c}" placeholder="What connects them? (optional)" value="${esc(S.labels[c])}" autocomplete="off">
          <div class="chips">${ws.length ? ws.map(w => `<button class="chip" data-c="${c}" data-rm="${w.id}" title="Tap to remove" aria-label="${esc(w.t)}, remove from ${NAMES[c]}">${esc(w.t)}</button>`).join("") : `<span class="empty">Tap ${NAMES[c].toLowerCase()} on the palette, then tap words.</span>`}</div>
          ${mw.length ? `<div class="mayberow"><span class="mlabel">Maybe</span>${mw.map(w => `<button class="chip maybe" data-c="${c}" data-rmm="${w.id}" data-mc="${c}" title="Tap to remove" aria-label="${esc(w.t)}, remove maybe ${NAMES[c]}">${esc(w.t)}</button>`).join("")}</div>` : ""}
          <button class="lockbtn" data-lock="${c}" ${ws.length === 4 ? "" : "disabled"}>Lock group</button>
        </section>`;
        }).join("")}
        ${(() => {
          const un = S.order.map(i => S.words[i]).filter(w => w.c === null);
          return un.length ? `<section class="group"><div class="ghead"><span class="gname">Not placed yet</span><span class="gcount">${un.length}</span></div>
          <div class="chips">${un.map(w => `<button class="chip plain" data-add="${w.id}" title="Tap to add to the selected color">${esc(w.t)}</button>`).join("")}</div></section>` : "";
        })()}
      </div>
    </div>`;

    app.querySelectorAll(".tile").forEach(b => b.onclick = () => tapWord(S.words[+b.dataset.id]));
    app.querySelectorAll("[data-mode]").forEach(b => b.onclick = () => { S.mode = b.dataset.mode; save(); render(); });
    app.querySelectorAll("[data-pick]").forEach(b => b.onclick = () => {
      if (b.dataset.pick === "x") S.erase = !S.erase; else { S.cur = +b.dataset.pick; S.erase = false; }
      save(); render();
    });
    app.querySelectorAll("[data-rm]").forEach(b => b.onclick = () => commit(() => { S.words[+b.dataset.rm].c = null; }));
    app.querySelectorAll("[data-rmm]").forEach(b => b.onclick = () => commit(() => {
      const w = S.words[+b.dataset.rmm], c = +b.dataset.mc; w.m = w.m.filter(x => x !== c);
    }));
    app.querySelectorAll("[data-add]").forEach(b => b.onclick = () => {
      if (S.erase || S.locked[S.cur] || S.cur >= S.groups) return toast("Pick a color first");
      tapWord(S.words[+b.dataset.add]);
    });
    app.querySelectorAll("[data-lock]").forEach(b => b.onclick = () => commit(() => {
      const c = +b.dataset.lock;
      S.locked[c] = true;
      S.words.forEach(w => { w.m = w.m.filter(x => x !== c); });
      if (S.cur === c) { const n = G().find(k => !S.locked[k]); if (n !== undefined) S.cur = n; }
      toast(`${NAMES[c]} locked`);
    }));
    app.querySelectorAll("[data-unlock]").forEach(b => b.onclick = () => commit(() => { S.locked[+b.dataset.unlock] = false; }));
    app.querySelectorAll("[data-lab]").forEach(i => {
      let before = null;
      i.onfocus = () => { before = snap(); };
      i.oninput = () => { S.labels[+i.dataset.lab] = i.value; save(); };
      i.onchange = () => { if (before && before !== snap()) { pushHist(before); before = snap(); const u = $("#undo"); if (u) u.disabled = false; } };
      i.onkeydown = e => { if (e.key === "Enter") i.blur(); };
    });
    $("#undo").onclick = () => { if (!hist.length) return; S = JSON.parse(hist.pop()); save(); render(); };
    $("#shuf").onclick = () => commit(() => {
      // Reorder unlocked tiles only; locked words keep their slots in the order array.
      const slots = [], ids = [];
      S.order.forEach((id, k) => { const w = S.words[id]; if (!(w.c !== null && S.locked[w.c])) { slots.push(k); ids.push(id); } });
      for (let i = ids.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [ids[i], ids[j]] = [ids[j], ids[i]]; }
      slots.forEach((k, n) => { S.order[k] = ids[n]; });
    });
    $("#arr").onclick = () => { S.arrange = !S.arrange; save(); render(); };
    $("#clr").onclick = () => commit(() => {
      S.words.forEach(w => { w.c = null; w.m = []; }); S.locked = [false, false, false, false];
      toast("Colors cleared. Undo brings them back.");
    });
    $("#bdate").onchange = e => {
      const other = sameDate(e.target.value, active);
      if (other) { e.target.value = S.date; return toast(`Another tab already has ${shortDate(other.s.date)}.`); }
      S.date = e.target.value; save(); rTabs();
    };
  }

  function tapWord(w) {
    if (S.erase) {
      if (w.c === null && !w.m.length) return;
      return commit(() => { w.c = null; w.m = []; });
    }
    const c = S.cur;
    if (c >= S.groups || S.locked[c]) return toast("Pick a color first");
    if (S.mode === "maybe") {
      if (w.c === c) return toast(`${w.t} is already sure in ${NAMES[c]}`);
      return commit(() => { w.m = w.m.includes(c) ? w.m.filter(x => x !== c) : w.m.concat(c).sort(); });
    }
    commit(() => {
      if (w.c === c) w.c = null;
      else { w.c = c; w.m = w.m.filter(x => x !== c); }
    });
  }

  /* ---------- screenshot reading ---------- */
  // Reads a screenshot into the active tab. The words land in that same tab even if you switch
  // tabs while it reads; if the tab was closed meanwhile, the result is dropped.
  async function readImage(blob, meta) {
    const d = guessDate(meta ? meta.name : blob.name, meta ? meta.lastModified : blob.lastModified);
    const t = tab();
    if (t.shot) URL.revokeObjectURL(t.shot);
    t.shot = URL.createObjectURL(blob);
    t.reading = "Reading words…"; S.screen = "reading"; save(); render();
    let words = [], note = "";
    try {
      const r = await window.PPOCR.read(blob, m => { t.reading = m; const el = $("#rmsg"); if (el && t.id === active) el.textContent = m; });
      words = r.words;
      if (r.method === "solved") note = "This board looks already solved, so there are no tiles left to sort. Type words in if that's wrong.";
      else if (r.method === "fallback") note = "Couldn't find the tile grid, so the whole screenshot was read. Check the words carefully.";
      else if (r.found < r.words.length) note = "Some tiles looked different (maybe selected in the game). Check those words.";
      if (!words.some(Boolean) && r.method !== "solved") note = "No words found. Type them in, or try another screenshot.";
    } catch (e) {
      console.error(e);
      note = "Couldn't read this screenshot. Type the words in, or try again.";
    }
    t.reading = null;
    if (!tabs.includes(t)) { URL.revokeObjectURL(t.shot); return; }
    sync();
    const back = tab();
    use(t);
    setDraft(words.length ? words : [], t.shot, d);
    if (!words.length) draft.words = Array(16).fill("");
    draft.note = note;
    S.screen = "confirm";
    sync(); use(back); save(); render();
  }
  // Screenshots go into the active tab when it has nothing in it yet, otherwise into a new tab.
  function readInto(blob, meta, keepDraft) {
    sync();
    const t = tab();
    if (!(isEmpty(t) || (keepDraft && t.s.screen === "confirm"))) openNew();
    readImage(blob, meta);
  }

  $("#fileIn").onchange = () => {
    const f = $("#fileIn").files[0];
    $("#fileIn").value = "";
    if (f) readInto(f, null, true);
  };

  // Android share sheet: the service worker stores the shared image, then opens ./?shared=1
  async function checkShared() {
    if (!/[?&]shared=1/.test(location.search)) return;
    history.replaceState(null, "", location.pathname);
    try {
      const cache = await caches.open("pp-share");
      const res = await cache.match("shared-image");
      if (!res) return toast("The shared image didn't come through. Try Load screenshot.");
      await cache.delete("shared-image");
      const meta = { name: decodeURIComponent(res.headers.get("X-File-Name") || ""), lastModified: +res.headers.get("X-Last-Modified") || 0 };
      readInto(await res.blob(), meta, false);
    } catch (e) { toast("Couldn't open the shared image."); }
  }

  if ("serviceWorker" in navigator && location.protocol !== "file:") {
    window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
  }

  load();
  render();
  checkShared();
  window.PP = { get state() { return S; }, get tabs() { sync(); return sorted().map(t => ({ id: t.id, name: tabName(t), screen: t.s.screen, date: t.s.date, active: t.id === active })); },
    splitWords, guessDate }; // for tests
})();
