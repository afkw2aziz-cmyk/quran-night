/**
 * verify.mjs — اختبار التطبيق بأمر واحد: `npm test`
 *
 * يفحص:
 *   ١) سلامة البيانات المولَّدة (سور · قراء · مواضيع · إذاعات) واتساقها الداخلي.
 *   ٢) أن كل رابط صوت يبدأ بـ https وينتهي بنمط صحيح.
 *   ٣) أن الإصدار واحد في: package.json = version.json = sw.js = الكاش.
 *   ٤) أن كل ملف يطلبه index.html أو sw.js موجود فعلاً على القرص.
 *   ٥) أن ملفات الأسرار لا وجود لها في المستودع.
 *
 * الخيار --net يفحص أيضاً ٣ روابط صوت حقيقية على الشبكة.
 */
import { readFile, access } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const NET = process.argv.includes("--net");

let pass = 0;
const fails = [];
const ok = (cond, label, extra = "") => {
  if (cond) { pass++; console.log("   ✅ " + label); }
  else { fails.push(label + (extra ? ` — ${extra}` : "")); console.log("   ❌ " + label + (extra ? ` — ${extra}` : "")); }
};
const read = (p) => readFile(join(ROOT, p), "utf8");
const readJson = async (p) => JSON.parse(await read(p));
const exists = async (p) => { try { await access(join(ROOT, p)); return true; } catch { return false; } };

console.log("══ اختبار تلاوة الليل ══\n");

/* ١) البيانات */
console.log("١) البيانات المولَّدة");
const surahs = (await readJson("data/surahs.json")).surahs;
const rec = await readJson("data/reciters.json");
const topics = (await readJson("data/topics.json")).topics;
const radios = await readJson("data/radios.json");

ok(surahs.length === 114, "١١٤ سورة", `وجد ${surahs.length}`);
ok(surahs.reduce((s, x) => s + x.verses, 0) === 6236, "مجموع الآيات ٦٢٣٦", String(surahs.reduce((s, x) => s + x.verses, 0)));
ok(surahs.every((s, i) => s.n === i + 1), "أرقام السور متتابعة ١..١١٤");
ok(surahs.every((s) => s.name && s.verses > 0), "لكل سورة اسم وعدد آيات");

ok(rec.featured.length >= 20, "قائمة منتقاة معتبرة", String(rec.featured.length));
ok(rec.all.length >= 100, "كتلوج كامل واسع", String(rec.all.length));
ok(rec.counts.withAyah >= 10, "قراء يدعمون المقتطفات", String(rec.counts.withAyah));

const idsF = rec.featured.map((r) => r.id);
const idsA = rec.all.map((r) => r.id);
ok(new Set(idsF).size === idsF.length, "معرّفات المنتقين لا تتكرّر", String(idsF.length - new Set(idsF).size));
ok(new Set(idsA).size === idsA.length, "معرّفات الكتلوج الكامل لا تتكرّر", String(idsA.length - new Set(idsA).size));
// المنتقى قد يضم قارئاً بمصدر آية-بآية فقط (بلا مصحف كامل) — وهذا مقبول ومقصود.
const orphan = idsF.filter((id) => !idsA.includes(id) && rec.featured.find((f) => f.id === id)?.full);
ok(orphan.length === 0, "كل منتقى له مصحف كامل موجود في الكتلوج الكامل", orphan.slice(0, 3).join(" "));
const badUrl = [...rec.featured, ...rec.all].flatMap((r) => [r.full?.base, r.ayah?.base]).filter((u) => u && !/^https:\/\/.+\/$/.test(u));
ok(badUrl.length === 0, "كل الروابط https وتنتهي بـ/", badUrl.slice(0, 3).join(" "));

// ثوابت بنيوية: كانت غيابها يخفي خللاً حقيقياً (قارئ بلا مصدر صوت)
const noSource = [...rec.featured, ...rec.all].filter((r) => !r.full && !r.ayah);
ok(noSource.length === 0, "كل قارئ له مصدر صوت (مصحف أو آية-بآية)", noSource.slice(0, 3).map((r) => r.ar).join(" "));
const badFull = [...rec.featured, ...rec.all].filter((r) => r.full && (!r.full.base || !(r.full.surahs === "all" || Array.isArray(r.full.surahs))));
ok(badFull.length === 0, "كل مصحف له base وقائمة سور صحيحة", badFull.slice(0, 3).map((r) => r.ar).join(" "));
const badPartial = [...rec.featured, ...rec.all].filter((r) => r.full?.partial && !(r.full.count >= 100));
ok(badPartial.length === 0, "المصاحف الناقصة معلَّمة بعدد سورها", badPartial.slice(0, 3).map((r) => r.ar).join(" "));

const versesOf = new Map(surahs.map((s) => [s.n, s.verses]));
const badRange = topics.filter((t) => t.kind === "ayahs").flatMap((t) => t.ranges.filter((r) => !versesOf.has(r.s) || r.from < 1 || r.to > versesOf.get(r.s) || r.from > r.to).map((r) => `${t.id} ${r.s}:${r.from}-${r.to}`));
ok(badRange.length === 0, "كل نطاقات المواضيع داخل حدود السور", badRange.slice(0, 3).join(" "));
const badTopicSurah = topics.filter((t) => t.kind === "surahs").flatMap((t) => t.surahs.filter((n) => !versesOf.has(n)));
ok(badTopicSurah.length === 0, "أرقام سور المواضيع صحيحة", badTopicSurah.join(","));
ok(topics.every((t) => t.note), "كل موضوع معلَّم بأنه «مختارات»");

ok(radios.radios.every((r) => /^https:\/\//.test(r.url)), "روابط الإذاعات https");
ok(new Set(radios.radios.map((r) => r.id)).size === radios.radios.length, "معرّفات الإذاعات لا تتكرّر");

/* ٢) الإصدار */
console.log("\n٢) الإصدار (مصدر واحد)");
const pkg = await readJson("package.json");
const ver = await readJson("version.json");
const sw = await read("sw.js");
const swVer = sw.match(/const VERSION = "([^"]+)"/)?.[1];
ok(pkg.version === ver.version, "package.json = version.json", `${pkg.version} ≠ ${ver.version}`);
ok(pkg.version === swVer, "package.json = sw.js", `${pkg.version} ≠ ${swVer}`);
ok(/^qn-shell-/.test(sw.match(/const SHELL = `([^`]+)`/)?.[1] || ""), "اسم كاش sw.js مشتق من الإصدار");

/* ٣) الملفات المطلوبة */
console.log("\n٣) الملفات المطلوبة");
const html = await read("index.html");
const needed = [
  ...[...html.matchAll(/(?:href|src)="(?!https?:|#)([^"]+)"/g)].map((m) => m[1]),
  ...[...sw.matchAll(/"((?:css|js|assets|data)\/[^"]+|\w+\.(?:html|json|webmanifest|js))"/g)].map((m) => m[1]),
  ...[...sw.matchAll(/\[([^\]]*)\]/g)].flatMap((m) => [...m[1].matchAll(/"([^"]+\.(?:css|js|json|png|html|webmanifest))"/g)].map((x) => x[1])),
];
const uniq = [...new Set(needed)].filter((p) => !p.startsWith("manifest") || p === "manifest.webmanifest");
const missing = [];
for (const p of uniq) if (!(await exists(p))) missing.push(p);
ok(missing.length === 0, `كل الملفات المطلوبة موجودة (${uniq.length} ملفاً)`, missing.join(" "));

const jsFiles = ["js/app.js", "js/player.js", "js/offline.js", "js/store.js"];
const imports = [];
for (const f of jsFiles) imports.push(...[...(await read(f)).matchAll(/from\s+"\.\/([^"]+)"/g)].map((m) => "js/" + m[1]));
const missingImp = [];
for (const p of [...new Set(imports)]) if (!(await exists(p))) missingImp.push(p);
ok(missingImp.length === 0, "كل الاستيرادات الداخلية موجودة", missingImp.join(" "));

/* ٤) الأسرار */
console.log("\n٤) الأسرار");
const secrets = [".env", "certs/server.key", "config.local.json", "secrets/token.txt"];
const found = [];
for (const s of secrets) if (await exists(s)) found.push(s);
ok(found.length === 0, "لا ملفات أسرار في المشروع", found.join(" "));
const gi = await read(".gitignore");
ok(/\.env/.test(gi) && /\*\.key/.test(gi) && /node_modules\//.test(gi), "‎.gitignore يوقي الأسرار والاعتماديات");

/* ٥) الشبكة (اختياري) */
if (NET) {
  console.log("\n٥) فحص شبكي حقيقي");
  const ea = rec.featured.find((r) => r.ayah);
  const fu = rec.featured.find((r) => r.full);
  const samples = [
    ea.ayah.base + "001001.mp3",
    ea.ayah.base + "002286.mp3",
    fu.full.base + "036.mp3",
    radios.radios[0].url,
  ];
  for (const u of samples) {
    try {
      const r = await fetch(u, { headers: { Range: "bytes=0-1" }, signal: AbortSignal.timeout(15000) });
      const t = r.headers.get("content-type") || "";
      ok(r.status < 400 && /audio|mpeg|octet/i.test(t), `صوت: ${u.slice(0, 62)}`, `HTTP ${r.status} ${t}`);
    } catch (e) { ok(false, `صوت: ${u.slice(0, 62)}`, e.message); }
  }
}

console.log(`\n${fails.length ? "❌" : "✅"} النتيجة: ${pass} ناجح · ${fails.length} فاشل`);
if (fails.length) { console.log("\nالفاشل:"); fails.forEach((f) => console.log("   • " + f)); process.exit(1); }
if (!NET) console.log("   (لمُّ فحص الشبكة الحقيقي: node tools/verify.mjs --net)");
