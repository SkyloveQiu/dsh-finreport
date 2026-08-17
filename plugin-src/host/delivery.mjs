// dsh-finreport — 多通道投递适配层
// 支持向 dsh-im 的所有 IM 通道主动推送（依赖各通道补丁新增的 bot.sendText 端点）:
//   whatsapp / telegram / discord / feishu / dingtalk / wecom / qq / weixin
//
// 配置（config.delivery，数组，每项一个目标）:
//   { channel: 'whatsapp', botId, jid }
//   { channel: 'telegram', botId, chatId }            // 数字或 @用户名
//   { channel: 'discord',  botId, channelId }
//   { channel: 'feishu',   botId, receiveId, receiveIdType? }   // 默认 chat_id
//   { channel: 'dingtalk', botId, sessionWebhook }    // 目标会话的 webhook
//   { channel: 'wecom',    botId, chatId }
//   { channel: 'qq',       botId, openid }            // 私聊；或 { group_openid }
//   { channel: 'weixin',   botId, toUserId }
// 兼容旧配置: config.whatsapp = { baseUrl, botId, jid }

function rpcEnvelope(method, payload) {
  return {
    type: 'client-request',
    rpcId: `finreport-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    method,
    payload,
  };
}

/** 把投递目标翻译成对应通道 RPC 的 payload。 */
export function targetPayload(channel, target) {
  if (channel === 'whatsapp') {
    return { botId: target.botId, jid: target.jid, text: target.text };
  }
  const t = {};
  if (channel === 'telegram') t.chatId = target.chatId;
  else if (channel === 'discord') t.channelId = target.channelId;
  else if (channel === 'feishu') {
    t.receiveId = target.receiveId;
    if (target.receiveIdType) t.receiveIdType = target.receiveIdType;
  } else if (channel === 'dingtalk') t.sessionWebhook = target.sessionWebhook;
  else if (channel === 'wecom') t.chatId = target.chatId;
  else if (channel === 'qq') {
    if (target.openid) t.openid = target.openid;
    if (target.group_openid) t.group_openid = target.group_openid;
  } else if (channel === 'weixin') t.toUserId = target.toUserId;
  else throw new Error(`unsupported delivery channel: ${channel}`);
  return { botId: target.botId, target: t, text: target.text };
}

/**
 * 向一个目标发送文本。
 * @returns {Promise<{sent: true, channel: string, botId: string}>}
 */
export async function sendToTarget({ baseUrl, channel, target, text, timeout = 30000 }) {
  const payload = targetPayload(channel, { ...target, text });
  const url = `${baseUrl.replace(/\/$/, '')}/${channel}/bot.sendText`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(rpcEnvelope('bot.sendText', payload)),
    signal: AbortSignal.timeout(timeout),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`${channel} endpoint HTTP ${res.status}: ${body.slice(0, 300)}`);
  }
  const result = await res.json();
  const inner = result?.result ?? {};
  if (!inner.ok) {
    throw new Error(`${channel} rpc error ${inner.error?.code ?? 'unknown'}: ${inner.error?.message ?? ''}`);
  }
  return { sent: true, channel, botId: target.botId };
}

/** 归一化投递配置 → 目标数组。 */
export function normalizeTargets(config) {
  if (Array.isArray(config?.delivery)) return config.delivery.filter((d) => d && d.channel);
  if (config?.whatsapp?.botId && config?.whatsapp?.jid) {
    return [{
      channel: 'whatsapp',
      botId: config.whatsapp.botId,
      jid: config.whatsapp.jid,
      baseUrl: config.whatsapp.baseUrl,
    }];
  }
  return [];
}

/** 生成投递函数：把同一文本推送到全部目标（可被 config.deliver 覆盖）。 */
export function createDeliverer(config) {
  if (typeof config?.deliver === 'function') return config.deliver;
  const baseUrl = (config?.whatsapp?.baseUrl ?? config?.baseUrl ?? 'http://127.0.0.1:3080');
  const targets = normalizeTargets(config);
  return async (text) => {
    if (!targets.length) throw new Error('no delivery targets configured (set config.delivery or config.whatsapp)');
    const results = [];
    const errors = [];
    for (const t of targets) {
      try {
        results.push(await sendToTarget({
          baseUrl: t.baseUrl ?? baseUrl,
          channel: t.channel,
          target: t,
          text,
        }));
      } catch (error) {
        errors.push({ channel: t.channel, botId: t.botId, error: String(error?.message ?? error) });
      }
    }
    if (errors.length && !results.length) {
      const err = new Error(`delivery failed for all targets: ${JSON.stringify(errors)}`);
      err.code = 'delivery-failed';
      throw err;
    }
    return { sent: true, targets: results.length, errors };
  };
}

/** 状态展示用的目标摘要（脱敏）。 */
export function describeTargets(config) {
  return normalizeTargets(config).map((t) => {
    const id = t.jid ?? t.chatId ?? t.channelId ?? t.receiveId ?? t.toUserId ?? t.openid ?? t.group_openid ?? t.sessionWebhook ?? '?';
    const masked = String(id).length > 10 ? `${String(id).slice(0, 6)}…${String(id).slice(-4)}` : String(id);
    return { channel: t.channel, botId: t.botId, target: masked };
  });
}

/**
 * 把 (channel, conversationId, kind) 转成该通道的 target 字段。
 * 用于"聊天内触发"：把日报发回发起对话所在的会话。
 * 返回 null 表示该通道暂无法由会话 id 直接寻址。
 */
export function conversationTarget(channel, conversationId, kind) {
  switch (channel) {
    case 'whatsapp':
      return { jid: conversationId };
    case 'telegram':
      return { chatId: /^\d+$/.test(conversationId) ? Number(conversationId) : conversationId };
    case 'discord':
      return { channelId: conversationId };
    case 'feishu':
      return { receiveId: conversationId };
    case 'wecom':
      return { chatId: conversationId };
    case 'qq':
      return kind === 'group' ? { group_openid: conversationId } : { openid: conversationId };
    case 'weixin':
      return { toUserId: conversationId };
    case 'dingtalk':
      // 钉钉的会话 id 是发送者标识，主动推送需要目标会话的 webhook；
      // 尽力而为（可能失败，错误会如实返回）。
      return { sessionWebhook: conversationId };
    default:
      return null;
  }
}
