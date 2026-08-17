// dsh-finreport — host 插件
// 职责:
//   1) 注册 /finreport RPC 通道（report.generate / report.send / report.status）
//   2) 内置每日定时调度（08:00 Europe/Amsterdam，DST 安全），通过 timer 服务驱动
//   3) 状态持久化（lastSentDate / nextRunAt / lastError）到 dataDir

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

import { generateReport, buildCalendarSection } from './report.mjs';
import { createDeliverer } from './delivery.mjs';

export const name = 'dsh-finreport-host';
export const inject = ['connection', 'timer'];

export const FINREPORT_RPC_CHANNEL = '/finreport';
export const FINREPORT_ENDPOINTS = Object.freeze({
  generate: 'report.generate',
  send: 'report.send',
  status: 'report.status',
});

// 默认宏观日历（2026 央行会议，已核实日期；可用 dataDir/events.json 覆盖）
export const DEFAULT_EVENTS = [
  { date: '2026-01-27', end: '2026-01-28', name: '美联储FOMC议息会议', country: 'US', detail: '利率决议美东 1/28 14:00' },
  { date: '2026-02-04', end: '2026-02-05', name: '欧洲央行(ECB)利率决议', country: 'EU', detail: '决议 2/5 法兰克福 14:15' },
  { date: '2026-03-17', end: '2026-03-18', name: '美联储FOMC议息会议', country: 'US', detail: '利率决议美东 3/18 14:00' },
  { date: '2026-03-18', end: '2026-03-19', name: '欧洲央行(ECB)利率决议', country: 'EU', detail: '决议 3/19 法兰克福 14:15' },
  { date: '2026-04-28', end: '2026-04-29', name: '美联储FOMC议息会议', country: 'US', detail: '利率决议美东 4/29 14:00' },
  { date: '2026-04-29', end: '2026-04-30', name: '欧洲央行(ECB)利率决议', country: 'EU', detail: '决议 4/30 法兰克福 14:15' },
  { date: '2026-06-10', end: '2026-06-11', name: '欧洲央行(ECB)利率决议', country: 'EU', detail: '决议 6/11 法兰克福 14:15' },
  { date: '2026-06-16', end: '2026-06-17', name: '美联储FOMC议息会议', country: 'US', detail: '利率决议美东 6/17 14:00' },
  { date: '2026-07-22', end: '2026-07-23', name: '欧洲央行(ECB)利率决议', country: 'EU', detail: '决议 7/23 法兰克福 14:15' },
  { date: '2026-07-28', end: '2026-07-29', name: '美联储FOMC议息会议', country: 'US', detail: '利率决议美东 7/29 14:00' },
  { date: '2026-09-09', end: '2026-09-10', name: '欧洲央行(ECB)利率决议', country: 'EU', detail: '决议 9/10 法兰克福 14:15' },
  { date: '2026-09-15', end: '2026-09-16', name: '美联储FOMC议息会议', country: 'US', detail: '利率决议美东 9/16 14:00' },
  { date: '2026-10-27', end: '2026-10-28', name: '美联储FOMC议息会议', country: 'US', detail: '利率决议美东 10/28 14:00' },
  { date: '2026-10-28', end: '2026-10-29', name: '欧洲央行(ECB)利率决议', country: 'EU', detail: '决议 10/29 法兰克福 14:15' },
  { date: '2026-12-08', end: '2026-12-09', name: '美联储FOMC议息会议', country: 'US', detail: '利率决议美东 12/9 14:00' },
  { date: '2026-12-16', end: '2026-12-17', name: '欧洲央行(ECB)利率决议', country: 'EU', detail: '决议 12/17 法兰克福 14:15' },
];
export const DEFAULT_MONTHLY_NOTE =
  '每月常规数据（约）：美国非农就业报告（首个周五）· 美国CPI（月中，以BLS公布为准）· 中国LPR（每月20日前后）· OPEC+ 月度产量会议';

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

  async init({ events, monthlyNote }) {
    await mkdir(this.dir, { recursive: true, mode: 0o700 });
    try {
      await readFile(this.eventsPath(), 'utf8');
    } catch {
      await writeFile(this.eventsPath(), JSON.stringify(
        { events: events ?? DEFAULT_EVENTS, monthlyNote: monthlyNote ?? DEFAULT_MONTHLY_NOTE },
        null, 2) + '\n', { encoding: 'utf8', mode: 0o600 });
    }
  }

  async loadEvents() {
    try {
      const raw = JSON.parse(await readFile(this.eventsPath(), 'utf8'));
      return {
        events: Array.isArray(raw.events) ? raw.events : DEFAULT_EVENTS,
        monthlyNote: typeof raw.monthlyNote === 'string' ? raw.monthlyNote : DEFAULT_MONTHLY_NOTE,
      };
    } catch {
      return { events: DEFAULT_EVENTS, monthlyNote: DEFAULT_MONTHLY_NOTE };
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

export function createFinreportRpcHandler(api, { status = () => ({}) } = {}) {
  for (const method of ['generate', 'send', 'status']) {
    if (typeof api[method] !== 'function') throw new TypeError(`finreport api missing ${method}`);
  }
  return async (endpoint, payload) => {
    if (!Object.values(FINREPORT_ENDPOINTS).includes(endpoint)) {
      return { ok: false, error: { code: 'bad-request', message: 'Unknown finreport endpoint.' } };
    }
    if (!exactKeys(payload, []) && endpoint !== FINREPORT_ENDPOINTS.generate) {
      return { ok: false, error: { code: 'bad-request', message: `${endpoint} does not accept fields.` } };
    }
    if (endpoint === FINREPORT_ENDPOINTS.generate && !exactKeys(payload, ['maxNews'])) {
      return { ok: false, error: { code: 'bad-request', message: 'report.generate accepts only maxNews.' } };
    }
    try {
      let value;
      if (endpoint === FINREPORT_ENDPOINTS.generate) value = { text: await api.generate(payload) };
      else if (endpoint === FINREPORT_ENDPOINTS.send) value = await api.send();
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
  const schedule = config.schedule ?? '08:00';
  const timeZone = config.timezone ?? 'Europe/Amsterdam';
  const enabled = config.enabled !== false;
  const maxNews = config.maxNews ?? 8;
  const dir = resolve(defaultDataDir(config));
  const store = new FinreportStore(dir);
  await store.init({ events: config.events, monthlyNote: config.monthlyNote });
  const deliver = createDeliverer(config);
  const log = typeof ctx.logger === 'function' ? ctx.logger('dsh-finreport') : console;

  let lastError = null;
  let nextRunAt = null;
  let running = false;
  let scheduleDispose = null;

  const todayInTz = () => {
    const p = zonedParts(Date.now(), timeZone);
    return `${p.y}-${String(p.mo).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`;
  };

  const generate = async (payload = {}) => {
    const cal = await store.loadEvents();
    return generateReport({
      events: cal.events,
      monthlyNote: cal.monthlyNote,
      timeZone,
      maxNews: Number.isInteger(payload?.maxNews) ? payload.maxNews : maxNews,
    });
  };

  const run = async ({ record = true } = {}) => {
    if (running) return { skipped: true, reason: 'already running' };
    running = true;
    try {
      const text = await generate();
      const state = await store.loadState();
      const today = todayInTz();
      if (record && state.lastSentDate === today) {
        return { skipped: true, reason: `already sent for ${today}` };
      }
      const result = await deliver(text);
      if (record) {
        await store.saveState({ lastSentDate: today, lastSentAt: new Date().toISOString() });
      }
      lastError = null;
      return { ...result, date: today };
    } catch (error) {
      lastError = String(error?.message ?? error);
      throw error;
    } finally {
      running = false;
    }
  };

  const scheduleNext = () => {
    if (scheduleDispose) { scheduleDispose(); scheduleDispose = null; }
    if (!enabled) { nextRunAt = null; return; }
    let ms;
    try {
      ms = nextRunMs(new Date(), schedule, timeZone) - Date.now();
    } catch (error) {
      lastError = `schedule: ${error.message}`;
      return;
    }
    nextRunAt = new Date(Date.now() + ms).toISOString();
    scheduleDispose = ctx.timer.timeout(async () => {
      scheduleDispose = null;
      try {
        await run();
      } catch (error) {
        log.warn?.(`scheduled run failed: ${String(error?.message ?? error)}`);
      } finally {
        scheduleNext();
      }
    }, ms);
  };

  const status = async () => {
    const state = await store.loadState();
    return {
      enabled,
      schedule,
      timezone: timeZone,
      maxNews,
      dataDir: dir,
      lastSentDate: state.lastSentDate ?? null,
      lastSentAt: state.lastSentAt ?? null,
      nextRunAt,
      lastError,
      running,
    };
  };

  const api = { generate, send: () => run(), status };

  const disposeRpc = ctx.connection.rpc.handle(
    FINREPORT_RPC_CHANNEL,
    createFinreportRpcHandler(api, { status }),
    { authority: config.rpcAuthority ?? 'loopback' },
  );

  scheduleNext();

  ctx.effect(() => () => {
    disposeRpc();
    if (scheduleDispose) { scheduleDispose(); scheduleDispose = null; }
  }, 'dsh-finreport: cleanup');

  return { name, status, generate, run, scheduleNext };
}

export default { name, inject, apply };
