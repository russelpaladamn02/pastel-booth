const $ = (id) => document.getElementById(id);
const els = { theme: $('themeSelect'), effect: $('effectSelect'), room: $('roomInput'), name: $('nameInput'), join: $('joinButton'), camera: $('cameraButton'), capture: $('captureButton'), pill: $('connectionPill'), status: $('connectionText'), roomBar: $('roomBar'), invite: $('inviteRow'), inviteText: $('inviteText'), copy: $('copyButton'), selfVideo: $('selfVideo'), friendVideo: $('friendVideo'), selfPlaceholder: $('selfPlaceholder'), friendPlaceholder: $('friendPlaceholder'), selfState: $('selfState'), friendState: $('friendState'), selfTag: $('selfNameTag'), friendTag: $('friendNameTag'), toast: $('toast'), overlay: $('countdownOverlay'), count: $('countdownNumber'), result: $('resultCard'), resultImage: $('resultImage'), download: $('downloadButton'), retake: $('retakeButton'), flipCamera: $('flipCameraButton'), mirror: $('mirrorToggle'), layout: $('layoutSelect'), size: $('sizeSelect'), shotCount: $('shotCountSelect'), shotsBadge: $('shotsBadge'), stripMirror: $('stripMirrorSelect'), stripStyle: $('stripStyleSelect'), stripLayoutEdit: $('stripLayoutEdit'), stripSizeEdit: $('stripSizeEdit') };
let socket, localStream, myId, roomCode, peers = new Map(), captureBusy = false, toastTimer, cameraFacing = 'user';
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
  if (!navigator.mediaDevices?.getUserMedia) { showToast('Camera needs HTTPS. Open the secure https:// site in Chrome.'); return; }
  els.camera.disabled = true; els.camera.textContent = 'Opening camera…';
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: cameraFacing }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
    if (localStream) localStream.getTracks().forEach(track => track.stop());
    localStream = stream;
    els.selfVideo.srcObject = localStream; els.selfVideo.classList.add('active'); els.selfPlaceholder.classList.add('hidden'); els.selfState.textContent = 'Camera is on';
    updateMirrorPreview();
    const displayName = els.name.value.trim() || 'you'; els.selfTag.textContent = displayName;
    for (const entry of peers.values()) await entry.transceiver.sender.replaceTrack(localStream.getVideoTracks()[0]);
    els.camera.innerHTML = '<span>✿</span> Camera is on'; els.camera.disabled = false; els.flipCamera.disabled = false; els.capture.disabled = false;
    showToast(cameraFacing === 'user' ? 'Front camera on — looking cute already!' : 'Back camera on!');
  } catch (error) {
    console.error(error); els.camera.disabled = false; els.camera.innerHTML = '<span>📷</span> Try camera again';
    const messages = { NotAllowedError: 'Camera permission is blocked. In Chrome, tap the site icon → Permissions → Camera → Allow, then reload.', NotFoundError: 'No camera was found on this device.', NotReadableError: 'Camera is busy in another app. Close other camera apps and try again.', OverconstrainedError: 'That camera mode is unavailable. Try switching camera again.' };
    showToast(messages[error.name] || 'Could not start the camera. Check permissions and close other camera apps.');
  }
}
async function switchCamera() {
  if (!localStream) { cameraFacing = cameraFacing === 'user' ? 'environment' : 'user'; return startCamera(); }
  cameraFacing = cameraFacing === 'user' ? 'environment' : 'user';
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { exact: cameraFacing }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
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
let capturedShots = [];
let editorReady = false;
function chosenValue(control, fallback) { return control && control.value ? control.value : fallback; }
function drawCoverMaybeMirrored(ctx, image, x, y, w, h, mirror) {
  if (!image) return;
  if (!mirror) return drawCover(ctx, image, x, y, w, h);
  ctx.save(); ctx.translate(x + w, y); ctx.scale(-1, 1); drawCover(ctx, image, 0, 0, w, h); ctx.restore();
}
function drawSpookyDecor(ctx, x, y, w, h, scale) {
  ctx.save(); ctx.strokeStyle = 'rgba(255,244,225,.82)'; ctx.lineWidth = Math.max(1, 2*scale);
  // little spider webs in corners
  for (const [ox,oy,flipX,flipY] of [[x+8*scale,y+8*scale,1,1],[x+w-8*scale,y+8*scale,-1,1]]) {
    ctx.beginPath(); ctx.moveTo(ox,oy); ctx.lineTo(ox+flipX*42*scale,oy); ctx.moveTo(ox,oy); ctx.lineTo(ox,oy+flipY*42*scale);
    for(let r=12;r<=38;r+=9){ctx.beginPath();ctx.moveTo(ox+flipX*r*scale,oy);ctx.quadraticCurveTo(ox+flipX*r*scale,oy+flipY*r*.55*scale,ox,oy+flipY*r*scale);ctx.stroke();}
    ctx.stroke();
  }
  // distressed scratches on the outer edge
  ctx.strokeStyle='rgba(65,25,38,.55)'; ctx.lineWidth=Math.max(1,3*scale);
  for(let i=0;i<5;i++){const sx=x+w-(12+i*5)*scale;ctx.beginPath();ctx.moveTo(sx,y+h*.25);ctx.lineTo(sx-8*scale,y+h*.25+18*scale);ctx.lineTo(sx-4*scale,y+h*.25+27*scale);ctx.stroke();}
  ctx.font=`${Math.round(32*scale)}px sans-serif`;ctx.textAlign='left';ctx.fillText('🎃',x+8*scale,y+h-10*scale);ctx.textAlign='right';ctx.fillText('🕸️',x+w-7*scale,y+h-8*scale);
  ctx.restore();
}
function renderStrip() {
  if (!capturedShots.length) return;
  document.body.dataset.season=chosenValue(els.stripStyle,'pastel');
  const layout = chosenValue(els.stripLayoutEdit, chosenValue(els.layout,'classic'));
  const sizeName = chosenValue(els.stripSizeEdit, chosenValue(els.size,'standard'));
  const style = chosenValue(els.stripStyle,'pastel');
  const mirror = chosenValue(els.stripMirror,'mirror') === 'mirror';
  const scale = sizeName === 'small' ? .72 : sizeName === 'large' ? 1.35 : 1;
  const width = Math.round((layout === 'wide' ? 980 : layout === 'grid' ? 900 : 780) * scale);
  const pad = Math.round(26*scale), gap = Math.round(16*scale), header = Math.round(88*scale), footer = Math.round(82*scale);
  const panelH = Math.round((layout === 'wide' ? 280 : layout === 'grid' ? 300 : 430)*scale);
  const cols = layout === 'grid' ? 2 : 1, rows = layout === 'grid' ? Math.ceil(capturedShots.length/2) : capturedShots.length;
  const panelW = layout === 'grid' ? Math.round((width-pad*2-gap)/2) : width-pad*2;
  const height = header + rows*panelH + (rows-1)*gap + footer;
  const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;const ctx=canvas.getContext('2d');
  const pastel=getComputedStyle(document.body).getPropertyValue('--accent-soft').trim()||'#ffe4ef';
  let bg=pastel, ink=getComputedStyle(document.body).getPropertyValue('--accent-dark').trim()||'#d85e8b';
  if(style==='candycane'){bg='#fff8f2';ink='#b52e42';}
  if(style==='spooky'){bg='#211a2d';ink='#ff9b42';}
  ctx.fillStyle=bg;ctx.fillRect(0,0,width,height);
  if(style==='candycane'){
    const band=Math.max(8,Math.round(18*scale));ctx.save();ctx.strokeStyle='#e45b68';ctx.lineWidth=band;
    for(let x=-height;x<width+height;x+=band*2){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x+height,height);ctx.stroke();}ctx.restore();
    ctx.fillStyle=bg;ctx.fillRect(pad/2,0,width-pad,height);
  }
  if(style==='spooky'){
    ctx.save();ctx.strokeStyle='rgba(255,140,65,.35)';ctx.lineWidth=Math.max(2,3*scale);ctx.strokeRect(pad/2,pad/2,width-pad,height-pad);
    // aged booth scratches along border
    for(let i=0;i<18;i++){const xx=(i*47*scale+13*scale)%(width-pad);ctx.beginPath();ctx.moveTo(xx,pad*.3);ctx.lineTo(xx-8*scale,pad*.9);ctx.stroke();}ctx.restore();
  }
  ctx.fillStyle=ink;ctx.textAlign='center';ctx.font=`800 ${Math.round(29*scale)}px Nunito,sans-serif`;
  ctx.fillText(style==='candycane'?'MERRY & BRIGHT · 2027 ♡':style==='spooky'?'SPOOKY LITTLE MEMORIES':'our little photo booth ♡',width/2,Math.round(49*scale));
  ctx.fillStyle=style==='spooky'?'#f8d8b7':'#8d748e';ctx.font=`600 ${Math.round(13*scale)}px "DM Sans",sans-serif`;ctx.fillText(`${roomCode||'PASTEL BOOTH'} · ${new Date().toLocaleDateString()}`,width/2,Math.round(72*scale));
  capturedShots.forEach((shot,i)=>{
    const col=layout==='grid'?i%2:0,row=layout==='grid'?Math.floor(i/2):i;
    const x=pad+col*(panelW+gap),y=header+row*(panelH+gap);
    ctx.fillStyle=style==='spooky'?'#4b3045':style==='candycane'?'#e45b68':'#fff';roundedRect(ctx,x,y,panelW,panelH,Math.round(14*scale));
    ctx.save();ctx.beginPath();roundedRectPath(ctx,x,y,panelW,panelH,Math.round(14*scale));ctx.clip();
    const inset=Math.round(10*scale),ix=x+inset,iy=y+inset,iw=panelW-inset*2,ih=panelH-inset*2;
    if(shot.remote){const half=(iw-Math.round(8*scale))/2;if(shot.local)drawCoverMaybeMirrored(ctx,shot.local,ix,iy,half,ih,mirror);else drawCoverMaybeMirrored(ctx,shot.remote,ix,iy,half,ih,mirror);drawCoverMaybeMirrored(ctx,shot.remote,ix+half+Math.round(8*scale),iy,half,ih,false);}
    else if(shot.local)drawCoverMaybeMirrored(ctx,shot.local,ix,iy,iw,ih,mirror);
    else {ctx.fillStyle=style==='spooky'?'#382638':'#f7eef6';ctx.fillRect(ix,iy,iw,ih);}
    drawPhotoEffect(ctx,ix,iy,iw,ih);
    if(style==='spooky')drawSpookyDecor(ctx,x,y,panelW,panelH,scale);
    if(style==='candycane'){ctx.strokeStyle='#fff8f2';ctx.lineWidth=Math.max(4,7*scale);ctx.strokeRect(x+3*scale,y+3*scale,panelW-6*scale,panelH-6*scale);ctx.fillStyle='#267b55';ctx.font=`${Math.round(22*scale)}px sans-serif`;ctx.textAlign='left';ctx.fillText('❄',x+10*scale,y+28*scale);ctx.textAlign='right';ctx.fillText('✦',x+panelW-10*scale,y+panelH-12*scale);}
    ctx.restore();ctx.fillStyle=style==='spooky'?'#ffb25e':'#fff';ctx.beginPath();ctx.arc(x+panelW-Math.round(22*scale),y+Math.round(22*scale),Math.round(14*scale),0,Math.PI*2);ctx.fill();ctx.fillStyle=ink;ctx.font=`800 ${Math.round(12*scale)}px "DM Sans",sans-serif`;ctx.textAlign='center';ctx.fillText(String(i+1),x+panelW-Math.round(22*scale),y+Math.round(26*scale));
  });
  ctx.fillStyle=ink;ctx.textAlign='center';ctx.font=`800 ${Math.round(19*scale)}px Nunito,sans-serif`;ctx.fillText(style==='spooky'?'TRICK OR TREAT ✦':style==='candycane'?'wrapped in holiday magic ✿':'made with love, wherever you are ✿',width/2,height-Math.round(35*scale));
  const data=canvas.toDataURL('image/png');els.resultImage.src=data;els.download.href=data;els.download.download=`pastel-booth-${style}-${Date.now()}.png`;
}
async function takeStrip(announce = true) {
  if(captureBusy||!localStream)return;
  captureBusy=true;els.capture.disabled=true;els.result.classList.add('hidden');capturedShots=[];
  const count=Math.max(3,Math.min(5,Number(chosenValue(els.shotCount,3))||3));
  if(els.shotsBadge)els.shotsBadge.textContent=String(count);
  if(announce)send({type:'room-event',event:'capture'});
  try {
    for(let shotIndex=0;shotIndex<count;shotIndex++){
      els.overlay.classList.remove('hidden');
      const label=$('countdownLabel');if(label)label.textContent=`photo ${shotIndex+1} of ${count}`;
      for(let second=3;second>=1;second--){els.count.textContent=String(second);await sleep(1000);}
      const local=await frameSnapshot(els.selfVideo),remote=await frameSnapshot(els.friendVideo);
      capturedShots.push({local,remote});
      els.count.textContent=shotIndex===count-1?'✦':'✓';await sleep(220);
    }
    els.overlay.classList.add('hidden');
    if(els.stripLayoutEdit)els.stripLayoutEdit.value=chosenValue(els.layout,'classic');
    if(els.stripSizeEdit)els.stripSizeEdit.value=chosenValue(els.size,'standard');
    if(els.stripMirror)els.stripMirror.value='mirror';
    renderStrip();els.result.classList.remove('hidden');els.result.scrollIntoView({behavior:'smooth',block:'start'});
    showToast('Your photos are ready! Choose a style before downloading ♡');
  } catch(err){console.error(err);els.overlay.classList.add('hidden');showToast('Could not finish the photo strip. Please try again.');}
  finally{captureBusy=false;els.capture.disabled=false;}
}
for(const control of [els.stripMirror,els.stripStyle,els.stripLayoutEdit,els.stripSizeEdit])if(control)control.addEventListener('change',()=>{if(control===els.stripStyle)document.body.dataset.season=control.value;renderStrip();});
function roundedRectPath(ctx,x,y,w,h,r){ctx.beginPath();ctx.moveTo(x+r,y);ctx.arcTo(x+w,y,x+w,y+h,r);ctx.arcTo(x+w,y+h,x,y+h,r);ctx.arcTo(x,y+h,x,y,r);ctx.arcTo(x,y,x+w,y,r);ctx.closePath();}
function roundedRect(ctx,x,y,w,h,r){ctx.fillStyle='#fff';roundedRectPath(ctx,x,y,w,h,r);ctx.fill();}
els.join.addEventListener('click', () => { if (socket && socket.readyState !== WebSocket.CLOSED) return; const room = els.room.value.trim() || randomRoom(); setupRoom(room); });
if(els.shotCount)els.shotCount.addEventListener('change',()=>{if(els.shotsBadge)els.shotsBadge.textContent=els.shotCount.value;});
els.camera.addEventListener('click', startCamera); els.flipCamera.addEventListener('click', switchCamera); els.capture.addEventListener('click', takeStrip); els.retake.addEventListener('click', () => { els.result.classList.add('hidden'); els.capture.scrollIntoView({ behavior:'smooth', block:'center' }); });
els.copy.addEventListener('click', async () => { try { await navigator.clipboard.writeText(inviteUrl()); showToast('Invite link copied — send it to your person!'); } catch { prompt('Copy your invite link:', inviteUrl()); } });
els.room.addEventListener('keydown', e => { if (e.key === 'Enter') els.join.click(); });
const params = new URLSearchParams(location.search); if (params.has('room')) { els.room.value = params.get('room'); }
window.addEventListener('beforeunload', () => { for (const e of peers.values()) e.pc.close(); if (socket) socket.close(); if (localStream) localStream.getTracks().forEach(t => t.stop()); });
