/**
 * build-catalog.mjs — يبني كتلوج التطبيق من المصادر الحقيقية ويتحقق من كل رابط.
 *
 * المخرجات:
 *   data/surahs.json   — ١١٤ سورة: الاسم، عدد الآيات، مكية/مدنية      (quran.com v4)
 *   data/radios.json   — الإذاعات المستمرة المفحوصة                    (mp3quran v3)
 *   version.json       — نسخة التطبيق، مرآة لـpackage.json
 *   data/reciters.json — {"featured": [...], "all": [...]}
 *       featured: قائمة منتقاة (tools/reciters.map.json) بأسماء عربية مرتبة،
 *                 وبعضها يدعم المقتطفات (آية بآية من everyayah).
 *       all:      كل مصحف كامل في mp3quran، مع اسم الرواية/النسخة لكل واحد.
 *
 * دروس مهمة مُثبَّتة في هذا السكربت:
 *   ١) القارئ الواحد له عدة مصاحف (حفص · قالون · ورش · مجوَّد · معلِّم…)، ولا يجوز
 *      اختيار «الأكثر سوراً» أعمى — فقد كان الحصري يُنسب لقالون والمنشاوي للمعلِّم.
 *      لذلك: نستثني «المصحف المعلِّم» و«ترجمة معاني»، ونتصفّح بالاسم المطلوب.
 *   ٢) لا يُكتب في المخرجات إلا رابط **فُحص فعلياً** (سور ١ و٥٥ و١١٤).
 *
 * التشغيل: node tools/build-catalog.mjs
 */
import { writeFile, mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DATA = join(ROOT, "data");

const URL_MP3QURAN = "https://mp3quran.net/api/v3/reciters?language=ar";
const URL_RADIOS = "https://mp3quran.net/api/v3/radios?language=ar";
const URL_CHAPTERS = "https://api.quran.com/api/v4/chapters?language=ar";
const URL_EVERYAYAH_LIST = "https://everyayah.com/recitations_ayat.html";

const fullUrl = (base, s) => `${base}${String(s).padStart(3, "0")}.mp3`;
const ayahUrl = (base, s, a) => `${base}${String(s).padStart(3, "0")}${String(a).padStart(3, "0")}.mp3`;

const UA = "quran-night/0.1 (catalog builder; +https://github.com/afkw2aziz-cmyk)";
const EXCLUDE_RECITER = /ترجمة معاني|معاني القرآن/;   // ترجمات صوتية لا تلاوات
const EXCLUDE_MOSHAF = /المعلِّم|المعلم/;              // مصحف تعليمي (يُكرّر بعد المعلّم)
const MIN_SURAHS = 110;                               // أقل من ذلك = ثغرات كثيرة

/* ─────────────── أدوات ─────────────── */
const norm = (s) =>
  (s || "").replace(/[\u064B-\u0652\u0670\u0640\u06D6-\u06ED]/g, "")
    .replace(/[أإآٱ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه")
    .replace(/[^\u0600-\u06FFa-zA-Z0-9]/g, "").toLowerCase();

const slug = (s) => s.replace(/^https?:\/\//, "").replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase();
const baseOf = (server) => (server.startsWith("http") ? server : "https://" + server).replace(/\/?$/, "/");
const surahListOf = (m) => [...new Set(m.surah_list.split(",").map((x) => parseInt(x, 10)).filter(Number.isInteger))].sort((a, b) => a - b);

/** يُخزّن النص بلا تشكيل للعرض المستقر */
const clean = (s) => s.replace(/[\u064B-\u0652]/g, "");

/** يُجمّل اسم المصحف للعرض: «حفص عن عاصم - مرتل» ← «حفص · مرتل»، و«X - X» ← «X» */
function prettyMoshaf(name) {
  const n = clean(name).replace(/\s*-\s*/g, " - ").trim();
  const dup = n.match(/^(.+?)\s+-\s+(.+)$/);
  if (dup && dup[1] === dup[2]) return dup[1];
  return n.replace(/^حفص عن عاصم\s+-\s+/u, "حفص · ");
}

/**
 * اختيار المصحف الصحيح من بين مصاحف القارئ.
 * want: اسم رواية («ورش»، «قالون») أو "mujawwad" أو null (الافتراضي: حفص مرتل).
 */
function pickMoshaf(moshafs, want) {
  const score = (m) => {
    const n = m.name, cnt = surahListOf(m).length;
    let s = 0;
    if (cnt === 114) s += 30; else if (cnt >= MIN_SURAHS) s += 10;
    if (want === "mujawwad") { if (/مجود|مجوّد/.test(n)) s += 60; else if (/مرتل/.test(n)) s += 5; }
    else if (want) { if (n.includes(want)) s += 60; }
    else { if (/حفص/.test(n)) s += 30; if (/مرتل/.test(n)) s += 15; if (/تسجيل عام/.test(n)) s -= 10; }
    if (/مجود|مجوّد/.test(n) && want !== "mujawwad") s -= 25;
    return s;
  };
  return moshafs.slice().sort((a, b) => score(b) - score(a))[0];
}

async function getText(url, tries = 3) {
  for (let i = 1; i <= tries; i++) {
    try {
      const r = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(30000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.text();
    } catch (e) {
      if (i === tries) throw new Error(`${url} → ${e.message}`);
      await new Promise((r) => setTimeout(r, 800 * i));
    }
  }
}
const getJson = async (u) => JSON.parse(await getText(u));

const probeCache = new Map();
async function probe(url, { stream = false } = {}) {
  const key = (stream ? "s:" : "f:") + url;
  if (probeCache.has(key)) return probeCache.get(key);
  let res;
  try {
    const r = await fetch(url, {
      headers: { "User-Agent": UA, Range: "bytes=0-1" },
      signal: AbortSignal.timeout(stream ? 9000 : 20000),
    });
    const type = r.headers.get("content-type") || "";
    if (stream) await r.body?.cancel().catch(() => { });
    res = r.status >= 400 ? { ok: false, why: `HTTP ${r.status}` }
      : !/audio|mpeg|aac|ogg|octet-stream/i.test(type) ? { ok: false, why: `نوع غير صوتي: ${type}` }
        : { ok: true, status: r.status };
  } catch (e) {
    res = { ok: false, why: e.name === "TimeoutError" ? "انتهت المهلة" : e.message };
  }
  probeCache.set(key, res);
  return res;
}

/** يفحص أن مصحفاً يعمل فعلاً: سور ١ و٥٥ و١١٤ */
async function verifyMoshaf(base) {
  const samples = [1, 55, 114];
  const rs = await Promise.all(samples.map((s) => probe(fullUrl(base, s))));
  const bad = samples.filter((_, i) => !rs[i].ok);
  return { ok: bad.length === 0, bad, why: rs.find((r) => !r.ok)?.why };
}

async function pool(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); }
  }));
  return out;
}

/* ─────────────── ١) السور ─────────────── */
console.log("══ بناء الكتلوج ══\n\n١) السور من quran.com …");
const chRaw = await getJson(URL_CHAPTERS);
const surahs = chRaw.chapters.map((c) => ({
  n: c.id, name: c.name_arabic, en: c.name_simple,
  verses: c.verses_count, makki: c.revelation_place === "makkah",
}));
console.log(`   ✅ ${surahs.length} سورة · ${surahs.reduce((s, x) => s + x.verses, 0)} آية`);

/* ─────────────── ٢) مصاحف mp3quran ─────────────── */
console.log("\n٢) مصاحف mp3quran …");
const mq = await getJson(URL_MP3QURAN);
const byName = new Map();
const all = [];
let skipped = 0;
for (const r of mq.reciters) {
  if (EXCLUDE_RECITER.test(r.name)) { skipped++; continue; }
  const mos = r.moshaf.filter((m) => !EXCLUDE_MOSHAF.test(m.name));
  // نُدرجه في الفهرس دائماً — حتى لو كانت كل مصاحفه تعليمية، ليعرف السكربت السبب
  byName.set(norm(r.name), { name: r.name, moshafs: mos, letter: r.letter });
  if (!mos.length) { skipped++; continue; }
  for (const m of mos) {
    const list = surahListOf(m);
    if (list.length < MIN_SURAHS) { skipped++; continue; }
    const base = baseOf(m.server);
    all.push({
      id: slug(base), ar: r.name, letter: r.letter || r.name.slice(0, 1),
      rewaya: m.name, base,
      surahs: list.length === 114 ? "all" : list,
      partial: list.length !== 114, count: list.length,
    });
  }
}
const uniqBase = [...new Map(all.map((a) => [a.id, a])).values()];
console.log(`   ✅ ${mq.reciters.length} قارئاً · ${uniqBase.length} مصحفاً كاملاً أو شبه كامل · أُسقط ${skipped}`);

/* ─────────────── ٣) everyayah ─────────────── */
console.log("\n٣) مجلدات everyayah …");
const eaHtml = await getText(URL_EVERYAYAH_LIST);
const NON_RECITER = /^(English|MultiLanguage|quranpngs|QuranText|QuranText_jpg|timings_files|tools|translations|warsh|XML)$/;
const eaFolders = [...new Set([...eaHtml.matchAll(/everyayah\.com\/data\/([A-Za-z0-9_]+)\//g)].map((m) => m[1]))]
  .filter((f) => !NON_RECITER.test(f));
console.log(`   ✅ ${eaFolders.length} قارئاً بمصدر آية-بآية`);

/* ─────────────── ٤) الفحص ─────────────── */
const map = JSON.parse(await readFile(join(ROOT, "tools", "reciters.map.json"), "utf8"));
console.log(`\n٤) الفحص الفعلي: ${map.reciters.length} منتقى + ${uniqBase.length} مصحفاً …`);
const t0 = Date.now();

const featured = await pool(map.reciters, 6, async (e) => {
  const o = { id: null, ar: e.ar, rewaya: e.rewaya || "حفص", notes: [], full: null, ayah: null };
  const want = e.rewaya ? e.rewaya : /مجوَّد|مجود/.test(e.ar) ? "mujawwad" : null;

  const hit = byName.get(norm(e.mp3quran));
  if (!hit) o.notes.push(`mp3quran: لا يوجد «${e.mp3quran}»`);
  else if (!hit.moshafs.length) o.notes.push("mp3quran: كل مصاحفه تعليمية (المصحف المعلِّم) — استُبعدت");
  else {
    const m = pickMoshaf(hit.moshafs, want);
    const base = baseOf(m.server);
    const v = await verifyMoshaf(base);
    if (!v.ok) o.notes.push(`سور ناقصة على المصدر (${v.bad.join(",")} → ${v.why})`);
    else {
      const list = surahListOf(m);
      o.full = { base, surahs: list.length === 114 ? "all" : list, moshaf: m.name, partial: list.length !== 114, count: list.length };
      o.rewaya = e.rewaya || prettyMoshaf(m.name);
      o.id = slug(base);
    }
  }

  if (e.ayah) {
    if (!eaFolders.includes(e.ayah)) o.notes.push(`everyayah: لا يوجد مجلد «${e.ayah}»`);
    else {
      const base = `https://everyayah.com/data/${e.ayah}/`;
      const p1 = await probe(ayahUrl(base, 1, 1));
      const p2 = p1.ok ? await probe(ayahUrl(base, 2, 286)) : { ok: false, why: "تخطّي" };
      if (!p1.ok) o.notes.push(`مجلد المقتطفات ردّ ${p1.why}`);
      else if (!p2.ok) o.notes.push(`مجلد المقتطفات ناقص (البقرة ٢٨٦ → ${p2.why})`);
      else { o.ayah = { base, folder: e.ayah }; o.id = o.id || "ea-" + slug(e.ayah); }
    }
  }
  o.id = o.id || "ar-" + slug(e.ar);
  o.playable = Boolean(o.full || o.ayah);
  return o;
});

const good = featured.filter((f) => f.playable);
const bad = featured.filter((f) => !f.playable);

// فحص بقية المصاحف — لا يُكتب إلا السليم
const keep = [];
const dropped = [];
await pool(uniqBase, 6, async (r) => {
  const v = await verifyMoshaf(r.base);
  if (v.ok) keep.push(r);
  else dropped.push({ ar: r.ar, rewaya: r.rewaya, why: `سور ناقصة: ${v.bad.join(",")} (${v.why})` });
});

console.log(`   انتهى في ${((Date.now() - t0) / 1000).toFixed(1)} ثانية · طلبات فعلية: ${probeCache.size}`);
console.log(`   ✅ منتقى صالح: ${good.length}/${featured.length} · ❌ مرفوض: ${bad.length}`);
console.log(`   ✅ مصاحف صالحة: ${keep.length}/${uniqBase.length}${dropped.length ? ` (أُسقط ${dropped.length})` : ""}`);
console.log(`   📖 يدعم المقتطفات: ${good.filter((f) => f.ayah).length} قارئاً`);
if (bad.length) { console.log("\n   منتقون لم يجتازوا الفحص:"); bad.forEach((b) => console.log(`     • ${b.ar}: ${b.notes.join(" | ")}`)); }
const partialNotes = good.filter((f) => f.notes.length || f.full?.partial);
if (partialNotes.length) {
  console.log("\n   ملاحظات:");
  partialNotes.forEach((p) => console.log(`     • ${p.ar}: ${[p.full?.partial ? `مصحف من ${p.full.count} سورة` : null, ...p.notes].filter(Boolean).join(" | ")}`));
}
if (dropped.length) { console.log("\n   مصاحف مُسقطة:"); dropped.slice(0, 8).forEach((d) => console.log(`     • ${d.ar} (${d.rewaya}): ${d.why}`)); }

/* ─────────────── ٥) الإذاعات ─────────────── */
console.log("\n٥) الإذاعات المستمرة …");
let radios = [];
try {
  const rr = await getJson(URL_RADIOS);
  const checked = await pool(rr.radios, 8, async (r) => {
    const p = await probe(r.url, { stream: true });
    return p.ok ? { id: "radio-" + slug(String(r.url).split("/").filter(Boolean).pop() || r.name), ar: r.name, url: r.url } : null;
  });
  const seen = new Set();
  radios = checked.filter((c) => c && !seen.has(c.id) && seen.add(c.id));
  console.log(`   ✅ تعمل: ${radios.length} من ${rr.radios.length}`);
} catch (e) {
  console.log(`   ⚠️ تعذّر جلب الإذاعات: ${e.message}`);
}

/* ─────────────── الكتابة ─────────────── */
await mkdir(DATA, { recursive: true });
const stamp = new Date().toISOString().slice(0, 10);

await writeFile(join(DATA, "surahs.json"),
  JSON.stringify({ generated: stamp, source: "quran.com/api/v4/chapters", surahs }, null, 1) + "\n");

await writeFile(join(DATA, "radios.json"),
  JSON.stringify({ generated: stamp, source: "mp3quran.net/api/v3/radios", note: "بث مستمر لا ينتهي. كل رابط مفحوص فعلياً — والإذاعات المتعثرة تتغيّر، فأعد البناء عند الحاجة.", count: radios.length, radios }, null, 0) + "\n");

await writeFile(join(DATA, "reciters.json"),
  JSON.stringify({
    generated: stamp,
    note: "مُولَّد آلياً بـ tools/build-catalog.mjs — كل رابط هنا مفحوص فعلياً (سور ١ و٥٥ و١١٤). لا تُحرّره يدوياً؛ عدّل tools/reciters.map.json ثم أعد البناء.",
    sources: { full: "mp3quran.net/api/v3", ayah: "everyayah.com", surahs: "quran.com/api/v4" },
    counts: { featured: good.length, withAyah: good.filter((f) => f.ayah).length, all: keep.length },
    featured: good.map(({ id, ar, rewaya, full, ayah, notes }) => ({
      id, ar, rewaya,
      full: full ? { base: full.base, surahs: full.surahs, moshaf: full.moshaf, partial: !!full.partial } : null,
      ayah: ayah ? { base: ayah.base } : null,
      note: notes.join(" | ") || undefined,
    })),
    // بنية موحّدة مع «المنتقى»: full{base,surahs,...} و ayah:null — كي لا يفرّق
    // التطبيق بين قائمة وأخرى (خلل سابق: ١٦٦ قارئاً لم يعمل شيء عندهم).
    all: keep.map(({ id, ar, letter, rewaya, base, surahs, partial, count }) => ({
      id, ar, letter,
      rewaya: prettyMoshaf(rewaya),
      full: { base, surahs, moshaf: prettyMoshaf(rewaya), partial: !!partial, count },
      ayah: null,
    })),
  }, null, 0) + "\n");

const pkg = JSON.parse(await readFile(join(ROOT, "package.json"), "utf8"));
await writeFile(join(ROOT, "version.json"), JSON.stringify({ version: pkg.version, built: stamp }, null, 1) + "\n");

console.log(`\n✅ كُتب: data/surahs.json · data/radios.json (${radios.length}) · data/reciters.json (منتقى ${good.length} · الكل ${keep.length}) · version.json (${pkg.version})`);
