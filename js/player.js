/**
 * player.js — المشغّل: طابور، تشغيل في الخلفية، شاشة القفل، مؤقّت نوم بتلاشٍ تدريجي،
 * وتشغيل من مخزن الجهاز إن كان المقطع محفوظاً.
 *
 * لا يلمس الواجهة: يُخطر عبر onchange/ontick فقط، وapp.js يرسم.
 */
import * as offline from "./offline.js";

const FADE_SECONDS = 20;          // مدة التلاشي التدريجي قبل النوم
const TICK_SAVE_EVERY = 5000;     // كل كم نحفظ الموضع

export class Player {
  constructor() {
    this.el = new Audio();
    this.el.preload = "auto";
    this.el.volume = 1;

    this.items = [];
    this.index = -1;
    this.repeat = false;
    this.onchange = null;
    this.ontick = null;
    this.onnotice = null;
    this.onendedQueue = null;

    this._blobUrl = null;
    this._timer = null;      // {endsAt, fade}
    this._timerInt = null;
    this._lastSave = 0;
    this._warm = null;
    this.stopAtEnd = false;  // «توقّف عند نهاية المقطع»

    this.el.addEventListener("playing", () => this._emit());
    this.el.addEventListener("pause", () => this._emit());
    this.el.addEventListener("ended", () => this._onEnded());
    this.el.addEventListener("error", () => this._onError());
    this.el.addEventListener("timeupdate", () => this._tick());
    this.el.addEventListener("loadedmetadata", () => this._emit());

    this._mediaSession();
  }

  /* ───────────── معلومات ───────────── */
  get item() { return this.items[this.index] || null; }
  get playing() { return !this.el.paused && !this.el.ended; }

  state() {
    const t = this._timer;
    return {
      item: this.item,
      index: this.index,
      total: this.items.length,
      playing: this.playing,
      time: this.el.currentTime || 0,
      duration: Number.isFinite(this.el.duration) ? this.el.duration : 0,
      repeat: this.repeat,
      timerLeft: t ? Math.max(0, Math.round((t.endsAt - Date.now()) / 1000)) : 0,
      timerSet: Boolean(t),
      timerFade: Boolean(t?.fade),
      buffering: this.el.readyState < 3 && !this.el.paused,
    };
  }

  _emit() { this.onchange?.(this.state()); }

  _tick() {
    this._emit();
    if ("mediaSession" in navigator && Number.isFinite(this.el.duration) && this.el.duration > 0) {
      try {
        navigator.mediaSession.setPositionState({
          duration: this.el.duration,
          playbackRate: this.el.playbackRate,
          position: Math.min(this.el.currentTime, this.el.duration),
        });
      } catch { }
    }
    if (Date.now() - this._lastSave > TICK_SAVE_EVERY) { this._lastSave = Date.now(); this.ontick?.(this.state()); }
  }

  /* ───────────── الطابور ───────────── */
  async setQueue(items, { autoplay = true, startIndex = 0, time = 0 } = {}) {
    this.items = items || [];
    this.index = -1;
    if (!this.items.length) { this.stop(); this._emit(); return; }
    await this.load(startIndex, { autoplay, time });
  }

  async load(i, { autoplay = true, time = 0 } = {}) {
    if (i < 0 || i >= this.items.length) return;
    this.index = i;
    const it = this.item;
    const src = await this._resolve(it.url);

    this.el.src = src;
    this._rewindBlob(src);
    this.el.currentTime = 0;
    if (time > 0) {
      const apply = () => { try { this.el.currentTime = time; } catch { } this.el.removeEventListener("loadedmetadata", apply); };
      this.el.addEventListener("loadedmetadata", apply);
      try { this.el.currentTime = time; } catch { }
    }
    this._updateMetadata();
    if (autoplay) {
      try { await this.el.play(); }
      catch (e) { this.onnotice?.("لم يبدأ التشغيل — اضغط زر التشغيل (قد يحتاج المتصفح لمسة أولى)."); }
    }
    this._emit();
    this._warmNext();
  }

  /** يجرّب المخزن المحلي أولاً، ثم يعود للمصدر على الشبكة */
  async _resolve(url) {
    try {
      const rec = await offline.get(url);
      if (rec?.blob) {
        this._nextBlob = URL.createObjectURL(rec.blob);
        return this._nextBlob;
      }
    } catch { /* المخزن غير متاح — نكمل بالشبكة */ }
    this._nextBlob = null;
    return url;
  }
  _rewindBlob(usedSrc) {
    if (this._blobUrl && this._blobUrl !== usedSrc) { try { URL.revokeObjectURL(this._blobUrl); } catch { } }
    this._blobUrl = usedSrc.startsWith("blob:") ? usedSrc : null;
  }

  play() {
    if (!this.item) return;
    this.el.volume = 1;
    this.el.play().catch(() => this.onnotice?.("تعذّر التشغيل — قد يحتاج المتصفح لمسة أولى."));
  }
  pause() { this.el.pause(); }
  toggle() { this.playing ? this.pause() : this.play(); }
  stop() { try { this.el.pause(); this.el.removeAttribute("src"); this.el.load(); } catch { } this._clearTimer(); this._emit(); }

  next(auto = false) {
    if (this.index < this.items.length - 1) return this.load(this.index + 1);
    if (this.repeat) return this.load(0);
    this.pause();
    this.onendedQueue?.(auto);
  }
  prev() {
    if (this.el.currentTime > 4) { this.el.currentTime = 0; return; }
    if (this.index > 0) return this.load(this.index - 1);
    this.el.currentTime = 0;
  }
  skip(sec) {
    try { this.el.currentTime = Math.max(0, Math.min((this.el.duration || 1e9), this.el.currentTime + sec)); } catch { }
  }
  seekTo(frac) {
    const d = this.el.duration;
    if (Number.isFinite(d) && d > 0) { try { this.el.currentTime = Math.max(0, Math.min(d, d * frac)); } catch { } }
  }
  setRepeat(on) { this.repeat = Boolean(on); this._emit(); }

  /** تسخين المقطع التالي في مخزون المتصفح لتقليل الفجوة بين الآيات */
  _warmNext() {
    const nxt = this.items[this.index + 1] || (this.repeat ? this.items[0] : null);
    if (!nxt) return;
    try { this._warm = new Audio(); this._warm.preload = "auto"; this._warm.src = nxt.url; } catch { }
  }

  /* ───────────── مؤقّت النوم ───────────── */
  setTimer(minutes, { fade = true } = {}) {
    this._clearTimer();
    const mins = Number(minutes);
    if (!mins || mins <= 0) { this._emit(); return; }
    this._timer = { endsAt: Date.now() + mins * 60000, fade, minutes: mins, faded: false };
    this._timerInt = setInterval(() => this._timerTick(), 1000);
    this._timerTick();
  }
  /** يتوقّف بعد نهاية المقطع الحالي (لا يُكمل الطابور) */
  setStopAtEnd(on = true) { this._clearTimer(); this.stopAtEnd = Boolean(on); this._emit(); }
  clearTimer() { this._clearTimer(); this.stopAtEnd = false; this.el.volume = 1; this._emit(); }

  _clearTimer() {
    if (this._timerInt) clearInterval(this._timerInt);
    this._timerInt = null; this._timer = null;
    this.el.volume = 1;
  }

  _timerTick() {
    const t = this._timer;
    if (!t) return;
    const left = (t.endsAt - Date.now()) / 1000;
    if (t.fade && left <= FADE_SECONDS) {
      t.faded = true;
      this.el.volume = Math.max(0, Math.min(1, left / FADE_SECONDS));
    }
    if (left <= 0) {
      this.pause();
      this.el.volume = 1;
      this._clearTimer();
      this.onnotice?.("انتهى مؤقّت النوم — نومة هنيئة 🌙");
    }
    this._emit();
  }

  _onEnded() {
    if (this.stopAtEnd) { this.pause(); this.stopAtEnd = false; this.onnotice?.("انتهى المقطع — نومة هنيئة 🌙"); this._emit(); return; }
    this.next(true);
  }
  _onError() {
    const it = this.item;
    if (!it) return;
    if (!navigator.onLine) this.onnotice?.(`«${it.title}» غير محفوظ على جهازك، ولا يوجد إنترنت الآن.`);
    else this.onnotice?.(`تعذّر تحميل «${it.title}» — نحاول التالي.`);
    if (this.items.length > 1) setTimeout(() => this.next(true), 1200);
  }

  /* ───────────── شاشة القفل ───────────── */
  _mediaSession() {
    if (!("mediaSession" in navigator)) return;
    const ms = navigator.mediaSession;
    const safe = (fn) => { try { fn(); } catch { } };
    safe(() => ms.setActionHandler("play", () => this.play()));
    safe(() => ms.setActionHandler("pause", () => this.pause()));
    safe(() => ms.setActionHandler("stop", () => { this.pause(); }));
    safe(() => ms.setActionHandler("previoustrack", () => this.prev()));
    safe(() => ms.setActionHandler("nexttrack", () => this.next()));
    safe(() => ms.setActionHandler("seekbackward", (d) => this.skip(-(d.seekOffset || 15))));
    safe(() => ms.setActionHandler("seekforward", (d) => this.skip(d.seekOffset || 30)));
    safe(() => ms.setActionHandler("seekto", (d) => { if (d.seekTime != null) { try { this.el.currentTime = d.seekTime; } catch { } } }));
  }

  _updateMetadata() {
    const it = this.item;
    if (!it || !("mediaSession" in navigator)) return;
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: it.title,
        artist: it.sub || "",
        album: "تلاوة الليل",
        artwork: [
          { src: "assets/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "assets/icon-512.png", sizes: "512x512", type: "image/png" },
        ],
      });
    } catch { /* بعض المتصفحات لا تدعم الأغلفة */ }
  }
}
