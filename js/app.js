/**
 * app.js — واجهة تلاوة الليل ومنطقها.
 * لا إطار عمل ولا اعتماديات: وحدات ES + DOM مباشرة.
 */
import { Player } from "./player.js";
import * as store from "./store.js";
import * as off from "./offline.js";

const $ = (id) => document.getElementById(id);
const el = {
  view: $("view"), title: $("title"), back: $("back"), version: $("version"),
  bar: $("bar"), barTitle: $("bar-title"), barSub: $("bar-sub"), barToggle: $("bar-toggle"),
  barTimer: $("bar-timer"), barOpen: $("bar-open"),
  player: $("player"), plTitle: $("pl-title"), plSub: $("pl-sub"), plRe: $("pl-rewaya"),
  plToggle: $("pl-toggle"), plBar: $("pl-bar"), plFill: $("pl-fill"), plNow: $("pl-now"),
  plDur: $("pl-dur"), plTimer: $("pl-timer"), plRepeat: $("pl-repeat"), plOffline: $("pl-offline"),
  plOfflineNote: $("pl-offline-note"), plSeek: $("pl-seek"),
  sheet: $("sheet"), sheetTitle: $("sheet-title"), sheetBody: $("sheet-body"),
  banner: $("banner"), bannerText: $("banner-text"), bannerCancel: $("banner-cancel"),
  toast: $("toast"),
};

const player = new Player();
const DB = { surahs: [], surahBy: new Map(), featured: [], all: [], byId: new Map(), topics: [], radios: [] };
let view = { path: "/", params: {} };
let ui = { query: "", scope: "featured", pick: null, drag: false, cancelSave: false };
let version = "";

/* ─────────────── أدوات ─────────────── */
const pad3 = (n) => String(n).padStart(3, "0");
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmt = (sec) => {
  sec = Math.max(0, Math.round(sec || 0));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return (h ? h + ":" + String(m).padStart(2, "0") : String(m)) + ":" + String(s).padStart(2, "0");
};
const surahName = (n) => DB.surahBy.get(n)?.name || String(n);
const reciterOf = (id) => DB.byId.get(id) || null;
const notify = (msg) => toast(msg);

function toast(msg, ms = 3200) {
  el.toast.textContent = msg;
  el.toast.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { el.toast.hidden = true; }, ms);
}

function go(hash) { location.hash = hash; }

/* ─────────────── تحميل البيانات ─────────────── */
async function boot() {
  try {
    const [su, re, to, ra, ver] = await Promise.all([
      fetch("data/surahs.json").then((r) => r.json()),
      fetch("data/reciters.json").then((r) => r.json()),
      fetch("data/topics.json").then((r) => r.json()),
      fetch("data/radios.json").then((r) => r.json()).catch(() => ({ radios: [] })),
      fetch("version.json").then((r) => r.json()).catch(() => ({ version: "?" })),
    ]);
    DB.surahs = su.surahs;
    DB.surahBy = new Map(DB.surahs.map((s) => [s.n, s]));
    DB.featured = re.featured || [];
    DB.all = (re.all || []).slice().sort((a, b) => a.ar.localeCompare(b.ar, "ar"));
    // دمج حذر: المنتقى يغلب الكتلوج الكامل، مع الاحتفاظ بحقوله (ayah/full) — فـMap
    // تُبقي آخر قيمة عند تكرار المفتاح، والاعتماد على ترتيب المصفوفة خطأ صامت.
    DB.byId = new Map(DB.all.map((r) => [r.id, { ...r }]));
    for (const r of DB.featured) {
      const prev = DB.byId.get(r.id) || {};
      DB.byId.set(r.id, { ...prev, ...r, full: r.full || prev.full || null, ayah: r.ayah || prev.ayah || null });
    }
    DB.topics = to.topics || [];
    DB.radios = ra.radios || [];
    version = ver.version;
    el.version.textContent = "v" + version;
  } catch (e) {
    el.view.innerHTML = `<div class="card"><b>تعذّر تحميل بيانات الكتلوج.</b><p class="muted">${esc(e.message)} — تأكّد من الاتصال ثم أعد التحميل.</p></div>`;
    return;
  }

  ui.reciterId = store.prefs().reciterId || DB.featured[0]?.id || null;
  ui.ayahReciterId = store.prefs().ayahReciterId || DB.featured.find((r) => r.ayah)?.id || null;

  wire();
  route();
  window.addEventListener("hashchange", route);

  if ("serviceWorker" in navigator) {
    if (/[?&]dev\b/.test(location.search)) {
      // وضع التطوير: بلا Service Worker كي لا تُخدَم نسخة قديمة من الكاش
      navigator.serviceWorker.getRegistrations().then((rs) => rs.forEach((r) => r.unregister())).catch(() => { });
      caches?.keys?.().then((ks) => ks.forEach((k) => caches.delete(k))).catch(() => { });
    } else {
      navigator.serviceWorker.register("sw.js").catch(() => { });
    }
  }
}

/* ─────────────── التوجيه ─────────────── */
function route() {
  const h = (location.hash || "#/").slice(1);
  const [path, qs] = h.split("?");
  view = { path: path || "/", params: Object.fromEntries(new URLSearchParams(qs || "")) };
  if (view.params.r) ui.reciterId = view.params.r;
  render();
}
function render() {
  el.back.hidden = view.path === "/";
  window.scrollTo({ top: 0 });
  const T = { "/": "تلاوة الليل", "/reciters": "القرّاء", "/surahs": "السور", "/topics": "المقتطفات", "/radios": "بث مستمر", "/offline": "محفوظ على جهازي" };
  el.title.textContent = T[view.path] || "تلاوة الليل";
  ({ "/": renderHome, "/reciters": renderReciters, "/surahs": renderSurahs, "/topics": renderTopics, "/radios": renderRadios, "/offline": renderOffline }[view.path] || renderHome)();
}

/* ─────────────── الرئيسية ─────────────── */
function renderHome() {
  const s = store.session();
  const cont = s && s.label ? `
    <button class="card cont" data-act="continue">
      <span class="cont-ic">▶</span>
      <span class="cont-tx"><b>متابعة</b><small>${esc(s.label)}</small></span>
    </button>` : "";
  el.view.innerHTML = `
    ${cont}
    <h2 class="h">ابدأ من هنا</h2>
    <div class="grid">
      <button class="card big" data-go="#/reciters">
        <span class="ic">🎧</span><b>سور كاملة</b>
        <small>${DB.featured.length} قارئاً منتقى و ${DB.all.length} في الكتلوج الكامل</small>
      </button>
      <button class="card big" data-go="#/topics">
        <span class="ic">🌿</span><b>مقتطفات بحسب الموضوع</b>
        <small>آيات الرحمة · وصف الجنة · السكينة · الشفاء… (${DB.topics.length})</small>
      </button>
      <button class="card big" data-go="#/radios">
        <span class="ic">📻</span><b>بث مستمر</b>
        <small>إذاعات تعمل بلا نهاية — لا تتوقف بين مقاطع (${DB.radios.length})</small>
      </button>
      <button class="card big" data-go="#/offline">
        <span class="ic">⤓</span><b>محفوظ على جهازي</b>
        <small>اسمع بلا إنترنت</small>
      </button>
    </div>
    <p class="foot">الصوت يُبثّ من مصادر القرآن المعلنة، ولا نخزّن منه شيئاً على أي جهاز.<br>للاستماع والشاشة مطفأة: ابدأ التشغيل ثم أطفئ الشاشة — التحكم يظهر على شاشة القفل.</p>
  `;
}

/* ─────────────── القرّاء ─────────────── */
function renderReciters() {
  const list = ui.scope === "featured" ? DB.featured : DB.all;
  const q = ui.query.trim();
  const filtered = q ? list.filter((r) => r.ar.includes(q) || (r.rewaya || "").includes(q)) : list;
  el.view.innerHTML = `
    <div class="toolbar">
      <input id="q" class="search" type="search" placeholder="ابحث باسم القارئ…" value="${esc(q)}" autocomplete="off" />
      <div class="chips">
        <button class="chipf ${ui.scope === "featured" ? "on" : ""}" data-scope="featured">المنتقون (${DB.featured.length})</button>
        <button class="chipf ${ui.scope === "all" ? "on" : ""}" data-scope="all">كل المصاحف (${DB.all.length})</button>
      </div>
    </div>
    <p class="muted small">${filtered.length} قارئاً${q ? ` يطابق «${esc(q)}»` : ""}</p>
    <div class="list">
      ${filtered.map((r) => `
        <button class="row" data-rec="${esc(r.id)}">
          <span class="row-main">
            <b>${esc(r.ar)}</b>
            <small>${esc(r.rewaya || r.full?.moshaf || "")}${r.full?.partial ? ` · ${r.full.count || r.full.surahs.length} سورة` : ""}</small>
          </span>
          <span class="badges">
            ${r.ayah ? '<span class="bdg">📖 مقتطفات</span>' : ""}
            ${r.full ? '<span class="bdg">🎧 سور</span>' : ""}
          </span>
        </button>`).join("") || '<p class="muted pad">لا نتائج.</p>'}
    </div>
    <p class="foot">اختر قارئاً لتظهر قائمة السور ١١٤. القارئ المعلَّم بـ«📖 مقتطفات» يمكن الاستماع له آية بآية من قسم المواضيع.</p>
  `;
  const input = $("q");
  input.addEventListener("input", (e) => { ui.query = e.target.value; const p = e.target.selectionStart; renderReciters(); $("q").focus(); $("q").setSelectionRange(p, p); });
  el.view.querySelectorAll("[data-scope]").forEach((b) => b.addEventListener("click", () => { ui.scope = b.dataset.scope; ui.query = ""; renderReciters(); }));
  el.view.querySelectorAll("[data-rec]").forEach((b) => b.addEventListener("click", () => {
    const id = b.dataset.rec;
    ui.reciterId = id;
    store.setPrefs({ reciterId: id });
    go("#/surahs?r=" + encodeURIComponent(id));
  }));
}

/* ─────────────── السور ─────────────── */
function renderSurahs() {
  const r = reciterOf(ui.reciterId);
  if (!r) { go("#/reciters"); return; }
  const q = ui.query.trim();
  let list = DB.surahs;
  if (ui.surahsFilter === "makki") list = list.filter((s) => s.makki);
  else if (ui.surahsFilter === "madani") list = list.filter((s) => !s.makki);
  else if (ui.surahsFilter === "qisar") list = list.filter((s) => s.verses <= 20);
  if (q) list = list.filter((s) => s.name.includes(q) || String(s.n) === q || s.en.toLowerCase().includes(q.toLowerCase()));
  const keys = store.offlineKeys();
  const canFull = Boolean(r.full);
  /** هل تُتاح هذه السورة بهذا القارئ؟ (مصحف ناقص أو آية-بآية) */
  const avail = (n) => (r.full && (r.full.surahs === "all" || r.full.surahs.includes(n))) || Boolean(r.ayah);

  el.view.innerHTML = `
    <button class="picker" data-go="#/reciters">
      <span class="row-art">🎙️</span>
      <span class="row-main"><b>${esc(r.ar)}</b><small>${esc(r.rewaya || r.full?.moshaf || "")}${r.full?.partial ? ` · مصحفه ${r.full.count || r.full.surahs.length} سورة` : ""} — بدّل القارئ</small></span>
      <span class="chev">‹</span>
    </button>
    <div class="toolbar">
      <input id="q" class="search" type="search" placeholder="ابحث باسم السورة أو رقمها…" value="${esc(q)}" autocomplete="off" />
      <div class="chips">
        ${[["all", "الكل"], ["makki", "مكية"], ["madani", "مدنية"], ["qisar", "قصار (≤٢٠ آية)"]]
      .map(([k, t]) => `<button class="chipf ${(ui.surahsFilter || "all") === k ? "on" : ""}" data-f="${k}">${t}</button>`).join("")}
      </div>
    </div>
    ${!canFull && !r.ayah ? '<p class="warn">هذا القارئ لا يملك مصدراً صالحاً.</p>' : ""}
    <div class="list">
      ${list.map((s) => {
        const one = canFull ? (r.full.base + pad3(s.n) + ".mp3") : (r.ayah?.base + pad3(s.n) + "001.mp3");
        const saved = keys.has(one);
        const on = avail(s.n);
        return `<div class="row-wrap">
          <button class="row ${on ? "" : "off"}" data-surah="${on ? s.n : ""}" ${on ? "" : "disabled"}>
            <span class="num">${s.n}</span>
            <span class="row-main"><b>${esc(s.name)}</b><small>${s.verses} آية · ${s.makki ? "مكية" : "مدنية"}${on ? "" : " · غير متاحة بهذا القارئ"}</small></span>
            ${saved ? '<span class="badges"><span class="bdg ok">✓ محفوظة</span></span>' : ""}
          </button>
          ${on ? `<button class="row-act" data-save="${s.n}" title="احفظ على جهازي" aria-label="احفظ على جهازي">⤓</button>` : ""}
        </div>`;
      }).join("") || '<p class="muted pad">لا نتائج.</p>'}
    </div>
  `;
  const input = $("q");
  input.addEventListener("input", (e) => { ui.query = e.target.value; const p = e.target.selectionStart; renderSurahs(); $("q").focus(); $("q").setSelectionRange(p, p); });
  el.view.querySelectorAll("[data-f]").forEach((b) => b.addEventListener("click", () => { ui.surahsFilter = b.dataset.f; ui.query = ""; renderSurahs(); }));
  el.view.querySelectorAll("[data-surah]").forEach((b) => b.addEventListener("click", () => playSurah(Number(b.dataset.surah), r)));
  el.view.querySelectorAll("[data-save]").forEach((b) => b.addEventListener("click", (e) => { e.stopPropagation(); saveItems(surahItems(r, Number(b.dataset.save)), `${surahName(Number(b.dataset.save))} — ${r.ar}`); }));
}

/* ─────────────── المواضيع ─────────────── */
function renderTopics() {
  const ar = reciterOf(ui.ayahReciterId);
  el.view.innerHTML = `
    <button class="picker" data-act="ayah-reciter">
      <span class="row-art">🎙️</span>
      <span class="row-main"><b>${esc(ar?.ar || "—")}</b><small>صوت المقتطفات — بدّله</small></span>
      <span class="chev">‹</span>
    </button>
    <p class="muted small">المقتطفات <b>مختارات</b> اجتهادية لا قائمة شرعية مُتفَق عليها${ar ? "" : " — اختر قارئاً يدعم المقتطفات أولاً"}.</p>
    <div class="list">
      ${DB.topics.map((t) => `
        <button class="row tall" data-topic="${esc(t.id)}">
          <span class="row-art">${t.emoji || "🌿"}</span>
          <span class="row-main"><b>${esc(t.title)}</b><small>${esc(t.desc || "")}</small></span>
          <span class="badges"><span class="bdg">${t.kind === "surahs" ? `${t.surahs.length} سورة` : `${t.ayahs} آية`}</span></span>
        </button>`).join("")}
    </div>
    <p class="foot">النطاقات ونصّ كل آية في <code>TOPICS.md</code> داخل المستودع للمراجعة.</p>
  `;
  el.view.querySelector("[data-act='ayah-reciter']")?.addEventListener("click", () => pickReciter({ ayahOnly: true, onPick: (id) => { ui.ayahReciterId = id; store.setPrefs({ ayahReciterId: id }); renderTopics(); } }));
  el.view.querySelectorAll("[data-topic]").forEach((b) => b.addEventListener("click", () => playTopic(DB.topics.find((t) => t.id === b.dataset.topic))));
}

/* ─────────────── الإذاعات ─────────────── */
function renderRadios() {
  const q = ui.query.trim();
  const list = q ? DB.radios.filter((r) => r.ar.includes(q)) : DB.radios;
  el.view.innerHTML = `
    <p class="muted small">بث مستمر لا ينتهي — مناسب للنوم، لا يحتاج مؤقّت مقطع. (${DB.radios.length} إذاعة)</p>
    <div class="toolbar"><input id="q" class="search" type="search" placeholder="ابحث في الإذاعات…" value="${esc(q)}" /></div>
    <div class="list">
      ${list.map((r) => `<button class="row" data-radio="${esc(r.id)}">
        <span class="row-art">📻</span>
        <span class="row-main"><b>${esc(r.ar)}</b><small>بث مستمر ٢٤ ساعة</small></span>
      </button>`).join("") || '<p class="muted pad">لا نتائج.</p>'}
    </div>`;
  const input = $("q");
  input.addEventListener("input", (e) => { ui.query = e.target.value; const p = e.target.selectionStart; renderRadios(); $("q").focus(); $("q").setSelectionRange(p, p); });
  el.view.querySelectorAll("[data-radio]").forEach((b) => b.addEventListener("click", () => {
    const r = DB.radios.find((x) => x.id === b.dataset.radio);
    startQueue([{ url: r.url, title: r.ar, sub: "بث مستمر", kind: "stream" }], { kind: "radio", radioId: r.id, label: r.ar, index: 0, time: 0 });
  }));
}

/* ─────────────── محفوظ على جهازي ─────────────── */
async function renderOffline() {
  const items = (await off.list()).sort((a, b) => b.at - a.at);
  const u = await off.usage();
  const mb = (n) => (n / 1048576).toFixed(1) + " م.ب";
  el.view.innerHTML = `
    <div class="card">
      <b>المساحة المستعملة</b>
      <p class="muted small">${u ? `${mb(items.reduce((s, i) => s + (i.size || 0), 0))} من أصل متاح ${mb(u.quota)} — المتصفح قد يمنح مساحة أكبر عند الحاجة.` : "غير معروف على هذا المتصفح."}</p>
      <p class="muted small">المقاطع محفوظة في جهازك أنت، ولا تُرسل لأي جهة. تحقّق دائمًا أنك لم تحفظ إلا ما أردت.</p>
    </div>
    <div class="list">
      ${items.map((i) => `<div class="row-wrap">
        <div class="row static">
          <span class="row-main"><b>${esc(i.label || i.url.split("/").pop())}</b><small>${esc(i.sub || "")} · ${mb(i.size || 0)} · ${new Date(i.at).toLocaleDateString("ar")}</small></span>
        </div>
        <button class="row-act danger" data-del="${esc(i.url)}" aria-label="احذف">🗑</button>
      </div>`).join("") || '<p class="muted pad">لا شيء محفوظ بعد. افتح سورة واضغط ⤓ لحفظها للاستماع بلا إنترنت.</p>'}
    </div>
    ${items.length ? '<button class="btn danger wide" data-act="clear">حذف كل المحفوظ</button>' : ""}
  `;
  el.view.querySelectorAll("[data-del]").forEach((b) => b.addEventListener("click", async () => {
    await off.del(b.dataset.del); store.unmarkOffline(b.dataset.del); notify("حُذف ✅"); renderOffline();
  }));
  el.view.querySelector("[data-act='clear']")?.addEventListener("click", async () => {
    if (!(await ask("حذف كل المحفوظ؟", "سيُحذف الصوت المحفوظ على جهازك فقط. لا يمكن التراجع.", "احذف الكل"))) return;
    await off.clear(); store.setPrefs({ offlineKeys: [] }); notify("حُذف الكل"); renderOffline();
  });
}

/* ─────────────── بناء الطوابير ─────────────── */
function surahItems(r, s) {
  const sr = DB.surahBy.get(s);
  if (!sr) return [];
  if (r.full && (r.full.surahs === "all" || r.full.surahs.includes(s))) {
    return [{ url: r.full.base + pad3(s) + ".mp3", title: sr.name, sub: r.ar, kind: "surah", s, reciterId: r.id }];
  }
  if (r.ayah) {
    return Array.from({ length: sr.verses }, (_, i) => ({
      url: r.ayah.base + pad3(s) + pad3(i + 1) + ".mp3",
      title: `${sr.name} · ${i + 1}`, sub: r.ar, kind: "ayah", s, a: i + 1, reciterId: r.id,
    }));
  }
  return [];
}

function topicItems(t, r) {
  if (t.kind === "surahs") return t.surahs.flatMap((s) => surahItems(r, s));
  if (!r?.ayah) return [];
  return t.ranges.flatMap((rg) => Array.from({ length: rg.to - rg.from + 1 }, (_, i) => {
    const a = rg.from + i;
    return { url: r.ayah.base + pad3(rg.s) + pad3(a) + ".mp3", title: `${surahName(rg.s)} · ${a}`, sub: `${r.ar} · ${t.title}`, kind: "ayah", s: rg.s, a, topicId: t.id };
  }));
}

function playSurah(s, r) {
  const items = surahItems(r, s);
  if (!items.length) return notify("تعذّر تشغيل هذه السورة بهذا القارئ.");
  startQueue(items, { kind: "surah", reciterId: r.id, surah: s, index: 0, time: 0, label: `${surahName(s)} — ${r.ar}` });
}

function playTopic(t) {
  const r = t.kind === "surahs" ? (reciterOf(ui.reciterId) || reciterOf(ui.ayahReciterId)) : reciterOf(ui.ayahReciterId);
  if (!r) return notify("اختر قارئاً يدعم المقتطفات أولاً (📖).");
  if (t.kind === "ayahs" && !r.ayah) return notify(`القارئ ${r.ar} لا يدعم المقتطفات — بدّله من أعلى الصفحة.`);
  const items = topicItems(t, r);
  if (!items.length) return notify("لا يوجد محتوى لهذا الموضوع بهذا القارئ.");
  startQueue(items, { kind: "topic", topicId: t.id, reciterId: r.id, index: 0, time: 0, label: `${t.title} — ${r.ar}` });
}

async function startQueue(items, spec) {
  store.saveSession({ ...spec, at: Date.now() });
  await player.setQueue(items, { autoplay: true, startIndex: spec.index || 0, time: spec.time || 0 });
  openPlayer();
  renderPlayerState(player.state());
}

function buildFromSpec(s) {
  const r = reciterOf(s.reciterId);
  if (!r) return null;
  let items = [];
  if (s.kind === "surah") items = surahItems(r, s.surah);
  else if (s.kind === "topic") { const t = DB.topics.find((x) => x.id === s.topicId); if (t) items = topicItems(t, r); }
  else if (s.kind === "radio") { const rd = DB.radios.find((x) => x.id === s.radioId); if (rd) items = [{ url: rd.url, title: rd.ar, sub: "بث مستمر", kind: "stream" }]; }
  return items.length ? items : null;
}

/* ─────────────── الحفظ بلا إنترنت ─────────────── */
async function saveItems(items, label) {
  const list = items.filter((i) => i.kind !== "stream");
  if (!list.length) return notify("البث المستمر لا يُحفظ — اختر سورة أو مقتطفاً.");
  const todo = [];
  for (const it of list) { if (!(await off.get(it.url))) todo.push(it); }
  if (!todo.length) return notify("محفوظ على جهازك مسبقاً ✅");

  const approx = todo.length === 1 ? "ملف واحد" : `${todo.length} ملفاً`;
  if (todo.length > 25) {
    const ok = await ask("حفظ عدد كبير من الملفات؟",
      `«${label}» يحتاج تحميل ${approx}. قد يستهلك مساحة معتبرة على جوالك. يمكنك حذفه لاحقاً من «محفوظ على جهازي».`, "احفظ");
    if (!ok) return;
  }
  await off.persist();
  ui.cancelSave = false;
  el.banner.hidden = false;
  let done = 0, bytes = 0;
  for (const it of todo) {
    if (ui.cancelSave) break;
    try {
      const res = await off.download(it.url, { label: it.title, sub: it.sub }, (got, total) => {
        const pct = total ? Math.round((got / total) * 100) : 0;
        el.bannerText.textContent = `حفظ ${done + 1}/${todo.length} — ${it.title} (${pct}%)`;
      });
      store.markOffline(it.url); done++; bytes += res.size;
    } catch (e) {
      el.bannerText.textContent = `تعذّر حفظ «${it.title}»: ${e.message}`;
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
  el.banner.hidden = true;
  notify(ui.cancelSave ? `أُوقف الحفظ (${done} من ${todo.length})` : `تم الحفظ ✅ ${done} ملفاً (${(bytes / 1048576).toFixed(1)} م.ب)`);
  render();
}

/* ─────────────── المشغّل ─────────────── */
function openPlayer() { el.player.hidden = false; document.body.classList.add("locked"); renderPlayerState(player.state()); }
function closePlayer() { el.player.hidden = true; document.body.classList.remove("locked"); }

function renderPlayerState(st) {
  const it = st.item;
  if (!it) {
    el.bar.hidden = true;
    if (!el.player.hidden) closePlayer();
    return;
  }
  el.bar.hidden = false;
  el.barTitle.textContent = it.title;
  el.barSub.textContent = it.sub || "";
  el.barToggle.textContent = st.playing ? "❚❚" : "▶";
  el.barTimer.hidden = !st.timerSet;
  if (st.timerSet) el.barTimer.textContent = "⏳ " + fmt(st.timerLeft);

  el.plTitle.textContent = it.title;
  el.plSub.textContent = it.sub || "";
  el.plRe.textContent = it.kind === "stream" ? "بث مستمر" : (st.total > 1 ? `${st.index + 1} / ${st.total}` : "");
  el.plToggle.textContent = st.playing ? "❚❚" : "▶";
  el.plRepeat.setAttribute("aria-pressed", String(st.repeat));
  el.plRepeat.classList.toggle("on", st.repeat);
  el.plTimer.classList.toggle("on", st.timerSet);
  el.plTimer.textContent = st.timerSet ? "⏳ " + fmt(st.timerLeft) : "⏳ مؤقّت النوم";
  el.plSeek.style.visibility = it.kind === "stream" ? "hidden" : "";
  if (!ui.drag) {
    const pc = st.duration ? (st.time / st.duration) * 100 : 0;
    el.plFill.style.width = pc + "%";
    el.plNow.textContent = fmt(st.time);
    el.plDur.textContent = st.duration ? fmt(st.duration) : "--:--";
  }
  const saved = store.offlineKeys().has(it.url);
  el.plOfflineNote.textContent = saved ? "✓ محفوظ على جهازك" : "";
  el.plOffline.textContent = saved ? "✓" : "⤓";
}

/* ─────────────── الشرائح (sheets) ─────────────── */
let sheetClose = null;
function openSheet(title, html, after) {
  el.sheetTitle.textContent = title;
  el.sheetBody.innerHTML = html;
  el.sheet.hidden = false;
  after?.(el.sheetBody);
  return new Promise((res) => {
    sheetClose = (v) => { el.sheet.hidden = true; sheetClose = null; res(v); };
  });
}
function closeSheet(v = undefined) { sheetClose?.(v); }

function pickReciter({ ayahOnly = false, onPick }) {
  const list = (ui.scope === "all" && !ayahOnly ? DB.all : DB.featured).filter((r) => !ayahOnly || r.ayah);
  openSheet(ayahOnly ? "قارئ المقتطفات" : "اختر قارئاً", `
    <div class="list">
      ${list.map((r) => `<button class="row" data-pick="${esc(r.id)}">
        <span class="row-main"><b>${esc(r.ar)}</b><small>${esc(r.rewaya || r.full?.moshaf || "")}</small></span>
      </button>`).join("") || '<p class="muted pad">لا يوجد قارئ يدعم المقتطفات.</p>'}
    </div>`, (body) => {
    body.querySelectorAll("[data-pick]").forEach((b) => b.addEventListener("click", () => { closeSheet(); onPick(b.dataset.pick); }));
  });
}

function timerSheet() {
  const st = player.state();
  openSheet("مؤقّت النوم", `
    <div class="grid2">
      ${[10, 20, 30, 45, 60, 90].map((m) => `<button class="btn" data-min="${m}">${m} دقيقة</button>`).join("")}
    </div>
    <button class="btn wide ${st.timerSet || player.stopAtEnd ? "on" : ""}" data-min="end">توقّف عند نهاية المقطع</button>
    <label class="switch"><input type="checkbox" id="fade" ${(st.timerFade ?? true) ? "checked" : ""}> <span>تلاشٍ تدريجي في آخر ٢٠ ثانية</span></label>
    <button class="btn wide danger" data-min="off">إلغاء المؤقّت</button>
    <p class="muted small">المؤقّت يعمل والمشغّل في الخلفية والشاشة مطفأة — يوقف الصوت وحده عند انتهاء الوقت.</p>
  `, (body) => {
    const fade = () => body.querySelector("#fade").checked;
    body.querySelector('[data-min="off"]').addEventListener("click", () => { player.clearTimer(); closeSheet(); });
    body.querySelector('[data-min="end"]').addEventListener("click", () => { player.setStopAtEnd(); closeSheet(); notify("سيتوقف عند نهاية المقطع"); });
    body.querySelectorAll("[data-min]:not([data-min='off']):not([data-min='end'])").forEach((b) => b.addEventListener("click", () => {
      player.setTimer(Number(b.dataset.min), { fade: fade() }); closeSheet();
      notify(`مؤقّت النوم: ${b.dataset.min} دقيقة${fade() ? " مع تلاشٍ" : ""}`);
    }));
  });
}

function ask(title, body, okLabel = "تأكيد") {
  return openSheet(title, `<p class="muted">${esc(body)}</p>
    <div class="row2"><button class="btn danger" data-ok>${esc(okLabel)}</button><button class="btn" data-no>إلغاء</button></div>`,
    (b) => {
      b.querySelector("[data-ok]").addEventListener("click", () => closeSheet(true));
      b.querySelector("[data-no]").addEventListener("click", () => closeSheet(false));
    });
}

/* ─────────────── الربط ─────────────── */
function wire() {
  el.back.addEventListener("click", () => history.back());
  el.view.addEventListener("click", (e) => {
    const g = e.target.closest("[data-go]"); if (g) return go(g.dataset.go);
    const a = e.target.closest("[data-act='continue']"); if (a) return resume();
  });

  el.barToggle.addEventListener("click", () => player.toggle());
  el.barOpen.addEventListener("click", openPlayer);
  el.plToggle.addEventListener("click", () => player.toggle());
  $("pl-prev").addEventListener("click", () => player.prev());
  $("pl-next").addEventListener("click", () => player.next());
  $("pl-back").addEventListener("click", () => player.skip(-15));
  $("pl-fwd").addEventListener("click", () => player.skip(30));
  $("pl-close").addEventListener("click", closePlayer);
  el.plTimer.addEventListener("click", timerSheet);
  el.plRepeat.addEventListener("click", () => { player.setRepeat(!player.repeat); notify(player.repeat ? "تكرار الطابور مُفعّل" : "التكرار متوقف"); });
  el.plOffline.addEventListener("click", () => saveItems(player.items, player.item?.title || "المقطع"));
  el.bannerCancel.addEventListener("click", () => { ui.cancelSave = true; });

  $("sheet-close").addEventListener("click", () => closeSheet());
  $("sheet-backdrop").addEventListener("click", () => closeSheet());

  // شريط التقدّم: سحب بإصبع أو فأرة
  const seek = (e) => {
    const r = el.plBar.getBoundingClientRect();
    const x = (e.touches?.[0]?.clientX ?? e.clientX) - r.left;
    const frac = (document.documentElement.dir || "rtl") === "rtl" ? 1 - x / r.width : x / r.width;
    return Math.max(0, Math.min(1, frac));
  };
  el.plBar.addEventListener("pointerdown", (e) => { ui.drag = true; el.plBar.setPointerCapture(e.pointerId); const f = seek(e); el.plFill.style.width = f * 100 + "%"; el.plNow.textContent = fmt(f * (player.state().duration || 0)); });
  el.plBar.addEventListener("pointermove", (e) => { if (!ui.drag) return; const f = seek(e); el.plFill.style.width = f * 100 + "%"; el.plNow.textContent = fmt(f * (player.state().duration || 0)); });
  el.plBar.addEventListener("pointerup", (e) => { if (!ui.drag) return; ui.drag = false; player.seekTo(seek(e)); });

  document.addEventListener("keydown", (e) => {
    if (e.target.matches("input,textarea")) return;
    if (e.code === "Space") { e.preventDefault(); player.toggle(); }
    if (e.code === "ArrowLeft") player.skip(-15);
    if (e.code === "ArrowRight") player.skip(15);
  });

  player.onchange = renderPlayerState;
  player.onnotice = notify;
  player.ontick = () => {
    const st = player.state();
    const s = store.session();
    if (st.item && s) store.saveSession({ ...s, index: st.index, time: st.time });
  };
  player.onendedQueue = (auto) => { if (auto) notify("انتهى الطابور 🌙"); };

  document.addEventListener("click", (e) => { const c = e.target.closest("[data-close-sheet]"); if (c) closeSheet(); });
}

/* ─────────────── متابعة آخر جلسة ─────────────── */
async function resume() {
  const s = store.session();
  if (!s) return;
  const items = buildFromSpec(s);
  if (!items) { store.clearSession(); notify("لا يمكن المتابعة — البيانات تغيّرت."); render(); return; }
  await player.setQueue(items, { autoplay: true, startIndex: Math.min(s.index || 0, items.length - 1), time: s.time || 0 });
  openPlayer();
  renderPlayerState(player.state());
}

boot();

/* خطّاف تشخيصي للتطوير والاختبار الآلي (لا يغيّر أي سلوك) */
window.__qn = {
  get player() { return player; },
  get db() { return DB; },
  get ui() { return ui; },
  store, off, version: () => version,
};
