const $ = (id) => document.getElementById(id);
const els = { theme: $('themeSelect'), effect: $('effectSelect'), room: $('roomInput'), name: $('nameInput'), join: $('joinButton'), camera: $('cameraButton'), capture: $('captureButton'), pill: $('connectionPill'), status: $('connectionText'), roomBar: $('roomBar'), invite: $('inviteRow'), inviteText: $('inviteText'), copy: $('copyButton'), selfVideo: $('selfVideo'), friendVideo: $('friendVideo'), selfPlaceholder: $('selfPlaceholder'), friendPlaceholder: $('friendPlaceholder'), selfState: $('selfState'), friendState: $('friendState'), selfTag: $('selfNameTag'), friendTag: $('friendNameTag'), toast: $('toast'), overlay: $('countdownOverlay'), count: $('countdownNumber'), result: $('resultCard'), resultImage: $('resultImage'), download: $('downloadButton'), retake: $('retakeButton') };
let socket, localStream, myId, roomCode, peers = new Map(), captureBusy = false, toastTimer;
const effects = {
  natural: { filter: 'none' },
  dreamy: { filter: 'brightness(1.08) saturate(1.08) contrast(.96)' },
  blush: { filter: 'sepia(.12) saturate(1.3) hue-rotate(325deg)' },
  golden: { filter: 'sepia(.2) saturate(1.2) contrast(1.03)' },
  vintage: { filter: 'sepia(.3) saturate(.82) contrast(1.08)' },
  mono: { filter: 'grayscale(1) contrast(1.05)' },
  hearts: { filter: 'saturate(1.08)' },
  prism: { filter: 'saturate(1.22) hue-rotate(14deg)' }
};
const savedTheme = localStorage.getItem('pastel-booth-theme');
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
    // The arriving guest creates the offer to avoid simultaneous negotiation.
    send({ type: 'room-event', event: 'effect', value: els.effect.value });
    showToast(`${msg.peer.name} joined the booth! ♡`);
  } else if (msg.type === 'signal') await receiveSignal(msg);
  else if (msg.type === 'room-event' && msg.event === 'capture') { showToast('Someone started a photo strip — get ready!'); takeStrip(false); }
  else if (msg.type === 'room-event' && msg.event === 'effect') { setEffect(msg.value, false); showToast('Photo effect updated for everyone ✨'); }
  else if (msg.type === 'peer-left') { const entry = peers.get(msg.id); if (entry) { entry.pc.close(); entry.video.remove(); peers.delete(msg.id); } updateFriendState(); showToast(`${msg.name} left the booth`); }
  else if (msg.type === 'error') showToast(msg.message);
}
function createPeer(id, name, makeOffer) {
  if (peers.has(id)) return peers.get(id);
  const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
  const transceiver = pc.addTransceiver('video', { direction: 'sendrecv' });
  const video = els.friendVideo;
  const entry = { id, name: name || 'Guest', pc, video, transceiver, candidateQueue: [] };
  peers.set(id, entry);
  if (localStream) transceiver.sender.replaceTrack(localStream.getVideoTracks()[0]);
  pc.ontrack = (event) => {
    video.srcObject = event.streams[0];
    const reveal = () => { video.classList.add('active'); els.friendPlaceholder.classList.add('hidden'); els.friendTag.textContent = entry.name; els.friendTag.classList.remove('hidden'); els.friendState.textContent = `${entry.name} is here!`; setStatus('Connected · together at last', 'connected'); };
    event.track.onunmute = reveal;
    if (!event.track.muted) reveal();
  };
  pc.onicecandidate = (event) => { if (event.candidate) send({ type: 'signal', to: id, candidate: event.candidate }); };
  pc.onconnectionstatechange = () => { if (pc.connectionState === 'failed') { els.friendState.textContent = 'Connection failed'; showToast('Could not connect cameras. Try refreshing or another network.'); } };
  pc.oniceconnectionstatechange = () => { if (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') setStatus('Connected · together at last', 'connected'); };
  if (makeOffer) pc.createOffer().then(offer => pc.setLocalDescription(offer)).then(() => send({ type: 'signal', to: id, description: pc.localDescription })).catch(() => showToast('Could not start the camera connection.'));
  return entry;
}
async function receiveSignal(msg) {
  const entry = createPeer(msg.from, 'Guest', false); const pc = entry.pc;
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
  if (!navigator.mediaDevices?.getUserMedia) { showToast('Camera access needs HTTPS or localhost.'); return; }
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
    els.selfVideo.srcObject = localStream; els.selfVideo.classList.add('active'); els.selfPlaceholder.classList.add('hidden'); els.selfState.textContent = 'Camera is on';
    const displayName = els.name.value.trim() || 'you'; els.selfTag.textContent = displayName;
    for (const entry of peers.values()) await entry.transceiver.sender.replaceTrack(localStream.getVideoTracks()[0]);
    els.camera.innerHTML = '<span>✿</span> Camera is on'; els.camera.disabled = true; els.capture.disabled = false;
    showToast('Camera on — looking cute already!');
  } catch (error) { console.error(error); showToast(error.name === 'NotAllowedError' ? 'Please allow camera access in your browser.' : 'Could not start your camera. Check that it is available.'); }
}
function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
async function frameSnapshot(video) {
  if (!video || !video.srcObject || video.readyState < 2 || !video.videoWidth) return null;
  const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 420;
  const ctx = canvas.getContext('2d');
  ctx.save(); ctx.translate(canvas.width, 0); ctx.scale(-1, 1); ctx.filter = effects[els.effect.value].filter; ctx.drawImage(video, 0, 0, canvas.width, canvas.height); ctx.restore();
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
  if (announce) send({ type: 'room-event', event: 'capture' });
  const shots = [];
  for (let i = 3; i > 0; i--) {
    els.overlay.classList.remove('hidden'); els.count.textContent = String(i); await sleep(850);
    const local = await frameSnapshot(els.selfVideo), remote = await frameSnapshot(els.friendVideo);
    shots.push({ local, remote });
    if (i > 1) await sleep(750);
  }
  els.overlay.classList.add('hidden');
  const width = 780, pad = 26, gap = 16, panelH = 430, header = 88, footer = 82;
  const height = header + shots.length * panelH + (shots.length - 1) * gap + footer;
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext('2d');
  const bg = getComputedStyle(document.body).getPropertyValue('--accent-soft').trim() || '#ffe4ef';
  const ink = getComputedStyle(document.body).getPropertyValue('--accent-dark').trim() || '#d85e8b';
  ctx.fillStyle = bg; ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = ink; ctx.textAlign = 'center'; ctx.font = '800 29px Nunito, sans-serif'; ctx.fillText('our little photo booth ♡', width/2, 49);
  ctx.fillStyle = '#8d748e'; ctx.font = '600 13px "DM Sans", sans-serif'; ctx.fillText(`${roomCode}  ·  ${new Date().toLocaleDateString()}`, width/2, 72);
  shots.forEach((shot, i) => {
    const y = header + i * (panelH + gap); ctx.fillStyle = '#fff'; roundedRect(ctx, pad, y, width - pad*2, panelH, 14); ctx.save(); ctx.beginPath(); roundedRectPath(ctx,pad,y,width-pad*2,panelH,14); ctx.clip();
    const innerX = pad + 10, innerY = y + 10, innerW = width - pad*2 - 20, innerH = panelH - 20;
    if (shot.remote) { const half = (innerW - 8)/2; if (shot.local) drawCover(ctx, shot.local, innerX, innerY, half, innerH); else drawCover(ctx, shot.remote, innerX, innerY, half, innerH); drawCover(ctx, shot.remote, innerX + half + 8, innerY, half, innerH); }
    else if (shot.local) drawCover(ctx, shot.local, innerX, innerY, innerW, innerH);
    else { ctx.fillStyle = '#f7eef6'; ctx.fillRect(innerX, innerY, innerW, innerH); }
    drawPhotoEffect(ctx, innerX, innerY, innerW, innerH);
    ctx.restore(); ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(width-48,y+32,20,0,Math.PI*2); ctx.fill(); ctx.fillStyle=ink; ctx.font='800 12px "DM Sans", sans-serif'; ctx.fillText(String(i+1),width-48,y+36);
  });
  ctx.fillStyle = ink; ctx.font = '800 19px Nunito, sans-serif'; ctx.fillText('made with love, wherever you are ✿', width/2, height-35);
  const data = canvas.toDataURL('image/png'); els.resultImage.src = data; els.download.href = data; els.result.classList.remove('hidden'); els.result.scrollIntoView({ behavior: 'smooth', block: 'center' });
  captureBusy = false; els.capture.disabled = false; showToast('Your photo strip is ready to save! ♡');
}
function roundedRectPath(ctx,x,y,w,h,r){ctx.beginPath();ctx.moveTo(x+r,y);ctx.arcTo(x+w,y,x+w,y+h,r);ctx.arcTo(x+w,y+h,x,y+h,r);ctx.arcTo(x,y+h,x,y,r);ctx.arcTo(x,y,x+w,y,r);ctx.closePath();}
function roundedRect(ctx,x,y,w,h,r){ctx.fillStyle='#fff';roundedRectPath(ctx,x,y,w,h,r);ctx.fill();}
els.join.addEventListener('click', () => { if (socket && socket.readyState !== WebSocket.CLOSED) return; const room = els.room.value.trim() || randomRoom(); setupRoom(room); });
els.camera.addEventListener('click', startCamera); els.capture.addEventListener('click', takeStrip); els.retake.addEventListener('click', () => { els.result.classList.add('hidden'); els.capture.scrollIntoView({ behavior:'smooth', block:'center' }); });
els.copy.addEventListener('click', async () => { try { await navigator.clipboard.writeText(inviteUrl()); showToast('Invite link copied — send it to your person!'); } catch { prompt('Copy your invite link:', inviteUrl()); } });
els.room.addEventListener('keydown', e => { if (e.key === 'Enter') els.join.click(); });
const params = new URLSearchParams(location.search); if (params.has('room')) { els.room.value = params.get('room'); }
window.addEventListener('beforeunload', () => { for (const e of peers.values()) e.pc.close(); if (socket) socket.close(); if (localStream) localStream.getTracks().forEach(t => t.stop()); });
