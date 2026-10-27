const $ = (id) => document.getElementById(id);
const els = { theme: $('themeSelect'), effect: $('effectSelect'), room: $('roomInput'), name: $('nameInput'), join: $('joinButton'), camera: $('cameraButton'), capture: $('captureButton'), pill: $('connectionPill'), status: $('connectionText'), roomBar: $('roomBar'), invite: $('inviteRow'), inviteText: $('inviteText'), copy: $('copyButton'), selfVideo: $('selfVideo'), friendVideo: $('friendVideo'), selfPlaceholder: $('selfPlaceholder'), friendPlaceholder: $('friendPlaceholder'), selfState: $('selfState'), friendState: $('friendState'), selfTag: $('selfNameTag'), friendTag: $('friendNameTag'), toast: $('toast'), overlay: $('countdownOverlay'), count: $('countdownNumber'), result: $('resultCard'), resultImage: $('resultImage'), download: $('downloadButton'), retake: $('retakeButton'), flipCamera: $('flipCameraButton'), mirror: $('mirrorToggle'), layout: $('layoutSelect'), size: $('sizeSelect'), soloMode: $('soloModeButton'), sharedMode: $('sharedModeButton'), modeHint: $('modeHint') };
let socket, localStream, myId, roomCode, peers = new Map(), captureBusy = false, toastTimer, cameraFacing = 'user', boothMode = 'solo';
const effects = {
  natural: { filter: 'none' },
  dreamy: { filter: 'brightness(1.08) saturate(1.08) contrast(.96)' },
  blush: { filter: 'sepia(.12) saturate(1.3) hue-rotate(325deg)' },
  golden: { filter: 'sepia(.2) saturate(1.2) contrast(1.03)' },
  vintage: { filter: 'sepia(.3) saturate(.82) contrast(1.08)' },
  mono: { filter: 'grayscale(1) contrast(1.05)' },
  hearts: { filter: 'saturate(1.08)' },
  prism: { filter: 'saturate(1.22) hue-rotate(14deg)' },
  puppy: { filter: 'brightness(1.06) saturate(1.13)' },
  collectible: { filter: 'brightness(1.06) saturate(.92) contrast(.97)' }
};
const savedTheme = localStorage.getItem('pastel-booth-theme');
const savedMirror = localStorage.getItem('pastel-booth-mirror');
els.mirror.checked = savedMirror === null ? true : savedMirror === 'true';
function updateMirrorPreview() { els.selfVideo.classList.toggle('mirror-preview', els.mirror.checked && cameraFacing === 'user'); }
els.mirror.addEventListener('change', () => { localStorage.setItem('pastel-booth-mirror', String(els.mirror.checked)); updateMirrorPreview(); });
if (savedTheme && ['cotton','peach','mint','dreamy'].includes(savedTheme)) { document.body.dataset.theme = savedTheme; els.theme.value = savedTheme; }
els.theme.addEventListener('change', () => { document.body.dataset.theme = els.theme.value; localStorage.setItem('pastel-booth-theme', els.theme.value); });
function setEffect(value, broadcast = true) {
  const effect = effects[value] ? value : 'natural';
  document.body.dataset.effect = effect;
  els.effect.value = effect;
  [els.selfVideo, els.friendVideo].forEach(video => { video.style.filter = effects[effect].filter; });
  localStorage.setItem('pastel-booth-effect', effect);
  if (broadcast) send({ type: 'room-event', event: 'effect', value: effect });
}
setEffect(localStorage.getItem('pastel-booth-effect') || 'natural', false);
els.effect.addEventListener('change', () => setEffect(els.effect.value));
function showToast(message) { els.toast.textContent = message; els.toast.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => els.toast.classList.remove('show'), 2800); }
function setStatus(message, state='') { els.status.textContent = message; els.pill.classList.toggle('connected', state === 'connected'); els.pill.classList.toggle('error', state === 'error'); }
function roomSlug(text) { return text.trim().toUpperCase().replace(/[^A-Z0-9-]/g, '-').replace(/-+/g, '-').slice(0, 24); }
function randomRoom() { return 'BOOTH-' + Math.random().toString(36).slice(2, 9).toUpperCase(); }
function wsUrl() { return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/signal`; }
function send(data) { if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(data)); }
function inviteUrl() { const u = new URL(location.href); u.searchParams.set('room', roomCode); return u.toString(); }
function setupRoom(room) {
  boothMode = 'shared';
  roomCode = roomSlug(room);
  els.room.value = roomCode;
  if (!roomCode) return showToast('Pick a room name first ✿');
  els.join.disabled = true; els.join.textContent = 'Connecting…'; setStatus('Connecting to your booth');
  socket = new WebSocket(wsUrl());
  socket.onopen = () => send({ type: 'join', room: roomCode, name: els.name.value.trim() || 'Guest' });
  socket.onmessage = async (event) => { let msg; try { msg = JSON.parse(event.data); } catch { return; } await handleMessage(msg); };
  socket.onerror = () => { setStatus('Could not connect', 'error'); showToast('Connection trouble. Is the booth server running?'); };
  socket.onclose = () => { if (myId) { setStatus('Disconnected', 'error'); showToast('You left the booth. Refresh to reconnect.'); } els.join.disabled = false; els.join.innerHTML = '<span>♡</span> Create / join booth'; };
}
async function handleMessage(msg) {
  if (msg.type === 'joined') {
    myId = msg.id; roomCode = msg.room; els.room.value = roomCode; els.roomBar.classList.add('hidden'); els.invite.classList.remove('hidden');
    els.inviteText.textContent = `Your room ${roomCode} is ready — invite someone to join!`; els.join.disabled = true; els.join.innerHTML = 'Booth is open ♡';
    setStatus('Booth open · waiting for your person');
    for (const peer of msg.peers || []) createPeer(peer.id, peer.name, true);
  } else if (msg.type === 'peer-joined') {
    // Reserve the remote video/peer entry immediately; the new arrival creates the offer.
    createPeer(msg.peer.id, msg.peer.name, false);
    send({ type: 'room-event', event: 'effect', value: els.effect.value });
    els.friendState.textContent = `Connecting to ${msg.peer.name}…`;
    showToast(`${msg.peer.name} joined the booth! ♡`);
  } else if (msg.type === 'signal') await receiveSignal(msg);
  else if (msg.type === 'room-event' && msg.event === 'capture') { showToast('Someone started a photo strip — get ready!'); takeStrip(false); }
  else if (msg.type === 'room-event' && msg.event === 'effect') { setEffect(msg.value, false); showToast('Photo effect updated for everyone ✨'); }
  else if (msg.type === 'peer-left') { const entry = peers.get(msg.id); if (entry) { entry.pc.close(); peers.delete(msg.id); } updateFriendState(); showToast(`${msg.name} left the booth`); }
  else if (msg.type === 'error') { showToast(msg.message); els.join.disabled = false; els.join.innerHTML = '<span>♡</span> Create / join booth'; }
}
function createPeer(id, name, makeOffer) {
  if (peers.has(id)) return peers.get(id);
  const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }, { urls: 'stun:stun2.l.google.com:19302' }] });
  const transceiver = pc.addTransceiver('video', { direction: 'sendrecv' });
  const video = els.friendVideo;
  const entry = { id, name: name || 'Guest', pc, video, transceiver, candidateQueue: [] };
  peers.set(id, entry);
  if (localStream) transceiver.sender.replaceTrack(localStream.getVideoTracks()[0]);
  pc.ontrack = async (event) => {
    // Some browsers omit event.streams; construct a stream from the received track.
    const remoteStream = event.streams && event.streams[0] ? event.streams[0] : new MediaStream([event.track]);
    video.srcObject = remoteStream;
    const reveal = async () => {
      video.classList.add('active'); els.friendPlaceholder.classList.add('hidden');
      els.friendTag.textContent = entry.name; els.friendTag.classList.remove('hidden');
      els.friendState.textContent = `${entry.name} is here!`;
      try { await video.play(); } catch (_) { els.friendState.textContent = 'Tap the guest video to play'; }
      if (!video.paused) setStatus('Connected · together at last', 'connected');
    };
    event.track.onunmute = reveal;
    if (!event.track.muted) await reveal();
    video.onloadedmetadata = () => video.play().catch(() => {});
  };
  pc.onicecandidate = (event) => { if (event.candidate) send({ type: 'signal', to: id, candidate: event.candidate }); };
  pc.onconnectionstatechange = async () => {
    if (pc.connectionState === 'connected') { els.friendState.textContent = `${entry.name} is here!`; setStatus('Connected · together at last', 'connected'); }
    if (pc.connectionState === 'failed') {
      els.friendState.textContent = 'Retrying guest connection…'; setStatus('Connection interrupted · retrying', 'error');
      try { await pc.restartIce(); } catch (_) {}
      setTimeout(() => { if (pc.connectionState === 'failed') showToast('The network may need a TURN relay. Try both devices on a different network or refresh both booths.'); }, 2500);
    }
  };
  pc.oniceconnectionstatechange = () => { if (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') setStatus('Connected · together at last', 'connected'); };
  if (makeOffer) pc.createOffer().then(offer => pc.setLocalDescription(offer)).then(() => send({ type: 'signal', to: id, description: pc.localDescription })).catch(() => showToast('Could not start the camera connection.'));
  return entry;
}
async function receiveSignal(msg) {
  const entry = createPeer(msg.from, peers.get(msg.from)?.name || 'Guest', false); const pc = entry.pc;
  try {
    if (msg.description) {
      await pc.setRemoteDescription(msg.description);
      for (const candidate of entry.candidateQueue.splice(0)) await pc.addIceCandidate(candidate);
      if (msg.description.type === 'offer') { const answer = await pc.createAnswer(); await pc.setLocalDescription(answer); send({ type: 'signal', to: msg.from, description: pc.localDescription }); }
    } else if (msg.candidate) {
      if (pc.remoteDescription) await pc.addIceCandidate(msg.candidate); else entry.candidateQueue.push(msg.candidate);
    }
  } catch (error) { console.error(error); showToast('Camera connection hiccup. Try refreshing both booths.'); }
}
function updateFriendState() {
  if (peers.size === 0) { els.friendVideo.classList.remove('active'); els.friendVideo.srcObject = null; els.friendPlaceholder.classList.remove('hidden'); els.friendTag.classList.add('hidden'); els.friendState.textContent = 'Waiting for someone to join'; setStatus('Booth open · waiting for your person'); }
}
async function startCamera() {
  // This button is deliberately available before joining a room so the user can grant permission.
  if (localStream) { stopCamera(); return; }
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
    showToast('Camera access needs a secure HTTPS address. Open the live site in Chrome, not an in-app preview.');
    els.selfState.textContent = 'HTTPS required';
    return;
  }
  els.camera.disabled = true; els.camera.textContent = 'Opening camera…';
  try {
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: cameraFacing }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
    } catch (firstError) {
      // Some mobile browsers reject advanced constraints; retry with a plain video request.
      if (firstError.name === 'OverconstrainedError' || firstError.name === 'NotFoundError') {
        stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      } else throw firstError;
    }
    localStream = stream;
    const activeTrack = localStream.getVideoTracks()[0];
    if (activeTrack) activeTrack.onended = () => { if (localStream && !localStream.getVideoTracks().some(t => t.readyState === 'live')) stopCamera(); };
    els.selfVideo.srcObject = localStream;
    try { await els.selfVideo.play(); } catch (_) { /* autoplay may wait for the next user gesture */ }
    els.selfVideo.classList.add('active'); els.selfPlaceholder.classList.add('hidden');
    startGestureDetection();
    els.selfState.textContent = 'Camera is on';
    updateMirrorPreview();
    const displayName = els.name.value.trim() || 'you'; els.selfTag.textContent = displayName;
    for (const entry of peers.values()) await entry.transceiver.sender.replaceTrack(localStream.getVideoTracks()[0]);
    els.camera.innerHTML = '<span>◯</span> Turn camera off'; els.camera.setAttribute('aria-pressed', 'true');
    els.camera.disabled = false; els.flipCamera.disabled = false; els.capture.disabled = false;
    showToast(cameraFacing === 'user' ? 'Front camera is on ♡' : 'Back camera is on ♡');
  } catch (error) {
    console.error('Camera start failed:', error);
    els.camera.disabled = false; els.camera.innerHTML = '<span>📷</span> Try camera again';
    els.camera.setAttribute('aria-pressed', 'false'); els.selfState.textContent = 'Camera off';
    const messages = {
      NotAllowedError: 'Camera permission was denied. Tap the site icon in Chrome → Permissions → Camera → Allow, then reload.',
      SecurityError: 'Your browser blocked camera access. Open the HTTPS website directly in Chrome.',
      NotFoundError: 'No available camera was found on this device.',
      NotReadableError: 'The camera is busy. Close Camera, video-call, or scanning apps, then try again.',
      OverconstrainedError: 'This camera mode is unavailable. Try switching camera.',
      AbortError: 'The camera could not start. Close other camera apps and try again.'
    };
    showToast(messages[error.name] || `Could not open camera (${error.name || 'unknown error'}). Check site permissions and try again.`);
  }
}
function stopCamera() {
  if (localStream) {
    localStream.getTracks().forEach(track => track.stop());
    localStream = null;
  }
  els.selfVideo.pause(); els.selfVideo.srcObject = null;
  els.selfVideo.classList.remove('active'); els.selfPlaceholder.classList.remove('hidden');
  els.selfState.textContent = 'Camera off';
  for (const entry of peers.values()) entry.transceiver.sender.replaceTrack(null).catch(() => {});
  els.camera.disabled = false; els.camera.innerHTML = '<span>📷</span> Turn camera on';
  els.camera.setAttribute('aria-pressed', 'false'); els.flipCamera.disabled = true; els.capture.disabled = true;
  showToast('Camera is off. Your camera is no longer being used.');
}
function selectMode(mode) {
  boothMode = mode;
  document.body.dataset.mode = mode;
  const shared = mode === 'shared';
  els.soloMode.classList.toggle('is-selected', !shared);
  els.sharedMode.classList.toggle('is-selected', shared);
  els.soloMode.setAttribute('aria-pressed', String(!shared));
  els.sharedMode.setAttribute('aria-pressed', String(shared));
  els.roomBar.classList.toggle('hidden', !shared || Boolean(myId));
  els.invite.classList.toggle('hidden', !shared || !myId);
  els.modeHint.textContent = shared
    ? 'Create a room, share its link, and both people can turn on their cameras.'
    : 'Solo mode is ready. Turn on your camera to take photos by yourself.';
  els.capture.innerHTML = shared ? '<span>✧</span> Take our photos' : '<span>✧</span> Take my photos';
  if (!shared && socket && socket.readyState !== WebSocket.CLOSED) {
    socket.close(); socket = null; myId = null; roomCode = null;
    for (const entry of peers.values()) entry.pc.close();
    peers.clear(); els.friendVideo.srcObject = null; els.friendVideo.classList.remove('active');
    els.friendPlaceholder.classList.remove('hidden'); els.friendTag.classList.add('hidden');
    els.friendState.textContent = 'Solo mode'; setStatus('Solo booth', '');
    els.join.disabled = false; els.join.innerHTML = '<span>♡</span> Create / join booth';
  } else if (!shared) {
    els.friendState.textContent = 'Solo mode'; setStatus('Solo booth', '');
  } else {
    els.friendState.textContent = 'Waiting for someone to join';
    if (!myId) setStatus('Not connected yet');
  }
}
async function switchCamera() {
  if (!localStream) { cameraFacing = cameraFacing === 'user' ? 'environment' : 'user'; return startCamera(); }
  cameraFacing = cameraFacing === 'user' ? 'environment' : 'user';
  try {
    let stream; try { stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { exact: cameraFacing }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false }); } catch (_) { stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false }); }
    const oldStream = localStream; localStream = stream; els.selfVideo.srcObject = stream;
    for (const entry of peers.values()) await entry.transceiver.sender.replaceTrack(stream.getVideoTracks()[0]);
    oldStream.getTracks().forEach(track => track.stop()); updateMirrorPreview();
    showToast(cameraFacing === 'user' ? 'Front camera selected' : 'Back camera selected');
  } catch (error) { cameraFacing = cameraFacing === 'user' ? 'environment' : 'user'; showToast('Could not switch camera on this device.'); }
}
function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
async function frameSnapshot(video) {
  if (!video || !video.srcObject || video.readyState < 2 || !video.videoWidth) return null;
  const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 420;
  const ctx = canvas.getContext('2d');
  ctx.save();
  const mirror = video === els.selfVideo ? (els.mirror.checked && cameraFacing === 'user') : false;
  if (mirror) { ctx.translate(canvas.width, 0); ctx.scale(-1, 1); }
  ctx.filter = effects[els.effect.value].filter; ctx.drawImage(video, 0, 0, canvas.width, canvas.height); ctx.restore();
  return canvas;
}
function drawPhotoEffect(ctx, x, y, width, height) {
  if (els.effect.value === 'hearts') {
    ctx.save(); ctx.font = '30px sans-serif'; ctx.textAlign = 'left'; ctx.shadowColor = 'rgba(224,95,145,.55)'; ctx.shadowBlur = 10;
    ctx.fillStyle = 'rgba(255,255,255,.95)'; ctx.fillText('♡', x + 20, y + 42); ctx.fillText('✦', x + width - 48, y + 45); ctx.fillText('♡', x + width - 54, y + height - 20); ctx.restore();
  } else if (els.effect.value === 'prism') {
    ctx.save(); ctx.globalAlpha = .16; ctx.globalCompositeOperation = 'screen';
    const gradient = ctx.createLinearGradient(x, y, x + width, y + height);
    gradient.addColorStop(0, '#f5a5d0'); gradient.addColorStop(.48, '#b7a8ff'); gradient.addColorStop(1, '#93dded');
    ctx.fillStyle = gradient; ctx.fillRect(x, y, width, height); ctx.restore();
  }
}
function drawCover(ctx, image, x, y, w, h) {
  const scale = Math.max(w / image.width, h / image.height), sw = w / scale, sh = h / scale, sx = (image.width - sw) / 2, sy = (image.height - sh) / 2;
  ctx.drawImage(image, sx, sy, sw, sh, x, y, w, h);
}
async function takeStrip(announce = true) {
  if (captureBusy || !localStream) return; captureBusy = true; els.capture.disabled = true; els.result.classList.add('hidden');
  if (announce && boothMode === 'shared' && myId) send({ type: 'room-event', event: 'capture' });
  const shots = [];
  for (let i = 3; i > 0; i--) {
    els.overlay.classList.remove('hidden'); els.count.textContent = String(i); await sleep(850);
    const local = await frameSnapshot(els.selfVideo), remote = await frameSnapshot(els.friendVideo);
    shots.push({ local, remote });
    if (i > 1) await sleep(750);
  }
  els.overlay.classList.add('hidden');
  const scale = els.size.value === 'small' ? 0.72 : els.size.value === 'large' ? 1.35 : 1;
  const layout = els.layout.value;
  const width = Math.round((layout === 'wide' ? 980 : layout === 'grid' ? 900 : 780) * scale);
  const pad = Math.round(26 * scale), gap = Math.round(16 * scale), header = Math.round(88 * scale), footer = Math.round(82 * scale);
  const panelH = Math.round((layout === 'wide' ? 280 : layout === 'grid' ? 300 : 430) * scale);
  const cols = layout === 'grid' ? 2 : 1, rows = layout === 'grid' ? 2 : 3;
  const panelW = layout === 'grid' ? Math.round((width - pad * 2 - gap) / 2) : width - pad * 2;
  const contentTop = header, contentHeight = rows * panelH + (rows - 1) * gap;
  const height = header + contentHeight + footer;
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext('2d');
  const bg = getComputedStyle(document.body).getPropertyValue('--accent-soft').trim() || '#ffe4ef';
  const ink = getComputedStyle(document.body).getPropertyValue('--accent-dark').trim() || '#d85e8b';
  ctx.fillStyle = bg; ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = ink; ctx.textAlign = 'center'; ctx.font = `800 ${Math.round(29 * scale)}px Nunito, sans-serif`; ctx.fillText('our little photo booth ♡', width/2, Math.round(49 * scale));
  ctx.fillStyle = '#8d748e'; ctx.font = `600 ${Math.round(13 * scale)}px \"DM Sans\", sans-serif`; ctx.fillText(`${roomCode || 'SOLO BOOTH'}  ·  ${new Date().toLocaleDateString()}`, width/2, Math.round(72 * scale));
  shots.forEach((shot, i) => {
    const col = layout === 'grid' ? i % 2 : 0, row = layout === 'grid' ? Math.floor(i / 2) : i;
    const x = pad + col * (panelW + gap), y = contentTop + row * (panelH + gap);
    roundedRect(ctx, x, y, panelW, panelH, Math.round(14 * scale)); ctx.save(); ctx.beginPath(); roundedRectPath(ctx,x,y,panelW,panelH,Math.round(14*scale)); ctx.clip();
    const innerX = x + Math.round(10 * scale), innerY = y + Math.round(10 * scale), innerW = panelW - Math.round(20 * scale), innerH = panelH - Math.round(20 * scale);
    if (shot.remote) { const half = (innerW - Math.round(8 * scale))/2; if (shot.local) drawCover(ctx, shot.local, innerX, innerY, half, innerH); else drawCover(ctx, shot.remote, innerX, innerY, half, innerH); drawCover(ctx, shot.remote, innerX + half + Math.round(8*scale), innerY, half, innerH); }
    else if (shot.local) drawCover(ctx, shot.local, innerX, innerY, innerW, innerH);
    else { ctx.fillStyle = '#f7eef6'; ctx.fillRect(innerX, innerY, innerW, innerH); }
    drawPhotoEffect(ctx, innerX, innerY, innerW, innerH);
    ctx.restore(); ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(x+panelW-Math.round(22*scale),y+Math.round(22*scale),Math.round(14*scale),0,Math.PI*2); ctx.fill(); ctx.fillStyle=ink; ctx.font=`800 ${Math.round(12*scale)}px \"DM Sans\", sans-serif`; ctx.fillText(String(i+1),x+panelW-Math.round(22*scale),y+Math.round(26*scale));
  });
  ctx.fillStyle = ink; ctx.font = `800 ${Math.round(19 * scale)}px Nunito, sans-serif`; ctx.fillText('made with love, wherever you are ✿', width/2, height-Math.round(35*scale));
  const data = canvas.toDataURL('image/png'); els.resultImage.src = data; els.download.href = data; els.result.classList.remove('hidden'); els.result.scrollIntoView({ behavior: 'smooth', block: 'center' });
  captureBusy = false; els.capture.disabled = false; showToast('Your photo strip is ready to save! ♡');
}
function roundedRectPath(ctx,x,y,w,h,r){ctx.beginPath();ctx.moveTo(x+r,y);ctx.arcTo(x+w,y,x+w,y+h,r);ctx.arcTo(x+w,y+h,x,y+h,r);ctx.arcTo(x,y+h,x,y,r);ctx.arcTo(x,y,x+w,y,r);ctx.closePath();}
function roundedRect(ctx,x,y,w,h,r){ctx.fillStyle='#fff';roundedRectPath(ctx,x,y,w,h,r);ctx.fill();}

// Gesture stickers fire only after a pose is held steadily, once per pose.
let handDetector = null, handDetecting = false, lastGestureAt = 0, candidateGesture = '', candidateFrames = 0, latchedGesture = '';
function floatSticker(emoji, x = 50, y = 34) {
  const layer = $('selfStickerOverlay'); if (!layer) return;
  const sticker = document.createElement('span'); sticker.className = 'sticker-float';
  sticker.textContent = emoji; sticker.style.setProperty('--x', `${Math.max(8, Math.min(82, x))}%`); sticker.style.setProperty('--y', `${Math.max(8, Math.min(72, y))}%`);
  layer.appendChild(sticker); setTimeout(() => sticker.remove(), 2300);
}
function classifyHand(lm) {
  if (!lm || lm.length < 21) return null;
  const up = (tip, pip) => lm[tip].y < lm[pip].y - .035;
  const index = up(8,6), middle = up(12,10), ring = up(16,14), pinky = up(20,18);
  const thumbOut = Math.abs(lm[4].x-lm[2].x) > .09;
  const pinch = Math.hypot(lm[4].x-lm[8].x, lm[4].y-lm[8].y) < .055;
  if (pinch) return { key:'kiss-heart', emoji:'💘💋' };
  if (index && middle && !ring && !pinky) return { key:'peace', emoji:'✌️💖' };
  if (thumbOut && lm[4].y < lm[3].y && !index && !middle && !ring && !pinky) return { key:'thumb', emoji:'👍💗' };
  if (index && middle && ring && pinky) return { key:'open-palm', emoji:'👋💞' };
  return null;
}
async function startGestureDetection() {
  if (handDetecting || !window.Hands || !els.selfVideo) return;
  handDetecting = true;
  try {
    handDetector = new window.Hands({ locateFile: file => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}` });
    handDetector.setOptions({ maxNumHands: 1, modelComplexity: 0, minDetectionConfidence: .7, minTrackingConfidence: .65 });
    handDetector.onResults(results => {
      const lm = results.multiHandLandmarks && results.multiHandLandmarks[0];
      const detected = classifyHand(lm); const key = detected?.key || '';
      if (key === candidateGesture) candidateFrames++; else { candidateGesture = key; candidateFrames = key ? 1 : 0; }
      // A neutral hand releases the latch, so holding a pose doesn't spam stickers.
      if (!key) { latchedGesture = ''; return; }
      const now = Date.now();
      if (candidateFrames >= 4 && key !== latchedGesture && now-lastGestureAt > 900) {
        latchedGesture = key; lastGestureAt = now;
        floatSticker(detected.emoji, (1-lm[9].x)*100, lm[9].y*100);
      }
    });
    const scan = async () => {
      if (!handDetecting) return;
      if (localStream && els.selfVideo.readyState >= 2 && !els.selfVideo.paused) {
        try { await handDetector.send({ image: els.selfVideo }); } catch (_) {}
      }
      requestAnimationFrame(scan);
    };
    scan();
  } catch (error) { console.warn('Gesture stickers unavailable:', error); handDetecting = false; }
}

els.join.addEventListener('click', () => { if (socket && socket.readyState !== WebSocket.CLOSED) return; const room = els.room.value.trim() || randomRoom(); setupRoom(room); });
els.camera.addEventListener('click', startCamera); els.flipCamera.addEventListener('click', switchCamera);
els.soloMode.addEventListener('click', () => selectMode('solo')); els.sharedMode.addEventListener('click', () => selectMode('shared')); els.capture.addEventListener('click', takeStrip); els.retake.addEventListener('click', () => { els.result.classList.add('hidden'); els.capture.scrollIntoView({ behavior:'smooth', block:'center' }); });
els.copy.addEventListener('click', async () => { try { await navigator.clipboard.writeText(inviteUrl()); showToast('Invite link copied — send it to your person!'); } catch { prompt('Copy your invite link:', inviteUrl()); } });
els.room.addEventListener('keydown', e => { if (e.key === 'Enter') els.join.click(); });
const params = new URLSearchParams(location.search);
if (params.has('room')) { els.room.value = params.get('room'); selectMode('shared'); } else { selectMode('solo'); }
els.camera.disabled = false; els.camera.setAttribute('aria-pressed', 'false');
els.selfState.textContent = 'Camera off';
window.addEventListener('beforeunload', () => { for (const e of peers.values()) e.pc.close(); if (socket) socket.close(); if (localStream) localStream.getTracks().forEach(t => t.stop()); });
