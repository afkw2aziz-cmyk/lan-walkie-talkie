/* عامل الخدمة: موجود فقط لجعل التطبيق قابلاً للتثبيت على الشاشة الرئيسية.
   لا نخزّن أي شيء في الكاش — التطبيق يحتاج السيرفر المحلي دائماً. */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (e) => {
  // مرور مباشر للشبكة (بدون كاش)
  if (e.request.method !== 'GET') return;
});
