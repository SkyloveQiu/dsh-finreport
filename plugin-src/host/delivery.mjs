// dsh-finreport — 投递适配层
// 默认投递通道：dsh-im 插件的主动发送端点 `POST {baseUrl}/whatsapp/bot.sendText`
// （需要 dsh-im 打过补丁，或在配置中提供自定义 sendUrl / sendText 函数）。

function envelope(payload, method, channel) {
  return {
    type: 'client-request',
    rpcId: `finreport-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    method,
    payload,
  };
}

/**
 * 通过 dsh-im 的 bot.sendText 端点发送。
 * @returns {Promise<{sent: true, jid: string}>}
 */
export async function sendViaWhatsapp({ baseUrl, botId, jid, text, timeout = 30000 }) {
  if (!baseUrl || !botId || !jid || !text) {
    throw new Error('whatsapp delivery requires baseUrl/botId/jid/text');
  }
  const url = `${baseUrl.replace(/\/$/, '')}/whatsapp/bot.sendText`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(envelope({ botId, jid, text }, 'bot.sendText')),
    signal: AbortSignal.timeout(timeout),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`whatsapp endpoint HTTP ${res.status}: ${body.slice(0, 300)}`);
  }
  const result = await res.json();
  const inner = result?.result ?? {};
  if (!inner.ok) {
    throw new Error(`whatsapp rpc error ${inner.error?.code ?? 'unknown'}: ${inner.error?.message ?? ''}`);
  }
  return { sent: true, jid };
}

/** 生成投递函数（可被配置覆盖）。 */
export function createDeliverer(config) {
  if (typeof config?.deliver === 'function') return config.deliver;
  const whatsapp = config?.whatsapp ?? {};
  return (text) => sendViaWhatsapp({
    baseUrl: whatsapp.baseUrl ?? 'http://127.0.0.1:3080',
    botId: whatsapp.botId,
    jid: whatsapp.jid,
    text,
  });
}
