#!/usr/bin/env python3
"""
يبني ورقة عرض HTML لكل مفاهيم اللوقو — لعرضها في المتصفح وتصويرها
(المتصفح يشكّل النص العربي بشكل صحيح، بخلاف أدوات الرسم المتاحة محلياً).
"""
import os
import re

HERE = os.path.dirname(os.path.abspath(__file__))
SVG_DIR = os.path.join(HERE, "svg")
OUT = os.path.join(HERE, "preview", "showcase.html")

CONCEPTS = [
    ("a", "الفقاعة المتكلّمة", "Bubble",
     "فقاعة حوار خضراء تحوي موجة صوتية، خلفها موجات بثّ، وبداخلها نقطة «مباشر». "
     "تجمع فكرتَي <b>الرسائل الصوتية</b> و<b>البثّ</b> في شكل واحد، وتبقى واضحة حتى في ٣٢ بكسل."),
    ("b", "الجهاز العصري", "Device",
     "تطوير لأيقونتك الحالية: جسم لاسلكي بأطراف ناعمة وتدرّج، هوائي، شاشة موجة، "
     "وشبكة سماعة مع موجات بثّ من الهوائي. <b>يحافظ على هوية التطبيق</b> المعروفة للعائلة."),
    ("c", "زر التكلّم والبثّ", "PTT",
     "دائرة الزر الأخضر كما في الواجهة، بداخلها ميكروفون داكن، وفوقها موجات بثّ. "
     "مباشر ومألوف لأن العائلة تعرف هذا الزر أصلاً — لكنه الأضعف في الحجم الصغير."),
]


def inline_svg(path, size, prefix):
    """يُدرج SVG داخل HTML مع إعادة تسمية المعرّفات لمنع التضارب بين النسخ."""
    with open(path, encoding="utf-8") as f:
        svg = f.read()
    svg = re.sub(r"<\?xml[^>]*\?>", "", svg)
    svg = re.sub(r"<!DOCTYPE[^>]*>", "", svg)
    for i in re.findall(r'id="([^"]+)"', svg):
        svg = svg.replace(f'id="{i}"', f'id="{prefix}-{i}"')
        svg = svg.replace(f'url(#{i})', f'url(#{prefix}-{i})')
        svg = svg.replace(f'xlink:href="#{i}"', f'xlink:href="#{prefix}-{i}"')
        svg = svg.replace(f'href="#{i}"', f'href="#{prefix}-{i}"')
    svg = re.sub(r'\s+width="[^"]*"\s+height="[^"]*"',
                 f' width="{size}" height="{size}"', svg, count=1)
    return svg


def card(key, name, badge, desc):
    svg = os.path.join(SVG_DIR, f"concept-{key}.svg")
    return f"""
  <section class="card">
    <div class="stage">{inline_svg(svg, 220, f"{key}-big")}</div>
    <div class="scales">
      <div class="scale"><div class="s128">{inline_svg(svg, 128, f"{key}-m")}</div><span>١٢٨ بكسل</span></div>
      <div class="scale"><div class="s64">{inline_svg(svg, 64, f"{key}-s")}</div><span>٦٤ بكسل</span></div>
      <div class="scale"><div class="s32">{inline_svg(svg, 32, f"{key}-xs")}</div><span>٣٢ بكسل</span></div>
    </div>
    <h2><span class="key">{key.upper()}</span> {name} <em>{badge}</em></h2>
    <p>{desc}</p>
  </section>"""


def build():
    cards = "\n".join(card(*c) for c in CONCEPTS)
    html = f"""<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<title>مفاهيم لوقو اللاسلكي العائلي</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Noto+Kufi+Arabic:wght@400;700&display=swap');
  * {{ box-sizing: border-box; }}
  body {{
    margin: 0; padding: 34px 40px 46px;
    background: radial-gradient(120% 90% at 50% 0%, #16224a 0%, #0b1220 62%);
    color: #e8eefc;
    font-family: 'Noto Kufi Arabic', 'Noto Naskh Arabic', 'Noto Sans Arabic', sans-serif;
    width: 1400px;
  }}
  header {{ text-align: center; margin-bottom: 30px; }}
  header h1 {{ margin: 0 0 8px; font-size: 34px; letter-spacing: -.5px; }}
  header h1 b {{ color: #27d17c; }}
  header p {{ margin: 0; color: #8fa2c4; font-size: 15px; }}
  .grid {{ display: grid; grid-template-columns: repeat(3, 1fr); gap: 26px; }}
  .card {{
    background: linear-gradient(180deg, #16203a, #111a2e);
    border: 1px solid #25324f; border-radius: 22px; padding: 22px 20px 18px;
    text-align: center;
  }}
  .stage {{
    display: grid; place-items: center;
    background: radial-gradient(90% 70% at 50% 10%, #1b2b4f, #0e1730);
    border: 1px dashed #2b3b5e; border-radius: 18px; padding: 20px 0 16px;
    margin-bottom: 16px;
  }}
  .scales {{ display: flex; gap: 14px; justify-content: center; align-items: flex-end; margin-bottom: 16px; }}
  .scale {{ display: flex; flex-direction: column; align-items: center; gap: 7px; }}
  .scale span {{ font-size: 11.5px; color: #6f83a8; }}
  .s128 svg, .s64 svg, .s32 svg {{ display: block; border-radius: 22%; }}
  h2 {{ margin: 0 0 8px; font-size: 19px; font-weight: 700; }}
  h2 .key {{
    background: #27d17c; color: #04150c; border-radius: 9px;
    padding: 1px 9px; margin-inline-end: 7px; font-size: 16px;
  }}
  h2 em {{ display: block; font-style: normal; font-size: 11.5px; color: #6f83a8;
           letter-spacing: 1.5px; margin-top: 5px; text-transform: uppercase; }}
  .card p {{ margin: 0; color: #a9b8d6; font-size: 13.5px; line-height: 1.85; text-align: start; }}
  .card p b {{ color: #27d17c; }}
  footer {{ margin-top: 26px; text-align: center; color: #6f83a8; font-size: 12.5px; }}
  footer code {{ background: #ffffff0d; padding: 2px 7px; border-radius: 6px; color: #a9b8d6; }}
</style>
</head>
<body>
  <header>
    <h1>مفاهيم لوقو <b>اللاسلكي العائلي</b></h1>
    <p>ثلاثة اتجاهات مبنية على ألوان التطبيق نفسها · اختر رقماً واحداً وأنفّذ عليه الطقم الكامل</p>
  </header>
  <div class="grid">
{cards}
  </div>
  <footer>القاعدة: تدرّج <code>#27d17c → #12a862</code> · خلفية <code>#0b1220</code> · موجات <code>#6ef0ab</code> · رسم متجهي SVG</footer>
</body>
</html>
"""
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        f.write(html)
    print("✅", OUT)
    return OUT


if __name__ == "__main__":
    build()
