/* 游戏部聊天室 · 交互逻辑(纯原生 JS,零依赖)
   跨设备互通:定时轮询 Cloudflare Worker 的 /chat 接口
   数据键(KV namespace: GAME_DEPT):
   - chat.<room>.meta   { name, members: {uid: nickname} }
   - chat.<room>.msgs   [{ uid, nickname, text, ts }] */
(function () {
  'use strict';
  const $ = (s) => document.querySelector(s);

  /* 双通道:优先自定义域名(大陆可访问),连不上自动切到 .workers.dev(海外) */
  const WORKER = 'https://chat.ttals.dpdns.org';
  const WORKER_FALLBACK = 'https://game-dept-team.2215417760.workers.dev';
  const POLL_MS = 2000;
  const LS = { uid: 'chat.uid', nickname: 'chat.nickname', room: 'chat.room' };

  /* 工具 */
  function lsGet(key, fb) { try { const v = JSON.parse(localStorage.getItem(key)); return v === null ? fb : v; } catch { return fb; } }
  function lsSet(key, v) { localStorage.setItem(key, JSON.stringify(v)); }
  function esc(s) { const d = document.createElement('div'); d.textContent = String(s); return d.innerHTML; }
  function fmtTime(ts) {
    const d = new Date(ts), today = new Date();
    const hh = d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
    if (d.toDateString() === today.toDateString()) return hh;
    return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + hh;
  }
  function avColor(uid) { let h = 0; for (let i = 0; i < uid.length; i++) h = (h * 31 + uid.charCodeAt(i)) | 0; return 'av-' + (Math.abs(h) % 6); }
  function firstChar(s) { s = String(s || ''); return s.charAt(0).toUpperCase() || '?'; }

  /* 我的身份 */
  let uid = lsGet(LS.uid, null);
  if (!uid) { uid = 'u-' + Math.random().toString(36).slice(2, 10); lsSet(LS.uid, uid); }
  let nickname = lsGet(LS.nickname, '') || ('玩家' + uid.slice(-4));
  lsSet(LS.nickname, nickname);
  const urlRoom = new URLSearchParams(location.search).get('room');
  let room = urlRoom || lsGet(LS.room, 'game-dept');
  lsSet(LS.room, room);

  /* 状态 */
  let lastMsgTs = 0, members = {}, connOk = true;
  let rooms = ['game-dept', 'team-chat', 'tech', 'off-topic'];
  let activeWorker = WORKER, fallbackTried = false;

  /* DOM */
  const msgsEl = $('#msgs'), msgInput = $('#msg-input'), roomInput = $('#room-input'), connEl = $('#conn-status');
  roomInput.value = room;
  $('#footer-room').textContent = 'room=' + room;

  function renderMe() { const av = $('#me-avatar'); av.textContent = firstChar(nickname); av.className = 'avatar ' + avColor(uid); $('#me-name').textContent = nickname; $('#me-uid').textContent = uid; }

  function renderRooms() {
    const list = $('#room-list');
    list.innerHTML = rooms.map(function (r) {
      const active = r === room ? ' active' : '';
      return '<li class="room-item' + active + '" data-room="' + esc(r) + '"><div class="avatar ' + avColor(r) + '">' + firstChar(r) + '</div><span class="r-name">' + esc(r) + '</span></li>';
    }).join('');
    list.querySelectorAll('.room-item').forEach(function (item) { item.addEventListener('click', function () { switchRoom(item.dataset.room); }); });
  }

  function renderMembers() {
    const list = $('#member-list'), ids = Object.keys(members);
    $('#member-count').textContent = ids.length;
    list.innerHTML = ids.map(function (id) {
      const isMe = id === uid;
      return '<li class="member-item"><div class="avatar ' + avColor(id) + '" style="width:30px;height:30px;font-size:.8rem">' + firstChar(members[id]) + '</div><span class="m-name">' + esc(members[id]) + (isMe ? '(我)' : '') + '</span><span class="m-online"></span></li>';
    }).join('');
  }

  function renderMsgs(newMsgs) {
    if (!newMsgs.length) return;
    const atBottom = msgsEl.scrollHeight - msgsEl.scrollTop - msgsEl.clientHeight < 120;
    newMsgs.forEach(function (m) {
      const isMe = m.uid === uid, div = document.createElement('div');
      div.className = 'msg' + (isMe ? ' me' : '');
      div.innerHTML = '<div class="m-avatar ' + avColor(isMe ? uid : m.uid) + '">' + firstChar(m.nickname) + '</div><div class="m-body"><div class="m-meta">' + (isMe ? '我' : esc(m.nickname)) + ' · ' + fmtTime(m.ts) + '</div><div class="m-bubble">' + esc(m.text) + '</div></div>';
      msgsEl.appendChild(div);
    });
    if (atBottom) msgsEl.scrollTop = msgsEl.scrollHeight;
  }

  /* 双通道:优先自定义域名,失败切 .workers.dev */
  async function api(path, opts) {
    try {
      const res = await fetch(activeWorker + path, { headers: { 'Content-Type': 'application/json' }, ...opts });
      return res.json().catch(function () { return {}; });
    } catch (e) {
      if (!fallbackTried) { fallbackTried = true; activeWorker = WORKER_FALLBACK; }
      const res2 = await fetch(activeWorker + path, { headers: { 'Content-Type': 'application/json' }, ...opts });
      return res2.json().catch(function () { return {}; });
    }
  }

  async function poll() {
    try {
      const data = await api('/chat?room=' + encodeURIComponent(room) + '&uid=' + encodeURIComponent(uid));
      if (data.room) {
        members = (data.meta && data.meta.members) || {};
        renderMembers();
        const fresh = (data.msgs || []).filter(function (m) { return m.ts > lastMsgTs; });
        if (fresh.length) {
          if (lastMsgTs === 0) { lastMsgTs = data.msgs[data.msgs.length - 1].ts; renderMsgs((data.msgs || []).slice(-20)); }
          else { renderMsgs(fresh); lastMsgTs = fresh[fresh.length - 1].ts; }
        }
        connOk = true; setConn(true);
      }
    } catch (e) { connOk = false; setConn(false); }
  }

  function setConn(ok) {
    connEl.className = 'conn ' + (ok ? 'on' : 'err');
    connEl.textContent = ok ? '已连接 ' + activeWorker.replace('https://', '') : '断线,重试中...';
  }

  async function send() {
    const text = msgInput.value.trim();
    if (!text) return;
    const optimistic = { uid: uid, nickname: nickname, text: text, ts: Date.now() };
    lastMsgTs = optimistic.ts;
    renderMsgs([optimistic]);
    msgInput.value = ''; msgInput.focus(); msgsEl.scrollTop = msgsEl.scrollHeight;
    try {
      await api('/chat/send', { method: 'POST', body: JSON.stringify({ room: room, uid: uid, nickname: nickname, text: text }) });
    } catch (e) {
      const fail = document.createElement('div');
      fail.className = 'msg-day'; fail.style.color = '#c0392b';
      fail.textContent = '⚠ 发送失败(断网),消息仅本地显示';
      msgsEl.appendChild(fail); msgsEl.scrollTop = msgsEl.scrollHeight;
    }
  }

  function switchRoom(r) {
    room = r; lsSet(LS.room, room); roomInput.value = room;
    $('#footer-room').textContent = 'room=' + room;
    msgsEl.innerHTML = ''; lastMsgTs = 0; members = {};
    renderRooms(); renderMembers(); setConnTitle(); poll();
  }
  function setConnTitle() { $('#room-name').textContent = room; $('#room-sub').textContent = '游戏部 · 房间 ' + room; }

  /* 表情 */
  const EMOJIS = ['😀','😂','😍','🤣','😎','🥳','😅','🙂','😉','😘','😜','🤔','😭','😤','👍','👎','👏','🙏','💪','🎉','🔥','⭐','❤️','💯','🎮','🕹️','🚀','👾','🎲','🏆','🎯','🌙'];
  function buildEmoji() {
    const grid = $('#emoji-grid');
    grid.innerHTML = EMOJIS.map(function (e) { return '<button type="button" data-e="' + e + '">' + e + '</button>'; }).join('');
    grid.querySelectorAll('button').forEach(function (b) {
      b.addEventListener('click', function () { msgInput.value += b.dataset.e; msgInput.focus(); $('#emoji-pop').hidden = true; });
    });
  }

  /* 事件 */
  $('#btn-send').addEventListener('click', send);
  msgInput.addEventListener('keydown', function (e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } });
  $('#btn-emoji').addEventListener('click', function () { const pop = $('#emoji-pop'); pop.hidden = !pop.hidden; });
  document.addEventListener('click', function (e) { const pop = $('#emoji-pop'); if (!pop.hidden && !pop.contains(e.target) && e.target.id !== 'btn-emoji') pop.hidden = true; });
  $('#btn-switch-room').addEventListener('click', function () { const r = roomInput.value.trim() || 'default'; switchRoom(r); });
  roomInput.addEventListener('keydown', function (e) { if (e.key === 'Enter') { const r = roomInput.value.trim() || 'default'; switchRoom(r); } });
  $('#btn-rename-self').addEventListener('click', function () {
    const n = prompt('你的新昵称:', nickname);
    if (n && n.trim()) { nickname = n.trim(); lsSet(LS.nickname, nickname); renderMe(); api('/chat/join', { method: 'POST', body: JSON.stringify({ room: room, uid: uid, nickname: nickname }) }); }
  });
  $('#btn-copy-room-link').addEventListener('click', function () {
    const link = location.origin + location.pathname + '?room=' + encodeURIComponent(room);
    if (navigator.clipboard) navigator.clipboard.writeText(link).then(function () { flashBtn('已复制!', 1500); }, function () { prompt('复制这个链接发给队友:', link); });
    else prompt('复制这个链接发给队友:', link);
  });
  function flashBtn(txt, ms) { const b = $('#btn-copy-room-link'), old = b.textContent; b.textContent = txt; setTimeout(function () { b.textContent = old; }, ms); }

  /* 启动 */
  function boot() {
    renderMe(); renderRooms(); setConnTitle(); buildEmoji();
    api('/chat/join', { method: 'POST', body: JSON.stringify({ room: room, uid: uid, nickname: nickname }) });
    poll();
    setInterval(poll, POLL_MS);
  }
  boot();
})();
