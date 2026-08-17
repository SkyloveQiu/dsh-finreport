# 📊 dsh-finreport

**每日财经日报** — DeepSeek Harness (DSH) 插件：用免费数据源自动生成财经日报
（**中/英双语**），按计划定时推送到已接入的任意 IM 通道；也支持在聊天内随时要求
机器人发送日报。

## 特性

- 🌐 **全球市场**：美股 / 欧股（含荷兰 AEX）/ 亚洲指数、外汇、黄金原油、比特币以太坊
- 📰 **今日要闻**：Google News 聚合（美股 / 宏观 / 欧洲 / 亚洲），来源权重 + 时效排序
- 📅 **宏观日历**：FOMC / ECB 等央行会议日程（2026 已核实，`events.json` 可维护，含英文名）
- 🌍 **双语**：每投递目标可独立配置 `zh`（中文）或 `en`（English），指令可临时指定
- ⏰ **每目标独立定时**：每个机器人/目标可拥有自己的发送时间与时区（DST 安全，无需 cron）
- 💬 **聊天内随时触发**：向任意已接入的机器人发送"日报 / 英文日报"等指令，
  其 agent 会调用 `finreport_send` 工具即时生成并推送（语言可临时指定）
- 🔌 **RPC 端点**：`report.generate` / `report.send` / `report.status`
- 🖥 **设置页**：Web GUI「设置 → 插件 → 财经日报」查看状态、生成预览、立即发送（可选语言）
- 🚫 无任何第三方运行时依赖（仅 Node 内置 `fetch`），数据源全部免费、无需 API Key

## 依赖

- DeepSeek Harness `dsh web`（`@deepseek-ai/dsh-base` 提供 timer 与 tools 服务）
- IM 主动发送：**dsh-im 各通道的 `bot.sendText` 主动发送端点**（8 通道全支持：
  WhatsApp / Telegram / Discord / 飞书 / 钉钉 / 企业微信 / QQ / 微信）。
  `@xmanrui/dsh-im@0.2.2` 原生只有"响应式"回复，需要打补丁（见 `patch/dsh-im/`），
  或在插件配置中提供自定义 `deliver` 函数。

### dsh-im 补丁（全通道主动发送）

给 `@xmanrui/dsh-im` 的全部通道增加 `bot.sendText` 端点
（`POST /<channel>/bot.sendText`，payload `{botId, target, text}`；
WhatsApp 为 `{botId, jid, text}`）。补丁文件按包内路径镜像在
[`patch/dsh-im/`](patch/dsh-im/)，README 内有应用步骤与各通道 target 结构表。

## 安装

```sh
# 从本地/私有源安装
dsh plugin --profile web add file:/path/to/dsh-finreport

# 或从 GitHub（发布后）
dsh plugin --profile web add github:你的用户名/dsh-finreport
```

重启 `dsh web`，打开「设置 → 插件 → 财经日报」即可看到设置页。

## 配置

插件配置通过 profile 的 `cordis.patch.yml` 覆盖。投递目标为**数组**，每项目标
可独立指定通道、语言、发送时间与时区：

```yaml
- id: dsh-finreport
  config:
    schedule: "08:00"              # 全局默认发送时间（目标未指定 schedule 时使用）
    timezone: Europe/Amsterdam     # 全局默认时区（自动处理 DST）
    enabled: true
    maxNews: 8
    dataDir: ~/.dsh/integrations/dsh-finreport   # 状态与 events.json 所在目录
    baseUrl: http://127.0.0.1:3080               # 本机 dsh web 地址
    delivery:
      - channel: whatsapp                        # WhatsApp
        botId: whatsapp_xxxxxxxxxxxxxxxx
        jid: "31xxxxxxxxx@lid"
        language: zh                             # zh | en
        schedule: "08:00"                        # 可选：本目标独立发送时间
        timezone: Europe/Amsterdam               # 可选：本目标独立时区
      - channel: telegram                        # Telegram
        botId: telegram_xxxxxxxxxxxxxxxx
        chatId: 123456789
        language: en                             # 这个机器人每天发英文日报
        schedule: "09:30"
        timezone: Asia/Shanghai
      # 其他通道见 patch/dsh-im/README.md 的 target 结构表
    # deliver: (text) => Promise<{sent: true}>   # 可选：自定义投递函数（完全接管发送）
```

`botId` 可在「设置 → 插件 → IM机器人」页面查看对应机器人的 id；各通道的 target
（chatId/channelId/receiveId 等）来自对应平台的会话标识。旧配置
`whatsapp: { baseUrl, botId, jid }` 仍然兼容。

首次运行时会在 `dataDir` 生成 `events.json`（2026 央行会议日程 + 月度常规说明），
可自行增补其他宏观事件（`nameEn` 字段用于英文日报）；修改后立即生效，无需重启。

## 聊天内触发（finreport_send 工具）

插件会向 agent 注册 `finreport_send` 工具。任何已接入的机器人会话（WhatsApp /
Telegram / Discord / …）里，向机器人发送类似指令即可即时获取日报：

```
日报
英文日报
send the daily report in English
```

机器人背后的 agent 会调用 `finreport_send`：默认把日报发回**当前对话**（按发起会话
所在通道与机器人投递，语言取该机器人的配置，指令可临时指定），若无法定位当前会话
则发送到全部配置目标。

工具参数：

| 参数 | 说明 |
|---|---|
| `language` | `'zh'`（中文）或 `'en'`（English）；缺省用目标的配置语言 |
| `target` | 可选：投递目标下标（见 `report.status`）或 `'all'`；缺省为当前会话 |

## RPC 端点（`/finreport` 通道）

| 端点 | 请求 | 响应 |
|---|---|---|
| `report.generate` | `{language?, maxNews?}` | `{text}` 报告全文 |
| `report.send` | `{language?, target?}` | 生成并推送 `{targets: [{channel, botId, sent, language}]}`；同日已发则 `{skipped}` |
| `report.status` | `{}` | 每目标调度/语言/最近发送/下次运行/工具注册状态 |

示例（本地调用）：

```sh
curl -X POST http://127.0.0.1:3080/finreport/report.send \
  -H 'Content-Type: application/json' \
  -d '{"type":"client-request","rpcId":"demo","method":"report.send","payload":{"language":"en"}}'
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
│   ├── index.mjs      # cordis 插件：RPC + 每目标调度 + agent 工具 + 状态持久化
│   ├── report.mjs     # 日报生成（中英双语；Yahoo / CoinGecko / Google News）
│   ├── delivery.mjs   # 多通道投递（8 通道 payload 翻译；会话→目标转换）
│   ├── session-map.mjs# 会话 id → (通道, 机器人, 对话) 反查（聊天内触发）
│   └── test.mjs       # 功能自测
└── client/
    └── index.js       # Web 设置页（状态 / 语言选择 / 生成预览 / 立即发送）
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
- 聊天内触发依赖 dsh-im 的状态文件做会话反查；钉钉等个别通道的会话 id 无法直接
  作为投递目标时，会回退为发送到全部配置目标

## License

MIT
