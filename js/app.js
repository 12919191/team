/* 游戏部团队站 · 交互逻辑（纯原生 JS，零依赖）
   数据存于浏览器 localStorage：
   - team.posts[]     文章
   - team.source      背景图出处标注
   跨设备同步：导出 / 导入 JSON 文件（分享 team-posts-*.json 给队友） */
(function () {
  'use strict';

  const $ = (s) => document.querySelector(s);

  /* ══════════ 工具 ══════════ */
  const LS = {
    posts: 'team.posts',
    source: 'team.source',
  };
  function lsGet(key, fb) {
    try { const v = JSON.parse(localStorage.getItem(key)); return v === null ? fb : v; }
    catch { return fb; }
  }
  function lsSet(key, v) { localStorage.setItem(key, JSON.stringify(v)); }
  function lsDel(key) { localStorage.removeItem(key); }
  function esc(str) {
    const d = document.createElement('div');
    d.textContent = String(str);
    return d.innerHTML;
  }

  /* ── 数据读写 ── */
  function readPosts() { return lsGet(LS.posts, []); }
  function upsertPost(post) {
    const posts = readPosts();
    const idx = posts.findIndex(p => p.id === post.id);
    if (idx >= 0) posts[idx] = post; else posts.unshift(post);
    lsSet(LS.posts, posts);
  }
  function deletePost(id) {
    lsSet(LS.posts, readPosts().filter(p => p.id !== id));
  }
  function readSource() { return lsGet(LS.source, null); }
  function writeSource(s) { lsSet(LS.source, s); }

  /* ══════════ 1. 背景图出处标注 ══════════ */
  const form = $('#source-form');
  const sourceStatus = $('#source-status');
  const caption = $('#hero-caption');

  function renderCaption(source) {
    if (!source || (!source.src && !source.author)) {
      caption.innerHTML = '<span>🖼 背景图：<em>待标注</em></span>';
      return;
    }
    const parts = [];
    if (source.src) parts.push('来源 ' + esc(source.src));
    if (source.author) parts.push('作者 ' + esc(source.author));
    if (source.license) parts.push(esc(source.license));
    if (source.url) parts.push('原图 <a href="' + esc(source.url) + '" target="_blank" rel="noopener">' + esc(source.url) + '</a>');
    if (source.note) parts.push('备注 ' + esc(source.note));
    caption.innerHTML = '<span>🖼 背景图：' + parts.join(' · ') + '</span>';
  }

  function fillForm(source) {
    if (!source) return;
    form.src.value = source.src || '';
    form.author.value = source.author || '';
    form.license.value = source.license || '';
    form.url.value = source.url || '';
    form.note.value = source.note || '';
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    const data = {
      src: form.src.value.trim(),
      author: form.author.value.trim(),
      license: form.license.value.trim(),
      url: form.url.value.trim(),
      note: form.note.value.trim(),
      updated: new Date().toLocaleString('zh-CN'),
    };
    writeSource(data);
    renderCaption(data);
    sourceStatus.textContent = '已保存 · ' + data.updated;
  });

  $('#btn-reset-source').addEventListener('click', function () {
    lsDel(LS.source);
    form.reset();
    renderCaption(null);
    sourceStatus.textContent = '已清空出处信息。';
  });

  /* ══════════ 2. 文章编辑器 ══════════ */
  const titleInput = $('#post-title');
  const bodyInput = $('#post-body');
  const listEl = $('#post-list');
  const emptyEl = $('#post-empty');
  const countEl = $('#post-count');
  const postStatus = $('#post-status');
  let editingId = null;

  function renderBody(md) {
    const lines = String(md).split('\n');
    let html = '', inList = false;
    for (const raw of lines) {
      const line = raw.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      if (/^#\s/.test(line)) {
        if (inList) { html += '</ul>'; inList = false; }
        html += '<strong style="font-size:1.05rem;display:block;margin-top:.6em">' + line.slice(2).trim() + '</strong>';
      } else if (/^-\s/.test(line)) {
        if (!inList) { html += '<ul style="margin:.4em 0 .4em 1.3em">'; inList = true; }
        html += '<li>' + line.slice(2).trim() + '</li>';
      } else if (line.trim() === '') {
        if (inList) { html += '</ul>'; inList = false; }
      } else {
        if (inList) { html += '</ul>'; inList = false; }
        html += '<p style="margin:.4em 0">' + line + '</p>';
      }
    }
    if (inList) html += '</ul>';
    return html;
  }

  function fmtDate(ts) {
    const d = new Date(ts);
    return d.toLocaleDateString('zh-CN') + ' ' + d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  }

  function resetEditorState() {
    titleInput.value = '';
    bodyInput.value = '';
    editingId = null;
  }

  function renderPosts() {
    const posts = readPosts();
    countEl.textContent = posts.length;
    emptyEl.style.display = posts.length ? 'none' : 'block';
    listEl.innerHTML = posts.map(function (p) {
      return '<li class="post-item" data-id="' + p.id + '">' +
        '<div class="p-head">' +
          '<div>' +
            '<h4>' + esc(p.title) + '</h4>' +
            '<div class="p-meta">' + fmtDate(p.ts) + '</div>' +
          '</div>' +
          '<div class="post-actions">' +
            '<button class="btn btn-edit" data-id="' + p.id + '">编辑</button>' +
            '<button class="btn btn-danger btn-del" data-id="' + p.id + '">删除</button>' +
          '</div>' +
        '</div>' +
        '<pre>' + renderBody(p.body) + '</pre>' +
      '</li>';
    }).join('');
    shareTools.hidden = posts.length === 0;
  }

  $('#btn-publish').addEventListener('click', function () {
    const title = titleInput.value.trim();
    if (!title) { postStatus.textContent = '⚠ 请先填写标题'; return; }
    const body = bodyInput.value.trim() || '（无正文）';
    if (editingId) {
      const origTs = readPosts().find(p => p.id === editingId)?.ts || Date.now();
      upsertPost({ id: editingId, title, body, ts: origTs });
      postStatus.textContent = '✅ 已更新「' + title + '」';
    } else {
      const id = Date.now();
      upsertPost({ id, title, body, ts: id });
      postStatus.textContent = '✅ 已发布「' + title + '」';
    }
    resetEditorState();
    renderPosts();
  });

  $('#btn-clear-post').addEventListener('click', function () {
    resetEditorState();
    postStatus.textContent = '';
  });

  listEl.addEventListener('click', function (e) {
    const t = e.target;
    const id = parseInt(t.dataset.id, 10);
    if (!id) return;
    if (t.classList.contains('btn-del')) {
      if (!confirm('确定删除这篇文章吗？删除后无法恢复。')) return;
      deletePost(id);
      if (editingId === id) { resetEditorState(); postStatus.textContent = '该文章已删除。'; }
      renderPosts();
      return;
    }
    if (t.classList.contains('btn-edit')) {
      const p = readPosts().find(x => x.id === id);
      if (!p) return;
      titleInput.value = p.title;
      bodyInput.value = p.body;
      editingId = p.id;
      postStatus.textContent = '✎ 正在编辑「' + p.title + '」，改完再点『发布文章』即保存';
      window.scrollTo({ top: $('#write-card').offsetTop - 80, behavior: 'smooth' });
    }
  });

  /* ══════════ 3. 导出 / 导入（JSON 本地备份，跨设备同步） ══════════ */
  const importFile = $('#import-file');
  const shareTools = $('#share-tools');

  $('#btn-export').addEventListener('click', function () {
    const posts = readPosts();
    if (!posts.length) { alert('还没有可导出的文章。'); return; }
    const blob = new Blob([JSON.stringify(posts, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'team-posts-' + new Date().toISOString().slice(0, 10) + '.json';
    a.click();
    URL.revokeObjectURL(a.href);
    postStatus.textContent = '💾 已导出 ' + posts.length + ' 篇（把 .json 文件发给队友，对方点「导入」即可同步）';
  });

  $('#btn-import').addEventListener('click', function () { importFile.click(); });
  importFile.addEventListener('change', function () {
    const f = this.files[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = function () {
      try {
        let raw = JSON.parse(reader.result);

        // 兼容三种导入格式：
        //   1. 纯文章数组        [ {id,title,body,ts}, ... ]
        //   2. 带包装对象        { posts: [ ... ] }
        //   3. 单篇文章对象      { id,title,body,ts }
        let incoming;
        if (Array.isArray(raw)) {
          incoming = raw;
        } else if (raw && Array.isArray(raw.posts)) {
          incoming = raw.posts;
        } else if (raw && typeof raw === 'object' && raw.title) {
          incoming = [raw];
        } else {
          throw new Error('格式不对：需要文章数组、{posts:[...]} 或单篇文章对象');
        }

        const posts = readPosts();
        const known = new Set(posts.map(p => p.id));
        let added = 0, skipped = 0;
        for (const p of incoming) {
          if (p && p.title) {
            const clean = {
              id: p.id ? Number(p.id) : Date.now() + Math.floor(Math.random() * 1000),
              title: String(p.title),
              body: String(p.body || ''),
              ts: p.ts ? Number(p.ts) : Date.now(),
            };
            if (!known.has(clean.id)) { upsertPost(clean); added++; }
            else { skipped++; }
          }
        }
        renderPosts();
        postStatus.textContent = '📥 导入完成：新增 ' + added + ' 篇，跳过 ' + skipped + ' 篇（已有的）';
      } catch (err) {
        alert('导入失败：' + (err.message || '请检查 .json 文件格式是否正确。'));
      }
      importFile.value = '';
    };
    reader.readAsText(f);
  });

  /* ══════════ 4. 背景图文件检测 ══════════ */
  (function probeFiles() {
    let found = false;
    const names = ['img/bg.jpg', 'img/bg.png'];
    function tryNext() {
      const name = names.pop();
      if (!name) { if (!found) showPlaceholderWarning(); return; }
      const probe = new Image();
      probe.onload = function () {
        if (found) return;
        found = true;
        document.querySelector('#hero').style.background =
          "url('" + name + "') center / cover no-repeat, " +
          "url('img/bg.svg') center / cover no-repeat, " +
          'linear-gradient(160deg,#0f2a52,#1e4f8f 60%,#3f2d8f)';
        tryNext();
      };
      probe.onerror = function () { tryNext(); };
      probe.src = name;
    }
    tryNext();
  })();

  function showPlaceholderWarning() {
    const c = document.createElement('div');
    c.className = 'hero-caption';
    c.style.cssText = 'position:absolute;left:.8rem;top:.8rem;right:auto;bottom:auto;z-index:1;' +
      'background:rgba(192,57,43,.85);font-size:.8rem;';
    c.textContent = '⚠ 未找到背景图 —— 把图片保存为 team\\img\\bg.jpg 或 bg.png 后刷新';
    document.querySelector('#hero').appendChild(c);
  }

  /* ══════════ 5. 淡蓝色鼠标拖尾（仅 PC / 有指针设备时启用） ══════════ */
  (function mouseTrail() {
    // 只有鼠标/触控板才启用（手机触屏不显示）
    const hasFinePointer = window.matchMedia('(pointer: fine)').matches;
    if (!hasFinePointer) return;

    const canvas = document.createElement('canvas');
    canvas.style.cssText =
      'position:fixed;top:0;left:0;width:100%;height:100%;' +
      'pointer-events:none;z-index:9999;';
    const ctx = canvas.getContext('2d');
    let W, H, DPR;

    function resize() {
      DPR = Math.min(window.devicePixelRatio || 1, 2);
      W = window.innerWidth;
      H = window.innerHeight;
      canvas.width = W * DPR;
      canvas.height = H * DPR;
      ctx.scale(DPR, DPR);
    }
    resize();
    window.addEventListener('resize', resize);
    document.body.appendChild(canvas);

    const MAX = 22;                       // 拖尾最大长度
    const dots = [];                       // 拖尾光点
    let lastMove = 0;
    let running = false;

    window.addEventListener('mousemove', function (e) {
      dots.push({ x: e.clientX, y: e.clientY, age: 0 });
      if (dots.length > MAX) dots.shift();
      lastMove = performance.now();
      if (!running) { running = true; requestAnimationFrame(tick); }
    });

    function tick() {
      const now = performance.now();
      const settled = now - lastMove > 400 && dots.length === 0;

      // 每个光点老化；老掉超过 MAX 的删掉
      for (let i = dots.length - 1; i >= 0; i--) {
        dots[i].age++;
        if (dots[i].age > MAX) dots.splice(i, 1);
      }

      ctx.clearRect(0, 0, W, H);
      for (const d of dots) {
        const t = d.age / MAX;             // 0=刚出现, 1=将消失
        const size = 14 * (1 - t);
        const alpha = 0.35 * (1 - t);
        const g = ctx.createRadialGradient(d.x, d.y, 0, d.x, d.y, size);
        g.addColorStop(0, 'rgba(150, 200, 255, ' + alpha + ')');
        g.addColorStop(0.6, 'rgba(100, 160, 255, ' + (alpha * 0.45) + ')');
        g.addColorStop(1, 'rgba(60, 120, 255, 0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(d.x, d.y, size, 0, Math.PI * 2);
        ctx.fill();
      }

      // 还有光点 或 鼠标还在动 → 继续；否则停帧
      if (dots.length || now - lastMove <= 400) {
        requestAnimationFrame(tick);
      } else {
        running = false;
      }
    }
  })();

  /* ══════════ 6. 移动端点击水波纹特效 ══════════
     手指点按钮/卡片时，从触点扩散一圈淡蓝色水波纹。
     仅在触屏设备（pointer: coarse）启用，PC 不触发。 */
  (function tapRipple() {
    const isCoarse = window.matchMedia('(pointer: coarse)').matches;
    if (!isCoarse) return;

    document.addEventListener('touchstart', function (e) {
      const t = e.changedTouches[0];
      if (!t) return;
      const x = t.clientX;
      const y = t.clientY;

      const el = document.createElement('span');
      el.className = 'tap-ripple';
      el.style.left = x + 'px';
      el.style.top = y + 'px';
      document.body.appendChild(el);

      // 动画结束移除
      el.addEventListener('animationend', function () { el.remove(); });
      // 兜底：万一动画没触发
      setTimeout(function () { el.remove(); }, 700);
    }, { passive: true });
  })();

  /* ══════════ 7. 导出 / 导入礼花特效（双端，持续 0.5s） ══════════
     点「导出」或「导入」按钮时，从按钮中心喷出一小束
     彩色纸屑，0.5s 内飘散消失。用一个独立 canvas 层实现。 */
  (function confetti() {
    const canvas = document.createElement('canvas');
    canvas.style.cssText =
      'position:fixed;top:0;left:0;width:100%;height:100%;' +
      'pointer-events:none;z-index:10000;';
    const ctx = canvas.getContext('2d');
    let W, H, DPR;

    function resize() {
      DPR = Math.min(window.devicePixelRatio || 1, 2);
      W = window.innerWidth;
      H = window.innerHeight;
      canvas.width = W * DPR;
      canvas.height = H * DPR;
      ctx.scale(DPR, DPR);
    }
    resize();
    window.addEventListener('resize', resize);
    document.body.appendChild(canvas);

    const COLORS = [
      '255, 200, 87',   // 金黄
      '100, 160, 255',  // 淡蓝
      '255, 107, 129',  // 珊瑚
      '78, 205, 196',   // 青绿
      '199, 146, 255',  // 淡紫
    ];

    let particles = [];
    let lastBurst = 0;

    function burst(x, y) {
      const COUNT = 24;
      for (let i = 0; i < COUNT; i++) {
        const angle = (Math.PI * 2 * i) / COUNT + (Math.random() - 0.5) * 0.4;
        const speed = 2 + Math.random() * 3;   // 向外速度
        particles.push({
          x: x, y: y,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed - 1.5,    // 稍微往上抛
          g: 0.12,                                // 重力
          size: 3 + Math.random() * 4,
          color: COLORS[i % COLORS.length],
          born: performance.now(),
          life: 500,                              // 0.5s
          rot: Math.random() * Math.PI,
          vrot: (Math.random() - 0.5) * 0.3,
        });
      }
      lastBurst = performance.now();
      startLoop();
    }

    let running = false;
    function startLoop() {
      if (running) return;
      running = true;
      requestAnimationFrame(loop);
    }

    function loop() {
      const now = performance.now();
      ctx.clearRect(0, 0, W, H);

      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        const t = now - p.born;
        if (t >= p.life) { particles.splice(i, 1); continue; }

        // 物理更新
        p.vy += p.g;
        p.x += p.vx;
        p.y += p.vy;
        p.rot += p.vrot;

        // 透明度：最后 200ms 渐隐
        const fade = t > p.life - 200 ? (p.life - t) / 200 : 1;

        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = 'rgba(' + p.color + ',' + fade + ')';
        ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
        ctx.restore();
      }

      if (particles.length || now - lastBurst < 600) {
        requestAnimationFrame(loop);
      } else {
        running = false;
      }
    }

    // 绑定导出 / 导入按钮
    function bind(btnId) {
      const btn = document.getElementById(btnId);
      if (!btn) return;
      btn.addEventListener('click', function () {
        const r = btn.getBoundingClientRect();
        burst(r.left + r.width / 2, r.top + r.height / 2);
      });
    }
    bind('btn-export');
    bind('btn-import');
  })();

  /* ══════════ 启动 ══════════ */
  (function boot() {
    // 载入已保存的出处
    const s = readSource();
    if (s) {
      fillForm(s);
      sourceStatus.textContent = '上次保存：' + (s.updated || '未知时间');
    }
    renderCaption(s);
    renderPosts();
  })();
})();
