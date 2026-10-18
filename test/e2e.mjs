/**
 * اختبار شامل من طرفين (بدون متصفح):
 *   - التحقق من الرمز
 *   - دخول عميلين + قائمة المتصلين
 *   - الوساطة (WebRTC signaling)
 *   - نظام «الضغط للتحدث» (منع تكلّم اثنين معاً)
 *   - رفع رسالة صوتية واسترجاعها عبر HTTP
 */
import fs from 'node:fs';
import WebSocket from 'ws';

const BASE_HTTP = 'http://127.0.0.1:8080';
const WS_URL = 'ws://127.0.0.1:8080/ws';
const CODE = JSON.parse(fs.readFileSync(new URL('../data/config.json', import.meta.url), 'utf8')).familyCode;

let fails = 0;
const ok = (name, cond, extra = '') => {
  console.log(`${cond ? '  ✅' : '  ❌'} ${name}${extra ? `  — ${extra}` : ''}`);
  if (!cond) fails++;
};

function client(tag) {
  const ws = new WebSocket(WS_URL);
  const inbox = [];
  const waiters = [];
  ws.on('message', (d) => {
    const m = JSON.parse(d.toString());
    inbox.push(m);
    for (const w of [...waiters]) if (w.pred(m)) { waiters.splice(waiters.indexOf(w), 1); w.resolve(m); }
  });
  return {
    tag, ws, inbox,
    ready: new Promise((r) => ws.on('open', r)),
    waitFor(pred, ms = 3000, label = '') {
      const hit = inbox.find(pred);
      if (hit) return Promise.resolve(hit);
      return new Promise((resolve, reject) => {
        const w = { pred, resolve };
        waiters.push(w);
        setTimeout(() => {
          const i = waiters.indexOf(w);
          if (i < 0) return;
          waiters.splice(i, 1);
          reject(new Error(`انتهت المهلة: ${label || tag}`));
        }, ms);
      });
    },
    send(o) { ws.send(JSON.stringify(o)); },
    sendBin(b) { ws.send(b); },
    close() { ws.close(); },
  };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

console.log('\n═══ 1) رفض الرمز الخطأ ═══');
{
  const bad = client('مخترق');
  await bad.ready;
  bad.send({ t: 'hello', name: 'دخيل', code: 'XXXXXX' });
  const err = await bad.waitFor((m) => m.t === 'err', 2000, 'رفض الرمز');
  ok('الرمز الخطأ مرفوض', err.reason === 'badcode');
  bad.close();
  await sleep(150);
}

console.log('\n═══ 2) دخول الوالدين ═══');
const A = client('أبو فيصل');
const B = client('ولد');
await Promise.all([A.ready, B.ready]);
A.send({ t: 'hello', name: 'أبو فيصل', code: CODE });
const wA = await A.waitFor((m) => m.t === 'welcome');
ok('دخول العميل الأول', !!wA.me, `المعرّف=${wA.me}`);
B.send({ t: 'hello', name: 'ولد', code: CODE });
const wB = await B.waitFor((m) => m.t === 'welcome');
ok('دخول العميل الثاني', !!wB.me, `المعرّف=${wB.me}`);

const roomB = await B.waitFor((m) => m.t === 'rooms' && m.roster?.length >= 2, 3000, 'قائمة المتصلين');
ok('قائمة المتصلين تحتوي الاثنين', roomB.roster.length === 2,
  roomB.roster.map((r) => r.name).join('، '));
ok('أسماء المتصلين صحيحة', roomB.roster.every((r) => r.name && !r.name.startsWith('مستخدم')));
const joinedB = await B.waitFor((m) => m.t === 'joined' && m.roomId === 'family', 3000, 'الغرفة الافتراضية');
ok('الغرفة الافتراضية موجودة', !!joinedB);
ok('التسريب مغلق: لا تصل الرسائل قبل التحقق',
  !B.inbox.some((m) => m.t === 'rooms' && m.roster?.some((r) => !r.name)));

console.log('\n═══ 3) نظام «الضغط للتحدث» ═══');
A.send({ t: 'ptt', on: true });
const talk = await B.waitFor((m) => m.t === 'talker' && m.id === wA.me, 2000, 'إعلان المتحدث');
ok('الآخر يرى من يتكلم', talk.name === 'أبو فيصل');

B.send({ t: 'ptt', on: true });
const busy = await B.waitFor((m) => m.t === 'busy', 2000, 'حظر التكلم المتزامن');
ok('منع تكلّم اثنين في الوقت نفسه', busy.by === 'أبو فيصل');

A.send({ t: 'ptt', on: false });
const ended = await B.waitFor((m) => m.t === 'talker' && m.id === null, 2000, 'انتهاء الكلام');
ok('تحرير الدور عند التوقف', ended.id === null);

console.log('\n═══ 4) وسيط WebRTC ═══');
A.send({ t: 'sig', to: wB.me, data: { sdp: { type: 'offer', sdp: 'اختبار' } } });
const sig = await B.waitFor((m) => m.t === 'sig' && m.from === wA.me, 2000, 'وسيط SDP');
ok('تمرير عرض SDP بين الجهازين', sig.data.sdp.sdp === 'اختبار');
A.send({ t: 'sig', to: wB.me, data: { cand: { candidate: 'candidate:1 udp 1 1.1.1.1 1 typ host' } } });
const cand = await B.waitFor((m) => m.t === 'sig' && m.data.cand, 2000, 'وسيط ICE');
ok('تمرير مرشّحات ICE', !!cand.data.cand.candidate);

console.log('\n═══ 5) الرسائل الصوتية ═══');
const fake = Buffer.from('OggS-صوت-تجريبي-0123456789');
A.send({ t: 'voice', dur: 3, mime: 'audio/webm;codecs=opus' });
await sleep(60);
A.sendBin(fake);
const got = await B.waitFor((m) => m.t === 'voice', 3000, 'وصول الرسالة');
ok('وصول الرسالة الصوتية للمستمع', got.dur === 3 && got.name === 'أبو فيصل', `المدة=${got.dur}ث`);
const echo = await A.waitFor((m) => m.t === 'voice' && m.mine, 2000, 'تأكيد للمرسل');
ok('المرسل يستلم تأكيداً', !!echo.mine);

const res = await fetch(BASE_HTTP + got.url);
const buf = Buffer.from(await res.arrayBuffer());
ok('تحميل المقطع عبر HTTP', res.status === 200 && buf.equals(fake), `${buf.length} بايت`);
ok('نوع المحتوى صحيح', res.headers.get('content-type')?.includes('audio/webm'),
  res.headers.get('content-type') || '');

console.log('\n═══ 6) غرفة خاصة + مغادرة ═══');
A.send({ t: 'dm', peerId: wB.me });
const inv = await B.waitFor((m) => m.t === 'invite', 2000, 'دعوة خاصة');
ok('إشعار الطرف الآخر بالمحادثة الخاصة', inv.from === 'أبو فيصل');
B.send({ t: 'join', roomId: inv.roomId });
const j = await B.waitFor((m) => m.t === 'joined' && m.roomId === inv.roomId, 2000, 'دخول الغرفة الخاصة');
ok('دخول الغرفة الخاصة', j.roomId === inv.roomId && j.members.length === 2);

A.close();
const left = await B.waitFor((m) => m.t === 'peer-left', 2000, 'إشعار المغادرة');
ok('إشعار الآخرين بالمغادرة', left.id === wA.me);

console.log('\n═══ 7) فحص الصحة ═══');
const h = await (await fetch(BASE_HTTP + '/api/health')).json();
ok('نقطة فحص الصحة تعمل', h.ok === true, JSON.stringify(h));

B.close();
await sleep(200);

console.log(`\n${fails === 0 ? '🎉 كل الاختبارات نجحت' : `⚠️  عدد الإخفاقات: ${fails}`}\n`);
process.exit(fails ? 1 : 0);
