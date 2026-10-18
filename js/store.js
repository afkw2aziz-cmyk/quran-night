/** store.js — تفضيلات المستخدم وموضع الاستماع الأخير (على جهازه وحده، localStorage). */

const P = "qn.prefs.v1";
const S = "qn.session.v1";

const readJson = (k) => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } };
const writeJson = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* الوضع الخاص قد يمنع */ } };

export function prefs() { return readJson(P) || {}; }
export function setPrefs(patch) { const p = { ...prefs(), ...patch }; writeJson(P, p); return p; }

/** موضع الاستماع: {kind, reciterId, surah, topicId, radioId, index, time, label, at} */
export function session() { const s = readJson(S); return s && s.at ? s : null; }
export function saveSession(s) { writeJson(S, { ...s, at: Date.now() }); }
export function clearSession() { try { localStorage.removeItem(S); } catch { } }

/** قائمة السور المحفوظة بلا إنترنت (المفاتيح = روابط الصوت) — لتلوين الصفوف */
export function offlineKeys() {
  const k = new Set(prefs().offlineKeys || []);
  return k;
}
export function markOffline(url) {
  const k = offlineKeys(); k.add(url);
  setPrefs({ offlineKeys: [...k] });
}
export function unmarkOffline(url) {
  const k = offlineKeys(); k.delete(url);
  setPrefs({ offlineKeys: [...k] });
}
