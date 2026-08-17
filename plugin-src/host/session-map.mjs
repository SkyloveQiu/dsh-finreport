// dsh-finreport — 会话反查
// 把 harness 会话 id 映射回 dsh-im 的 (channel, botId, conversationId, kind)，
// 用于"聊天内触发日报"：哪个机器人/对话发起的请求，就把日报发回哪里。
// 数据来源：dsh-im 各通道的 state.json（sessions: { "<kind>:<conversationId>": "<sessionId>" }）。

import { readdir, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

const CHANNEL_PREFIX = 'dsh-';

export function defaultDshHome() {
  return process.env.DSH_HOME ?? join(homedir(), '.dsh');
}

/**
 * 反查会话 id → 会话信息。
 * @returns {Promise<{channel: string, botId: string, kind: string, conversationId: string} | null>}
 */
export async function findConversationBySession(sessionId, { dshHome } = {}) {
  if (!sessionId) return null;
  const integrations = join(dshHome ?? defaultDshHome(), 'integrations');
  let channels;
  try {
    channels = await readdir(integrations, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const entry of channels) {
    if (!entry.isDirectory() || !entry.name.startsWith(CHANNEL_PREFIX)) continue;
    const channel = entry.name.slice(CHANNEL_PREFIX.length);
    const botsRoot = join(integrations, entry.name, 'bots');
    let bots;
    try {
      bots = await readdir(botsRoot, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const bot of bots) {
      if (!bot.isDirectory()) continue;
      const statePath = join(botsRoot, bot.name, 'state.json');
      try {
        const raw = JSON.parse(await readFile(statePath, 'utf8'));
        const sessions = raw?.sessions ?? {};
        for (const [key, sid] of Object.entries(sessions)) {
          if (sid !== sessionId) continue;
          const sep = key.indexOf(':');
          return {
            channel,
            botId: bot.name,
            kind: sep > 0 ? key.slice(0, sep) : 'direct',
            conversationId: sep > 0 ? key.slice(sep + 1) : key,
          };
        }
      } catch {
        // 跳过无法解析的状态文件
      }
    }
  }
  return null;
}
