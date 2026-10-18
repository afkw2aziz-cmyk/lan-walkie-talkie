'use strict';
/* =========================================================================
   اللاسلكي العائلي — منطق التطبيق
   بث مباشر (WebRTC mesh) + رسائل صوتية (عبر السيرفر المحلي)
   ========================================================================= */

const $ = (s) => document.querySelector(s);
const el = {
  login: $('#login'), app: $('#app'),
  nameInput: $('#nameInput'), codeInput: $('#codeInput'), nameChips: $('#nameChips'),
  joinBtn: $('#joinBtn'), loginError: $('#loginError'),
  statusDot: $('#statusDot'), myName: $('#myName'),
  channels: $('#channels'), log: $('#log'),
  talkerBanner: $('#talkerBanner'), talkerName: $('#talkerName'),
  pttBtn: $('#pttBtn'), pttIcon: $('#pttIcon'), pttLabel: $('#pttLabel'),
  recordBtn: $('#recordBtn'), muteBtn: $('#muteBtn'), hint: $('#hint'),
  recBar: $('#recBar'), recTimer: $('#recTimer'), recSend: $('#recSend'), recCancel: $('#recCancel'),
  sheet: $('#sheet'), closeSheet: $('#closeSheet'), saveBtn: $('#saveBtn'), leaveBtn: $('#leaveBtn'),
  autoplayToggle: $('#autoplayToggle'), vibrateToggle: $('#vibrateToggle'), wakeToggle: $('#wakeToggle'),
  renameInput: $('#renameInput'), infoRoom: $('#infoRoom'), infoCount: $('#infoCount'),
  toast: $('#toast'), announcer: $('#announcer'), liveAudio: $('#liveAudio'),
  settingsBtn: $('#settingsBtn'), addToHome: $('#addToHome'),
};

/* ============================== الحالة ============================== */
const S = {
  ws: null, me: null, name: '', code: '',
  roomId: 'family', rooms: [], roster: [], members: [], talker: null,
  peers: new Map(),                  // id -> { pc, audio, initiator }
  micStream: null, micTrack: null,
  pttOn: false, blockedUntil: 0, recording: false,
  recorder: null, recChunks: [], recStart: 0, recTicker: null, recMime: '',
  autoplay: true, vibrate: true, keepAwake: true, muted: false,
  wakeLock: null, unlocked: false, byUser: false, retry: 0,
  invites: new Set(), messages: new Map(),
};
const KEYS = { name: 'ft_name', code: 'ft_code', prefs: 'ft_prefs', names: 'ft_names' };

/* ============================== أدوات ============================== */
const wsSend = (o) => { if (S.ws?.readyState === 1) S.ws.send(JSON.stringify(o)); };
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const hhmm = (ts) => new Date(ts).toLocaleTimeString('ar', { hour: '2-digit', minute: '2-digit' });
const mmss = (ms) => { const s = Math.floor(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const initials = (n) => (n || '؟').trim().slice(0, 2);

function toast(text, ms = 2200) {
  el.toast.textContent = text;
  el.toast.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { el.toast.hidden = true; }, ms);
}
function buzz(pattern = [110, 55, 110]) {
  if (S.vibrate && navigator.vibrate) { try { navigator.vibrate(pattern); } catch { /* تجاهل */ } }
}
function setStatus(kind) {
  el.statusDot.className = 'dot ' + kind;
  el.statusDot.title = { on: 'متصل', off: 'جارٍ الاتصال…', err: 'انقطع الاتصال' }[kind] || '';
}

/* ============================ الإعدادات ============================ */
function loadPrefs() {
  try {
    const p = JSON.parse(localStorage.getItem(KEYS.prefs) || '{}');
    S.autoplay = p.autoplay !== false;
    S.vibrate = p.vibrate !== false;
    S.keepAwake = p.keepAwake !== false;
  } catch { /* تجاهل */ }
  el.autoplayToggle.checked = S.autoplay;
  el.vibrateToggle.checked = S.vibrate;
  el.wakeToggle.checked = S.keepAwake;
}
function savePrefs() {
  S.autoplay = el.autoplayToggle.checked;
  S.vibrate = el.vibrateToggle.checked;
  S.keepAwake = el.wakeToggle.checked;
  localStorage.setItem(KEYS.prefs, JSON.stringify({ autoplay: S.autoplay, vibrate: S.vibrate, keepAwake: S.keepAwake }));
  applyWakeLock();
  toast('تم الحفظ');
}

/* ==================== تفعيل الصوت (مطلوب لسفاري) ==================== */
const SILENT = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=';
function unlockAudio() {
  try { if (navigator.audioSession) navigator.audioSession.type = 'play-and-record'; } catch { /* غير مدعوم */ }
  if (S.unlocked) return;
  S.unlocked = true;
  // افتح قناة الصوت في سفاري: عنصر لكل نظير + عنصر الإعلانات، كلها بلمسة واحدة
  const els = [el.announcer, ...document.querySelectorAll('#liveAudio audio')];
  for (const a of els) {
    try {
      a.src = SILENT;
      const p = a.play();
      if (p?.then) p.then(() => { a.pause(); a.removeAttribute('src'); a.load?.(); }).catch(() => {});
      else { a.pause(); a.removeAttribute('src'); }
    } catch { /* تجاهل */ }
  }
}
document.addEventListener('touchstart', unlockAudio, { once: true, passive: true });
document.addEventListener('click', unlockAudio, { once: true });

/* ========================= إبقاء الشاشة مضاءة ========================= */
async function applyWakeLock() {
  try {
    if (S.wakeLock) { await S.wakeLock.release().catch(() => {}); S.wakeLock = null; }
    if (S.keepAwake && 'wakeLock' in navigator && document.visibilityState === 'visible') {
      S.wakeLock = await navigator.wakeLock.request('screen');
      S.wakeLock.addEventListener?.('release', () => { S.wakeLock = null; });
    }
  } catch { /* غير مدعوم */ }
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') applyWakeLock(); });

/* ============================= الميكروفون ============================= */
async function startMic() {
  if (S.micStream) return;
  if (!navigator.mediaDevices?.getUserMedia) {
    const e = new Error('لا يمكن الوصول للميكروفون');
    e.friendly = location.protocol === 'https:'
      ? 'المتصفح لا يدعم الميكروفون.'
      : 'يجب فتح الموقع عبر HTTPS (الشهادة الآمنة) لتشغيل الميكروفون.';
    throw e;
  }
  S.micStream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    video: false,
  });
  S.micTrack = S.micStream.getAudioTracks()[0];
  S.micTrack.enabled = false;                      // الميكروفون مكتوم حتى الضغط
  S.micTrack.addEventListener('ended', () => { S.micStream = null; S.micTrack = null; });
}
const setMic = (on) => { if (S.micTrack) S.micTrack.enabled = on; };

/* ============================== الاتصال ============================== */
function connect() {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  let ws;
  try { ws = new WebSocket(`${proto}//${location.host}/ws`); }
  catch { setStatus('err'); return scheduleReconnect(); }
  S.ws = ws;

  ws.onopen = () => {
    S.retry = 0;
    setStatus('on');
    wsSend({ t: 'hello', name: S.name, code: S.code });
  };
  ws.onmessage = (ev) => {
    let m; try { m = JSON.parse(ev.data); } catch { return; }
    onServer(m);
  };
  ws.onclose = () => {
    setStatus('off');
    teardownMesh();
    if (!S.byUser) scheduleReconnect();
  };
  ws.onerror = () => setStatus('err');
}

function scheduleReconnect() {
  S.retry = Math.min(S.retry + 1, 8);
  const wait = Math.min(600 * S.retry, 5000);
  toast(`انقطع الاتصال… إعادة المحاولة (${S.retry})`, wait);
  setTimeout(() => { if (!S.byUser) connect(); }, wait);
}

function onServer(m) {
  switch (m.t) {
    case 'welcome':
      S.me = m.me;
      el.myName.textContent = S.name;
      el.renameInput.value = S.name;
      break;

    case 'err':
      if (m.reason === 'badcode') {
        S.byUser = true;
        try { S.ws.close(); } catch { /* تجاهل */ }
        goLogin('رمز العائلة غير صحيح. تأكد منه مع أبو فيصل.');
      } else {
        toast(m.reason === 'toolarge' ? 'المقطع طويل جداً' : 'خطأ في الخادم');
      }
      break;

    case 'rooms':
      S.rooms = m.list || [];
      if (m.roster) S.roster = m.roster;
      renderChannels();
      break;

    case 'joined': {
      S.roomId = m.roomId;
      S.members = m.members || [];
      S.talker = m.talker;
      S.messages.clear();
      el.log.textContent = '';
      renderChannels();
      updateInfo();
      if (m.history?.length) {
        for (const msg of m.history) addVoiceEntry(msg, { silent: true });
        addSys(`— رسائل سابقة في ${roomName(S.roomId)} —`);
      }
      rebuildMesh();
      break;
    }

    case 'members':
      S.members = m.members || [];
      S.talker = m.talker;
      renderTalker();
      rebuildMesh();
      updateInfo();
      break;

    case 'peer-left':
      closePeer(m.id);
      if (S.talker?.id === m.id) { S.talker = null; renderTalker(); }
      break;

    case 'talker':
      S.talker = m.id ? { id: m.id, name: m.name } : null;
      // لو حُرِّر دورنا تلقائياً من الخادم، أعِد الزر لحالته
      if (!m.id && S.pttOn && m.prev === S.me) pttRelease(false);
      renderTalker();
      if (m.id && m.id !== S.me) buzz([40]);
      break;

    case 'busy':
      S.blockedUntil = Date.now() + 1200;
      el.pttBtn.classList.add('blocked');
      setTimeout(() => el.pttBtn.classList.remove('blocked'), 1200);
      toast(`${m.by} يتكلم الآن… انتظر لحظة`, 1200);
      pttRelease(false);
      break;

    case 'sig':
      onSignal(m.from, m.data);
      break;

    case 'invite':
      S.invites.add(m.roomId);
      renderChannels();
      buzz([80, 40, 80]);
      toast(`${m.from} يريد محادثة خاصة معك`);
      break;

    case 'voice':
      addVoiceEntry(m);
      if (m.from !== S.me) {
        buzz([120, 60, 120]);
        if (S.autoplay) playVoice(m.url, null);
      }
      break;
  }
}

/* ============================== الغرف ============================== */
const roomName = (id) => S.rooms.find((r) => r.id === id)?.name || 'العائلة';

function renderChannels() {
  el.channels.textContent = '';
  for (const r of S.rooms) {
    const b = document.createElement('button');
    b.className = 'chip' + (r.id === S.roomId ? ' active' : '') + (S.invites.has(r.id) ? ' ringing' : '');
    b.innerHTML = `${esc(r.name)}${r.count ? ` <span class="muted">(${r.count})</span>` : ''}`;
    if (S.invites.has(r.id)) b.innerHTML += ' <span class="badge">!</span>';
    b.onclick = () => { S.invites.delete(r.id); wsSend({ t: 'join', roomId: r.id }); renderChannels(); };
    el.channels.appendChild(b);
  }
  // أزرار المحادثة الخاصة مع المتصلين في قناة أخرى
  const dmPeers = S.roster.filter((p) => p.id !== S.me && p.roomId !== S.roomId);
  for (const p of dmPeers) {
    const b = document.createElement('button');
    b.className = 'chip';
    b.innerHTML = `خاص: ${esc(p.name)}`;
    b.onclick = () => wsSend({ t: 'dm', peerId: p.id });
    el.channels.appendChild(b);
  }
}

function renderTalker() {
  const others = S.talker && S.talker.id !== S.me;
  el.talkerBanner.hidden = !others;
  if (others) el.talkerName.textContent = S.talker.name || 'أحدهم';
}

function updateInfo() {
  el.infoRoom.textContent = roomName(S.roomId);
  el.infoCount.textContent = String(S.members.length);
}

/* ============================ شبكة WebRTC ============================ */
function rebuildMesh() {
  const want = new Set(S.members.filter((m) => m.id !== S.me).map((m) => m.id));
  for (const id of [...S.peers.keys()]) if (!want.has(id)) closePeer(id);
  for (const id of want) if (!S.peers.has(id)) addPeer(id, S.me > id);
  updateMeshStatus();
}

function addPeer(id, initiator) {
  if (S.peers.has(id)) return S.peers.get(id);
  const pc = new RTCPeerConnection({ iceServers: [] });
  const entry = { pc, audio: null, initiator, id, pending: [] };
  S.peers.set(id, entry);

  if (initiator && S.micStream) for (const t of S.micStream.getTracks()) pc.addTrack(t, S.micStream);

  pc.onicecandidate = (e) => { if (e.candidate) wsSend({ t: 'sig', to: id, data: { cand: e.candidate } }); };
  pc.ontrack = (e) => attachRemote(id, e.streams[0] || new MediaStream([e.track]));
  pc.onconnectionstatechange = () => {
    updateMeshStatus();
    if (pc.connectionState === 'connected') flushCandidates(entry);
    if (['failed', 'closed'].includes(pc.connectionState) && S.peers.has(id)) {
      // أعد المحاولة مرة واحدة
      closePeer(id);
      if (S.members.some((m) => m.id === id)) setTimeout(() => addPeer(id, S.me > id), 1200);
    }
  };

  if (initiator) {
    pc.onnegotiationneeded = async () => {
      try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        wsSend({ t: 'sig', to: id, data: { sdp: pc.localDescription } });
      } catch { /* تجاهل */ }
    };
  }
  return entry;
}

/** مرشّحات ICE التي وصلت قبل وصف الاتصال — تُطبَّق بعد جاهزيته */
async function flushCandidates(entry) {
  if (!entry?.pc.remoteDescription) return;
  const queue = entry.pending.splice(0);
  for (const c of queue) { try { await entry.pc.addIceCandidate(c); } catch { /* تجاهل */ } }
}

function closePeer(id) {
  const e = S.peers.get(id);
  if (!e) return;
  S.peers.delete(id);
  try { e.pc.onnegotiationneeded = null; e.pc.close(); } catch { /* تجاهل */ }
  if (e.audio) {
    try {
      e.audio.srcObject = null;
      e.audio.pause?.();
      if (e.audio.dataset.pooled) delete e.audio.dataset.peer;
      else e.audio.remove();
    } catch { /* تجاهل */ }
  }
  updateMeshStatus();
}

function teardownMesh() {
  for (const id of [...S.peers.keys()]) closePeer(id);
}

function attachRemote(id, stream) {
  const e = S.peers.get(id);
  if (!e) return;
  let a = e.audio;
  if (!a) {
    a = pickAudioEl();
    a.muted = S.muted;
    e.audio = a;
    a.dataset.peer = String(id);
  }
  if (a.srcObject !== stream) a.srcObject = stream;
  a.play().catch(() => { /* يبدأ مع أول لمسة */ });
  updateMeshStatus();
}

/** عنصر صوت حرّ من المجموعة (المجموعة مُفعَّلة مسبقاً بلمسة الدخول — مهم لسفاري) */
function pickAudioEl() {
  const els = [...document.querySelectorAll('#liveAudio audio')];
  const busy = new Set([...S.peers.values()].map((p) => p.audio).filter(Boolean));
  const free = els.find((x) => !busy.has(x));
  if (free) return free;
  const a = document.createElement('audio');
  a.setAttribute('playsinline', '');
  a.setAttribute('webkit-playsinline', '');
  a.autoplay = true;
  el.liveAudio.appendChild(a);
  return a;
}

/** حالة الشبكة المباشرة — يظهر للأسرة سبب عدم عمل البث */
function updateMeshStatus() {
  const total = S.peers.size;
  const conn = [...S.peers.values()].filter((p) => p.pc.connectionState === 'connected').length;
  S.mesh = { total, conn };
  if (!total) {
    el.hint.textContent = 'لا أحد آخر في هذه القناة الآن — سجّل رسالة صوتية أو انتظر.';
    el.hint.className = 'hint muted small';
    return;
  }
  if (conn === total) {
    el.hint.textContent = 'جاهز — اضغط مع الاستمرار على الزر ثم اتكلم.';
    el.hint.className = 'hint muted small';
    return;
  }
  el.hint.textContent = `البث المباشر يتصل… (${conn}/${total}) — الرسائل الصوتية تعمل فوراً.`;
  el.hint.className = 'hint small warn';
}

async function onSignal(from, data) {
  let e = S.peers.get(from) || addPeer(from, false);
  const pc = e.pc;
  try {
    if (data.sdp) {
      if (data.sdp.type === 'offer') {
        if (pc.signalingState !== 'stable') return;
        await pc.setRemoteDescription(data.sdp);
        for (const tr of pc.getTransceivers()) {
          try { tr.direction = 'sendrecv'; if (S.micTrack) await tr.sender.replaceTrack(S.micTrack); } catch { /* تجاهل */ }
        }
        const ans = await pc.createAnswer();
        await pc.setLocalDescription(ans);
        wsSend({ t: 'sig', to: from, data: { sdp: pc.localDescription } });
      } else if (data.sdp.type === 'answer') {
        if (pc.signalingState !== 'have-local-offer') return;
        await pc.setRemoteDescription(data.sdp);
      }
      await flushCandidates(e);           // طبّق المرشّحات التي سبقت الوصف
    } else if (data.cand) {
      if (pc.remoteDescription?.type) await pc.addIceCandidate(data.cand);
      else e.pending.push(data.cand);     // احتفظ بها حتى يجهز الوصف
    }
  } catch { /* تجاهل أخطاء الوساطة */ }
}

/* ========================== الضغط للتحدث ========================== */
function pttPress(ev) {
  ev.preventDefault();
  if (S.recording) { toast('أوقف التسجيل أولاً'); return; }
  if (Date.now() < S.blockedUntil) return;
  if (!S.micTrack) { toast('لا يوجد ميكروفون'); return; }
  S.pttOn = true;
  setMic(true);
  el.pttBtn.classList.add('live');
  el.pttIcon.textContent = '📡';
  el.pttLabel.textContent = 'تتكلم… اترك للإنهاء';
  wsSend({ t: 'ptt', on: true });
}
function pttRelease(send = true) {
  if (!S.pttOn) return;
  S.pttOn = false;
  if (!S.recording) setMic(false);
  el.pttBtn.classList.remove('live');
  el.pttIcon.textContent = '🎤';
  el.pttLabel.textContent = 'اضغط للتحدث';
  if (send) wsSend({ t: 'ptt', on: false });
}
el.pttBtn.addEventListener('pointerdown', pttPress);
el.pttBtn.addEventListener('pointerup', () => pttRelease(true));
el.pttBtn.addEventListener('pointercancel', () => pttRelease(true));
el.pttBtn.addEventListener('pointerleave', () => pttRelease(true));
el.pttBtn.addEventListener('contextmenu', (e) => e.preventDefault());

/* ======================== الرسائل الصوتية ======================== */
const MIMES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4;codecs=mp4a.40.2', 'audio/mp4', 'audio/ogg;codecs=opus', 'audio/ogg'];
const pickMime = () => (window.MediaRecorder ? MIMES.find((m) => { try { return MediaRecorder.isTypeSupported(m); } catch { return false; } }) : null);

function recToggle() {
  if (S.recording) return stopRecording(true);
  if (!S.micTrack) { toast('لا يوجد ميكروفون'); return; }
  if (S.pttOn) pttRelease(true);
  const mime = pickMime();
  if (!window.MediaRecorder || !mime) { toast('التسجيل غير مدعوم في هذا المتصفح'); return; }
  try {
    S.recorder = new MediaRecorder(S.micStream, { mimeType: mime });
  } catch { toast('تعذّر بدء التسجيل'); return; }
  S.recMime = mime;
  S.recChunks = [];
  S.recorder.ondataavailable = (e) => { if (e.data?.size) S.recChunks.push(e.data); };
  S.recorder.onstop = onRecStop;
  setMic(true);                                   // لا بد أن يكون الميكروفون مفعّلاً للتسجيل
  S.recorder.start(250);
  S.recording = true;
  S.recStart = Date.now();
  el.recordBtn.classList.add('on');
  el.recBar.hidden = false;
  el.pttBtn.classList.add('blocked');
  S.recTicker = setInterval(() => {
    el.recTimer.textContent = mmss(Date.now() - S.recStart);
    if (Date.now() - S.recStart > 120_000) stopRecording(true);
  }, 200);
  buzz([60]);
}

function stopRecording(send) {
  if (!S.recording) return;
  S.recording = false;
  clearInterval(S.recTicker);
  el.recBar.hidden = true;
  el.recordBtn.classList.remove('on');
  el.pttBtn.classList.remove('blocked');
  S.sendOnStop = !!send;
  try { S.recorder.stop(); } catch { /* تجاهل */ }
}

async function onRecStop() {
  const dur = Math.round((Date.now() - S.recStart) / 1000);
  setMic(false);
  const chunks = S.recChunks;
  S.recChunks = [];
  if (!S.sendOnStop) { toast('أُلغي التسجيل'); return; }
  if (dur < 1) { toast('المقطع قصير جداً'); return; }
  const blob = new Blob(chunks, { type: S.recMime });
  if (!blob.size) { toast('لم يُسجَّل صوت'); return; }
  wsSend({ t: 'voice', dur, mime: S.recMime });
  try { S.ws.send(await blob.arrayBuffer()); }
  catch { toast('تعذّر الإرسال'); }
}

function addVoiceEntry(m, { silent = false } = {}) {
  if (!silent && S.messages.has(m.id)) return;
  S.messages.set(m.id, true);
  const mine = m.from === S.me || m.mine;
  const item = document.createElement('div');
  item.className = 'entry';
  const bars = Array.from({ length: 18 }, () => `<i style="height:${Math.round(20 + Math.random() * 80)}%"></i>`).join('');
  item.innerHTML = `
    <div class="avatar">${esc(initials(m.name))}</div>
    <div class="body">
      <div class="head">
        <span class="name">${mine ? 'أنا' : esc(m.name || '—')}</span>
        <span class="time">${hhmm(m.ts || Date.now())}</span>
        ${silent ? '' : '<span class="live-tag">رسالة صوتية</span>'}
      </div>
      <div class="bubble ${mine ? 'mine' : ''}">
        <button class="play" aria-label="تشغيل">▶</button>
        <span class="dur">${mmss((m.dur || 0) * 1000)}</span>
        <span class="wave">${bars}</span>
      </div>
    </div>`;
  const bubble = item.querySelector('.bubble');
  item.querySelector('.play').onclick = () => (bubble.classList.contains('playing') ? stopPlayback() : playVoice(m.url, bubble));
  el.log.appendChild(item);
  el.log.scrollTop = el.log.scrollHeight;
}

let playingEl = null;
function stopPlayback() {
  try { el.announcer.pause(); } catch { /* تجاهل */ }
  if (playingEl) { playingEl.classList.remove('playing'); playingEl.querySelector('.play').textContent = '▶'; }
  playingEl = null;
}
function playVoice(url, bubble) {
  stopPlayback();
  el.announcer.src = url;
  const p = el.announcer.play();
  if (p?.catch) p.catch(() => toast('اضغط على ▶ للتشغيل'));
  if (bubble) { bubble.classList.add('playing'); bubble.querySelector('.play').textContent = '❚❚'; playingEl = bubble; }
}
el.announcer.addEventListener('ended', stopPlayback);

/* ============================ عناصر الواجهة ============================ */
function addSys(text) {
  const d = document.createElement('div');
  d.className = 'sys';
  d.textContent = text;
  el.log.appendChild(d);
  el.log.scrollTop = el.log.scrollHeight;
}
function goLogin(msg) {
  S.byUser = true;
  teardownMesh();
  try { S.ws?.close(); } catch { /* تجاهل */ }
  el.app.classList.remove('show');
  el.login.classList.add('show');
  if (msg) { el.loginError.textContent = msg; el.loginError.hidden = false; }
}

/* ============================== الدخول ============================== */
el.joinBtn.addEventListener('click', async () => {
  const name = el.nameInput.value.trim();
  const code = el.codeInput.value.trim().toUpperCase();
  el.loginError.hidden = true;
  if (name.length < 2) return fail('اكتب اسمك (حرفان على الأقل).');
  if (code.length < 4) return fail('اكتب رمز العائلة.');

  unlockAudio();
  try {
    await startMic();
  } catch (err) {
    return fail(err.friendly || (err.name === 'NotAllowedError'
      ? 'رفضت صلاحية الميكروفون. افتح إعدادات المتصفح واسمح بالميكروفون.'
      : 'تعذّر تشغيل الميكروفون: ' + err.message));
  }

  S.name = name; S.code = code; S.byUser = false;
  localStorage.setItem(KEYS.name, name);
  localStorage.setItem(KEYS.code, code);
  saveNameChip(name);

  el.login.classList.remove('show');
  el.app.classList.add('show');
  el.myName.textContent = name;
  el.renameInput.value = name;
  applyWakeLock();
  connect();

  function fail(t) { el.loginError.textContent = t; el.loginError.hidden = false; }
});

function saveNameChip(name) {
  let list = [];
  try { list = JSON.parse(localStorage.getItem(KEYS.names) || '[]'); } catch { /* تجاهل */ }
  list = [name, ...list.filter((n) => n !== name)].slice(0, 6);
  localStorage.setItem(KEYS.names, JSON.stringify(list));
  renderNameChips();
}
function renderNameChips() {
  let list = [];
  try { list = JSON.parse(localStorage.getItem(KEYS.names) || '[]'); } catch { /* تجاهل */ }
  el.nameChips.textContent = '';
  for (const n of list) {
    const b = document.createElement('button');
    b.textContent = n;
    b.onclick = () => { el.nameInput.value = n; };
    el.nameChips.appendChild(b);
  }
}

/* ============================ الأحداث ============================ */
el.recordBtn.addEventListener('click', recToggle);
el.recSend.addEventListener('click', () => stopRecording(true));
el.recCancel.addEventListener('click', () => stopRecording(false));

el.muteBtn.addEventListener('click', () => {
  S.muted = !S.muted;
  for (const e of S.peers.values()) if (e.audio) e.audio.muted = S.muted;
  el.muteBtn.textContent = S.muted ? '🔇' : '🔊';
  el.muteBtn.classList.toggle('muted', S.muted);
  toast(S.muted ? 'السماعة مكتومة' : 'السماعة تعمل');
});

el.settingsBtn.addEventListener('click', () => { el.sheet.hidden = false; updateInfo(); });
el.closeSheet.addEventListener('click', () => { el.sheet.hidden = true; });
el.sheet.addEventListener('click', (e) => { if (e.target === el.sheet) el.sheet.hidden = true; });
el.saveBtn.addEventListener('click', () => {
  savePrefs();
  const n = el.renameInput.value.trim();
  if (n.length >= 2 && n !== S.name) {
    S.name = n;
    localStorage.setItem(KEYS.name, n);
    saveNameChip(n);
    el.myName.textContent = n;
    wsSend({ t: 'rename', name: n });
  }
  S.invites.clear();
  el.sheet.hidden = true;
});
el.leaveBtn.addEventListener('click', () => {
  el.sheet.hidden = true;
  goLogin('خرجت من الجلسة.');
  el.nameInput.value = S.name;
  el.codeInput.value = S.code;
});

/* ======================= تثبيت على الشاشة الرئيسية ======================= */
const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent);
if (isIOS() && !isStandalone()) el.addToHome.hidden = false;
el.addToHome.addEventListener('click', () => {
  toast('سفاري: زر المشاركة ⤴ ← «إضافة إلى الشاشة الرئيسية»', 6000);
});

/* ============================== التهيئة ============================== */
loadPrefs();
renderNameChips();
el.codeInput.value = localStorage.getItem(KEYS.code) || '';
if (localStorage.getItem(KEYS.name)) {
  el.nameInput.value = localStorage.getItem(KEYS.name);
}
if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}
el.infoRoom.textContent = 'العائلة';
window.addEventListener('beforeunload', () => { S.byUser = true; });
