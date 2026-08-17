# dsh-im WhatsApp 主动发送补丁

给 `@xmanrui/dsh-im`（0.2.2）新增 `bot.sendText` 端点，使机器人可以主动推送消息
（原生插件只有"收到消息后回复"的能力）。

## 应用方式

把三个文件替换到 `node_modules/@xmanrui/dsh-im` 对应路径后重建 bundle：

```sh
cp patch/dsh-im/whatsapp-runtime.mjs   <dsh-im>/src/channels/whatsapp/whatsapp-runtime.mjs
cp patch/dsh-im/whatsapp-controller.mjs <dsh-im>/src/channels/whatsapp/whatsapp-controller.mjs
cp patch/dsh-im/whatsapp-rpc.mjs        <dsh-im>/plugin-src/host/channels/whatsapp/rpc.mjs
cd <dsh-im> && npm install --no-save esbuild @whiskeysockets/baileys@7.0.0-rc14
node plugin-src/host/build.mjs
```

## 改动摘要

- `WhatsappRuntime.sendText({jid, text})`：通过在线 Baileys socket 发送文本
- `WhatsappController.sendText(botId, jid, text)`：路由到对应机器人的 runtime
- RPC 端点 `bot.sendText`：`POST /whatsapp/bot.sendText`
  payload `{botId, jid, text}`，响应 `{sent: true, jid}`
