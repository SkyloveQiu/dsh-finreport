// dsh-finreport — 客户端设置页（最小实现）
// 展示: 调度状态 / 最近发送 / 下次运行；操作: 生成预览 / 立即发送

import React from 'react';

const h = React.createElement;

export const name = 'finreport-settings';
export const inject = ['slots', 'connection'];

const CHANNEL = '/finreport';

async function unwrap(rpcCall, endpoint, payload = {}, signal) {
  const result = await rpcCall(endpoint, payload, signal);
  const inner = result?.result ?? result;
  if (!inner || typeof inner.ok !== 'boolean') {
    throw new Error('finreport 服务返回了无法识别的响应');
  }
  if (!inner.ok) {
    const error = new Error(inner.error?.message ?? 'finreport 操作失败');
    error.code = inner.error?.code;
    throw error;
  }
  return inner.value;
}

function Button({ children, onClick, disabled, kind = 'secondary' }) {
  return h('button', {
    type: 'button',
    onClick,
    disabled,
    style: {
      padding: '6px 14px', borderRadius: '6px', cursor: disabled ? 'default' : 'pointer',
      border: kind === 'primary' ? 'none' : '1px solid #ccc',
      background: kind === 'primary' ? '#2563eb' : '#fff',
      color: kind === 'primary' ? '#fff' : '#111',
      fontSize: '13px',
    },
  }, children);
}

function Field({ label, value }) {
  return h('div', { style: { marginBottom: '8px' } },
    h('span', { style: { color: '#888', marginRight: '8px', fontSize: '12px' } }, label),
    h('span', { style: { fontSize: '13px' } }, String(value ?? '—')));
}

function FinreportSettingsTab({ rpcCall }) {
  const [status, setStatus] = React.useState(null);
  const [preview, setPreview] = React.useState(null);
  const [busy, setBusy] = React.useState(null); // 'generate' | 'send' | null
  const [error, setError] = React.useState(null);
  const [notice, setNotice] = React.useState(null);
  const [lang, setLang] = React.useState('zh');

  const refresh = React.useCallback(async (signal) => {
    try {
      setStatus(await unwrap(rpcCall, 'report.status', {}, signal));
      setError(null);
    } catch (err) {
      if (err?.name !== 'AbortError') setError(String(err?.message ?? err));
    }
  }, [rpcCall]);

  React.useEffect(() => {
    const controller = new AbortController();
    void refresh(controller.signal);
    const timer = setInterval(() => void refresh(controller.signal), 15000);
    return () => { controller.abort(); clearInterval(timer); };
  }, [refresh]);

  const onGenerate = async () => {
    setBusy('generate'); setNotice(null); setError(null);
    try {
      const value = await unwrap(rpcCall, 'report.generate', { language: lang });
      setPreview(value.text);
    } catch (err) {
      setError(String(err?.message ?? err));
    } finally {
      setBusy(null);
    }
  };

  const onSend = async () => {
    setBusy('send'); setNotice(null); setError(null);
    try {
      const value = await unwrap(rpcCall, 'report.send', { language: lang });
      setNotice(`已发送: ${JSON.stringify(value)}`);
      setPreview(null);
      await refresh();
    } catch (err) {
      setError(String(err?.message ?? err));
    } finally {
      setBusy(null);
    }
  };

  return h('div', { style: { maxWidth: '640px', fontFamily: 'system-ui, sans-serif' } },
    h('h3', null, '📊 财经日报'),
    h('p', { style: { color: '#666', fontSize: '13px' } },
      '每天定时生成中文财经日报并通过已接入的 IM 通道推送（WhatsApp/Telegram/Discord/飞书/钉钉/企微/QQ/微信，依赖 dsh-im 各通道的 bot.sendText 端点）。'),

    h('div', { style: { background: '#f6f6f6', borderRadius: '8px', padding: '12px', margin: '12px 0' } },
      status ? [
        h(Field, { key: 's1', label: '全局调度', value: `每天 ${status.schedule}（${status.timezone}）${status.enabled ? '' : '· 已停用'}` }),
        h(Field, {
          key: 's2',
          label: '投递目标',
          value: (status.targets || []).map((t) =>
            `${t.channel}[${t.index}] ${t.language} ${t.schedule}@${t.timezone} → ${(status.deliveryTargets || [])[t.index]?.target ?? ''}`).join('\n') || '未配置',
        }),
        h(Field, { key: 's3', label: '最近发送', value: status.lastSentDate ? `${status.lastSentDate} ${status.lastSentAt ? `(${new Date(status.lastSentAt).toLocaleString()})` : ''}` : '尚未发送' }),
        h(Field, { key: 's4', label: '下次运行', value: (status.targets || []).map((t) => `${t.channel}: ${t.nextRunAt ? new Date(t.nextRunAt).toLocaleString() : '—'}`).join('；') || '—' }),
        h(Field, { key: 's5', label: '聊天内触发', value: status.toolRegistered ? 'finreport_send 工具已注册' : '未注册' }),
        h(Field, { key: 's6', label: '数据目录', value: status.dataDir }),
        h(Field, { key: 's7', label: '上次错误', value: status.lastError ?? '无' }),
      ] : h('p', null, '正在读取状态…')),

    h('div', { style: { display: 'flex', gap: '8px', marginBottom: '12px', alignItems: 'center' } },
      h('select', {
        value: lang,
        onChange: (e) => setLang(e.target.value),
        style: { padding: '6px 8px', borderRadius: '6px', border: '1px solid #ccc', fontSize: '13px' },
      },
        h('option', { value: 'zh' }, '中文'),
        h('option', { value: 'en' }, 'English')),
      h(Button, { kind: 'primary', onClick: onSend, disabled: busy !== null }, busy === 'send' ? '发送中…' : '立即发送'),
      h(Button, { onClick: onGenerate, disabled: busy !== null }, busy === 'generate' ? '生成中…' : '生成预览')),

    error ? h('p', { style: { color: '#c00', fontSize: '13px' } }, `⚠️ ${error}`) : null,
    notice ? h('p', { style: { color: '#0a7d32', fontSize: '13px' } }, `✅ ${notice}`) : null,

    preview ? h('pre', {
      style: {
        background: '#0d1117', color: '#e6edf3', borderRadius: '8px',
        padding: '12px', fontSize: '12px', whiteSpace: 'pre-wrap',
        wordBreak: 'break-word', maxHeight: '480px', overflow: 'auto',
      },
    }, preview) : null);
}

export function apply(ctx) {
  const rpcCall = (endpoint, payload, signal) =>
    ctx.connection.rpc.call(CHANNEL, endpoint, payload, signal);

  ctx.slots.inject('settings.plugins.tab', () => ctx.slots.register({
    name: 'settings.plugins.tab',
    id: 'finreport',
    order: 30,
    label: '财经日报',
    inject: () => ({ rpcCall }),
  }, FinreportSettingsTab));
}

export default { name, inject, apply };
