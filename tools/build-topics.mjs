/**
 * build-topics.mjs — يحوّل tools/topics.draft.json إلى:
 *   data/topics.json  (يقرأه التطبيق)
 *   TOPICS.md         (ورقة مراجعة: نص كل آية في كل مقتطف، لتراجعها بعينك)
 *
 * مبادئ:
 *   ١) لا نكتب نطاقاً لم نتحقق من صحته مقابل عدد آيات السورة الحقيقي.
 *   ٢) النص يُجلب من quran.com v4 ليظهر لك في ورقة المراجعة (لا يُستعمل في التشغيل).
 *   ٣) كل مقتطف معلَّم بأنه «مختارات» لا قائمة شرعية مُتفَق عليها.
 *
 * التشغيل: node tools/build-topics.mjs        (يُخزّن النصوص في tools/.cache)
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DATA = join(ROOT, "data");
const CACHE = join(ROOT, "tools", ".cache");
const UA = "quran-night/0.1 (topics builder)";

const draft = JSON.parse(await readFile(join(ROOT, "tools", "topics.draft.json"), "utf8"));
const surahs = JSON.parse(await readFile(join(DATA, "surahs.json"), "utf8")).surahs;
const versesOf = new Map(surahs.map((s) => [s.n, s.verses]));
const nameOf = new Map(surahs.map((s) => [s.n, s.name]));

/** يجلب نص سورة كاملة (مع تخزين مؤقت) */
async function chapterText(n) {
  await mkdir(CACHE, { recursive: true });
  const f = join(CACHE, `ch-${n}.json`);
  if (existsSync(f)) return JSON.parse(await readFile(f, "utf8"));
  const errors = [];
  for (const script of ["imlaei", "uthmani"]) {
    try {
      const r = await fetch(`https://api.quran.com/api/v4/quran/verses/${script}?chapter_number=${n}`, {
        headers: { "User-Agent": UA }, signal: AbortSignal.timeout(30000),
      });
      if (!r.ok) { errors.push(`${script}: HTTP ${r.status}`); continue; }
      const d = await r.json();
      if (!d.verses?.length) { errors.push(`${script}: لا آيات`); continue; }
      const out = { script, verses: d.verses.map((v) => ({ a: +v.verse_key.split(":")[1], t: v.text_imlaei || v.text_uthmani || "" })) };
      await writeFile(f, JSON.stringify(out));
      return out;
    } catch (e) { errors.push(`${script}: ${e.message}`); }
  }
  throw new Error(`تعذّر جلب نص السورة ${n} (${errors.join(" · ")})`);
}

const ok = [], problems = [], review = [];

for (const t of draft.topics) {
  const out = { id: t.id, title: t.title, emoji: t.emoji, desc: t.desc, kind: t.kind, note: t.note };

  if (t.kind === "surahs") {
    const bad = (t.surahs || []).filter((n) => !versesOf.has(n));
    if (bad.length) problems.push(`${t.title}: أرقام سور غير موجودة ${bad.join(",")}`);
    out.surahs = t.surahs.filter((n) => versesOf.has(n));
    out.ayahs = out.surahs.reduce((s, n) => s + versesOf.get(n), 0);
    ok.push(out);
    review.push(`\n## ${t.emoji} ${t.title}  \n_${t.desc} — ${t.note}_\n\n${out.surahs
      .map((n) => `- **${nameOf.get(n)}** (${n}) — ${versesOf.get(n)} آية`).join("\n")}\n`);
    continue;
  }

  out.ranges = [];
  const blocks = [];
  for (const spec of t.ranges) {
    const [s, rng] = spec.split(":");
    const sn = +s, [a1, a2] = rng.split("-").map(Number);
    const max = versesOf.get(sn);
    const to = a2 || a1;
    if (!max) { problems.push(`${t.title} → ${spec}: سورة غير موجودة`); continue; }
    if (a1 < 1 || to > max || a1 > to) { problems.push(`${t.title} → ${spec}: نطاق خارج السورة (عدد آياتها ${max})`); continue; }
    out.ranges.push({ s: sn, from: a1, to, count: to - a1 + 1 });
    const ch = await chapterText(sn);
    const txt = ch.verses.filter((v) => v.a >= a1 && v.a <= to);
    if (txt.length !== to - a1 + 1) { problems.push(`${t.title} → ${spec}: النص المسترجع ناقص (${txt.length}/${to - a1 + 1})`); continue; }
    blocks.push(txt.map((v) => `**${sn}:${v.a}** — ${v.t}`).join("\n\n"));
  }
  out.ayahs = out.ranges.reduce((s, r) => s + r.count, 0);
  out.blocks = out.ranges.length;
  ok.push(out);
  review.push(`\n## ${t.emoji} ${t.title}  \n_${t.desc} — ${t.note}_ — **${out.ayahs} آية · ${out.blocks} مقاطع**\n\n${blocks.join("\n\n")}\n`);
}

if (problems.length) {
  console.error("\n❌ نطاقات لم تجتز التحقق — لم يُكتب شيء:\n" + problems.map((p) => "   • " + p).join("\n"));
  process.exit(1);
}

const stamp = new Date().toISOString().slice(0, 10);
await mkdir(DATA, { recursive: true });

await writeFile(join(DATA, "topics.json"), JSON.stringify({
  generated: stamp,
  note: "مُولَّد آلياً بـ tools/build-topics.mjs. المقتطفات «مختارات» اجتهادية تُراجَع في TOPICS.md — لا نصوص شرعية مُتفَق عليها.",
  topics: ok,
}, null, 1) + "\n");

await writeFile(join(ROOT, "TOPICS.md"), `# ورقة مراجعة المقتطفات — تلاوة الليل

> هذا الملف مُولَّد آلياً بـ \`node tools/build-topics.mjs\` لتراجع بنفسك **نصّ كل آية**
> في كل مقتطف قبل أن يُنشر. النص من quran.com (سكربت مبسّط للقراءة).
> المقتطفات **مختارات اجتهادية** — ليست قائمة شرعية مُتفَق عليها، ولا تُنسب لفضيلة خاصة
> إلا بدليل. عدّل \`tools/topics.draft.json\` ثم أعد البناء.

**المجموع: ${ok.length} موضوعاً · ${ok.filter((t) => t.kind === "ayahs").reduce((s, t) => s + t.ayahs, 0)} آية في المقتطفات · ${ok.filter((t) => t.kind === "surahs").length} موضوعاً بسور كاملة**
${review.join("\n")}
---
_مُولِّد بتاريخ ${stamp}._
`);

console.log(`✅ ${ok.length} موضوعاً · ${ok.reduce((s, t) => s + (t.ayahs || 0), 0)} آية`);
console.log("   كُتب: data/topics.json + TOPICS.md (ورقة المراجعة)");
