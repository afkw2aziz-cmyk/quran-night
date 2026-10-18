#!/usr/bin/env python3
"""
make-icons.py — يولّد أيقونات التطبيق PNG بلا أي مكتبة خارجية.

لا يوجد PIL ولا ImageMagick على هذا الجهاز، فالنصّ يكتب PNG بنفسه (zlib + struct):
هلال ذهبي على ليل متدرّج مع نجوم خفيفة، برسم مضاد للتسنّن (supersampling ×2).

التشغيل:  python3 tools/make-icons.py
المخرجات في assets/:
    icon-192.png · icon-512.png · icon-maskable-512.png · apple-touch-icon-180.png · favicon-32.png
"""
import math
import os
import struct
import zlib

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "assets")
SS = 2  # مضاعف الدقة (supersampling)

# الألوان
NIGHT_TOP = (0x0A, 0x0F, 0x1F)
NIGHT_BOT = (0x19, 0x22, 0x45)
GLOW = (0x3A, 0x53, 0xA0)
GOLD_TOP = (0xFC, 0xDE, 0x9A)
GOLD_BOT = (0xE8, 0xA9, 0x2E)
STAR = (0xE9, 0xEF, 0xFF)


def mix(a, b, t):
    t = max(0.0, min(1.0, t))
    return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))


def dist(u, v, cx, cy):
    return math.hypot(u - cx, v - cy)


def render(size, pad=1.0):
    """يرسم الأيقونة بدقة size×size. pad < 1 يُقلّص المحتوى نحو المركز (لـ maskable)."""
    W = size * SS
    buf = bytearray(W * W * 3)

    def place(u, v):
        """يحوّل الإحداثي إلى ما بعد التصغير حول المركز."""
        return 0.5 + (u - 0.5) / pad, 0.5 + (v - 0.5) / pad

    for j in range(W):
        for i in range(W):
            u = (i + 0.5) / W
            v = (j + 0.5) / W
            cu, cv = place(u, v)

            # ١) خلفية متدرّجة ليلاً
            col = mix(NIGHT_TOP, NIGHT_BOT, v)

            # ٢) هالة خفيفة حول الهلال
            g = max(0.0, 1.0 - dist(cu, cv, 0.50, 0.46) / 0.46)
            col = mix(col, GLOW, 0.55 * g ** 2.2)

            # ٣) الهلال = قرص خارجي ناقص قرص مُزاح
            in_outer = dist(cu, cv, 0.50, 0.46) <= 0.305
            in_cut = dist(cu, cv, 0.605, 0.395) <= 0.262
            if in_outer and not in_cut:
                # أطراف الهلال أفتح من بطنه
                t = max(0.0, min(1.0, (cv - 0.16) / 0.62))
                col = mix(GOLD_TOP, GOLD_BOT, t)

            # ٤) نجوم
            for (sx, sy, sr) in ((0.755, 0.245, 0.030), (0.660, 0.745, 0.020), (0.838, 0.620, 0.016)):
                d = dist(cu, cv, sx, sy) / sr
                if d < 1.8:
                    a = (1.0 - d / 1.8) ** 1.7
                    col = mix(col, STAR, 0.95 * a)

            o = (j * W + i) * 3
            buf[o] = col[0]
            buf[o + 1] = col[1]
            buf[o + 2] = col[2]

    # تنزيل الدقة: متوسط كل كتلة SS×SS
    rows = []
    for y in range(size):
        row = bytearray([0])  # مرشّح السطر: 0
        for x in range(size):
            r = g = b = 0
            for dy in range(SS):
                base = ((y * SS + dy) * W + x * SS) * 3
                for dx in range(SS):
                    o = base + dx * 3
                    r += buf[o]; g += buf[o + 1]; b += buf[o + 2]
            n = SS * SS
            row += bytes((r // n, g // n, b // n))
        rows.append(bytes(row))
    return zlib.compress(b"".join(rows), 9)


def write_png(path, size, pad=1.0):
    data = render(size, pad)
    def chunk(tag, body):
        c = struct.pack(">I", len(body)) + tag + body
        return c + struct.pack(">I", zlib.crc32(tag + body) & 0xFFFFFFFF)

    png = (b"\x89PNG\r\n\x1a\n"
           + chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0))
           + chunk(b"IDAT", data)
           + chunk(b"IEND", b""))
    with open(path, "wb") as f:
        f.write(png)
    return len(png)


def main():
    os.makedirs(OUT, exist_ok=True)
    jobs = [
        ("icon-512.png", 512, 1.0),
        ("icon-192.png", 192, 1.0),
        ("apple-touch-icon-180.png", 180, 1.0),
        ("favicon-32.png", 32, 1.0),
        ("icon-maskable-512.png", 512, 0.72),   # هوامش آمنة لأندرويد
    ]
    print("══ توليد الأيقونات ══")
    for name, size, pad in jobs:
        p = os.path.join(OUT, name)
        n = write_png(p, size, pad)
        print(f"   ✅ {name:26s} {size}×{size}  {n / 1024:.1f} ك.ب")
    print(f"\n   المكان: {os.path.relpath(OUT, os.path.join(HERE, '..'))}/")


if __name__ == "__main__":
    main()
