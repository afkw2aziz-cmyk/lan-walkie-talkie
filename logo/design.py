#!/usr/bin/env python3
"""
مولّد هوية «اللاسلكي العائلي» البصرية — تحديداً المفهوم B «الجهاز العصري».

الأصول المتجهية (SVG) والصور النقطية للرسم تُولَّد بـ pycairo.
أصول النصوص (wordmark) تُولَّد كـ SVG ثم تُصوَّر في المتصفح، لأن تشكيل
العربية يحتاج محرّك نصوص حقيقياً (Pango غير مربوط بـ pycairo على هذا الجهاز).

الاستعمال:
    python3 logo/design.py concepts   # استكشاف المفاهيم (أرشيف)
    python3 logo/build.py final       # بناء الطقم الكامل
"""
import math
import os
import sys

import cairo

W = 512
HERE = os.path.dirname(os.path.abspath(__file__))


# ------------------------------- الألوان -------------------------------
def rgb(h, a=1.0):
    h = h.lstrip("#")
    return (int(h[0:2], 16) / 255, int(h[2:4], 16) / 255, int(h[4:6], 16) / 255, a)


BG0 = rgb("0b1220")       # خلفية التطبيق
BG1 = rgb("16224a")       # توهّج علوي
G1 = rgb("27d17c")        # الأخضر الأساسي
G2 = rgb("12a862")        # الأخضر الغامق
G3 = rgb("0d8a4e")        # أخضر أغمق (الأزرار الجانبية)
GL = rgb("6ef0ab")        # أخضر مضيء (موجات البثّ)
GREY = rgb("8fa2c4")      # رمادي مزرق
INK = rgb("0b1220")       # داكن العناصر
RED = rgb("ff4d5e")       # «مباشر»
WHITE = rgb("ffffff")
TXT = rgb("e8eefc")       # نص فاتح
LIGHT_BG = rgb("f4f7fc")  # خلفية فاتحة للنص الداكن


# ------------------------------- أدوات الرسم -------------------------------
def squircle(ctx, cx, cy, r, n=4.2, steps=900):
    """مربّع بأطراف فائقة النعومة (شكل أيقونات iOS/أندرويد الحديثة)."""
    pts = []
    for i in range(steps + 1):
        t = 2 * math.pi * i / steps
        ct, st = math.cos(t), math.sin(t)
        pts.append((cx + r * math.copysign(abs(ct) ** (2 / n), ct),
                    cy + r * math.copysign(abs(st) ** (2 / n), st)))
    ctx.move_to(*pts[0])
    for p in pts[1:]:
        ctx.line_to(*p)
    ctx.close_path()


def rrect(ctx, x, y, w, h, r):
    r = min(r, w / 2, h / 2)
    ctx.new_sub_path()
    ctx.arc(x + w - r, y + r, r, -math.pi / 2, 0)
    ctx.arc(x + w - r, y + h - r, r, 0, math.pi / 2)
    ctx.arc(x + r, y + h - r, r, math.pi / 2, math.pi)
    ctx.arc(x + r, y + r, r, math.pi, 3 * math.pi / 2)
    ctx.close_path()


def arc(ctx, cx, cy, r, a0, a1, lw, color):
    ctx.set_line_width(lw)
    ctx.set_line_cap(cairo.LINE_CAP_ROUND)
    ctx.set_source_rgba(*color)
    ctx.arc(cx, cy, r, a0, a1)
    ctx.stroke()


def bar(ctx, x, y, w, h, color, r=None):
    r = w / 2 if r is None else r
    ctx.set_source_rgba(*color)
    rrect(ctx, x, y, w, h, r)
    ctx.fill()


def vert_grad(ctx, y0, y1, c0, c1):
    g = cairo.LinearGradient(0, y0, 0, y1)
    g.add_color_stop_rgba(0, *c0)
    g.add_color_stop_rgba(1, *c1)
    return g


def tile_bg(ctx, r=256):
    """خلفية الأيقونة: مربّع ناعم بتوهّج علوي."""
    squircle(ctx, 256, 256, r, 4.2)
    g = cairo.RadialGradient(256, 92, 12, 256, 290, 430)
    g.add_color_stop_rgba(0, *BG1)
    g.add_color_stop_rgba(1, *BG0)
    ctx.set_source(g)
    ctx.fill()


def wave_bars(ctx, cx, cy, heights, bw, gap, color, maxh, r=None):
    n = len(heights)
    x = cx - (n * bw + (n - 1) * gap) / 2
    for h in heights:
        hh = maxh * h
        bar(ctx, x, cy - hh / 2, bw, hh, color, r)
        x += bw + gap


# ==================== المفهوم النهائي: B — الجهاز العصري ====================
# الإحداثيات كلها في فضاء 512×512، والرسم مركزي حول x=256.
BODY = dict(x=152, y=176, w=208, h=280, r=72)
ANT = dict(x=300, y=78, w=32, h=120, r=16)
SCREEN = dict(x=180, y=216, w=152, h=144, r=42)
BTN = dict(x=336, y=262, w=44, h=106, r=22)      # يُقصّ نصفه تحت الجسم
GRILLE = [(398, 92), (420, 92), (442, 92)]        # (y, عرض)
LED = (196, 196, 9)
WAVE = ([0.42, 0.62, 1.0, 0.74, 0.46], 18, 13)    # (النسب, عرض العمود, الفجوة)
WAVE_MAXH = 76
WAVE_CENTER = (318, 150)                          # مركز موجات البثّ
WAVE_RADII = ((74, 0.30), (108, 0.18), (142, 0.10))
WAVE_SPAN = (-3.20, -1.82)


def _waves(ctx, color, maxh):
    heights, bw, gap = WAVE
    wave_bars(ctx, SCREEN["x"] + SCREEN["w"] / 2,
              SCREEN["y"] + SCREEN["h"] / 2, heights, bw, gap, color, maxh)


def _silhouette(ctx):
    """مسار الجسم مع ثقوب الشاشة وشبكة السماعة (للنسخة الأحادية اللون)."""
    ctx.set_fill_rule(cairo.FILL_RULE_EVEN_ODD)
    rrect(ctx, BODY["x"], BODY["y"], BODY["w"], BODY["h"], BODY["r"])
    rrect(ctx, SCREEN["x"], SCREEN["y"], SCREEN["w"], SCREEN["h"], SCREEN["r"])
    for y, bw in GRILLE:
        rrect(ctx, 256 - bw / 2, y, bw, 10, 5)
    ctx.fill()
    ctx.set_fill_rule(cairo.FILL_RULE_WINDING)


def mark(ctx, scale=1.0, mode="tile"):
    """يرسم العلامة. mode: tile | transparent | mono-light | mono-dark"""
    mono = mode in ("mono-light", "mono-dark")
    mcolor = WHITE if mode == "mono-light" else INK

    ctx.save()
    ctx.translate(256, 256)
    ctx.scale(scale, scale)
    ctx.translate(-256, -256)

    # --- موجات البثّ من الهوائي (تُرسم أولاً لتكون خلف الجهاز) ---
    wave_color = (mcolor if mono else GL)[:3]
    for rr, al in WAVE_RADII:
        arc(ctx, WAVE_CENTER[0], WAVE_CENTER[1], rr, WAVE_SPAN[0], WAVE_SPAN[1],
            20, wave_color + (al,))

    # --- الهوائي ---
    ctx.set_source_rgba(*(mcolor if mono else GREY))
    rrect(ctx, ANT["x"], ANT["y"], ANT["w"], ANT["h"], ANT["r"])
    ctx.fill()

    # --- الزر الجانبي (يظهر نصفه خارج الجسم) ---
    ctx.set_source_rgba(*(mcolor if mono else G3))
    rrect(ctx, BTN["x"], BTN["y"], BTN["w"], BTN["h"], BTN["r"])
    ctx.fill()

    if mono:
        ctx.set_source_rgba(*mcolor)
        _silhouette(ctx)
    else:
        # --- جسم الجهاز بتدرّج رأسي مطابق لأزرار الواجهة ---
        ctx.set_source(vert_grad(ctx, BODY["y"], BODY["y"] + BODY["h"], G1, G2))
        rrect(ctx, BODY["x"], BODY["y"], BODY["w"], BODY["h"], BODY["r"])
        ctx.fill()
        # حدّ داخلي مضيء خفيف يعطي حجماً للجسم
        ctx.save()
        rrect(ctx, BODY["x"] + 3, BODY["y"] + 3, BODY["w"] - 6, BODY["h"] - 6,
              BODY["r"] - 3)
        ctx.set_line_width(3)
        ctx.set_source_rgba(*GL[:3], 0.16)
        ctx.stroke()
        ctx.restore()
        # --- الشاشة ---
        ctx.set_source_rgba(*INK)
        rrect(ctx, SCREEN["x"], SCREEN["y"], SCREEN["w"], SCREEN["h"], SCREEN["r"])
        ctx.fill()

    # --- موجة صوتية داخل الشاشة ---
    _waves(ctx, mcolor if mono else G1, WAVE_MAXH)

    if not mono:
        # شبكة السماعة
        for y, bw in GRILLE:
            bar(ctx, 256 - bw / 2, y, bw, 10, GREY[:3] + (0.5,), 5)
        # مؤشّر «مباشر»
        ctx.set_source_rgba(*RED)
        ctx.arc(LED[0], LED[1], LED[2], 0, 2 * math.pi)
        ctx.fill()

    ctx.restore()


# ------------------------------ الإخراج ------------------------------
MODES = ("tile", "transparent", "mono-light", "mono-dark")


def render_png(path, mode="tile", size=512, scale=1.0, bg=None):
    surf = cairo.ImageSurface(cairo.FORMAT_ARGB32, size, size)
    ctx = cairo.Context(surf)
    ctx.set_antialias(cairo.ANTIALIAS_BEST)
    ctx.scale(size / W, size / W)
    if mode == "tile":
        tile_bg(ctx)
    if bg:
        ctx.set_source_rgba(*bg)
        squircle(ctx, 256, 256, 256, 4.2)
        ctx.fill()
    mark(ctx, scale=scale, mode=mode)
    surf.write_to_png(path)
    return path


def render_svg(path, mode="tile", scale=1.0):
    surf = cairo.SVGSurface(path, W, W)
    ctx = cairo.Context(surf)
    ctx.set_antialias(cairo.ANTIALIAS_BEST)
    if mode == "tile":
        tile_bg(ctx)
    mark(ctx, scale=scale, mode=mode)
    surf.finish()
    return path


# ====================== أصول النصوص (wordmark) ======================
def mark_inner_svg(mode="tile"):
    """يرجع محتوى SVG للعلامة (بدون وسم svg الخارجي) لإدراجه داخل lockup."""
    tmp = os.path.join(HERE, ".cache", f"mark-{mode}.svg")
    os.makedirs(os.path.dirname(tmp), exist_ok=True)
    render_svg(tmp, mode=mode)
    with open(tmp, encoding="utf-8") as f:
        s = f.read()
    start = s.find(">", s.find("<svg")) + 1
    end = s.rfind("</svg>")
    inner = s[start:end]
    # إعادة تسمية المعرّفات لمنع التضارب عند الدمج
    import re
    for i in re.findall(r'id="([^"]+)"', inner):
        inner = inner.replace(f'id="{i}"', f'id="mk-{i}"')
        inner = inner.replace(f'url(#{i})', f'url(#mk-{i})')
    return inner


FONT_AR = "'Noto Kufi Arabic','Noto Sans Arabic','Noto Naskh Arabic',sans-serif"
FONT_EN = "'Noto Sans','DejaVu Sans',sans-serif"


def lockup_svg(kind="wordmark-ar", theme="dark"):
    """يرجع نص SVG لشعار نصي. kind: wordmark-ar | wordmark-en | stacked

    ملاحظة مهمة: نُثبّت direction="ltr" على جذر SVG حتى لا يورّث الاتجاه من
    الصفحة الحاضنة (صفحتنا عربية RTL)، فتصبح دلالة text-anchor متوقّعة.
    """
    mk = mark_inner_svg("tile")
    txt = TXT if theme == "dark" else rgb("0f1a2e")
    sub = GREY if theme == "dark" else rgb("5b6b8c")
    bg = f'<rect width="100%" height="100%" fill="#{"0b1220" if theme == "dark" else "f4f7fc"}"/>'

    if kind == "wordmark-ar":
        # عربي: العلامة يميناً والنص يساراً (اتجاه القراءة العربية)
        w, h = 1200, 360
        body = f"""
  <g transform="translate(880,60) scale({240 / W})">{mk}</g>
  <text x="832" y="178" text-anchor="end" font-family="{FONT_AR}"
        font-size="88" font-weight="700" fill="{_hex(txt)}">اللاسلكي العائلي</text>
  <text x="832" y="242" text-anchor="end" font-family="{FONT_AR}"
        font-size="30" fill="{_hex(sub)}">بثّ صوتي فوري داخل شبكة المنزل</text>
  <text x="832" y="300" text-anchor="end" font-family="{FONT_EN}"
        font-size="22" letter-spacing="2" fill="{_hex(sub)}">FAMILY-TALK</text>"""
    elif kind == "wordmark-en":
        # إنجليزي: العلامة يساراً والنص يميناً
        w, h = 1200, 360
        body = f"""
  <g transform="translate(80,60) scale({240 / W})">{mk}</g>
  <text x="368" y="172" text-anchor="start" font-family="{FONT_EN}"
        font-size="96" font-weight="700" fill="{_hex(txt)}">family-talk</text>
  <text x="368" y="232" text-anchor="start" font-family="{FONT_EN}"
        font-size="27" letter-spacing="1.2" fill="{_hex(sub)}">LAN walkie-talkie · WebRTC + PWA</text>
  <text x="368" y="300" text-anchor="start" font-family="{FONT_AR}"
        font-size="36" fill="{_hex(txt)}">اللاسلكي العائلي</text>"""
    else:  # stacked
        w, h = 800, 880
        body = f"""
  <g transform="translate(250,60) scale({300 / W})">{mk}</g>
  <text x="400" y="530" text-anchor="middle" font-family="{FONT_AR}"
        font-size="84" font-weight="700" fill="{_hex(txt)}">اللاسلكي العائلي</text>
  <text x="400" y="600" text-anchor="middle" font-family="{FONT_AR}"
        font-size="30" fill="{_hex(sub)}">بثّ صوتي فوري داخل شبكة المنزل</text>
  <text x="400" y="668" text-anchor="middle" font-family="{FONT_EN}"
        font-size="26" letter-spacing="3" fill="{_hex(sub)}">FAMILY-TALK</text>"""

    svg = (f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" '
           f'viewBox="0 0 {w} {h}" direction="ltr">{bg}{body}\n</svg>\n')
    return svg, w, h


def _hex(c):
    return "#%02x%02x%02x" % tuple(round(v * 255) for v in c[:3])


def write_lockups(outdir):
    made = []
    for kind in ("wordmark-ar", "wordmark-en", "stacked"):
        for theme in ("dark", "light"):
            svg, w, h = lockup_svg(kind, theme)
            name = f"{kind}{'' if theme == 'dark' else '-light'}.svg"
            p = os.path.join(outdir, name)
            with open(p, "w", encoding="utf-8") as f:
                f.write(svg)
            made.append((p, w, h))
    return made


# ---------------------------- المفاهيم (أرشيف) ----------------------------
def concept_a(ctx, scale=1.0):
    ctx.save()
    ctx.translate(256, 256)
    ctx.scale(scale, scale)
    ctx.translate(-256, -256)
    for rr, al in ((178, 0.22), (216, 0.14), (254, 0.08)):
        arc(ctx, 300, 210, rr, -1.30, 0.28, 22, GL[:3] + (al,))
    ctx.set_source_rgba(*G2)
    ctx.move_to(150, 300)
    ctx.curve_to(150, 360, 132, 392, 96, 418)
    ctx.curve_to(150, 412, 196, 400, 214, 372)
    ctx.close_path()
    ctx.fill()
    ctx.set_source(vert_grad(ctx, 118, 372, G1, G2))
    rrect(ctx, 120, 118, 292, 254, 92)
    ctx.fill()
    wave_bars(ctx, 260, 246, [0.34, 0.62, 1.0, 0.72, 0.44], 30, 17, INK, 132)
    ctx.set_source_rgba(*RED)
    ctx.arc(166, 166, 15, 0, 2 * math.pi)
    ctx.fill()
    ctx.restore()


def concept_b(ctx, scale=1.0):
    mark(ctx, scale=scale, mode="tile")


def concept_c(ctx, scale=1.0):
    ctx.save()
    ctx.translate(256, 256)
    ctx.scale(scale, scale)
    ctx.translate(-256, -256)
    for rr, al in ((150, 0.26), (188, 0.16), (226, 0.09)):
        arc(ctx, 256, 268, rr, math.pi * 1.14, math.pi * 1.86, 22, GL[:3] + (al,))
    ctx.set_source(vert_grad(ctx, 190, 400, G1, G2))
    ctx.arc(256, 290, 112, 0, 2 * math.pi)
    ctx.fill()
    arc(ctx, 256, 290, 88, 0, 2 * math.pi, 6, INK[:3] + (0.18,))
    ctx.set_source_rgba(*INK)
    rrect(ctx, 234, 236, 44, 74, 22)
    ctx.fill()
    arc(ctx, 256, 310, 40, 0, math.pi, 16, INK)
    ctx.set_line_width(16)
    ctx.set_line_cap(cairo.LINE_CAP_ROUND)
    ctx.set_source_rgba(*INK)
    ctx.move_to(256, 348)
    ctx.line_to(256, 366)
    ctx.stroke()
    ctx.move_to(236, 370)
    ctx.line_to(276, 370)
    ctx.stroke()
    ctx.restore()


CONCEPTS = {
    "a": ("الفقاعة المتكلّمة", concept_a),
    "b": ("الجهاز العصري", concept_b),
    "c": ("زر التكلّم والبثّ", concept_c),
}


def run_concepts():
    out = os.path.join(HERE, "preview")
    os.makedirs(out, exist_ok=True)
    os.makedirs(os.path.join(HERE, "svg"), exist_ok=True)
    for key, (title, fn) in CONCEPTS.items():
        for size in (512, 128, 64):
            surf = cairo.ImageSurface(cairo.FORMAT_ARGB32, size, size)
            ctx = cairo.Context(surf)
            ctx.set_antialias(cairo.ANTIALIAS_BEST)
            ctx.scale(size / W, size / W)
            tile_bg(ctx)
            fn(ctx, 1.0)
            surf.write_to_png(f"{out}/concept-{key}-{size}.png")
        surf = cairo.SVGSurface(f"{HERE}/svg/concept-{key}.svg", W, W)
        ctx = cairo.Context(surf)
        tile_bg(ctx)
        fn(ctx, 1.0)
        surf.finish()
        print(f"✅ concept-{key}: {title}")


if __name__ == "__main__":
    if (sys.argv[1:] or ["concepts"])[0] == "concepts":
        run_concepts()
    else:
        print(__doc__)
