/**
 * offline.js — مخزن الصوت في جهاز المستخدم وحده (IndexedDB).
 *
 * لماذا IndexedDB لا Service Worker؟ لأن تشغيل مقطع من مخزن عبر Service Worker
 * يحتاج دعم طلبات النطاق (Range) يدوياً، وهو هشّ على بعض المتصفحات. أما حفظ
 * Blob في IndexedDB ثم تشغيله من blob: فمضمون، والتقديم والترجيع يعملان فيه.
 *
 * لا يُرسَل شيء إلى أي جهة — الحفظ على الجوال نفسه، وبقرار صريح من المستخدم.
 */
const DB = "qn-offline";
const ST = "audio";

let dbp = null;
function open() {
  if (dbp) return dbp;
  dbp = new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains(ST)) db.createObjectStore(ST, { keyPath: "url" });
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  return dbp;
}

const req = (store, fn) => new Promise((res, rej) => {
  const r = fn(store);
  r.onsuccess = () => res(r.result);
  r.onerror = () => rej(r.error);
});

export async function put(url, blob, meta = {}) {
  const db = await open();
  const store = db.transaction(ST, "readwrite").objectStore(ST);
  await req(store, (s) => s.put({ url, blob, size: blob.size, at: Date.now(), ...meta }));
  return true;
}
export async function get(url) {
  const db = await open();
  return (await req(db.transaction(ST, "readonly").objectStore(ST), (s) => s.get(url))) || null;
}
export async function list() {
  const db = await open();
  return (await req(db.transaction(ST, "readonly").objectStore(ST), (s) => s.getAll())) || [];
}
export async function del(url) {
  const db = await open();
  await req(db.transaction(ST, "readwrite").objectStore(ST), (s) => s.delete(url));
}
export async function clear() {
  const db = await open();
  await req(db.transaction(ST, "readwrite").objectStore(ST), (s) => s.clear());
}
export async function count() {
  const db = await open();
  return (await req(db.transaction(ST, "readonly").objectStore(ST), (s) => s.count())) || 0;
}
export async function usage() {
  try {
    if (navigator.storage?.estimate) {
      const e = await navigator.storage.estimate();
      return { used: e.usage || 0, quota: e.quota || 0 };
    }
  } catch { /* غير مدعوم */ }
  return null;
}
/** نطلب من المتصفح ألّا يحذف مخزننا عند ضيق المساحة */
export async function persist() {
  try { return (await navigator.storage?.persist?.()) || false; } catch { return false; }
}

/** ينزّل رابطاً ويخزّنه، مع تقرير تقدّم بالبايتات */
export async function download(url, meta = {}, onProgress = null) {
  const r = await fetch(url, { mode: "cors" });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const total = +(r.headers.get("content-length") || 0);
  let blob;
  if (r.body && onProgress) {
    const reader = r.body.getReader();
    const parts = [];
    let got = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      parts.push(value);
      got += value.length;
      onProgress(got, total);
    }
    blob = new Blob(parts, { type: "audio/mpeg" });
  } else {
    blob = await r.blob();
    onProgress?.(blob.size, total || blob.size);
  }
  await put(url, blob, meta);
  return { size: blob.size };
}
