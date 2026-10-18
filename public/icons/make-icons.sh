#!/usr/bin/env bash
# تحديث أيقونات التطبيق من طقم الهوية في logo/
#
# الأيقونات لم تعد تُرسم هنا بـ ffmpeg (كانت نسخة صندوقية قديمة).
# المصدر الوحيد للحقيقة الآن: logo/png/logo-icon-*.png
# لإعادة توليد الأصول من الصفر:  python3 logo/build.py final
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="$DIR/../../logo/png"

[ -d "$SRC" ] || { echo "✗ لم أجد طقم الهوية في: $SRC"; echo "  شغّل أولاً:  python3 logo/build.py final"; exit 1; }

copy() { # copy <مصدر> <هدف>
  local s="$SRC/$1" d="$DIR/$2"
  [ -f "$s" ] || { echo "✗ المصدر مفقود: $s"; exit 1; }
  cp "$s" "$d"
  printf '  ✓ %-24s ← %s\n' "$2" "$1"
}

echo "تحديث أيقونات التطبيق من طقم الهوية:"
copy logo-icon-180.png          icon-180.png
copy logo-icon-192.png          icon-192.png
copy logo-icon-512.png          icon-512.png
copy logo-icon-maskable-512.png icon-maskable-512.png

echo
echo "الأحجام الناتجة:"
for f in "$DIR"/*.png; do printf '  %-26s %s\n' "$(basename "$f")" "$(file -b "$f" | cut -d, -f2)"; done
echo
echo "ملاحظة: السيرفر يقدّم الملفات بـ Cache-Control: no-store، وعامل الخدمة"
echo "لا يخزّن شيئاً — فالتحديث يظهر على الجوالات فوراً عند إعادة التحميل."
echo "أما أيقونة التطبيق المثبَّت على الشاشة الرئيسية فقد تبقى القديمة حتى"
echo "يُعاد تثبيته (قرار من نظام الجوال نفسه)."
