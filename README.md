# 游戏部聊天室（chat/）

QQ 风格跨设备聊天室：纯静态前端 + Cloudflare Worker 后端。
双击 `index.html` 即可本地使用；配上后端后两个不同设备打开同一房间
即可实时聊天。

## 目录结构

```
chat/
├── index.html        主页（会话列表 + 聊天窗口 + 表情 + 头像 + 群聊）
├── css/style.css     QQ 风格响应式样式（手机/电脑都适配）
├── js/app.js         交互逻辑（轮询后端 / 发消息 / 房间切换 / 表情）
└── README.md         本说明
```

## 前端怎么打开

**本地**：双击 `index.html`。

**线上**（大陆可访问）：
- 后端：`https://chat.ttals.dpdns.org`
- 前端：`https://12919191.github.io/team/chat/`

打开前端后右上角会显示「已连接 chat.ttals.dpdns.org」（绿点）。

## 后端配置

后端是 Cloudflare Worker（`game-dept-team`），聊天 API 已部署在：
`https://game-dept-team.2215417760.workers.dev`（海外 / 有梯子的设备）
`https://chat.ttals.dpdns.org`（大陆自定义域名，DNS 已配好 CNAME）

前端 `js/app.js` 里 `WORKER` 写的是自定义域名，连不上会自动切到
`.workers.dev`。两个地址都能访问时，自动走自定义域名（大陆优先）。

## 聊天怎么用

1. 打开 `index.html`（本地）或线上地址
2. 左上角填房间名（默认 `game-dept`），点「切换」
3. 输入框写消息，Enter 发送（Shift+Enter 换行）
4. 点 😊 出表情选择器
5. 点「🔗 分享」复制房间链接（`?room=xxx`），发给队友
6. 队友打开同样链接、进同样房间，2 秒内就能看到你的消息

## 关于数据

- 消息存 Cloudflare KV（`chat.<房间>.msgs`），保留最近 200 条
- 每个设备一个稳定 `uid`（存 localStorage）
- 切房间 = 换 KV 键，消息独立不串
- 轮询间隔 2 秒，消息延迟 ≤2 秒

## 技术栈

- 原生 HTML + CSS + JS，零依赖
- Cloudflare Workers + KV（后端）
- 双通道：自定义域名（大陆）→ .workers.dev（海外）自动切换
- 响应式布局，移动端自动单列
