#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# توليد شهادة محلية (CA) + شهادة سيرفر لتشغيل تطبيق اللاسلكي على الشبكة المحلية
# لا يحتاج sudo — كل الملفات داخل مجلد certs/
# ---------------------------------------------------------------------------
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"

HOSTNAME_LOCAL="$(hostname).local"

# اكتشاف عنوان IP الحالي للشبكة المحلية تلقائياً
IPV4="$(ip -4 route get 1.1.1.1 2>/dev/null | grep -oP 'src \K[\d.]+' || true)"
if [ -z "${IPV4:-}" ]; then
  IPV4="$(ip -4 addr show 2>/dev/null | grep -oP 'inet \K192\.168\.[\d.]+' | head -1 || true)"
fi
[ -z "${IPV4:-}" ] && IPV4="127.0.0.1"

echo "المضيف: $HOSTNAME_LOCAL"
echo "العنوان: $IPV4"

# تراجع إن وجدت شهادات سابقة
if [ -f ca.crt ] && [ "${1:-}" != "--force" ]; then
  echo "توجد شهادات سابقة (ca.crt). استعمل --force لتجديدها."
  exit 0
fi

# --- 1) جهة إصدار محلية (CA) صالحة 10 سنوات -------------------------------
openssl genrsa -out ca.key 4096 2>/dev/null
openssl req -x509 -new -nodes -key ca.key -sha256 -days 3650 \
  -subj "/C=SA/O=Family Talk Local CA/CN=Family Talk Local CA" \
  -out ca.crt

# --- 2) شهادة السيرفر مخاطبة بالـ mDNS + IP + localhost -------------------
# ملاحظة: آبل وآندرويد يرفضان شهادات أطول من 825 يوماً -> نستعمل 820
cat > server.ext <<EOF
basicConstraints = CA:FALSE
keyUsage = digitalSignature, keyEncipherment
extendedKeyUsage = serverAuth
subjectAltName = @alt_names
[alt_names]
DNS.1 = ${HOSTNAME_LOCAL}
DNS.2 = localhost
DNS.3 = family-talk.local
IP.1  = ${IPV4}
IP.2  = 127.0.0.1
EOF

openssl genrsa -out server.key 2048 2>/dev/null
openssl req -new -key server.key \
  -subj "/C=SA/O=Family Talk/CN=${HOSTNAME_LOCAL}" \
  -out server.csr
openssl x509 -req -in server.csr -CA ca.crt -CAkey ca.key -CAcreateserial \
  -out server.crt -days 820 -sha256 -extfile server.ext

rm -f server.csr server.ext

chmod 600 ca.key server.key
chmod 644 ca.crt server.crt

echo
echo "تم التوليد بنجاح:"
echo "  ca.crt     -> ثبّته على كل جوال (شهادة الجذر)"
echo "  server.crt -> للسيرفر"
echo "  العنوان المستعمل: https://${HOSTNAME_LOCAL}:8443  او  https://${IPV4}:8443"
echo
echo "للتحقق:"
openssl x509 -in server.crt -noout -subject -ext subjectAltName
