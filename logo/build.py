#!/usr/bin/env python3
"""
يبني الطقم الكامل لهوية «اللاسلكي العائلي» (المفهوم B — الجهاز العصري).

    python3 logo/build.py final

المخرجات:
    logo/svg/*.svg     أصول متجهية (مasters)
    logo/png/*.png     صور نقطية بكل الأحجام
    logo/render/*.html صفحات وسيطة تُصوَّر في المتصفح (لأن النص العربي
                        يحتاج محرّك نصوص حقيقياً غير متاح في pycairo هنا)
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import design as D  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
SVG = os.path.join(HERE, "svg")
PNG = os.path.join(HERE, "png")
RENDER = os.path.join(HERE, "render")

ICON_SIZES = [1024, 512, 192, 180, 128, 64, 48, 32]
MASK_SCALE = 0.62


def fresh(*dirs):
    for d in dirs:
        os.makedirs(d, exist_ok=True)


def build_marks(manifest):
    # ---------- الأيقونة الكاملة (الخلفية + العلامة) ----------
    for mode, name, scale in (("tile", "logo-icon", 1.0),
                              ("tile", "logo-icon-maskable", MASK_SCALE)):
        svg = os.path.join(SVG, f"{name}.svg")
        D.render_svg(svg, mode=mode, scale=scale)
        manifest.append(("svg", svg))

    for size in ICON_SIZES:
        p = os.path.join(PNG, f"logo-icon-{size}.png")
        D.render_png(p, mode="tile", size=size)
        manifest.append(("png", p))
    for size in (1024, 512):
        p = os.path.join(PNG, f"logo-icon-maskable-{size}.png")
        D.render_png(p, mode="tile", size=size, scale=MASK_SCALE)
        manifest.append(("png", p))

    # ---------- العلامة بلا خلفية ----------
    svg = os.path.join(SVG, "logo-mark.svg")
    D.render_svg(svg, mode="transparent")
    manifest.append(("svg", svg))
    for size in (1024, 512):
        p = os.path.join(PNG, f"logo-mark-{size}.png")
        D.render_png(p, mode="transparent", size=size)
        manifest.append(("png", p))

    # ---------- النسخ الأحادية ----------
    for mode, name in (("mono-light", "logo-mono-light"),
                       ("mono-dark", "logo-mono-dark")):
        svg = os.path.join(SVG, f"{name}.svg")
        D.render_svg(svg, mode=mode)
        manifest.append(("svg", svg))
        for size in (1024, 512):
            p = os.path.join(PNG, f"{name}-{size}.png")
            D.render_png(p, mode=mode, size=size)
            manifest.append(("png", p))


def build_lockups(manifest):
    """SVG للأصول النصية + صفحات HTML لتصويرها في المتصفح."""
    for kind in ("wordmark-ar", "wordmark-en", "stacked"):
        for theme in ("dark", "light"):
            svg, w, h = D.lockup_svg(kind, theme)
            suffix = "" if theme == "dark" else "-light"
            name = f"{kind}{suffix}"
            sp = os.path.join(SVG, f"{name}.svg")
            with open(sp, "w", encoding="utf-8") as f:
                f.write(svg)
            manifest.append(("svg", sp))

            bg = "#0b1220" if theme == "dark" else "#f4f7fc"
            html = f"""<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>{name}</title>
<style>
  html,body{{margin:0;padding:0;background:{bg}}}
  svg{{display:block}}
</style></head>
<body>{svg}</body></html>
"""
            hp = os.path.join(RENDER, f"{name}.html")
            with open(hp, "w", encoding="utf-8") as f:
                f.write(html)
            manifest.append(("render", hp))


def build_preview(manifest):
    """ورقة عرض نهائية للطقم (تُصوَّر في المتصفح)."""
    icon = D.mark_inner_svg("tile")
    mono_l = D.mark_inner_svg("mono-light")
    mono_d = D.mark_inner_svg("mono-dark")
    mark = D.mark_inner_svg("transparent")
    wa_d, _, _ = D.lockup_svg("wordmark-ar", "dark")
    we_d, _, _ = D.lockup_svg("wordmark-en", "dark")
    st_d, _, _ = D.lockup_svg("stacked", "dark")
    wa_l, _, _ = D.lockup_svg("wordmark-ar", "light")

    def icon_svg(size):
        return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{size}" height="{size}" '
                f'viewBox="0 0 512 512"><g id="ic{size}">{icon}</g></svg>')

    # معرّفات فريدة لكل نسخة مضمّنة
    import re

    def uniq(svg, prefix):
        for i in re.findall(r'id="([^"]+)"', svg):
            svg = svg.replace(f'id="{i}"', f'id="{prefix}-{i}"')
            svg = svg.replace(f'url(#{i})', f'url(#{prefix}-{i})')
        return svg

    sizes = "".join(
        f'<div class="sz"><div>{uniq(icon_svg(s), f"s{s}")}</div><span>{s}px</span></div>'
        for s in (256, 128, 64, 48, 32))

    homescreen = "".join(
        f'<div class="app"><div>{uniq(icon_svg(56), f"h{i}")}</div>'
        f'<span>{"اللاسلكي" if i == 0 else "الكاميرا" if i == 1 else "الرسائل" if i == 2 else "الإعدادات"}</span></div>'
        for i in range(4))

    html = f"""<!DOCTYPE html>
<html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>طقم الهوية — اللاسلكي العائلي</title>
<style>
  *{{box-sizing:border-box}}
  body{{margin:0;padding:32px 40px 44px;width:1360px;
    background:radial-gradient(120% 80% at 50% 0%,#16224a 0%,#0b1220 60%);
    color:#e8eefc;font-family:'Noto Kufi Arabic','Noto Sans Arabic',sans-serif}}
  h1{{margin:0 0 6px;font-size:26px;text-align:center}}
  h1 b{{color:#27d17c}}
  .sub{{text-align:center;color:#8fa2c4;font-size:13.5px;margin-bottom:26px}}
  h2{{font-size:15px;color:#8fa2c4;font-weight:400;margin:0 0 12px;
     letter-spacing:.5px;border-top:1px solid #25324f;padding-top:16px}}
  .row{{display:flex;gap:24px;align-items:center;flex-wrap:wrap}}
  .box{{border:1px solid #25324f;border-radius:18px;padding:18px;
       background:linear-gradient(180deg,#131d33,#101828)}}
  .sizes{{display:flex;gap:22px;align-items:flex-end;justify-content:center}}
  .sz{{text-align:center;color:#6f83a8;font-size:11.5px}}
  .sz span{{display:block;margin-top:7px}}
  .sz svg{{border-radius:22%;display:block}}
  .apps{{display:flex;gap:26px;justify-content:center}}
  .app{{text-align:center;font-size:10.5px;color:#c9d6ef}}
  .app svg{{border-radius:24%;display:block;margin-bottom:6px}}
  .mono-light{{background:#0b1220;border-radius:14px;padding:14px;display:inline-block}}
  .mono-dark{{background:#f4f7fc;border-radius:14px;padding:14px;display:inline-block}}
  .markbox{{background:repeating-conic-gradient(#1b2740 0 25%,#16203a 0 50%) 50%/18px 18px;
           border-radius:14px;padding:14px;display:inline-block}}
  .lockups{{display:flex;flex-direction:column;gap:14px}}
  .lockups .on{{border-radius:14px;overflow:hidden;line-height:0}}
  .lightbg{{background:#f4f7fc}}
  .tag{{font-size:11px;color:#6f83a8;margin-top:6px}}
  footer{{margin-top:22px;text-align:center;color:#6f83a8;font-size:12px}}
  code{{background:#ffffff0d;padding:2px 7px;border-radius:6px;color:#a9b8d6}}
</style></head><body>
  <h1>طقم هوية <b>اللاسلكي العائلي</b></h1>
  <div class="sub">المفهوم B «الجهاز العصري» · رسم متجهي · ألوان التطبيق نفسها</div>

  <h2>١) الأيقونة — كل الأحجام</h2>
  <div class="box sizes">{sizes}</div>

  <h2>٢) على شاشة الجوال (كما ستظهر للعائلة)</h2>
  <div class="box apps">{homescreen}</div>

  <h2>٣) النسخ البديلة</h2>
  <div class="row">
    <div><div class="mono-light">{uniq(f'<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120" viewBox="0 0 512 512">{mono_l}</svg>', "ml")}</div>
      <div class="tag">أحادي فاتح — لخلفية داكنة</div></div>
    <div><div class="mono-dark">{uniq(f'<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120" viewBox="0 0 512 512">{mono_d}</svg>', "md")}</div>
      <div class="tag">أحادي داكن — لخلفية فاتحة</div></div>
    <div><div class="markbox">{uniq(f'<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120" viewBox="0 0 512 512">{mark}</svg>', "mk")}</div>
      <div class="tag">بلا خلفية — PNG شفّاف</div></div>
    <div><div class="mono-light">{uniq(f'<svg xmlns="http://www.w3.org/2000/svg" width="70" height="70" viewBox="0 0 512 512">{mono_l}</svg>', "m2")}
      {uniq(f'<svg xmlns="http://www.w3.org/2000/svg" width="70" height="70" viewBox="0 0 512 512">{mono_l}</svg>', "m3")}
      {uniq(f'<svg xmlns="http://www.w3.org/2000/svg" width="70" height="70" viewBox="0 0 512 512">{mono_l}</svg>', "m4")}</div>
      <div class="tag">النسخة الأحادية في ٧٠ بكسل</div></div>
  </div>

  <h2>٤) الشعار النصي (Wordmark)</h2>
  <div class="lockups">
    <div><div class="on">{uniq(wa_d, "wa")}</div><div class="tag">عربي — على داكن</div></div>
    <div><div class="on lightbg">{uniq(wa_l, "wb")}</div><div class="tag">عربي — على فاتح</div></div>
    <div><div class="on">{uniq(we_d, "we")}</div><div class="tag">إنجليزي — على داكن</div></div>
  </div>

  <h2>٥) الشكل المكدّس (للحالات المربّعة)</h2>
  <div class="box" style="width:400px">{uniq(st_d, "st")}</div>

  <footer>تدرّج <code>#27d17c → #12a862</code> · خلفية <code>#0b1220</code> ·
   موجات <code>#6ef0ab</code> · «مباشر» <code>#ff4d5e</code></footer>
</body></html>
"""
    hp = os.path.join(RENDER, "kit-preview.html")
    with open(hp, "w", encoding="utf-8") as f:
        f.write(html)
    manifest.append(("render", hp))
    return hp


def resolve_icon(size):
    """مسار الأيقونة المولَّدة (للتصوير في المتصفح إن لزم)."""
    return os.path.join(PNG, f"logo-icon-{size}.png")


def main():
    if (sys.argv[1:] or ["final"])[0] != "final":
        print(__doc__)
        return
    fresh(SVG, PNG, RENDER, os.path.join(HERE, ".cache"))
    manifest = []
    build_marks(manifest)
    build_lockups(manifest)
    build_preview(manifest)
    tally = {}
    for kind, p in manifest:
        tally[kind] = tally.get(kind, 0) + 1
    print("✅ اكتمل البناء:", tally)
    print("\nملفات تنتظر التصوير في المتصفح:")
    for kind, p in manifest:
        if kind == "render":
            print("   ", os.path.relpath(p, HERE))


if __name__ == "__main__":
    main()
