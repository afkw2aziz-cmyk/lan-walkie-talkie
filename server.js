#!/usr/bin/env node
/**
 * family-talk — سيرفر اللاسلكي العائلي
 * ------------------------------------------------------------------------
 * - HTTPS  على المنفذ 8443 (شهادة محلية من مجلد certs/)
 * - HTTP   على 127.0.0.1:8080 للتطوير فقط (localhost يُعتبر سياقاً آمناً)
 * - WebSocket واحد للوساطة (تسجيل الدخول، الغرف، وسيط WebRTC، الرسائل الصوتية)
 * - WebRTC يعمل ندّاً لندّ (mesh) داخل الشبكة المحلية — الصوت لا يمر بالسيرفر
 * - الرسائل الصوتية تُخزَّن في data/media وتُبث لمن في الغرفة
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import https from 'node:https';
import http from 'node:http';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, 'public');
const CERT_DIR = path.join(__dirname, 'certs');
const DATA_DIR = path.join(__dirname, 'data');
const MEDIA_DIR = path.join(DATA_DIR, 'media');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');

/* رقم الإصدار: مصدر واحد فقط هو package.json — يُحقن في الصفحات ويُعلَن في /api/health */
const PKG = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'));
const APP_VERSION = PKG.version;

const HTTPS_PORT = Number(process.env.PORT || 8443);
const DEV_HTTP_PORT = Number(process.env.DEV_PORT || 8080);

const MAX_VOICE_BYTES = 6 * 1024 * 1024;   // 6 ميجابايت للمقطع الواحد
const MAX_VOICE_SECONDS = 120;             // أقصى مدة مقطع صوتي
const PTT_MAX_LOCK_MS = 90_000;            // تحرير تلقائي للمتحدث
const HISTORY_PER_ROOM = 25;               // عدد الرسائل المُرسلة عند الدخول
const RETENTION_DAYS = 7;                  // مدة الاحتفاظ بالرسائل

fs.mkdirSync(MEDIA_DIR, { recursive: true });

/* ============================ الإعدادات ============================ */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const randomCode = (n = 6) =>
  Array.from({ length: n }, () => ALPHABET[crypto.randomInt(ALPHABET.length)]).join('');

let config = {};
try { config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); } catch { /* جديد */ }
if (!config.familyCode) {
  config.familyCode = randomCode(6);
  config.createdAt ||= new Date().toISOString();
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}
const FAMILY_CODE = (process.env.FAMILY_CODE || config.familyCode).toUpperCase();

/* ============================== الحالة ============================== */
let nextId = 1;
const clients = new Map();      // id -> client
const rooms = new Map();        // roomId -> room
const messages = [];            // سجل الرسائل الصوتية (الأحدث آخراً)

const now = () => Date.now();

/* ── حماية رمز العائلة من التخمين ──────────────────────────────────────
   المستودع عام وخطوات الاتصال موثّقة، والرمز هو حدّ الحماية الوحيد. لذا:
   تأخير قصير على كل محاولة فاشلة + قيد لكل عنوان شبكة + تسجيل في السجل. */
const AUTH_FAILS_PER_IP = 10;        // محاولات فاشلة مسموحة لكل عنوان…
const AUTH_WINDOW_MS = 10 * 60_000;  // …خلال هذه النافذة
const AUTH_LOCK_MS = 15 * 60_000;    // ومدة الحجب عند تجاوزها
const AUTH_FAIL_DELAY_MS = 500;      // تأخير الردّ على المحاولة الفاشلة
const authFails = new Map();         // ip -> { n, first, until }

/** الثواني المتبقية من حجب هذا العنوان (0 = غير محجوب) */
function authLockLeft(ip) {
  const until = authFails.get(ip)?.until || 0;
  return Math.max(0, Math.ceil((until - now()) / 1000));
}

/** يسجّل محاولة فاشلة، ويُرجع عددها وهل استدعت حجب العنوان */
function noteAuthFail(ip) {
  const st = authFails.get(ip) || { n: 0, first: now(), until: 0 };
  if (now() - st.first > AUTH_WINDOW_MS) { st.n = 0; st.first = now(); }
  st.n += 1;
  const tried = st.n;
  let locked = false;
  if (st.n >= AUTH_FAILS_PER_IP) {
    st.until = now() + AUTH_LOCK_MS;
    st.n = 0; st.first = now();
    locked = true;
  }
  authFails.set(ip, st);
  if (authFails.size > 200) {  // تنظيف السجل حتى لا ينمو بلا حدّ
    for (const [k, v] of authFails) {
      if ((!v.until || v.until < now()) && now() - v.first > AUTH_WINDOW_MS) authFails.delete(k);
    }
  }
  return { tried, locked };
}

/** مقارنة بزمن ثابت (حتى لا يُستنتج الرمز من فرق زمن الردّ) */
function codeMatches(supplied) {
  const a = Buffer.from(String(supplied), 'utf8');
  const b = Buffer.from(FAMILY_CODE, 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** سطر سجل موحّد لمحاولات الدخول (يظهر في journalctl و service.log) */
function logAuth(text) {
  console.log(`🔐 [${new Date().toISOString()}] ${text}`);
}

const send = (c, obj) => {
  if (c?.ws?.readyState === 1) c.ws.send(JSON.stringify(obj));
};
const broadcast = (room, obj, exceptId = null) => {
  for (const id of room.members) {
    if (id === exceptId) continue;
    const c = clients.get(id);
    if (c) send(c, obj);
  }
};
const roomIdForDm = (a, b) => `dm:${Math.min(a, b)}-${Math.max(a, b)}`;

function createRoom(id, kind) {
  const room = { id, kind, members: new Set(), talker: null, lockUntil: 0, createdAt: now() };
  rooms.set(id, room);
  return room;
}
const familyRoom = () => rooms.get('family') || createRoom('family', 'family');

function roomMeta(room) {
  const names = [...room.members].map((id) => clients.get(id)?.name).filter(Boolean);
  let name = 'العائلة';
  if (room.kind === 'dm') {
    const peer = [...room.members].map((id) => clients.get(id)).find(Boolean);
    name = peer ? `خاص: ${peer.name}` : 'محادثة خاصة';
  }
  return { id: room.id, kind: room.kind, name, count: room.members.size, names };
}

/** الغرف التي يحق لهذا العميل رؤيتها */
function roomsFor(client) {
  const list = [roomMeta(familyRoom())];
  for (const room of rooms.values()) {
    if (room.kind !== 'dm') continue;
    if (!room.id.includes(`-${client.id}`) && !room.id.includes(`${client.id}-`)) continue;
    if (!room.members.has(client.id) && !hasTouched(room, client.id)) continue;
    list.push(roomMeta(room));
  }
  return list;
}
// نسمح برؤية غرفة dm التي كان طرفاً فيها (لو كان الطرف الآخر أنشأها)
const dmParticipants = new Map(); // roomId -> Set(ids) لأي غرفة dm أُنشئت وهو أحد طرفيها

function dmRoom(a, b) {
  const id = roomIdForDm(a, b);
  let room = rooms.get(id);
  if (!room) room = createRoom(id, 'dm');
  if (!dmParticipants.has(id)) dmParticipants.set(id, new Set([a, b]));
  return room;
}
const hasTouched = (room, id) => dmParticipants.get(room.id)?.has(id) ?? false;

function pushRooms() {
  const list = [...clients.values()]
    .filter((c) => c.authed)
    .map((c) => ({ id: c.id, name: c.name || `مستخدم${c.id}`, roomId: c.ch }))
    .sort((a, b) => a.id - b.id);
  for (const c of clients.values()) if (c.authed) send(c, { t: 'rooms', list: roomsFor(c), roster: list });
}

/** قائمة أعضاء الغرفة الحالية لعميل معيّن */
function membersOf(roomId) {
  const room = rooms.get(roomId);
  if (!room) return [];
  return [...room.members]
    .map((id) => clients.get(id))
    .filter(Boolean)
    .map((c) => ({ id: c.id, name: c.name }))
    .sort((a, b) => a.id - b.id);
}

function syncRoom(room) {
  broadcast(room, {
    t: 'members',
    roomId: room.id,
    me: null,
    members: membersOf(room.id),
    talker: room.talker ? { id: room.talker, name: clients.get(room.talker)?.name } : null,
    count: room.members.size,
  });
  pushRooms();
}

function leaveRoom(client, roomId) {
  const room = rooms.get(roomId);
  if (!room) return;
  room.members.delete(client.id);
  if (room.talker === client.id) { room.talker = null; room.lockUntil = 0; }
  // أخبر الآخرين بإزالة نظير
  broadcast(room, { t: 'peer-left', roomId, id: client.id });
  syncRoom(room);
  if (room.members.size === 0 && room.kind === 'dm') {
    rooms.delete(room.id);
    dmParticipants.delete(room.id);
  }
}

function joinRoom(client, room) {
  if (client.ch === room.id) return;
  if (client.ch) leaveRoom(client, client.ch);
  client.ch = room.id;
  room.members.add(client.id);
  send(client, {
    t: 'joined',
    roomId: room.id,
    me: client.id,
    members: membersOf(room.id),
    talker: room.talker ? { id: room.talker, name: clients.get(room.talker)?.name } : null,
    history: messages.filter((m) => m.roomId === room.id).slice(-HISTORY_PER_ROOM),
  });
  syncRoom(room);
}

function releaseTalker(room, why = 'timeout') {
  if (!room.talker) return;
  const id = room.talker;
  room.talker = null;
  room.lockUntil = 0;
  broadcast(room, { t: 'talker', roomId: room.id, id: null, why, prev: id });
}

/* ========================== WebSocket ========================== */
const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_VOICE_BYTES + 4096 });

wss.on('connection', (ws, req) => {
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  const client = { id: nextId++, name: null, ws, ch: null, authed: false, upload: null, joinedAt: now(),
                   ip: req?.socket?.remoteAddress || 'unknown' };
  clients.set(client.id, client);

  ws.on('message', (raw, isBinary) => {
    if (isBinary) return finishUpload(client, raw);
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    handle(client, msg);
  });

  ws.on('close', () => {
    if (client.ch) leaveRoom(client, client.ch);
    clients.delete(client.id);
    pushRooms();
  });

  ws.on('error', () => { /* تُغلق تلقائياً */ });
});

function handle(client, msg) {
  // الرسالة الوحيدة المسموحة قبل التحقق هي الدخول
  if (!client.authed && msg.t !== 'hello') return;

  switch (msg.t) {
    case 'hello': {
      // عنوان محجوب؟ لا نُكمل ولا نأخذ تأخيراً — نرفض فوراً حتى نهاية الحجب
      const left = client.authed ? 0 : authLockLeft(client.ip);
      if (left > 0) {
        logAuth(`محاولة من عنوان محجوب ${client.ip} — يتبقى ${left} ثانية`);
        send(client, { t: 'err', reason: 'locked' });
        return;
      }
      const code = String(msg.code || '').trim().toUpperCase();
      if (!codeMatches(code)) {
        const { tried, locked } = noteAuthFail(client.ip);
        logAuth(`رمز خاطئ من ${client.ip} — المحاولة ${tried}/${AUTH_FAILS_PER_IP}`
          + (locked ? ` ← حُجب ${AUTH_LOCK_MS / 60_000} دقيقة` : ''));
        setTimeout(() => send(client, { t: 'err', reason: locked ? 'locked' : 'badcode' }), AUTH_FAIL_DELAY_MS);
        return;
      }
      authFails.delete(client.ip);   // رمز صحيح → يُصفَّر العدّ لهذا العنوان
      const name = String(msg.name || '').trim().slice(0, 24) || `مستخدم${client.id}`;
      logAuth(`دخول ناجح — ${name} من ${client.ip}`);
      client.authed = true;
      client.name = name;
      send(client, {
        t: 'welcome',
        me: client.id,
        name,
        rooms: roomsFor(client),
        serverTime: now(),
      });
      pushRooms();
      // لو كان أحدهم ينتظره في غرفة خاصة منشأة مسبقاً
      joinRoom(client, familyRoom());
      break;
    }

    case 'join': {
      const roomId = String(msg.roomId || 'family');
      const room = rooms.get(roomId);
      if (!room) { send(client, { t: 'err', reason: 'noroom' }); return; }
      if (room.kind === 'dm' && !hasTouched(room, client.id)) {
        send(client, { t: 'err', reason: 'noroom' }); return;
      }
      joinRoom(client, room);
      break;
    }

    case 'dm': { // فتح محادثة خاصة مع نظير
      const peerId = Number(msg.peerId);
      const peer = clients.get(peerId);
      if (!peer) { send(client, { t: 'err', reason: 'nopeer' }); return; }
      const room = dmRoom(client.id, peer.id);
      joinRoom(client, room);
      // إشعار الطرف الآخر بظهور المحادثة (لا ننقله قسراً)
      send(peer, { t: 'invite', roomId: room.id, from: client.name, fromId: client.id });
      pushRooms();
      break;
    }

    case 'rename': {
      client.name = String(msg.name || '').trim().slice(0, 24) || client.name;
      const room = rooms.get(client.ch);
      if (room) syncRoom(room);
      break;
    }

    /* ------------------------- الضغط للتحدث ------------------------- */
    case 'ptt': {
      const room = rooms.get(client.ch);
      if (!room) return;
      if (msg.on) {
        if (room.talker && room.talker !== client.id && now() < room.lockUntil) {
          send(client, { t: 'busy', roomId: room.id, by: clients.get(room.talker)?.name || 'أحدهم' });
          return;
        }
        room.talker = client.id;
        room.lockUntil = now() + PTT_MAX_LOCK_MS;
        broadcast(room, { t: 'talker', roomId: room.id, id: client.id, name: client.name });
      } else if (room.talker === client.id) {
        releaseTalker(room, 'released');
      }
      break;
    }

    /* --------------------------- وسيط WebRTC --------------------------- */
    case 'sig': {
      const to = clients.get(Number(msg.to));
      if (!to) return;
      send(to, { t: 'sig', from: client.id, name: client.name, data: msg.data });
      break;
    }

    /* ------------------------- الرسائل الصوتية ------------------------- */
    case 'voice': {
      const room = rooms.get(client.ch);
      if (!room) return;
      const dur = Math.min(Number(msg.dur) || 0, MAX_VOICE_SECONDS);
      client.upload = { roomId: room.id, mime: String(msg.mime || 'audio/webm'), dur, size: 0 };
      break;
    }

    case 'ping': send(client, { t: 'pong' }); break;
  }
}

function finishUpload(client, buf) {
  const up = client.upload;
  client.upload = null;
  const room = rooms.get(client.ch);
  if (!up || !room || up.roomId !== room.id) return;
  if (!buf?.length || buf.length > MAX_VOICE_BYTES) {
    send(client, { t: 'err', reason: 'toolarge' }); return;
  }
  const ext = /mp4|aac|m4a/i.test(up.mime) ? 'm4a' : /ogg/i.test(up.mime) ? 'ogg' : 'webm';
  const id = crypto.randomBytes(9).toString('hex');
  const file = `${id}.${ext}`;
  fs.writeFileSync(path.join(MEDIA_DIR, file), buf);

  const meta = {
    id, roomId: room.id, from: client.id, name: client.name,
    mime: up.mime, dur: up.dur, size: buf.length, ts: now(), url: `/media/${file}`,
  };
  messages.push(meta);
  saveIndex();
  broadcast(room, { t: 'voice', ...meta });
  send(client, { t: 'voice', ...meta, mine: true });
  prune();
}

/* --------- فهرس الرسائل: يبقى بعد إعادة التشغيل --------- */
const INDEX_FILE = path.join(DATA_DIR, 'messages.json');

function loadIndex() {
  try {
    const arr = JSON.parse(fs.readFileSync(INDEX_FILE, 'utf8'));
    for (const m of arr) {
      if (m?.url && fs.existsSync(path.join(MEDIA_DIR, path.basename(m.url)))) messages.push(m);
    }
  } catch { /* لا فهرس بعد */ }
}
function saveIndex() {
  try { fs.writeFileSync(INDEX_FILE, JSON.stringify(messages)); } catch { /* تجاهل */ }
}
/** حذف ملفات الصوت التي لم يعد لها أثر في الفهرس */
function cleanupOrphans() {
  const known = new Set(messages.map((m) => path.basename(m.url)));
  for (const f of fs.readdirSync(MEDIA_DIR)) {
    if (!known.has(f)) { try { fs.unlinkSync(path.join(MEDIA_DIR, f)); } catch { /* تجاهل */ } }
  }
}

function prune() {
  const cutoff = now() - RETENTION_DAYS * 86_400_000;
  const extra = Math.max(0, messages.length - 400);
  const removed = messages.filter((m, i) => m.ts < cutoff || i < extra);
  if (!removed.length) return;
  for (const m of removed) {
    try { fs.unlinkSync(path.join(DATA_DIR, 'media', path.basename(m.url))); } catch { /* موجود مسبقاً */ }
  }
  const keep = new Set(removed.map((m) => m.id));
  for (let i = messages.length - 1; i >= 0; i--) if (keep.has(messages[i].id)) messages.splice(i, 1);
  saveIndex();
}

/* ===================== نبض الحياة وتحرير المتحدث ===================== */
setInterval(() => {
  for (const c of clients.values()) {
    if (c.ws.readyState !== 1) continue;
    if (!c.ws.isAlive) { c.ws.terminate(); continue; }
    c.ws.isAlive = false;
    try { c.ws.ping(); } catch { /* تجاهل */ }
  }
  for (const room of rooms.values()) {
    if (room.talker && now() > room.lockUntil) releaseTalker(room, 'timeout');
  }
}, 15_000).unref?.();

/* ========================= خدمة الملفات ========================= */
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webm': 'audio/webm',
  '.m4a': 'audio/mp4',
  '.ogg': 'audio/ogg',
  '.mp4': 'audio/mp4',
  '.txt': 'text/plain; charset=utf-8',
};

/** صفحة رمز العائلة (تعمل على HTTP و HTTPS) */
function sendCodePage(res) {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(`<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>رمز العائلة</title>
<body style="font:16px system-ui;background:#0b1220;color:#e8eefc;display:grid;place-items:center;height:100vh;margin:0;text-align:center">
<div><div style="opacity:.7;margin-bottom:10px">رمز العائلة</div>
<div style="font:800 46px/1 ui-monospace,monospace;letter-spacing:.18em;color:#27d17c">${FAMILY_CODE}</div>
<div style="opacity:.5;margin-top:14px;font-size:13px">اكتبه مرة واحدة في كل جوال</div></div></body></html>`);
}

function serveFile(res, filePath, { noStore = false } = {}) {
  fs.stat(filePath, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('غير موجود'); return; }
    const ext = path.extname(filePath).toLowerCase();
    const head = {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Content-Length': st.size,
      'Accept-Ranges': 'bytes',
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
      'X-Content-Type-Options': 'nosniff',
    };
    const ctrl = `${noStore ? 'no-store' : 'public, max-age=300'}`;
    head['Cache-Control'] = ctrl;
    // دعم طلبات النطاق للملفات الصوتية (مهم لسفاري)
    res.writeHead(200, head);
    fs.createReadStream(filePath).pipe(res);
  });
}

/* صفحات HTML: نحقن رقم الإصدار الحالي قبل الإرسال (لا صياغة قوالب، فقط __APP_VERSION__) */
function sendHtml(res, filePath) {
  let html;
  try { html = fs.readFileSync(filePath, 'utf8'); }
  catch { res.writeHead(404); res.end(''); return; }
  const buf = Buffer.from(html.replaceAll('__APP_VERSION__', APP_VERSION), 'utf8');
  res.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Length': buf.length,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(buf);
}

function handler(req, res) {
  const url = new URL(req.url, 'https://local');
  let pathname = decodeURIComponent(url.pathname);
  const isTls = !!req.socket.encrypted;

  // --- على HTTP غير المشفّر من أجهزة الشبكة: صفحة التعريف + شهادة الثقة فقط ---
  const isLoopback = req.socket.remoteAddress === '127.0.0.1'
    || req.socket.remoteAddress === '::1'
    || req.socket.remoteAddress === '::ffff:127.0.0.1';
  if (!isTls && !isLoopback) {
    const allowed = ['/', '/setup.html', '/styles.css', '/qr.png'];
    const isIcon = pathname.startsWith('/icons/') && !pathname.includes('..');
    if (pathname === '/ca.crt') {
      res.writeHead(200, {
        'Content-Type': 'application/x-x509-ca-cert',
        'Content-Disposition': 'attachment; filename="family-talk-ca.crt"',
        'Content-Length': fs.statSync(path.join(CERT_DIR, 'ca.crt')).size,
      });
      fs.createReadStream(path.join(CERT_DIR, 'ca.crt')).pipe(res);
      return;
    }
    if (pathname === '/qr.png') {
      const qr = path.join(DATA_DIR, 'qr.png');
      if (fs.existsSync(qr)) return serveFile(res, qr);
      res.writeHead(404); res.end(''); return;
    }
    if (pathname === '/code') { res.writeHead(404, { 'Cache-Control': 'no-store' }); res.end(''); return; }
    if (allowed.includes(pathname) || isIcon) {
      if (pathname === '/' ) pathname = '/setup.html';
      const p = path.join(PUBLIC_DIR, path.normalize(pathname));
      return p.endsWith('.html') ? sendHtml(res, p) : serveFile(res, p, { noStore: true });
    }
    // بقية المسارات → إلى النسخة المشفّرة
    const host = String(req.headers.host || '').split(':')[0];
    res.writeHead(302, { Location: `https://${host}:${HTTPS_PORT}${req.url}` });
    res.end();
    return;
  }

  if (pathname === '/api/health') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({
      ok: true,
      version: APP_VERSION,
      clients: clients.size,
      rooms: rooms.size,
      messages: messages.length,
    }));
    return;
  }

  if (pathname === '/ca.crt') {
    res.writeHead(200, {
      'Content-Type': 'application/x-x509-ca-cert',
      'Content-Disposition': 'attachment; filename="family-talk-ca.crt"',
      'Content-Length': fs.statSync(path.join(CERT_DIR, 'ca.crt')).size,
    });
    fs.createReadStream(path.join(CERT_DIR, 'ca.crt')).pipe(res);
    return;
  }

  if (pathname === '/qr.png') {
    const qr = path.join(DATA_DIR, 'qr.png');
    if (fs.existsSync(qr)) return serveFile(res, qr);
    res.writeHead(404); res.end(''); return;
  }

  // رمز العائلة يُعرض على جهاز الخدمة نفسه فقط — أي جهاز آخر على الشبكة كان يقرأه صريحاً
  if (pathname === '/code') {
    if (!isLoopback) { res.writeHead(404, { 'Cache-Control': 'no-store' }); res.end(''); return; }
    return sendCodePage(res);
  }

  if (pathname.startsWith('/media/')) {
    const base = path.basename(pathname);
    return serveFile(res, path.join(MEDIA_DIR, base));
  }

  if (pathname === '/' || pathname === '') pathname = '/index.html';
  const filePath = path.join(PUBLIC_DIR, path.normalize(pathname).replace(/^(\.\.[/\\])+/, ''));
  if (!filePath.startsWith(PUBLIC_DIR)) { res.writeHead(403); res.end('ممنوع'); return; }
  // صفحات HTML تُحقن برقم الإصدار، وبقية الملفات دائماً طازجة (تطبيق محلي)
  if (filePath.endsWith('.html')) return sendHtml(res, filePath);
  serveFile(res, filePath, { noStore: true });
}

/* ========================= تشغيل الخدمتين ========================= */
function attachUpgrade(server, { localOnly = false } = {}) {
  const loopback = (a) => a === '127.0.0.1' || a === '::1' || a === '::ffff:127.0.0.1';
  server.on('upgrade', (req, socket, head) => {
    const { pathname } = new URL(req.url, 'https://local');
    if (pathname !== '/ws') { socket.destroy(); return; }
    if (localOnly && !loopback(req.socket.remoteAddress)) { socket.destroy(); return; }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  });
}

let httpsServer = null;
try {
  const key = fs.readFileSync(path.join(CERT_DIR, 'server.key'));
  const cert = fs.readFileSync(path.join(CERT_DIR, 'server.crt'));
  if (!fs.existsSync(path.join(CERT_DIR, 'server.crt'))) throw new Error('لا توجد شهادة');
  httpsServer = https.createServer({ key, cert }, handler);
  attachUpgrade(httpsServer);
  httpsServer.listen(HTTPS_PORT, '0.0.0.0', () => {
    console.log(`🔒  https://<عنوان-الجهاز>:${HTTPS_PORT}  (للجوالات)`);
  });
  httpsServer.on('error', (e) => console.error('خطأ HTTPS:', e.message));
} catch (e) {
  console.error('⚠️  تعذّر تشغيل HTTPS:', e.message);
  console.error('    شغّل أولاً:  npm run certs');
}

const devServer = http.createServer(handler);
attachUpgrade(devServer, { localOnly: true });
devServer.listen(DEV_HTTP_PORT, '0.0.0.0', () => {
  console.log(`📱  http://<عنوان-الجهاز>:${DEV_HTTP_PORT}  (لتعريف الجوالات: التطبيق + شهادة الثقة)`);
});
devServer.on('error', (e) => console.error('خطأ HTTP:', e.message));

/* --------- رمز QR (يُولَّد محلياً بـ qrencode إن توفّر) --------- */
let PUBLIC_URL = '';
function makeQr() {
  const ip = process.env.LAN_IP
    || Object.values(os.networkInterfaces()).flat()
      .find((i) => i && i.family === 'IPv4' && !i.internal)?.address
    || '127.0.0.1';
  const target = `https://${ip}:${HTTPS_PORT}/`;
  try {
    execFileSync('qrencode', ['-o', path.join(DATA_DIR, 'qr.png'), '-s', '8', '-m', '2', target]);
  } catch { /* qrencode غير متوفّر */ }
  return target;
}

console.log('');
console.log('──────────────────────────────────────────────');
console.log('  جهاز اللاسلكي العائلي — يعمل الآن');
console.log('──────────────────────────────────────────────');
console.log(`  رمز العائلة:      ${FAMILY_CODE}`);
PUBLIC_URL = makeQr();
console.log(`  رابط التطبيق:     ${PUBLIC_URL}`);
console.log(`  صفحة تعريف الجوال: http://${new URL(PUBLIC_URL).hostname}:${DEV_HTTP_PORT}/`);
console.log(`  رمز العائلة للمراجعة (على هذا الجهاز فقط): http://127.0.0.1:${DEV_HTTP_PORT}/code`);
console.log('──────────────────────────────────────────────');
console.log('');

loadIndex();
cleanupOrphans();
prune();
