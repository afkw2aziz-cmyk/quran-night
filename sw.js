/**
 * sw.js — خدمة تشغيل التطبيق بلا إنترنت (هيكل الواجهة فقط).
 *
 * ⚠️ مهم: هذا الملف **لا** يخزّن أي صوت. الصوت إما يُبثّ من مصدره،
 * وإما يحفظه المستخدم بيده في مخزن الجهاز (IndexedDB عبر js/offline.js).
 *
 * VERSION يجب أن يطابق "version" في package.json — يتحقق منه `npm test`.
 */
const VERSION = "0.1.0";
const SHELL = `qn-shell-${VERSION}`;

const ASSETS = [
  "./",
  "index.html",
  "manifest.webmanifest",
  "css/style.css",
  "js/app.js",
  "js/player.js",
  "js/offline.js",
  "js/store.js",
  "data/surahs.json",
  "data/reciters.json",
  "data/topics.json",
  "data/radios.json",
  "version.json",
  "assets/icon-192.png",
  "assets/icon-512.png",
  "assets/icon-maskable-512.png",
  "assets/apple-touch-icon-180.png",
  "assets/favicon-32.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(SHELL);
    // نضيف واحداً واحداً: فشل ملف لا يُفشل التثبيت كله
    await Promise.all(ASSETS.map((u) => c.add(new Request(u, { cache: "reload" })).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith("qn-shell-") && k !== SHELL).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (e) => {
  const { request } = e;
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // لا نتدخّل في الأصوات إطلاقاً: البثّ من CDN أو blob محلي
  if (request.destination === "audio" || /\.(mp3|m4a|aac|ogg|opus)(\?|$)/i.test(url.pathname)) return;
  if (url.origin !== self.location.origin) return;

  // بيانات الكتلوج: من المخزن فوراً ثم تحديث خلفي
  if (url.pathname.includes("/data/") && url.pathname.endsWith(".json")) {
    e.respondWith((async () => {
      const c = await caches.open(SHELL);
      const hit = await c.match(request, { ignoreSearch: true });
      const net = fetch(request).then((r) => { if (r.ok) c.put(request, r.clone()); return r; }).catch(() => null);
      return hit || (await net) || new Response('{"error":"offline"}', { headers: { "Content-Type": "application/json" } });
    })());
    return;
  }

  // بقية هيكل التطبيق: المخزن أولاً (يعمل بلا إنترنت)
  e.respondWith((async () => {
    const c = await caches.open(SHELL);
    const hit = await c.match(request, { ignoreSearch: true });
    if (hit) return hit;
    try {
      const r = await fetch(request);
      if (r.ok && r.type === "basic") c.put(request, r.clone());
      return r;
    } catch {
      return (await c.match("index.html")) || Response.error();
    }
  })());
});
