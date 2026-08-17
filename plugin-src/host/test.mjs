// dsh-finreport — 功能自测（无需真实 cordis 环境）
// 运行: npm test
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { apply, FINREPORT_ENDPOINTS, nextRunMs } from '../../lib/index.js';

function mockCtx() {
  let handler = null;
  let toolDef = null;
  let timerId = 0;
  const timers = new Map();
  const ctx = {
    logger: () => ({ warn: (...a) => console.warn('[mock]', ...a), info: () => {} }),
    connection: {
      rpc: {
        handle(channel, fn) {
          assert.equal(channel, '/finreport');
          handler = fn;
          return () => { handler = null; };
        },
      },
    },
    timer: {
      timeout(fn, ms) {
        const id = `t${++timerId}`;
        timers.set(id, { fn, ms });
        return () => timers.delete(id);
      },
    },
    tools: {
      register(def) {
        toolDef = def;
        return () => { toolDef = null; };
      },
    },
    effect(fn) { this._effect = fn; return fn; },
  };
  return { ctx, getHandler: () => handler, getTool: () => toolDef, getTimers: () => timers };
}

const dataDir = await mkdtemp(join(tmpdir(), 'finreport-test-'));

try {
  // --- nextRunMs DST sanity ---
  const t1 = nextRunMs(new Date('2026-08-16T10:00:00Z'), '08:00', 'Europe/Amsterdam');
  assert.equal(new Date(t1).toISOString(), '2026-08-17T06:00:00.000Z'); // summer: 08:00 CEST = 06:00 UTC
  const t2 = nextRunMs(new Date('2026-08-17T07:00:00Z'), '08:00', 'Europe/Amsterdam'); // already past today
  assert.equal(new Date(t2).toISOString(), '2026-08-18T06:00:00.000Z');
  const t3 = nextRunMs(new Date('2026-12-16T10:00:00Z'), '08:00', 'Europe/Amsterdam');
  assert.equal(new Date(t3).toISOString(), '2026-12-17T07:00:00.000Z'); // winter: 08:00 CET = 07:00 UTC
  console.log('✓ nextRunMs DST (summer/winter) ok');

  // --- apply plugin with mock ctx (custom deliverer, no targets) ---
  const { ctx, getHandler, getTool, getTimers } = mockCtx();
  const result = await apply(ctx, {
    dataDir,
    whatsapp: { baseUrl: 'http://127.0.0.1:3080', botId: 'test-bot', jid: 'test@lid' },
    deliver: async (text) => ({ sent: true, jid: 'test@lid', len: text.length }),
  });
  assert.ok(result.generate, 'api.generate exposed');
  const handler = getHandler();
  assert.ok(handler, 'rpc handler registered');
  assert.ok(getTool(), 'finreport_send tool registered');
  assert.ok(getTimers().size >= 1, 'schedule armed');

  // --- status ---
  let resp = await handler(FINREPORT_ENDPOINTS.status, {});
  assert.equal(resp.ok, true);
  assert.equal(resp.value.schedule, '08:00');
  assert.equal(resp.value.timezone, 'Europe/Amsterdam');
  assert.equal(resp.value.toolRegistered, true);
  assert.ok(Array.isArray(resp.value.targets), 'per-target status present');
  console.log('✓ report.status ok -> targets:', resp.value.targets.length);

  // --- generate zh (real network) ---
  resp = await handler(FINREPORT_ENDPOINTS.generate, {});
  assert.equal(resp.ok, true, `generate failed: ${JSON.stringify(resp.error)}`);
  const zh = resp.value.text;
  assert.ok(zh.includes('财经日报'), 'zh report contains title');
  assert.ok(zh.includes('全球市场') && zh.includes('今日要闻') && zh.includes('宏观日历'),
    'zh report contains all sections');
  console.log(`✓ report.generate zh ok (${zh.length} chars)`);

  // --- generate en ---
  resp = await handler(FINREPORT_ENDPOINTS.generate, { language: 'en' });
  assert.equal(resp.ok, true, `generate en failed: ${JSON.stringify(resp.error)}`);
  const en = resp.value.text;
  assert.ok(en.includes('Daily Financial Report'), 'en report contains title');
  assert.ok(en.includes('Global Markets') && en.includes('Top News') && en.includes('Macro Calendar'),
    'en report contains all sections');
  assert.ok(!en.includes('财经日报'), 'en report has no zh title');
  console.log(`✓ report.generate en ok (${en.length} chars)`);

  // --- send with custom deliverer ---
  resp = await handler(FINREPORT_ENDPOINTS.send, {});
  assert.equal(resp.ok, true, `send failed: ${JSON.stringify(resp.error)}`);
  assert.equal(resp.value.targets[0].sent, true);
  console.log('✓ report.send ok (custom deliverer)');

  // --- idempotency: same-day second send skipped ---
  resp = await handler(FINREPORT_ENDPOINTS.send, {});
  assert.equal(resp.ok, true);
  assert.equal(resp.value.targets[0].skipped, true);
  console.log('✓ same-day duplicate send skipped');

  // --- payload validation ---
  resp = await handler(FINREPORT_ENDPOINTS.send, { extra: 1 });
  assert.equal(resp.ok, false);
  resp = await handler(FINREPORT_ENDPOINTS.generate, { language: 'fr' });
  assert.equal(resp.ok, false);
  resp = await handler('report.nope', {});
  assert.equal(resp.ok, false);
  console.log('✓ payload/endpoint validation ok');

  // --- multi-channel delivery (targetPayload / sendToTarget via mock fetch) ---
  const { targetPayload, sendToTarget, normalizeTargets, describeTargets, conversationTarget } =
    await import('../../plugin-src/host/delivery.mjs');
  const wa = targetPayload('whatsapp', { botId: 'b1', jid: 'x@lid', text: 'hi' });
  assert.deepEqual(wa, { botId: 'b1', jid: 'x@lid', text: 'hi' });
  const tg = targetPayload('telegram', { botId: 'b2', chatId: 123, text: 'hi' });
  assert.deepEqual(tg, { botId: 'b2', target: { chatId: 123 }, text: 'hi' });
  const qq = targetPayload('qq', { botId: 'b3', group_openid: 'g1', text: 'hi' });
  assert.deepEqual(qq, { botId: 'b3', target: { group_openid: 'g1' }, text: 'hi' });
  assert.equal(normalizeTargets({ delivery: [{ channel: 'telegram', botId: 'b', chatId: 1 }] }).length, 1);
  assert.equal(normalizeTargets({ whatsapp: { botId: 'b', jid: 'j' } }).length, 1);
  assert.equal(describeTargets({ delivery: [{ channel: 'telegram', botId: 'b', chatId: 12345678901 }] })[0].target, '123456…8901');
  assert.deepEqual(conversationTarget('whatsapp', 'x@lid', 'direct'), { jid: 'x@lid' });
  assert.deepEqual(conversationTarget('qq', 'g-1', 'group'), { group_openid: 'g-1' });
  const calls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    calls.push({ url, body: JSON.parse(opts.body) });
    return { ok: true, json: async () => ({ type: 'server-response', result: { ok: true, value: { sent: true } } }) };
  };
  try {
    await sendToTarget({ baseUrl: 'http://x:1', channel: 'discord', target: { botId: 'b', channelId: 'c' }, text: 't' });
  } finally {
    globalThis.fetch = realFetch;
  }
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'http://x:1/discord/bot.sendText');
  assert.equal(calls[0].body.method, 'bot.sendText');
  assert.deepEqual(calls[0].body.payload, { botId: 'b', target: { channelId: 'c' }, text: 't' });
  console.log('✓ multi-channel delivery (payload translation + HTTP path) ok');

  // --- tool execute: unknown session falls back to configured targets ---
  const tool = getTool();
  const toolResult = await tool.execute(
    { language: 'en' },
    { agent: { id: 'session-does-not-exist' }, signal: new AbortController().signal },
  );
  assert.equal(toolResult.sent, true);
  assert.ok(toolResult.targets.length >= 1);
  console.log('✓ finreport_send tool execute (fallback) ok');

  // --- per-target scheduling: two targets with own schedule/timezone/language ---
  const { ctx: ctx2, getHandler: getHandler2, getTimers: getTimers2 } = mockCtx();
  const applied2 = await apply(ctx2, {
    dataDir,
    delivery: [
      { channel: 'whatsapp', botId: 'wa', jid: 'a@lid', language: 'zh', schedule: '09:00', timezone: 'Europe/Amsterdam' },
      { channel: 'telegram', botId: 'tg', chatId: 1, language: 'en', schedule: '10:30', timezone: 'Asia/Tokyo' },
    ],
    deliver: undefined,
  });
  assert.ok(applied2, 'apply with targets ok');
  const tCount = getTimers2().size;
  assert.ok(tCount >= 2, `expected >=2 timers, got ${tCount}`);
  const st = await getHandler2()(FINREPORT_ENDPOINTS.status, {});
  assert.equal(st.ok, true);
  assert.equal(st.value.targets.length, 2);
  assert.equal(st.value.targets[0].language, 'zh');
  assert.equal(st.value.targets[1].language, 'en');
  assert.equal(st.value.targets[0].schedule, '09:00');
  assert.equal(st.value.targets[1].schedule, '10:30');
  assert.equal(st.value.targets[1].timezone, 'Asia/Tokyo');
  console.log('✓ per-target independent schedule/language ok');

  // --- cleanup ---
  ctx._effect?.();
  ctx2._effect?.();
  console.log('\nALL TESTS PASSED');
} finally {
  await rm(dataDir, { recursive: true, force: true });
}
