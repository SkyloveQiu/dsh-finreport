# dsh-im 全通道主动发送补丁 (bot.sendText)

给 `@xmanrui/dsh-im`（0.2.2）的**全部 8 个 IM 通道**新增 `bot.sendText` 端点，
使机器人可以主动推送消息（原生插件只有"收到消息后回复"的能力）：

| 通道 | RPC 端点 | target 结构 |
|---|---|---|
| whatsapp | `POST /whatsapp/bot.sendText` | `{ botId, jid, text }` |
| telegram | `POST /telegram/bot.sendText` | `{ botId, target: { chatId }, text }` |
| discord | `POST /discord/bot.sendText` | `{ botId, target: { channelId }, text }` |
| feishu | `POST /feishu/bot.sendText` | `{ botId, target: { receiveId, receiveIdType? }, text }` |
| dingtalk | `POST /dingtalk/bot.sendText` | `{ botId, target: { sessionWebhook }, text }` |
| wecom | `POST /wecom/bot.sendText` | `{ botId, target: { chatId }, text }` |
| qq | `POST /qq/bot.sendText` | `{ botId, target: { openid } 或 { group_openid }, text }` |
| weixin | `POST /weixin/bot.sendText` | `{ botId, target: { toUserId }, text }` |

统一响应：`{ "ok": true, "value": { "sent": true, "botId": "…" } }`；
未连接时返回 `{ "ok": false, "error": { "code": "not-connected" } }`。

## 应用方式

本目录按 `@xmanrui/dsh-im` 的包内路径镜像存放补丁后的文件，把每个文件覆盖到
`node_modules/@xmanrui/dsh-im` 对应路径后重建 bundle：

```sh
D=node_modules/@xmanrui/dsh-im
P=path/to/patch/dsh-im
cp -r $P/src/*        $D/src/
cp -r $P/plugin-src/* $D/plugin-src/
cd $D && npm install --no-save esbuild @whiskeysockets/baileys@7.0.0-rc14
node plugin-src/host/build.mjs
```

## 改动摘要（每个通道 3 处，token 类共享 1 处）

- **runtime**（`src/channels/<ch>/<ch>-runtime.mjs`）：新增 `async sendText(target, text)`，
  校验连接状态与参数后经实时客户端发送（与对应 bridge 相同的发送原语），返回 `{ sent: true }`
- **controller**（`src/channels/<ch>/<ch>-controller.mjs`）：新增
  `async sendText(botId, target, text)`，按 botId 找到对应 runtime，未连接/不支持时抛错
- **rpc**（`plugin-src/host/channels/<ch>/rpc.mjs` 或 shared/rpc.mjs）：注册端点
  `bot.sendText`，校验 `{botId, target, text}`，接线到 controller.sendText
- Telegram/Discord 共用 `src/channels/shared/token-bot-controller.mjs` 与
  `plugin-src/host/channels/shared/rpc.mjs`，一次补丁覆盖两通道

## 发送原语参考

- whatsapp: `socket.sendMessage(jid, { text })`（Baileys）
- telegram: `api.sendMessage({ chatId, text, … })`（Bot API）
- discord: `api.createMessage({ channelId, content, … })`
- feishu: `client.im.v1.message.create({ params: { receive_id_type: 'chat_id' }, data: { receive_id, msg_type: 'text', content } })`
- dingtalk: `api.sendText({ clientId, clientSecret, sessionWebhook, text, signal })`
- wecom: `client.sendMessage(chatId, { msgtype: 'markdown', markdown: { content } })`
- qq: `bot.sendText({ scope: 'c2c'|'group', targetId, msgId? }, text)`
- weixin: `api.sendText({ baseUrl, token, toUserId, text, signal })`
