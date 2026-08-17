# 📊 dsh-finreport

**每日财经日报** — DeepSeek Harness (DSH) 插件：用免费数据源自动生成中文财经日报，
按计划定时通过 WhatsApp 推送给你。

> 最早以脚本形式运行于阿姆斯特丹的 DSH 实例（08:00 Europe/Amsterdam 推送），
> 本仓库将其封装为可安装、可发布的 DSH 插件。

## 特性

- 🌐 **全球市场**：美股 / 欧股（含荷兰 AEX）/ 亚洲指数、外汇、黄金原油、比特币以太坊
- 📰 **今日要闻**：Google News 聚合（美股 / 宏观 / 欧洲 / 亚洲），来源权重 + 时效排序
- 📅 **宏观日历**：FOMC / ECB 等央行会议日程（2026 已核实，`events.json` 可维护）
- ⏰ **内置调度**：每天定时（默认 08:00 Europe/Amsterdam），DST 安全，无需外部 cron
- 🔌 **RPC 端点**：`report.generate` / `report.send` / `report.status`
- 🖥 **设置页**：Web GUI「设置 → 插件 → 财经日报」查看状态、生成预览、立即发送
- 🚫 无任何第三方运行时依赖（仅 Node 内置 `fetch`），数据源全部免费、无需 API Key

## 依赖

- DeepSeek Harness `dsh web`（含 `@deepseek-ai/dsh-base` 提供的 timer 服务）
- WhatsApp 投递：**dsh-im 的 `bot.sendText` 主动发送端点**。
  `@xmanrui/dsh-im@0.2.2` 原生只有"响应式"回复，需要打补丁（见下文），
  或在插件配置中提供自定义 `deliver` 函数 / 其他通道。

### dsh-im 补丁（WhatsApp 主动发送）

给 `@xmanrui/dsh-im` 增加 `bot.sendText` 端点（`POST /whatsapp/bot.sendText`，
payload `{botId, jid, text}`）。补丁内容：

- `src/channels/whatsapp/whatsapp-runtime.mjs`：`WhatsappRuntime.sendText()`
- `src/channels/whatsapp/whatsapp-controller.mjs`：`WhatsappController.sendText()`
- `plugin-src/host/channels/whatsapp/rpc.mjs`：注册端点 `bot.sendText`

可直接使用本仓库 `patch/` 目录下的补丁文件，或参考
[vendor/dsh-im](https://github.com/xmanrui/dsh-im) 的对应源码。

## 安装

```sh
# 从本地/私有源安装
dsh plugin --profile web add file:/path/to/dsh-finreport

# 或从 GitHub（发布后）
dsh plugin --profile web add github:你的用户名/dsh-finreport
```

重启 `dsh web`，打开「设置 → 插件 → 财经日报」即可看到设置页。

## 配置

插件配置通过 profile 的 `cordis.patch.yml` 覆盖（参考 dsh-im 的写法）：

```yaml
- id: dsh-finreport
  config:
    schedule: "08:00"              # 每日发送时间（目标时区墙钟时间）
    timezone: Europe/Amsterdam     # 目标时区（自动处理 DST）
    enabled: true
    maxNews: 8
    dataDir: ~/.dsh/integrations/dsh-finreport   # 状态与 events.json 所在目录
    whatsapp:
      baseUrl: http://127.0.0.1:3080
      botId: whatsapp_xxxxxxxxxxxxxxxx   # 你的 WhatsApp 机器人 id
      jid: "31xxxxxxxxx@lid"             # 接收日报的会话 jid
    # deliver: (text) => Promise<{sent: true}>   # 可选：自定义投递函数
```

首次运行时会在 `dataDir` 生成 `events.json`（2026 央行会议日程 + 月度常规说明），
可自行增补其他宏观事件；修改后立即生效，无需重启。

## RPC 端点（`/finreport` 通道）

| 端点 | 请求 | 响应 |
|---|---|---|
| `report.generate` | `{}` 或 `{maxNews}` | `{text}` 报告全文 |
| `report.send` | `{}` | 生成并推送 `{sent, jid, date}`；同日已发则 `{skipped}` |
| `report.status` | `{}` | 调度/最近发送/下次运行/上次错误 |

示例（本地调用）：

```sh
curl -X POST http://127.0.0.1:3080/finreport/report.send \
  -H 'Content-Type: application/json' \
  -d '{"type":"client-request","rpcId":"demo","method":"report.send","payload":{}}'
```

## 开发

```sh
npm install        # esbuild / react（仅构建需要）
npm run build      # 构建 lib/index.js 与 lib/client.js
npm test           # 功能自测（含真实网络生成，需可访问 Yahoo/Google News）
```

结构：

```
plugin-src/
├── host/
│   ├── index.mjs      # cordis 插件：RPC 通道 + 定时调度 + 状态持久化
│   ├── report.mjs     # 日报生成（Yahoo Finance / CoinGecko / Google News RSS）
│   ├── delivery.mjs   # 投递适配（默认 dsh-im bot.sendText 端点）
│   └── test.mjs       # 功能自测
└── client/
    └── index.js       # Web 设置页（状态 / 生成预览 / 立即发送）
```

## 推送到 GitHub

```sh
git init
git add -A
git commit -m "feat: dsh-finreport — daily financial report plugin"
# 在 GitHub 新建空仓库（如 dsh-finreport），然后：
git remote add origin git@github.com:你的用户名/dsh-finreport.git
git push -u origin main
```

发布后即可通过 `dsh plugin --profile web add github:你的用户名/dsh-finreport` 安装。

## 数据源与局限

- Yahoo Finance 免费接口偶有限流（内置重试与降级：加密走 CoinGecko）
- Google News 按主题查询，个别标题可能有噪音，可在 `report.mjs` 调整 `NEWS_QUERIES`
- 宏观日历为静态配置（FOMC/ECB 2026 已核实），非自动抓取；CPI/非农等以
  "月度常规"说明形式给出，可按需增补 `events.json`

## License

MIT
