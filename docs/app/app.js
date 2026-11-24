/* GenoTv web app · di Geno85
   Dati preparati dal workflow (data/*.json, stesso sito: niente blocchi CORS).
   Canali che Safari non sa aprire (http, .ts) → con un tocco si aprono in VLC. */
"use strict";
const $ = id => document.getElementById(id);
const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const store = {
  get(k, d) { try { const v = localStorage.getItem("wa_" + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem("wa_" + k, JSON.stringify(v)); } catch (e) {} }
};
// Piccolo archivio per le liste (anche grandi) dell'utente
const idb = {
  db: null,
  open() { return this.db || (this.db = new Promise((res, rej) => { const r = indexedDB.open("genotv", 1); r.onupgradeneeded = () => r.result.createObjectStore("kv"); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); })); },
  async get(k) { try { const db = await this.open(); return await new Promise(res => { const r = db.transaction("kv").objectStore("kv").get(k); r.onsuccess = () => res(r.result); r.onerror = () => res(null); }); } catch (e) { return null; } },
  async set(k, v) { try { const db = await this.open(); await new Promise(res => { const t = db.transaction("kv", "readwrite"); t.objectStore("kv").put(v, k); t.oncomplete = res; t.onerror = res; }); } catch (e) {} }
};
const IOS = /iPad|iP(?:hone|od)/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const STANDALONE = window.navigator.standalone === true || matchMedia("(display-mode: standalone)").matches;
const VLC_STORE = "https://apps.apple.com/app/vlc-media-player/id650377962";

const S = {
  tab: "home", group: "Tutti", q: "",
  ch: [], guide: {}, guideT: 0, radio: [],
  my: { lists: store.get("lists", []), active: store.get("active", ""), ch: [], group: "Tutti" },
  favs: new Set(store.get("favs", [])), recents: store.get("recents", []),
  theme: store.get("theme", "notte"), cur: null, curList: [], shown: 60
};

function toast(t) { const el = $("toast"); el.textContent = t; el.classList.add("on"); clearTimeout(toast._t); toast._t = setTimeout(() => el.classList.remove("on"), 2600); }
function hhmm(sec) { const d = new Date(sec * 1000); return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0"); }
function initials(n) { return String(n).replace(/[^0-9A-Za-zÀ-ÿ ]/g, "").split(" ").filter(Boolean).slice(0, 2).map(w => w[0]).join("").toUpperCase() || "TV"; }
function logo(c) { return c.logo ? `<img src="${esc(c.logo)}" alt="" loading="lazy" onerror="this.replaceWith(document.createTextNode('${initials(c.name)}'))">` : esc(initials(c.name)); }
const key = c => c.url;

/* ---------- compatibilità con Safari ---------- */
// Safari apre solo link https e flussi HLS (.m3u8) o MP4. Gli altri (http, .ts, Xtream senza estensione) → VLC.
function needsVlc(url) {
  const u = String(url || "").trim();
  if (!/^https:\/\//i.test(u)) return true;
  const p = u.split("?")[0].toLowerCase();
  if (/\.(ts|mkv|avi|flv|mpd)$/.test(p)) return true;
  if (/\/live\/[^/]+\/[^/]+\/\d+$/.test(p) || /\/[^/]+\/[^/]+\/\d+$/.test(p) && !/\.(m3u8|mp4|m4v|mov)$/.test(p) && /:\d+\//.test(u)) return true;  // Xtream
  return false;
}
function openVlc(c) {
  if (!store.get("vlcSeen", false)) { vlcInfo(c); return; }
  location.href = "vlc-x-callback://x-callback-url/stream?url=" + encodeURIComponent(c.url);
  addRecent(c);
}
function vlcInfo(c) {
  sheet(`<h3>▶ Questo canale si apre con VLC</h3>
    <p class="note">Safari non sa aprire alcuni formati (link http e flussi .ts). Per questi canali GenoTv usa <b>VLC</b>, un'app gratuita: tocchi il canale e parte subito dentro VLC.</p>
    <p class="note">Per tornare alla tua lista tocca <b>«◀ GenoTv»</b> in alto a sinistra.</p>
    <a class="btn ghost full" href="${VLC_STORE}" target="_blank" rel="noopener">⬇️ Scarica VLC (gratis)</a>
    <button class="btn full" id="vlcGo">Ho già VLC: apri il canale</button>`);
  $("vlcGo").onclick = () => { store.set("vlcSeen", true); closeSheet(); openVlc(c); };
}

/* ---------- dati ---------- */
async function loadJSON(u) { const r = await fetch(u, { cache: "no-cache" }); if (!r.ok) throw new Error(r.status); return r.json(); }
async function loadData() {
  try { const d = await loadJSON("data/canali.json"); S.ch = d.c || []; store.set("cacheCh", d); }
  catch (e) { const d = store.get("cacheCh", null); if (d) { S.ch = d.c; toast("Senza connessione: uso i canali salvati"); } }
  render();
  try { const g = await loadJSON("data/guida.json"); S.guide = g.p || {}; S.guideT = g.t || 0; render(); } catch (e) {}
}
function progs(c) { const i = S.ch.indexOf(c); return i >= 0 ? (S.guide[i] || []) : []; }
function nowNext(c) {
  const t = Date.now() / 1000, l = progs(c), k = l.findIndex(p => p[0] <= t && p[1] > t);
  return k < 0 ? null : { cur: l[k], next: l[k + 1] };
}

/* ---------- liste personali ---------- */
function parseM3U(text) {
  const out = []; let meta = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim(); if (!line) continue;
    if (line.startsWith("#EXTINF")) {
      const attr = n => { const m = line.match(new RegExp(n + '="([^"]*)"')); return m ? m[1] : ""; };
      const comma = line.lastIndexOf(",");
      meta = { name: (comma >= 0 ? line.slice(comma + 1) : "").trim() || attr("tvg-name") || "Senza nome", logo: attr("tvg-logo"), group: (attr("group-title") || "Altro").split(";")[0].trim() || "Altro" };
    } else if (!line.startsWith("#")) { out.push(Object.assign({}, meta || { name: line, logo: "", group: "Altro" }, { url: line })); meta = null; }
  }
  return out;
}
async function useList(id, quiet) {
  const l = S.my.lists.find(x => x.id === id); if (!l) return;
  S.my.active = id; store.set("active", id);
  const text = await idb.get("list_" + id) || "";
  S.my.ch = parseM3U(text); S.my.group = "Tutti";
  if (!quiet) render();
}
async function addList(name, text, url) {
  const ch = parseM3U(text);
  if (!ch.length) { toast("Il file non contiene canali"); return; }
  const id = "l" + Date.now().toString(36);
  const vlc = ch.filter(c => needsVlc(c.url)).length;
  S.my.lists.push({ id, name: name || "La mia lista", url: url || "", n: ch.length, vlc });
  store.set("lists", S.my.lists); await idb.set("list_" + id, text);
  await useList(id, true); closeSheet(); go("mia");
  sheet(`<h3>✅ Lista aggiunta</h3><div class="stat"><div class="glass"><b>${ch.length - vlc}</b>si guardano in GenoTv</div><div class="glass"><b>${vlc}</b>si aprono con VLC</div></div>
    ${vlc ? `<p class="note">Safari non sa aprire alcuni formati (link http e flussi .ts): per quei canali GenoTv apre <b>VLC</b>, gratis sull'App Store. Li riconosci dall'etichetta <span class="vlc" style="font-size:11px;font-weight:800;background:#ff8800;color:#fff;padding:2px 6px;border-radius:6px">VLC</span>.</p>
    <a class="btn ghost full" href="${VLC_STORE}" target="_blank" rel="noopener">⬇️ Scarica VLC (gratis)</a>` : `<p class="note">Tutti i canali si guardano direttamente in GenoTv. 🎉</p>`}
    <button class="btn full" id="okL">Vai alla lista</button>`);
  $("okL").onclick = closeSheet;
}
function addListSheet() {
  sheet(`<h3>📋 Aggiungi la tua lista</h3>
    <p class="note">Puoi aggiungere una lista M3U da un file sul telefono oppure da un link.</p>
    <input class="field" id="lName" placeholder="Nome della lista (es. La mia lista)" maxlength="40">
    <label class="btn full" style="margin-top:12px">📂 Scegli il file dal telefono<input type="file" id="lFile" accept=".m3u,.m3u8,audio/x-mpegurl,application/vnd.apple.mpegurl,text/plain" hidden></label>
    <input class="field" id="lUrl" type="url" placeholder="…oppure incolla il link della lista" autocomplete="off" autocapitalize="off">
    <button class="btn ghost full" id="lGo">🔗 Aggiungi dal link</button>
    <p class="note">⚖️ GenoTv è solo un lettore: sei responsabile delle liste che aggiungi. Le liste pirata di canali a pagamento sono illegali.</p>`);
  $("lFile").onchange = e => { const f = e.target.files[0]; if (!f) return; const r = new FileReader(); r.onload = () => addList($("lName").value.trim() || f.name.replace(/\.(m3u8?|txt)$/i, ""), String(r.result), ""); r.readAsText(f); };
  $("lGo").onclick = async () => {
    const u = $("lUrl").value.trim(); if (!u) return toast("Incolla prima il link");
    toast("Scarico la lista…");
    try { const r = await fetch(u, { cache: "no-store" }); if (!r.ok) throw new Error(r.status); addList($("lName").value.trim() || hostOf(u), await r.text(), u); }
    catch (e) { sheet(`<h3>😕 Non riesco a scaricarla</h3><p class="note">Il server di questa lista non permette di scaricarla dal browser${/^http:/i.test(u) ? " (e il link non è sicuro: http)" : ""}. Succede con molti fornitori.</p>
      <p class="note"><b>Come fare:</b> apri il link in Safari, salva il file (Condividi → Salva su File) e poi aggiungilo con <b>«Scegli il file dal telefono»</b>.</p><button class="btn full" id="bk">Ho capito</button>`); $("bk").onclick = addListSheet; }
  };
}
const hostOf = u => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch (e) { return "La mia lista"; } };

/* ---------- preferiti e recenti ---------- */
function toggleFav(c) { const k = key(c); S.favs.has(k) ? S.favs.delete(k) : S.favs.add(k); store.set("favs", [...S.favs]); const fd = store.get("favData", {}); fd[k] = c; store.set("favData", fd); }
function addRecent(c) { S.recents = [c, ...S.recents.filter(x => x.url !== c.url)].slice(0, 20); store.set("recents", S.recents); }

/* ---------- lettore ---------- */
let hls = null;
function play(c, list) {
  if (needsVlc(c.url)) { openVlc(c); return; }
  S.cur = c; S.curList = list || [c]; addRecent(c);
  stopRadio();
  $("player").hidden = false; document.body.classList.add("lock");
  $("plName").textContent = c.name; $("plFav").textContent = S.favs.has(key(c)) ? "★" : "☆";
  const nn = nowNext(c); $("plNow").textContent = nn ? "In onda: " + nn.cur[2] : (c.group || "");
  $("plVlc").hidden = true; $("plMsg").textContent = "";
  $("plAir").hidden = !window.WebKitPlaybackTargetAvailabilityEvent;
  renderNext(c);
  startVideo([c.url].concat(c.alts || []), 0);
}
function startVideo(urls, i) {
  const v = $("video");
  if (hls) { hls.destroy(); hls = null; }
  if (i >= urls.length) { $("plMsg").textContent = "😕 Il canale non risponde in questo momento."; $("plVlc").hidden = false; return; }
  const u = urls[i];
  v.onerror = () => startVideo(urls, i + 1);
  if (v.canPlayType("application/vnd.apple.mpegurl") || !/m3u8|relinker|mediapolis/i.test(u)) { v.src = u; v.play().catch(() => {}); }
  else if (window.Hls && Hls.isSupported()) {
    hls = new Hls({ maxBufferLength: 20 }); hls.loadSource(u); hls.attachMedia(v);
    hls.on(Hls.Events.MANIFEST_PARSED, () => v.play().catch(() => {}));
    hls.on(Hls.Events.ERROR, (e, d) => { if (d.fatal) startVideo(urls, i + 1); });
  } else { loadHls().then(() => startVideo(urls, i)); }
}
function loadHls() { return new Promise(res => { if (window.Hls) return res(); const s = document.createElement("script"); s.src = "vendor/hls.min.js"; s.onload = res; s.onerror = res; document.head.appendChild(s); }); }
function closePlayer() { const v = $("video"); v.pause(); if (hls) { hls.destroy(); hls = null; } v.removeAttribute("src"); v.load(); $("player").hidden = true; document.body.classList.remove("lock"); render(); }
function renderNext(c) {
  const t = Date.now() / 1000, l = progs(c).filter(p => p[1] > t).slice(0, 8);
  $("plNext").innerHTML = l.length ? l.map(p => `<div class="prog ${p[0] <= t ? "cur" : ""}"><div class="t">${hhmm(p[0])}</div><div><b>${esc(p[2])}</b>${p[3] ? `<p>${esc(p[3])}</p>` : ""}</div></div>`).join("") : "";
}
$("plClose").onclick = closePlayer;
$("plFav").onclick = () => { if (!S.cur) return; toggleFav(S.cur); $("plFav").textContent = S.favs.has(key(S.cur)) ? "★" : "☆"; };
$("plAir").onclick = () => { const v = $("video"); if (v.webkitShowPlaybackTargetPicker) v.webkitShowPlaybackTargetPicker(); };
$("plPip").onclick = async () => { const v = $("video"); try { if (v.webkitSupportsPresentationMode && v.webkitSupportsPresentationMode("picture-in-picture")) v.webkitSetPresentationMode(v.webkitPresentationMode === "picture-in-picture" ? "inline" : "picture-in-picture"); else if (document.pictureInPictureEnabled) { document.pictureInPictureElement ? await document.exitPictureInPicture() : await v.requestPictureInPicture(); } else toast("Picture in Picture non disponibile qui"); } catch (e) { toast("Picture in Picture non disponibile"); } };
$("plVlc").onclick = () => { if (S.cur) { store.set("vlcSeen", true); location.href = "vlc-x-callback://x-callback-url/stream?url=" + encodeURIComponent(S.cur.url); } };

/* ---------- radio ---------- */
async function loadRadio() {
  if (S.radio.length) return;
  try {
    const r = await fetch("https://de1.api.radio-browser.info/json/stations/search?countrycode=IT&hidebroken=true&order=clickcount&reverse=true&limit=150");
    const arr = await r.json(), seen = new Set();
    S.radio = arr.map(x => ({ id: x.stationuuid, name: (x.name || "").trim(), url: x.url_resolved || x.url, logo: x.favicon || "", tags: (x.tags || "").split(",").slice(0, 3).join(", ") }))
      .filter(x => x.name && /^https:/i.test(x.url) && !seen.has(x.name.toLowerCase()) && seen.add(x.name.toLowerCase()));
  } catch (e) { try { S.radio = (await loadJSON("data/radio.json")).r || []; } catch (e2) {} }
  render();
}
function playRadio(st) {
  const a = $("audio"); a.src = st.url; a.play().catch(() => toast("Tocca ▶ per avviare la radio"));
  S.radioCur = st; store.set("radioLast", st);
  $("mini").hidden = false; document.body.classList.add("has-mini");
  $("miniName").textContent = st.name; $("miniSub").textContent = "In diretta"; $("miniLogo").src = st.logo || "icone/icona-192.png"; $("miniPlay").textContent = "⏸";
  if ("mediaSession" in navigator) {
    navigator.mediaSession.metadata = new MediaMetadata({ title: st.name, artist: "GenoTv · Radio", artwork: st.logo ? [{ src: st.logo, sizes: "256x256" }] : [{ src: "icone/icona-512.png", sizes: "512x512", type: "image/png" }] });
    navigator.mediaSession.setActionHandler("play", () => a.play()); navigator.mediaSession.setActionHandler("pause", () => a.pause());
  }
}
function stopRadio() { const a = $("audio"); a.pause(); a.removeAttribute("src"); $("mini").hidden = true; document.body.classList.remove("has-mini"); S.radioCur = null; }
$("miniPlay").onclick = () => { const a = $("audio"); if (a.paused) { a.play(); $("miniPlay").textContent = "⏸"; } else { a.pause(); $("miniPlay").textContent = "▶"; } };
$("miniStop").onclick = stopRadio;

/* ---------- finestre ---------- */
function sheet(html) { $("shBody").innerHTML = html; $("sheet").classList.add("open"); $("sheetBg").classList.add("open"); }
function closeSheet() { $("sheet").classList.remove("open"); $("sheetBg").classList.remove("open"); }
$("sheetBg").onclick = closeSheet;

/* ---------- interfaccia ---------- */
function chRow(c, i, list) {
  const nn = list === "free" ? nowNext(c) : null, vlc = needsVlc(c.url), fav = S.favs.has(key(c));
  let sub = esc(c.group || ""), pg = "";
  if (nn) { sub = "In onda: " + esc(nn.cur[2]); pg = `<div class="pg"><i style="width:${Math.round((Date.now() / 1000 - nn.cur[0]) / (nn.cur[1] - nn.cur[0]) * 100)}%"></i></div>`; }
  return `<div class="ch glass" data-i="${i}" role="button" tabindex="0"><div class="lg">${logo(c)}</div><div class="tx"><b>${esc(c.name)}</b><small>${sub}</small>${pg}</div>${vlc ? `<span class="vlc">VLC</span>` : ""}<button class="st ${fav ? "on" : ""}" data-f="${i}" aria-label="Preferito">${fav ? "★" : "☆"}</button></div>`;
}
function bindRows(items, listKind) {
  $("main").querySelectorAll(".ch[data-i]").forEach(el => el.onclick = e => { if (e.target.closest(".st")) return; play(items[+el.dataset.i], items); });
  $("main").querySelectorAll("[data-f]").forEach(b => b.onclick = () => { const c = items[+b.dataset.f]; toggleFav(c); b.classList.toggle("on"); b.textContent = S.favs.has(key(c)) ? "★" : "☆"; });
  const m = $("moreBtn"); if (m) m.onclick = () => { S.shown += 80; render(); };
}
function chips(groups, cur, onPick) {
  const el = $("chips"); el.style.display = groups.length > 1 ? "flex" : "none";
  el.innerHTML = groups.map(g => `<button class="chip ${g === cur ? "on" : ""}" data-g="${esc(g)}">${esc(g)}</button>`).join("");
  el.querySelectorAll(".chip").forEach(b => b.onclick = () => { onPick(b.dataset.g); S.shown = 60; render(); });
}
function filterQ(list) { const q = S.q.trim().toLowerCase(); return q ? list.filter(c => c.name.toLowerCase().includes(q)) : list; }

function renderHome() {
  $("chips").style.display = "none"; $("searchBox").style.display = "flex";
  const t = Date.now() / 1000;
  // in onda adesso sui canali principali
  const live = S.ch.slice(0, 40).map(c => ({ c, nn: nowNext(c) })).filter(x => x.nn);
  const h = live[0];
  let html = "";
  if (IOS && !STANDALONE) html += `<div class="card glass install"><div class="ii">📲</div><div><b>Aggiungi GenoTv alla schermata Home</b><div class="note">Tocca <b>Condividi</b> ⬆️ in Safari e poi <b>«Aggiungi alla schermata Home»</b>: si aprirà come un'app, a tutto schermo.</div></div></div>`;
  html += h ? `<button class="hero" id="hero"><span class="live">● IN ONDA ORA</span><span class="hl">${logo(h.c)}</span><h3>${esc(h.nn.cur[2])}</h3><p>${esc(h.c.name)} · fino alle ${hhmm(h.nn.cur[1])}</p><div class="pg"><i style="width:${Math.round((t - h.nn.cur[0]) / (h.nn.cur[1] - h.nn.cur[0]) * 100)}%"></i></div></button>`
    : `<button class="hero" id="hero"><span class="live">📺 TV GRATIS</span><h3>I canali italiani gratuiti</h3><p>${S.ch.length ? S.ch.length + " canali, tutti in chiaro e legali" : "Carico i canali…"}</p></button>`;
  html += `<h2>Esplora</h2><div class="widgets">
    <button class="w" data-go="tv"><span class="wi" style="background:#fbcfe8;border-radius:24px 10px 24px 10px">📺</span>Canali</button>
    <button class="w" data-go="guida"><span class="wi" style="background:#bfdbfe;border-radius:50%">🕘</span>Guida</button>
    <button class="w" data-go="radio"><span class="wi" style="background:#fecaca">📻</span>Radio</button>
    <button class="w" data-go="mia"><span class="wi" style="background:#e9d5ff;border-radius:32px 32px 32px 10px">📋</span>La mia lista</button></div>`;
  if (S.recents.length) html += `<h2>Continua a guardare</h2><div class="row">${S.recents.slice(0, 10).map((c, i) => `<div class="tile glass" data-r="${i}" role="button"><div class="lg">${logo(c)}</div><b>${esc(c.name)}</b><small>${needsVlc(c.url) ? "con VLC" : esc(c.group || "")}</small></div>`).join("")}</div>`;
  const favs = [...S.favs].map(k => store.get("favData", {})[k]).filter(Boolean);
  if (favs.length) html += `<h2>⭐ Preferiti</h2><div class="row">${favs.slice(0, 12).map((c, i) => `<div class="tile glass" data-fv="${i}" role="button"><div class="lg">${logo(c)}</div><b>${esc(c.name)}</b><small>${esc(c.group || "")}</small></div>`).join("")}</div>`;
  if (live.length > 1) html += `<h2>In onda adesso<button class="more" data-go="guida">Guida ›</button></h2><div class="list">${live.slice(1, 7).map(x => chRow(x.c, S.ch.indexOf(x.c), "free")).join("")}</div>`;
  $("main").innerHTML = html;
  if ($("hero")) $("hero").onclick = () => h ? play(h.c, S.ch) : go("tv");
  $("main").querySelectorAll("[data-go]").forEach(b => b.onclick = () => go(b.dataset.go));
  $("main").querySelectorAll("[data-r]").forEach(b => b.onclick = () => play(S.recents[+b.dataset.r], S.recents));
  $("main").querySelectorAll("[data-fv]").forEach(b => b.onclick = () => play(favs[+b.dataset.fv], favs));
  bindRows(S.ch, "free");
}
function renderTv() {
  $("searchBox").style.display = "flex";
  const groups = ["Tutti", "⭐ Preferiti", ...new Set(S.ch.map(c => c.group))];
  chips(groups, S.group, g => S.group = g);
  let items = S.group === "Tutti" ? S.ch : S.group === "⭐ Preferiti" ? S.ch.filter(c => S.favs.has(key(c))) : S.ch.filter(c => c.group === S.group);
  items = filterQ(items);
  if (!S.ch.length) { $("main").innerHTML = `<div class="empty"><span class="big">📡</span>Carico i canali…</div>`; return; }
  if (!items.length) { $("main").innerHTML = `<div class="empty"><span class="big">${S.group === "⭐ Preferiti" ? "⭐" : "🔍"}</span>${S.group === "⭐ Preferiti" ? "Nessun preferito: tocca la stella su un canale." : "Nessun canale trovato"}</div>`; return; }
  const shown = items.slice(0, S.shown);
  $("main").innerHTML = `<div class="list">${shown.map(c => chRow(c, S.ch.indexOf(c), "free")).join("")}</div>` + (items.length > shown.length ? `<button class="btn ghost more-btn" id="moreBtn">Mostra altri (${items.length - shown.length})</button>` : "");
  bindRows(S.ch, "free");
}
function renderGuide() {
  $("searchBox").style.display = "flex"; $("chips").style.display = "none";
  const t = Date.now() / 1000;
  const items = filterQ(S.ch).map(c => ({ c, nn: nowNext(c) })).filter(x => x.nn).slice(0, 80);
  if (!items.length) { $("main").innerHTML = `<div class="empty"><span class="big">🕘</span>${Object.keys(S.guide).length ? "Nessun programma trovato" : "La guida TV sta arrivando…"}</div>`; return; }
  $("main").innerHTML = `<div class="list">${items.map(x => `<div class="ch glass" data-g="${S.ch.indexOf(x.c)}" role="button"><div class="lg">${logo(x.c)}</div><div class="tx"><b>${esc(x.c.name)}</b><small>${hhmm(x.nn.cur[0])} ${esc(x.nn.cur[2])}</small><div class="pg"><i style="width:${Math.round((t - x.nn.cur[0]) / (x.nn.cur[1] - x.nn.cur[0]) * 100)}%"></i></div><small>${x.nn.next ? "Dopo: " + hhmm(x.nn.next[0]) + " " + esc(x.nn.next[2]) : ""}</small></div></div>`).join("")}</div>`;
  $("main").querySelectorAll("[data-g]").forEach(el => el.onclick = () => guideSheet(S.ch[+el.dataset.g]));
}
function guideSheet(c) {
  const t = Date.now() / 1000; let last = "", html = "";
  progs(c).filter(p => p[1] > t - 2 * 3600).forEach(p => {
    const d = new Date(p[0] * 1000).toDateString(); if (d !== last) { last = d; html += `<div class="day">${d === new Date().toDateString() ? "Oggi" : new Date(p[0] * 1000).toLocaleDateString("it-IT", { weekday: "long", day: "numeric", month: "long" })}</div>`; }
    html += `<div class="prog ${p[0] <= t && p[1] > t ? "cur" : p[1] <= t ? "past" : ""}"><div class="t">${hhmm(p[0])}</div><div><b>${esc(p[2])}</b>${p[3] && p[0] <= t && p[1] > t ? `<p>${esc(p[3])}</p>` : ""}</div></div>`;
  });
  sheet(`<h3>${esc(c.name)}</h3><button class="btn full" id="gPlay">▶ Guarda ora</button>${html}`);
  $("gPlay").onclick = () => { closeSheet(); play(c, S.ch); };
}
function renderRadio() {
  $("searchBox").style.display = "flex"; $("chips").style.display = "none";
  if (!S.radio.length) { $("main").innerHTML = `<div class="empty"><span class="big">📻</span>Carico le radio…</div>`; loadRadio(); return; }
  const items = filterQ(S.radio).slice(0, S.shown);
  $("main").innerHTML = `<div class="list">${items.map((st, i) => `<div class="ch glass" data-ra="${i}" role="button"><div class="lg">${st.logo ? `<img src="${esc(st.logo)}" alt="" loading="lazy" onerror="this.replaceWith(document.createTextNode('📻'))">` : "📻"}</div><div class="tx"><b>${esc(st.name)}</b><small>${esc(st.tags || "Radio")}</small></div></div>`).join("")}</div>`;
  $("main").querySelectorAll("[data-ra]").forEach(el => el.onclick = () => playRadio(items[+el.dataset.ra]));
}
function renderMy() {
  $("searchBox").style.display = S.my.lists.length ? "flex" : "none";
  if (!S.my.lists.length) {
    $("chips").style.display = "none";
    $("main").innerHTML = `<div class="card glass"><h2 style="margin-top:0">📋 La tua lista, anche qui</h2><p class="note">Hai una lista M3U? Aggiungila e guarda i tuoi canali con la guida, i preferiti e la ricerca di GenoTv.</p>
      <p class="note">I canali che Safari non sa aprire (link http e flussi .ts) partono con un tocco in <b>VLC</b>, gratis sull'App Store.</p><button class="btn full" id="addL">＋ Aggiungi una lista</button></div>`;
    $("addL").onclick = addListSheet; return;
  }
  const l = S.my.lists.find(x => x.id === S.my.active) || S.my.lists[0];
  if (!S.my.ch.length && l) { useList(l.id); $("main").innerHTML = `<div class="empty">Apro la lista…</div>`; return; }
  const groups = ["Tutti", ...new Set(S.my.ch.map(c => c.group))];
  chips(groups, S.my.group, g => S.my.group = g);
  const items = filterQ(S.my.group === "Tutti" ? S.my.ch : S.my.ch.filter(c => c.group === S.my.group)), shown = items.slice(0, S.shown);
  $("main").innerHTML = `<div class="card glass" style="display:flex;align-items:center;gap:10px;padding:12px 14px"><div style="flex:1;min-width:0"><b>${esc(l.name)}</b><div class="note" style="margin:0">${l.n} canali · ${l.n - l.vlc} in GenoTv · ${l.vlc} con VLC</div></div><button class="mini-btn" id="manL">Gestisci</button></div>`
    + `<div class="list">${shown.map((c, i) => chRow(c, i, "my")).join("")}</div>` + (items.length > shown.length ? `<button class="btn ghost more-btn" id="moreBtn">Mostra altri (${items.length - shown.length})</button>` : "");
  $("manL").onclick = manageLists;
  bindRows(shown, "my");
}
function manageLists() {
  sheet(`<h3>📋 Le tue liste</h3>${S.my.lists.map(l => `<div class="lrow"><div class="ln"><b>${esc(l.name)}</b><small>${l.n} canali${l.url ? " · " + esc(hostOf(l.url)) : " · file"}</small></div>
    <button class="mini-btn" data-use="${l.id}">${l.id === S.my.active ? "✓ In uso" : "Usa"}</button><button class="mini-btn" data-del="${l.id}" aria-label="Elimina">✕</button></div>`).join("")}
    <button class="btn full" id="addL2">＋ Aggiungi un'altra lista</button>`);
  $("addL2").onclick = addListSheet;
  $("shBody").querySelectorAll("[data-use]").forEach(b => b.onclick = async () => { await useList(b.dataset.use); closeSheet(); });
  $("shBody").querySelectorAll("[data-del]").forEach(b => b.onclick = async () => {
    if (!confirm("Eliminare questa lista?")) return;
    S.my.lists = S.my.lists.filter(x => x.id !== b.dataset.del); store.set("lists", S.my.lists); await idb.set("list_" + b.dataset.del, "");
    if (S.my.active === b.dataset.del) { S.my.active = S.my.lists[0] ? S.my.lists[0].id : ""; S.my.ch = []; store.set("active", S.my.active); }
    closeSheet(); render();
  });
}
function settings() {
  sheet(`<h3>⚙️ Impostazioni</h3><b>Tema</b><div class="seg">${[["notte", "🌙 Notte"], ["chiaro", "☀️ Chiaro"], ["oro", "✨ Natale dorato"]].map(([k, t]) => `<button data-th="${k}" class="${S.theme === k ? "on" : ""}">${t}</button>`).join("")}</div>
    <div class="card glass" style="margin-top:16px"><b>📲 Usala come un'app</b><p class="note">In Safari tocca <b>Condividi</b> ⬆️ e poi <b>«Aggiungi alla schermata Home»</b>.</p></div>
    <div class="card glass"><b>ℹ️ GenoTv web app</b><p class="note">I canali sono gratuiti e legali (lista Free-TV). Rispetto all'app Android mancano alcune funzioni: Android Auto, widget, passaggio alla TV con QR e anteprima dei canali. Alcuni canali della tua lista si aprono con VLC.</p>
    <p class="note">Dati aggiornati: ${S.guideT ? new Date(S.guideT * 1000).toLocaleString("it-IT") : "—"}</p><p class="note">di Geno85 · t.me/GenoTvUfficiale</p></div>`);
  $("shBody").querySelectorAll("[data-th]").forEach(b => b.onclick = () => { S.theme = b.dataset.th; store.set("theme", S.theme); applyTheme(); settings(); });
}
$("setBtn").onclick = settings;
function applyTheme() { document.body.dataset.theme = S.theme; document.querySelector('meta[name="theme-color"]').content = getComputedStyle(document.body).getPropertyValue("--bg").trim() || "#0b0d1a"; }

function render() {
  const h = new Date().getHours();
  $("hi").textContent = S.tab === "home" ? (h < 6 ? "Buona notte" : h < 13 ? "Buongiorno" : h < 18 ? "Buon pomeriggio" : "Buonasera") + " 👋" : "";
  $("title").textContent = { home: "GenoTv", tv: "Canali TV", guida: "Guida TV", radio: "Radio", mia: "La mia lista" }[S.tab];
  $("q").placeholder = S.tab === "radio" ? "Cerca una radio…" : "Cerca un canale…";
  ({ home: renderHome, tv: renderTv, guida: renderGuide, radio: renderRadio, mia: renderMy })[S.tab]();
}
function go(t) {
  S.tab = t; S.shown = 60; S.q = ""; $("q").value = "";
  document.querySelectorAll("#tabs button").forEach(b => b.classList.toggle("on", b.dataset.t === t));
  movePill(); window.scrollTo(0, 0); render();
  const m = $("main"); m.classList.remove("enter"); void m.offsetWidth; m.classList.add("enter");
}
function movePill() { const b = document.querySelector("#tabs button.on"), p = $("pill"); if (!b) return; p.style.left = b.offsetLeft + "px"; p.style.width = b.offsetWidth + "px"; }
document.querySelectorAll("#tabs button").forEach(b => b.onclick = () => go(b.dataset.t));
let qT = 0; $("q").oninput = () => { clearTimeout(qT); qT = setTimeout(() => { S.q = $("q").value; S.shown = 60; render(); }, 200); };
addEventListener("resize", movePill);
setInterval(() => { if (!document.hidden && $("player").hidden && !$("sheet").classList.contains("open")) render(); }, 60000);

/* ---------- avvio ---------- */
applyTheme(); movePill(); go("home"); loadData();
if (S.my.active) useList(S.my.active, true);
if ("serviceWorker" in navigator) addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
