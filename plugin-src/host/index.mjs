// dsh-finreport — host 插件
// 职责:
//   1) 注册 /finreport RPC 通道（report.generate / report.send / report.status）
//   2) 每投递目标独立定时调度（各自的 schedule + timezone，DST 安全），由 timer 服务驱动
//   3) 中/英双语日报生成（每目标可配置 language，指令可临时覆盖）
//   4) 注册 agent 工具 finreport_send：任意 IM 会话内可要求机器人即时发送日报
//   5) 状态持久化到 dataDir

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

import { generateReport } from './report.mjs';
import {
  normalizeTargets,
  describeTargets,
  sendToTarget,
  conversationTarget,
} from './delivery.mjs';
import { findConversationBySession } from './session-map.mjs';

export const name = 'dsh-finreport-host';
export const inject = ['connection', 'timer', 'tools'];

export const FINREPORT_RPC_CHANNEL = '/finreport';
export const FINREPORT_ENDPOINTS = Object.freeze({
  generate: 'report.generate',
  send: 'report.send',
  status: 'report.status',
});

// 默认宏观日历（2026 央行会议，已核实日期；可用 dataDir/events.json 覆盖）
export const DEFAULT_EVENTS = [
  { date: '2026-01-27', end: '2026-01-28', name: '美联储FOMC议息会议', nameEn: 'US FOMC Meeting', country: 'US', detail: '利率决议美东 1/28 14:00' },
  { date: '2026-02-04', end: '2026-02-05', name: '欧洲央行(ECB)利率决议', nameEn: 'ECB Rate Decision', country: 'EU', detail: '决议 2/5 法兰克福 14:15' },
  { date: '2026-03-17', end: '2026-03-18', name: '美联储FOMC议息会议', nameEn: 'US FOMC Meeting', country: 'US', detail: '利率决议美东 3/18 14:00' },
  { date: '2026-03-18', end: '2026-03-19', name: '欧洲央行(ECB)利率决议', nameEn: 'ECB Rate Decision', country: 'EU', detail: '决议 3/19 法兰克福 14:15' },
  { date: '2026-04-28', end: '2026-04-29', name: '美联储FOMC议息会议', nameEn: 'US FOMC Meeting', country: 'US', detail: '利率决议美东 4/29 14:00' },
  { date: '2026-04-29', end: '2026-04-30', name: '欧洲央行(ECB)利率决议', nameEn: 'ECB Rate Decision', country: 'EU', detail: '决议 4/30 法兰克福 14:15' },
  { date: '2026-06-10', end: '2026-06-11', name: '欧洲央行(ECB)利率决议', nameEn: 'ECB Rate Decision', country: 'EU', detail: '决议 6/11 法兰克福 14:15' },
  { date: '2026-06-16', end: '2026-06-17', name: '美联储FOMC议息会议', nameEn: 'US FOMC Meeting', country: 'US', detail: '利率决议美东 6/17 14:00' },
  { date: '2026-07-22', end: '2026-07-23', name: '欧洲央行(ECB)利率决议', nameEn: 'ECB Rate Decision', country: 'EU', detail: '决议 7/23 法兰克福 14:15' },
  { date: '2026-07-28', end: '2026-07-29', name: '美联储FOMC议息会议', nameEn: 'US FOMC Meeting', country: 'US', detail: '利率决议美东 7/29 14:00' },
  { date: '2026-09-09', end: '2026-09-10', name: '欧洲央行(ECB)利率决议', nameEn: 'ECB Rate Decision', country: 'EU', detail: '决议 9/10 法兰克福 14:15' },
  { date: '2026-09-15', end: '2026-09-16', name: '美联储FOMC议息会议', nameEn: 'US FOMC Meeting', country: 'US', detail: '利率决议美东 9/16 14:00' },
  { date: '2026-10-27', end: '2026-10-28', name: '美联储FOMC议息会议', nameEn: 'US FOMC Meeting', country: 'US', detail: '利率决议美东 10/28 14:00' },
  { date: '2026-10-28', end: '2026-10-29', name: '欧洲央行(ECB)利率决议', nameEn: 'ECB Rate Decision', country: 'EU', detail: '决议 10/29 法兰克福 14:15' },
  { date: '2026-12-08', end: '2026-12-09', name: '美联储FOMC议息会议', nameEn: 'US FOMC Meeting', country: 'US', detail: '利率决议美东 12/9 14:00' },
  { date: '2026-12-16', end: '2026-12-17', name: '欧洲央行(ECB)利率决议', nameEn: 'ECB Rate Decision', country: 'EU', detail: '决议 12/17 法兰克福 14:15' },
];
export const DEFAULT_MONTHLY_NOTE =
  '每月常规数据（约）：美国非农就业报告（首个周五）· 美国CPI（月中，以BLS公布为准）· 中国LPR（每月20日前后）· OPEC+ 月度产量会议';
export const DEFAULT_MONTHLY_NOTE_EN =
  'Monthly recurring (approx.): US Nonfarm Payrolls (first Friday) · US CPI (mid-month, per BLS) · China LPR (around the 20th) · OPEC+ monthly output meeting';

// ---------------------------------------------------------------- 时区工具

function zonedParts(ts, tz) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(new Date(ts));
  const get = (t) => Number(parts.find((p) => p.type === t).value);
  return { y: get('year'), mo: get('month'), d: get('day'), h: get('hour'), mi: get('minute'), s: get('second') };
}

function tzOffsetMs(ts, tz) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'longOffset' })
    .formatToParts(new Date(ts));
  const name = (parts.find((p) => p.type === 'timeZoneName')?.value ?? '').trim();
  const mm = name.match(/(\d{1,2})(?::(\d{2}))?/);
  if (!mm) return 0;
  const sign = name.startsWith('GMT-') ? -1 : 1;
  return sign * ((Number(mm[1]) * 60 + Number(mm[2] ?? 0)) * 60000);
}

/** 计算下一次 HH:MM（目标时区墙钟时间）对应的 UTC 毫秒时间戳。DST 安全。 */
export function nextRunMs(now = new Date(), hhmm = '08:00', tz = 'Europe/Amsterdam') {
  const [h, m] = String(hhmm).split(':').map(Number);
  if (!Number.isInteger(h) || !Number.isInteger(m) || h < 0 || h > 23 || m < 0 || m > 59) {
    throw new Error(`invalid schedule time: ${hhmm}`);
  }
  for (let off = 0; off < 4; off += 1) {
    const day = new Date(now.getTime() + off * 864e5);
    const p = zonedParts(day.getTime(), tz);
    const utcCandidate = Date.UTC(p.y, p.mo - 1, p.d, h, m);
    const instant = utcCandidate - tzOffsetMs(utcCandidate, tz);
    if (instant > now.getTime()) return instant;
  }
  throw new Error('unable to compute next run time');
}

// ---------------------------------------------------------------- 状态

function defaultDataDir(config) {
  return config?.dataDir
    ?? join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'integrations', 'dsh-finreport');
}

export class FinreportStore {
  constructor(dir) { this.dir = dir; }
  statePath() { return join(this.dir, 'state.json'); }
  eventsPath() { return join(this.dir, 'events.json'); }

  async init({ events, monthlyNote, monthlyNoteEn }) {
    await mkdir(this.dir, { recursive: true, mode: 0o700 });
    try {
      await readFile(this.eventsPath(), 'utf8');
    } catch {
      await writeFile(this.eventsPath(), JSON.stringify({
        events: events ?? DEFAULT_EVENTS,
        monthlyNote: monthlyNote ?? DEFAULT_MONTHLY_NOTE,
        monthlyNoteEn: monthlyNoteEn ?? DEFAULT_MONTHLY_NOTE_EN,
      }, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 });
    }
  }

  async loadEvents() {
    try {
      const raw = JSON.parse(await readFile(this.eventsPath(), 'utf8'));
      return {
        events: Array.isArray(raw.events) ? raw.events : DEFAULT_EVENTS,
        monthlyNote: typeof raw.monthlyNote === 'string' ? raw.monthlyNote : DEFAULT_MONTHLY_NOTE,
        monthlyNoteEn: typeof raw.monthlyNoteEn === 'string' ? raw.monthlyNoteEn : DEFAULT_MONTHLY_NOTE_EN,
      };
    } catch {
      return { events: DEFAULT_EVENTS, monthlyNote: DEFAULT_MONTHLY_NOTE, monthlyNoteEn: DEFAULT_MONTHLY_NOTE_EN };
    }
  }

  async loadState() {
    try {
      return JSON.parse(await readFile(this.statePath(), 'utf8')) ?? {};
    } catch {
      return {};
    }
  }

  async saveState(patch) {
    const next = { ...(await this.loadState()), ...patch };
    await writeFile(this.statePath(), JSON.stringify(next, null, 2) + '\n', {
      encoding: 'utf8', mode: 0o600,
    });
    return next;
  }
}

// ---------------------------------------------------------------- RPC

function isRecord(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }
function exactKeys(v, allowed) { return isRecord(v) && Object.keys(v).every((k) => allowed.includes(k)); }
function validLanguage(v) { return v === undefined || v === 'zh' || v === 'en'; }
function validTarget(v) { return v === undefined || v === 'all' || (typeof v === 'number' && Number.isInteger(v) && v >= 0); }

export function createFinreportRpcHandler(api, { status = () => ({}) } = {}) {
  for (const method of ['generate', 'send', 'status']) {
    if (typeof api[method] !== 'function') throw new TypeError(`finreport api missing ${method}`);
  }
  const bad = (message) => ({ ok: false, error: { code: 'bad-request', message } });
  return async (endpoint, payload) => {
    if (!Object.values(FINREPORT_ENDPOINTS).includes(endpoint)) {
      return bad('Unknown finreport endpoint.');
    }
    if (!isRecord(payload)) return bad('Payload must be an object.');
    if (endpoint === FINREPORT_ENDPOINTS.generate) {
      if (!exactKeys(payload, ['language', 'maxNews']) || !validLanguage(payload.language)) {
        return bad('report.generate accepts only { language?: "zh"|"en", maxNews?: number }.');
      }
    } else if (endpoint === FINREPORT_ENDPOINTS.send) {
      if (!exactKeys(payload, ['language', 'target']) || !validLanguage(payload.language)
        || !validTarget(payload.target)) {
        return bad('report.send accepts only { language?: "zh"|"en", target?: number|"all" }.');
      }
    } else if (!exactKeys(payload, [])) {
      return bad('report.status does not accept fields.');
    }
    try {
      let value;
      if (endpoint === FINREPORT_ENDPOINTS.generate) value = { text: await api.generate(payload) };
      else if (endpoint === FINREPORT_ENDPOINTS.send) value = await api.send(payload);
      else value = await status();
      return { ok: true, value };
    } catch (error) {
      return {
        ok: false,
        error: { code: error?.code ?? 'finreport-operation-failed', message: String(error?.message ?? error) },
      };
    }
  };
}

// ---------------------------------------------------------------- 插件

export async function apply(ctx, config = {}) {
  const globalSchedule = config.schedule ?? '08:00';
  const globalTimeZone = config.timezone ?? 'Europe/Amsterdam';
  const enabled = config.enabled !== false;
  const maxNews = config.maxNews ?? 8;
  const baseUrl = (config?.baseUrl ?? config?.whatsapp?.baseUrl ?? 'http://127.0.0.1:3080').replace(/\/$/, '');
  const dir = resolve(defaultDataDir(config));
  const store = new FinreportStore(dir);
  await store.init({ events: config.events, monthlyNote: config.monthlyNote, monthlyNoteEn: config.monthlyNoteEn });
  const log = typeof ctx.logger === 'function' ? ctx.logger('dsh-finreport') : console;
  const targets = normalizeTargets(config);
  if (!targets.length) {
    log.warn?.('no delivery targets configured (set config.delivery or config.whatsapp)');
  }

  let lastError = null;
  let running = false;
  const timers = new Map(); // target index -> timer dispose
  let toolDispose = null;

  const todayInTz = (tz) => {
    const p = zonedParts(Date.now(), tz);
    return `${p.y}-${String(p.mo).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`;
  };
  const targetLanguage = (t, override) => {
    const lang = String(override ?? t.language ?? 'zh').toLowerCase();
    return lang === 'en' || lang === 'english' ? 'en' : 'zh';
  };

  const generate = async (payload = {}) => {
    const cal = await store.loadEvents();
    return generateReport({
      events: cal.events,
      monthlyNote: cal.monthlyNote,
      monthlyNoteEn: cal.monthlyNoteEn,
      timeZone: globalTimeZone,
      maxNews: Number.isInteger(payload?.maxNews) ? payload.maxNews : maxNews,
      language: payload?.language ?? 'zh',
    });
  };

  /** 向单个目标发送日报（可临时指定语言）。 */
  const sendOne = async (idx, { language } = {}) => {
    const t = targets[idx];
    if (!t) {
      const err = new Error(`delivery target ${idx} not found`);
      err.code = 'bad-target';
      throw err;
    }
    const lang = targetLanguage(t, language);
    const text = await generate({ language: lang, maxNews });
    const result = await sendToTarget({
      baseUrl: t.baseUrl ?? baseUrl,
      channel: t.channel,
      target: t,
      text,
    });
    return { ...result, language: lang, date: todayInTz(t.timezone ?? globalTimeZone) };
  };

  /** 向一个或多个目标发送；record=true 时记录状态（幂等防重发，按目标记录）。 */
  const run = async (payload = {}) => {
    if (running) return { skipped: true, reason: 'already running' };
    running = true;
    try {
      // 自定义投递函数（若配置了 deliver，则完全接管发送）
    if (typeof config.deliver === 'function') {
      const language = payload?.language;
      const today = todayInTz(globalTimeZone);
      const state = await store.loadState();
      if (state.lastSentDate === today) {
        return { targets: [{ skipped: true, reason: `already sent for ${today}` }] };
      }
      const text = await generate({ language });
      await config.deliver(text);
      await store.saveState({ lastSentDate: today, lastSentAt: new Date().toISOString() });
      lastError = null;
      return { targets: [{ sent: true, language: targetLanguage({}, language), custom: true }] };
    }
    const language = payload?.language;
      const pick = payload?.target;
      const idxs = pick === undefined || pick === 'all'
        ? targets.map((_, i) => i)
        : [Number(pick)];
      const results = [];
      for (const idx of idxs) {
        const t = targets[idx];
        if (!t) {
          results.push({ target: idx, error: 'target not found' });
          continue;
        }
        const today = todayInTz(t.timezone ?? globalTimeZone);
        const state = await store.loadState();
        const key = `${t.channel}:${t.botId}`;
        const sentToday = state.sentByTarget?.[key] === today;
        if (sentToday) {
          results.push({ target: idx, channel: t.channel, botId: t.botId, skipped: true, reason: `already sent for ${today}` });
          continue;
        }
        try {
          const res = await sendOne(idx, { language });
          await store.saveState({
            sentByTarget: { ...(state.sentByTarget ?? {}), [key]: today },
            lastSentDate: today,
            lastSentAt: new Date().toISOString(),
          });
          results.push({ target: idx, channel: res.channel, botId: res.botId, sent: true, language: res.language });
        } catch (error) {
          results.push({ target: idx, channel: t.channel, botId: t.botId, sent: false, error: String(error?.message ?? error) });
        }
      }
      lastError = null;
      return { targets: results };
    } catch (error) {
      lastError = String(error?.message ?? error);
      throw error;
    } finally {
      running = false;
    }
  };

  // ---- 每目标独立定时 ----

  const clearTimers = () => {
    for (const dispose of timers.values()) dispose();
    timers.clear();
  };

  const scheduleTarget = (idx) => {
    const t = targets[idx];
    if (!t || !enabled) return null;
    const tz = t.timezone ?? globalTimeZone;
    const sched = t.schedule ?? globalSchedule;
    let ms;
    try {
      ms = nextRunMs(new Date(), sched, tz) - Date.now();
    } catch (error) {
      lastError = `schedule[${idx}]: ${error.message}`;
      return null;
    }
    const prev = timers.get(idx);
    if (prev) prev();
    const nextAt = new Date(Date.now() + ms).toISOString();
    const dispose = ctx.timer.timeout(async () => {
      timers.delete(idx);
      try {
        await run({ target: idx });
      } catch (error) {
        log.warn?.(`target ${idx} scheduled run failed: ${String(error?.message ?? error)}`);
      } finally {
        scheduleTarget(idx);
      }
    }, ms);
    timers.set(idx, dispose);
    return nextAt;
  };

  const scheduleAll = () => {
    clearTimers();
    if (!enabled) return;
    targets.forEach((_, i) => scheduleTarget(i));
  };

  // ---- RPC API ----

  const status = async () => {
    const state = await store.loadState();
    const now = Date.now();
    const perTarget = targets.map((t, i) => {
      const tz = t.timezone ?? globalTimeZone;
      const sched = t.schedule ?? globalSchedule;
      let next = null;
      try {
        next = new Date(nextRunMs(new Date(), sched, tz)).toISOString();
      } catch { /* ignore */ }
      return {
        index: i,
        channel: t.channel,
        botId: t.botId,
        language: targetLanguage(t),
        schedule: sched,
        timezone: tz,
        nextRunAt: next,
        lastSentDate: state.sentByTarget?.[`${t.channel}:${t.botId}`] ?? null,
      };
    });
    return {
      enabled,
      schedule: globalSchedule,
      timezone: globalTimeZone,
      maxNews,
      dataDir: dir,
      baseUrl,
      targets: perTarget,
      deliveryTargets: describeTargets(config),
      lastSentDate: state.lastSentDate ?? null,
      lastSentAt: state.lastSentAt ?? null,
      lastError,
      running,
      toolRegistered: toolDispose !== null,
      now,
    };
  };

  const api = { generate, send: (p = {}) => run(p), status };

  const disposeRpc = ctx.connection.rpc.handle(
    FINREPORT_RPC_CHANNEL,
    createFinreportRpcHandler(api, { status }),
    { authority: config.rpcAuthority ?? 'loopback' },
  );

  // ---- agent 工具：聊天内触发 ----

  if (ctx.tools?.register) {
    const render = (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }];
    toolDispose = ctx.tools.register({
      name: 'finreport_send',
      description: 'Generate and send the daily financial report (中英文可选). When invoked from an IM chat, ' +
        "it sends the report back to that conversation; otherwise it sends to all configured delivery targets. " +
        "Use language 'zh' for Chinese or 'en' for English.",
      parameters: {
        language: {
          type: 'string',
          required: false,
          description: "Report language: 'zh' (中文) or 'en' (English). Defaults to the target's configured language.",
        },
        target: {
          type: 'string',
          required: false,
          description: 'Optional delivery target index (see /finreport report.status) or "all". Defaults to the current conversation.',
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          required: ['sent'],
          properties: {
            sent: { type: 'boolean' },
            targets: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  channel: { type: 'string' },
                  botId: { type: 'string' },
                  sent: { type: 'boolean' },
                  skipped: { type: 'boolean' },
                  language: { type: 'string' },
                  error: { type: 'string' },
                },
              },
            },
            note: { type: 'string' },
          },
        },
        render,
      },
      timeoutMs: 120000,
      isConcurrencySafe: () => true,
      execute: async (args, exec) => {
        const language = typeof args?.language === 'string' ? args.language : undefined;
        const target = typeof args?.target === 'string' ? args.target : undefined;
        const sessionId = exec?.agent?.id ? String(exec.agent.id) : null;
        if (sessionId && (target === undefined || target === '')) {
          const conv = await findConversationBySession(sessionId).catch(() => null);
          if (conv) {
            const tFields = conversationTarget(conv.channel, conv.conversationId, conv.kind);
            if (tFields) {
              const matched = targets.find((t) => t.channel === conv.channel && t.botId === conv.botId);
              const lang = targetLanguage(matched ?? { language: undefined }, language);
              const text = await generate({ language: lang, maxNews });
              await sendToTarget({
                baseUrl,
                channel: conv.channel,
                target: { botId: conv.botId, ...tFields },
                text,
              });
              return {
                sent: true,
                targets: [{ channel: conv.channel, botId: conv.botId, sent: true, language: lang }],
                note: `sent to ${conv.channel} conversation`,
              };
            }
          }
        }
        const res = await run({ language, target });
        return {
          sent: true,
          targets: res.targets,
          note: 'sent to configured delivery targets',
        };
      },
    });
  } else {
    log.warn?.('tools service unavailable — in-chat "finreport_send" tool not registered');
  }

  // ---- 生命周期 ----

  scheduleAll();

  ctx.effect(() => () => {
    disposeRpc();
    clearTimers();
    if (toolDispose) { toolDispose(); toolDispose = null; }
  }, 'dsh-finreport: cleanup');

}

export default { name, inject, apply };
