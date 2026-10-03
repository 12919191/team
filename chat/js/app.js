/* 游戏部聊天室 · 交互逻辑（纯原生 JS，零依赖）
   跨设备互通：定时轮询 Cloudflare Worker 的 /chat 接口
   数据键（KV namespace: GAME_DEPT）:
   - chat.<room>.meta   { name, members: {uid: nickname} }
   - chat.<room>.msgs   [{ uid, nickname, text, ts }]

   每个客户端：
   - 进页生成一个稳定 uid（localStorage 存）
   - 每 2s GET /chat?room=X 拉最新消息，比上次多的就渲染
   - 发消息 POST /chat/send
   - 切换房间 = 改 room 参数重新轮询 */
(function () {
  'use strict';

  const $ = (s) => document.querySelector(s);

  /* ══════════ 配置 ══════════ */
  // Worker 地址：
  //   大陆访问（已绑自定义域名）：https://chat.ttals.dpdns.org
  //   海外 / 有梯子：             https://game-dept-team.2215417760.workers.dev
  //   默认用自定义域名（大陆优先），连不上会自动切到 .workers.dev 重试
  const WORKER = 'https://chat.ttals.dpdns.org';
  const WORKER_FALLBACK = 'https://game-dept-team.2215417760.workers.dev';
  const POLL_MS = 2000;            // 轮询间隔
  const LS = {
    uid: 'chat.uid',
    nickname: 'chat.nickname',
    room: 'chat.room',
  };

  /* ══════════ 双通道 Worker 地址（大陆优先自定义域名，失败切 .workers.dev） ══════════ */
  let workerBase = WORKER;
  let workerTriedFallback = false;

  async function api(path, opts) {
    let base = workerBase;
    try {
      const res = await fetch(base + path, {
        headers: { 'Content-Type': 'application/json' },
        ...opts,
      });
      const data = await res.json().catch(function () { return {}; });
      // 404 是正常业务（没数据），其他错误才切通道
      if (!res.ok && res.status !== 404) throw new Error('HTTP ' + res.status);
      return data;
    } catch (e) {
      // 主通道失败且没切过 → 切到 .workers.dev 重试一次
      if (!workerTriedFallback) {
        workerTriedFallback = true;
        workerBase = WORKER_FALLBACK;
        setConnNote('⚠ 自定义域名连不上，已切到 .workers.dev');
      } else {
        throw e;
      }
    }
    const res2 = await fetch(workerBase + path, {
      headers: { 'Content-Type': 'application/json' },
      ...opts,
    });
    return res2.json().catch(function () { return {}; });
  }

  function setConnNote(msg) {
    const el = document.getElementById('conn-note');
    if (el) el.textContent = msg;
  }

  /* ══════════ 工具 ══════════ */
  function lsGet(key, fb) {
    try { const v = JSON.parse(localStorage.getItem(key)); return v === null ? fb : v; }
    catch { return fb; }
  }
  function lsSet(key, v) { localStorage.setItem(key, JSON.stringify(v)); }
  function esc(s) {
    const d = document.createElement('div');
    d.textContent = String(s);
    return d.innerHTML;
  }
  function fmtTime(ts) {
    const d = new Date(ts);
    const today = new Date();
    const hh = d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
    if (d.toDateString() === today.toDateString()) return hh;
    return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + hh;
  }
  function avColor(uid) {
    let h = 0;
    for (let i = 0; i < uid.length; i++) h = (h * 31 + uid.charCodeAt(i)) | 0;
    return 'av-' + (Math.abs(h) % 6);
  }
  function firstChar(s) {
    s = String(s || '');
    return s.charAt(0).toUpperCase() || '?';
  }

  /* ══════════ 我的身份（每个设备一个稳定 uid） ══════════ */
  let uid = lsGet(LS.uid, null);
  if (!uid) {
    uid = 'u-' + Math.random().toString(36).slice(2, 10);
    lsSet(LS.uid, uid);
  }
  let nickname = lsGet(LS.nickname, '') || ('玩家' + uid.slice(-4));
  lsSet(LS.nickname, nickname);

  // 当前房间（URL ?room= 优先，否则用 localStorage，再否则 default）
  const urlRoom = new URLSearchParams(location.search).get('room');
  let room = urlRoom || lsGet(LS.room, 'game-dept');
  lsSet(LS.room, room);

  /* ══════════ 状态 ══════════ */
  let lastMsgTs = 0;                 // 上次拉到的最新消息时间戳
  let members = {};
  let rooms = ['game-dept', 'team-chat', 'tech', 'off-topic'];  // 群聊房间列表
  let connOk = true;

  /* ══════════ DOM ══════════ */
  const msgsEl = $('#msgs');
  const msgInput = $('#msg-input');
  const roomInput = $('#room-input');
  const connEl = $('#conn-status');

  roomInput.value = room;
  $('#footer-room').textContent = 'room=' + room;

  /* ── 我的卡片 ── */
  function renderMe() {
    const av = $('#me-avatar');
    av.textContent = firstChar(nickname);
    av.className = 'avatar ' + avColor(uid);
    $('#me-name').textContent = nickname;
    $('#me-uid').textContent = uid;
  }

  /* ── 群聊列表 ── */
  function renderRooms() {
    const list = $('#room-list');
    list.innerHTML = rooms.map(function (r) {
      const active = r === room ? ' active' : '';
      return '<li class="room-item' + active + '" data-room="' + esc(r) + '">' +
        '<div class="avatar ' + avColor(r) + '">' + firstChar(r) + '</div>' +
        '<span class="r-name">' + esc(r) + '</span>' +
      '</li>';
    }).join('');

    list.querySelectorAll('.room-item').forEach(function (item) {
      item.addEventListener('click', function () {
        switchRoom(item.dataset.room);
      });
    });
  }

  /* ── 成员列表 ── */
  function renderMembers() {
    const list = $('#member-list');
    const ids = Object.keys(members);
    $('#member-count').textContent = ids.length;
    list.innerHTML = ids.map(function (id) {
      const isMe = id === uid;
      return '<li class="member-item">' +
        '<div class="avatar ' + avColor(id) + '" style="width:30px;height:30px;font-size:.8rem">' +
          firstChar(members[id]) + '</div>' +
        '<span class="m-name">' + esc(members[id]) + (isMe ? '（我）' : '') + '</span>' +
        '<span class="m-online"></span>' +
      '</li>';
    }).join('');
  }

  /* ── 渲染新消息 ── */
  function renderMsgs(newMsgs) {
    if (!newMsgs.length) return;
    const atBottom = msgsEl.scrollHeight - msgsEl.scrollTop - msgsEl.clientHeight < 120;

    newMsgs.forEach(function (m) {
      const isMe = m.uid === uid;
      const div = document.createElement('div');
      div.className = 'msg' + (isMe ? ' me' : '');

      const avClass = isMe ? avColor(uid) : avColor(m.uid);
      div.innerHTML =
        '<div class="m-avatar ' + avClass + '">' + firstChar(m.nickname) + '</div>' +
        '<div class="m-body">' +
          '<div class="m-meta">' + (isMe ? '我' : esc(m.nickname)) + ' · ' + fmtTime(m.ts) + '</div>' +
          '<div class="m-bubble">' + esc(m.text) + '</div>' +
        '</div>';
      msgsEl.appendChild(div);
    });

    if (atBottom) msgsEl.scrollTop = msgsEl.scrollHeight;
  }

  /* ══════════ 网络请求 ══════════ */
  async function api(path, opts) {
    const res = await fetch(WORKER + path, {
      headers: { 'Content-Type': 'application/json' },
      ...opts,
    });
    return res.json().catch(function () { return {}; });
  }

  async function poll() {
    try {
      const data = await api('/chat?room=' + encodeURIComponent(room) + '&uid=' + encodeURIComponent(uid));
      if (data.room) {
        members = (data.meta && data.meta.members) || {};
        renderMembers();
        // 只显示我还没见过的消息（ts > lastMsgTs）
        const fresh = (data.msgs || []).filter(function (m) { return m.ts > lastMsgTs; });
        if (fresh.length) {
          // 首拉时不渲染旧消息（避免刷屏），但记录时间戳
          if (lastMsgTs === 0) {
            lastMsgTs = fresh[fresh.length - 1].ts;
            // 首拉时渲染最近 20 条作为上下文
            renderMsgs((data.msgs || []).slice(-20));
            lastMsgTs = data.msgs[data.msgs.length - 1].ts;
          } else {
            renderMsgs(fresh);
            lastMsgTs = fresh[fresh.length - 1].ts;
          }
        }
        connOk = true;
        setConn(true);
      }
    } catch (e) {
      connOk = false;
      setConn(false);
    }
  }

  function setConn(ok) {
    connEl.className = 'conn ' + (ok ? 'on' : 'err');
    connEl.textContent = ok ? '已连接 ' + WORKER.replace('https://', '') : '断线，重试中…';
  }

  async function send() {
    const text = msgInput.value.trim();
    if (!text) return;
    // 先乐观渲染自己的消息
    const optimistic = { uid: uid, nickname: nickname, text: text, ts: Date.now() };
    lastMsgTs = optimistic.ts;
    renderMsgs([optimistic]);
    msgInput.value = '';
    msgInput.focus();
    msgsEl.scrollTop = msgsEl.scrollHeight;

    try {
      await api('/chat/send', {
        method: 'POST',
        body: JSON.stringify({ room: room, uid: uid, nickname: nickname, text: text }),
      });
    } catch (e) {
      // 发送失败（断网）：标红提示
      const fail = document.createElement('div');
      fail.className = 'msg-day';
      fail.style.color = '#c0392b';
      fail.textContent = '⚠ 发送失败（断网），消息仅本地显示';
      msgsEl.appendChild(fail);
      msgsEl.scrollTop = msgsEl.scrollHeight;
    }
  }

  function switchRoom(r) {
    room = r;
    lsSet(LS.room, room);
    roomInput.value = room;
    $('#footer-room').textContent = 'room=' + room;
    // 清屏重来
    msgsEl.innerHTML = '';
    lastMsgTs = 0;
    members = {};
    renderRooms();
    renderMembers();
    setConnTitle();
    poll();
  }

  function setConnTitle() {
    $('#room-name').textContent = room;
    $('#room-sub').textContent = '游戏部 · 房间 ' + room;
  }

  /* ══════════ 表情 ══════════ */
  const EMOJIS = ['😀','😂','😍','🤣','😎','🥳','😅','🙂','😉','😘','😜','🤔','😭','😤','👍','👎','👏','🙏','💪','🎉','🔥','⭐','❤️','💯','🎮','🕹️','🚀','👾','🎲','🏆','🎯','🌙'];

  function buildEmoji() {
    const grid = $('#emoji-grid');
    grid.innerHTML = EMOJIS.map(function (e) {
      return '<button type="button" data-e="' + e + '">' + e + '</button>';
    }).join('');
    grid.querySelectorAll('button').forEach(function (b) {
      b.addEventListener('click', function () {
        msgInput.value += b.dataset.e;
        msgInput.focus();
        $('#emoji-pop').hidden = true;
      });
    });
  }

  /* ══════════ 事件绑定 ══════════ */
  $('#btn-send').addEventListener('click', send);
  msgInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  });

  $('#btn-emoji').addEventListener('click', function () {
    const pop = $('#emoji-pop');
    pop.hidden = !pop.hidden;
  });
  // 点空白处收起表情弹层
  document.addEventListener('click', function (e) {
    const pop = $('#emoji-pop');
    if (!pop.hidden && !pop.contains(e.target) && e.target.id !== 'btn-emoji') {
      pop.hidden = true;
    }
  });

  $('#btn-switch-room').addEventListener('click', function () {
    const r = roomInput.value.trim() || 'default';
    switchRoom(r);
  });
  roomInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') {
      const r = roomInput.value.trim() || 'default';
      switchRoom(r);
    }
  });

  // 改昵称
  $('#btn-rename-self').addEventListener('click', function () {
    const n = prompt('你的新昵称：', nickname);
    if (n && n.trim()) {
      nickname = n.trim();
      lsSet(LS.nickname, nickname);
      renderMe();
      // 登记到房间
      api('/chat/join', { method: 'POST', body: JSON.stringify({ room: room, uid: uid, nickname: nickname }) });
    }
  });

  // 复制房间链接
  $('#btn-copy-room-link').addEventListener('click', function () {
    const link = location.origin + location.pathname + '?room=' + encodeURIComponent(room);
    if (navigator.clipboard) {
      navigator.clipboard.writeText(link).then(function () {
        flashBtn('已复制！', 1500);
      }, function () {
        prompt('复制这个链接发给队友：', link);
      });
    } else {
      prompt('复制这个链接发给队友：', link);
    }
  });
  function flashBtn(txt, ms) {
    const b = $('#btn-copy-room-link');
    const old = b.textContent;
    b.textContent = txt;
    setTimeout(function () { b.textContent = old; }, ms);
  }

  /* ══════════ 启动 ══════════ */
  function boot() {
    renderMe();
    renderRooms();
    setConnTitle();
    buildEmoji();

    // 先登记自己
    api('/chat/join', { method: 'POST', body: JSON.stringify({ room: room, uid: uid, nickname: nickname }) });

    // 首拉
    poll();
    // 轮询
    setInterval(poll, POLL_MS);
  }
  boot();
})();
