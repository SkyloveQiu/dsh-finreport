// dsh-finreport — 功能自测（无需真实 cordis 环境）
// 运行: npm test
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { apply, FINREPORT_ENDPOINTS, nextRunMs } from '../../lib/index.js';

function mockCtx() {
  let handler = null;
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
    effect(fn) { this._effect = fn; return fn; },
  };
  return { ctx, getHandler: () => handler, getTimers: () => timers };
}

const dataDir = await mkdtemp(join(tmpdir(), 'finreport-test-'));

try {
  // --- nextRunMs DST sanity ---
  const t1 = nextRunMs(new Date('2026-08-16T10:00:00Z'), '08:00', 'Europe/Amsterdam');
  // 2026-08-17 08:00 CEST = 06:00 UTC
  assert.equal(new Date(t1).toISOString(), '2026-08-17T06:00:00.000Z');
  const t2 = nextRunMs(new Date('2026-08-17T07:00:00Z'), '08:00', 'Europe/Amsterdam'); // already past today
  assert.equal(new Date(t2).toISOString(), '2026-08-18T06:00:00.000Z');
  // winter DST: 2026-12-17 08:00 CET = 07:00 UTC
  const t3 = nextRunMs(new Date('2026-12-16T10:00:00Z'), '08:00', 'Europe/Amsterdam');
  assert.equal(new Date(t3).toISOString(), '2026-12-17T07:00:00.000Z');
  console.log('✓ nextRunMs DST (summer/winter) ok');

  // --- apply plugin with mock ctx ---
  const { ctx, getHandler, getTimers } = mockCtx();
  const result = await apply(ctx, {
    dataDir,
    whatsapp: { baseUrl: 'http://127.0.0.1:3080', botId: 'test-bot', jid: 'test@lid' },
    deliver: async (text) => ({ sent: true, jid: 'test@lid', len: text.length }),
  });
  assert.ok(result.generate, 'api.generate exposed');
  const handler = getHandler();
  assert.ok(handler, 'rpc handler registered');
  assert.ok(getTimers().size >= 1, 'schedule armed');

  // --- status ---
  let resp = await handler(FINREPORT_ENDPOINTS.status, {});
  assert.equal(resp.ok, true);
  assert.equal(resp.value.schedule, '08:00');
  assert.equal(resp.value.timezone, 'Europe/Amsterdam');
  assert.ok(resp.value.nextRunAt, 'nextRunAt set');
  console.log('✓ report.status ok -> next run:', resp.value.nextRunAt);

  // --- generate (real network) ---
  resp = await handler(FINREPORT_ENDPOINTS.generate, {});
  assert.equal(resp.ok, true, `generate failed: ${JSON.stringify(resp.error)}`);
  const text = resp.value.text;
  assert.ok(text.includes('财经日报'), 'report contains title');
  assert.ok(text.includes('全球市场') && text.includes('今日要闻') && text.includes('宏观日历'),
    'report contains all sections');
  console.log(`✓ report.generate ok (${text.length} chars)`);

  // --- send with mock deliverer ---
  resp = await handler(FINREPORT_ENDPOINTS.send, {});
  assert.equal(resp.ok, true, `send failed: ${JSON.stringify(resp.error)}`);
  assert.equal(resp.value.sent, true);
  console.log('✓ report.send ok (mock deliverer)');

  // --- idempotency: same-day second send skipped ---
  resp = await handler(FINREPORT_ENDPOINTS.send, {});
  assert.equal(resp.ok, true);
  assert.equal(resp.value.skipped, true);
  console.log('✓ same-day duplicate send skipped');

  // --- payload validation ---
  resp = await handler(FINREPORT_ENDPOINTS.send, { extra: 1 });
  assert.equal(resp.ok, false);
  resp = await handler('report.nope', {});
  assert.equal(resp.ok, false);
  console.log('✓ payload/endpoint validation ok');

  // --- cleanup ---
  ctx._effect?.();
  console.log('\nALL TESTS PASSED');
} finally {
  await rm(dataDir, { recursive: true, force: true });
}
