// dsh-finreport — 日报生成器（Node 版，无第三方运行时依赖）
// 数据源: Yahoo Finance v8 chart / CoinGecko(备用) / Google News RSS / 本地宏观日历

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/126.0 Safari/537.36';

const WEEKDAYS_CN = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];

export const MARKETS = [
  ['^GSPC', 'S&P 500', 'us'], ['^DJI', '道琼斯', 'us'], ['^IXIC', '纳斯达克', 'us'],
  ['^STOXX50E', 'Euro Stoxx 50', 'eu'], ['^GDAXI', '德国DAX', 'eu'],
  ['^FCHI', '法国CAC 40', 'eu'], ['^AEX', '荷兰AEX', 'eu'],
  ['^N225', '日经225', 'asia'], ['^HSI', '恒生指数', 'asia'],
  ['000001.SS', '上证指数', 'asia'], ['^KS11', '韩国KOSPI', 'asia'],
  ['EURUSD=X', '欧元/美元', 'fx'], ['USDCNY=X', '美元/人民币', 'fx'],
  ['GBPUSD=X', '英镑/美元', 'fx'], ['USDJPY=X', '美元/日元', 'fx'],
  ['GC=F', '黄金 (COMEX)', 'comm'], ['CL=F', 'WTI原油', 'comm'],
  ['BZ=F', '布伦特原油', 'comm'], ['BTC-USD', '比特币', 'crypto'],
  ['ETH-USD', '以太坊', 'crypto'],
];

const GROUP_ORDER = ['us', 'eu', 'asia', 'fx', 'comm', 'crypto'];
const GROUP_META = {
  us: ['🇺🇸 美股', 2], eu: ['🇪🇺 欧股', 2], asia: ['🌏 亚洲', 2],
  fx: ['💱 外汇', 4], comm: ['🥇 大宗商品', 1], crypto: ['🪙 加密货币', 0],
};
const SYMBOL_TZ = {
  '^GSPC': 'America/New_York', '^DJI': 'America/New_York', '^IXIC': 'America/New_York',
  '^STOXX50E': 'Europe/Zurich', '^GDAXI': 'Europe/Berlin', '^FCHI': 'Europe/Paris',
  '^AEX': 'Europe/Amsterdam', '^N225': 'Asia/Tokyo', '^HSI': 'Asia/Hong_Kong',
  '000001.SS': 'Asia/Shanghai', '^KS11': 'Asia/Seoul',
  'EURUSD=X': 'Europe/London', 'USDCNY=X': 'Europe/London',
  'GBPUSD=X': 'Europe/London', 'USDJPY=X': 'Europe/London',
  'GC=F': 'America/New_York', 'CL=F': 'America/New_York', 'BZ=F': 'America/New_York',
  'BTC-USD': 'UTC', 'ETH-USD': 'UTC',
};

const NEWS_QUERIES = [
  ['market', 'stock market OR "S&P 500" OR Wall Street OR Nasdaq when:1d', 'en-US', 'US'],
  ['macro', '("Federal Reserve" OR Fed OR inflation OR "interest rate") when:1d', 'en-US', 'US'],
  ['europe', '(Europe OR eurozone OR DAX OR CAC OR AEX) markets when:1d', 'en-GB', 'GB'],
  ['asia', '(China OR Japan OR "Hong Kong" OR "Asia markets") when:1d', 'en-US', 'US'],
];

const SOURCE_WEIGHTS = {
  Reuters: 10, Bloomberg: 10, WSJ: 10, 'Financial Times': 10, CNBC: 9,
  MarketWatch: 8, 'Investing.com': 8, AP: 8, Fortune: 8, "Barron's": 8,
  'The Economist': 8, Nikkei: 9, 'South China Morning Post': 8, Caixin: 8,
  'Yahoo Finance': 7, 'Business Insider': 7, BBC: 7, 'The Guardian': 7,
  Forbes: 7, 'Bloomberg Quint': 8, Benzinga: 7, 'Seeking Alpha': 6,
};
const BAD_WORDS = ['google news', 'top stories', 'videos', 'live updates'];

// ---------------------------------------------------------------- helpers

async function fetchText(url, { timeout = 12000, retries = 2, signal } = {}) {
  let last;
  for (let i = 0; i < retries; i += 1) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeout);
      const res = await fetch(url, {
        headers: { 'User-Agent': UA, Accept: '*/*' },
        signal: signal ?? ctrl.signal,
      });
      clearTimeout(timer);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (err) {
      last = err;
      await new Promise((r) => setTimeout(r, 1200 * (i + 1)));
    }
  }
  throw last;
}

const fetchJson = async (url, opts) => JSON.parse(await fetchText(url, opts));

function pad(n, w = 2) { return String(n).padStart(w, '0'); }

function fmtDateTime(ts, tzName) {
  const dt = new Intl.DateTimeFormat('en-CA', {
    timeZone: tzName, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date(ts));
  // "2026-08-17, 14:05"
  const [date, time] = dt.split(', ');
  const [y, m, d] = date.trim().split('-');
  return { date: `${y}-${m}-${d}`, time: time.trim(), dateCN: `${Number(m)}/${Number(d)}` };
}

function formatNumber(value, decimals) {
  return decimals <= 0
    ? value.toLocaleString('en-US', { maximumFractionDigits: 0 })
    : value.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

// ---------------------------------------------------------------- market data

async function yahooQuote(symbol) {
  const url = `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=5d`;
  try {
    const data = await fetchJson(url);
    const res = data.chart?.result?.[0];
    if (!res) return null;
    const meta = res.meta ?? {};
    const closes = (res.indicators?.quote?.[0]?.close ?? []).filter((c) => c != null);
    const price = meta.regularMarketPrice;
    let prev = meta.previousClose;
    if (prev == null && closes.length >= 2) prev = closes[closes.length - 2];
    if (price == null || prev == null || prev === 0) return null;
    return {
      price: Number(price),
      prev: Number(prev),
      ts: meta.regularMarketTime ? meta.regularMarketTime * 1000 : Date.now(),
      tz: SYMBOL_TZ[symbol] ?? meta.exchangeTimezoneName ?? 'UTC',
    };
  } catch {
    return null;
  }
}

async function coingeckoFallback() {
  try {
    const data = await fetchJson('https://api.coingecko.com/api/v3/simple/price' +
      '?ids=bitcoin,ethereum&vs_currencies=usd&include_24hr_change=true', { retries: 1 });
    const out = {};
    for (const [key, label] of [['bitcoin', 'BTC-USD'], ['ethereum', 'ETH-USD']]) {
      const price = data[key]?.usd;
      if (price) {
        const chg = data[key]?.usd_24h_change;
        out[label] = { price: Number(price), prev: chg ? price / (1 + chg / 100) : price, ts: Date.now(), tz: 'UTC' };
      }
    }
    return out;
  } catch {
    return {};
  }
}

async function buildMarketSection() {
  const quotes = new Map();
  for (const [symbol, display, group] of MARKETS) {
    const q = await yahooQuote(symbol);
    if (q) quotes.set(symbol, { display, group, ...q });
    await new Promise((r) => setTimeout(r, 220));
  }
  const cg = await coingeckoFallback();
  for (const [label, q] of Object.entries(cg)) {
    if (!quotes.has(label)) {
      quotes.set(label, {
        display: label === 'BTC-USD' ? '比特币' : '以太坊',
        group: 'crypto',
        ...q,
      });
    }
  }
  const now = new Date();
  const todayBJ = fmtDateTime(now.getTime(), 'Asia/Shanghai').date;
  const lines = [];
  for (const group of GROUP_ORDER) {
    const items = [...quotes.entries()].filter(([, v]) => v.group === group);
    if (!items.length) continue;
    const [title, decimals] = GROUP_META[group];
    let label;
    if (group === 'us' || group === 'eu') label = '上日收盘';
    else if (group === 'asia') {
      label = items.every(([, v]) => fmtDateTime(v.ts, SYMBOL_TZ[v.symbol] ?? 'UTC').date === todayBJ)
        ? '今日盘中' : '最新';
    } else label = '最新';
    lines.push(`\n${title} · ${label}`);
    for (const [symbol, v] of items) {
      const pct = v.prev ? ((v.price - v.prev) / v.prev) * 100 : 0;
      const arrow = pct >= 0 ? '▲' : '▼';
      let tzLabel, tzForTime;
      if (group === 'asia') { tzLabel = '北京'; tzForTime = 'Asia/Shanghai'; }
      else if (group === 'us') { tzLabel = '美东'; tzForTime = 'America/New_York'; }
      else if (group === 'eu') { tzLabel = '欧洲'; tzForTime = SYMBOL_TZ[symbol] ?? 'Europe/Berlin'; }
      else if (group === 'fx') { tzLabel = '伦敦'; tzForTime = 'Europe/London'; }
      else if (group === 'comm') { tzLabel = '美东'; tzForTime = 'America/New_York'; }
      else { tzLabel = 'UTC'; tzForTime = 'UTC'; }
      const qt = fmtDateTime(v.ts, tzForTime);
      lines.push(`▸ ${v.display.padEnd(10)} ${formatNumber(v.price, decimals).padStart(14)}  ` +
        `${arrow}${Math.abs(pct).toFixed(2)}%  (${tzLabel} ${qt.dateCN} ${qt.time})`);
    }
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------- news

function normalizeTitle(title) {
  return title.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff ]/g, '').replace(/\s+/g, ' ').trim();
}

/** 极简 RSS 解析（Google News 的 <item> 结构固定，正则足够）。 */
function parseRssItems(xml) {
  const items = [];
  const itemRe = /<item>([\s\S]*?)<\/item>/g;
  let m;
  while ((m = itemRe.exec(xml)) !== null) {
    const body = m[1];
    const title = (body.match(/<title>([\s\S]*?)<\/title>/) || [])[1] ?? '';
    const pub = (body.match(/<pubDate>([\s\S]*?)<\/pubDate>/) || [])[1] ?? '';
    const srcMatch = body.match(/<source[^>]*>([\s\S]*?)<\/source>/);
    const src = srcMatch ? srcMatch[1].trim() : '';
    const link = (body.match(/<link>([\s\S]*?)<\/link>/) || [])[1] ?? '';
    const titleText = title.replace(/<!\[CDATA\[|\]\]>/g, '').trim();
    if (!titleText || !pub) continue;
    const ts = Date.parse(pub);
    if (Number.isNaN(ts)) continue;
    if (BAD_WORDS.some((w) => titleText.toLowerCase().includes(w))) continue;
    items.push({ title: titleText, src, link, ts });
  }
  return items;
}

function xmlUnescape(s) {
  return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'").replace(/&apos;/g, "'").replace(/&amp;/g, '&');
}

async function fetchNews(limit = 8) {
  const now = Date.now();
  const pool = [];
  for (const [, query, hl, gl] of NEWS_QUERIES) {
    const url = 'https://news.google.com/rss/search?' +
      new URLSearchParams({ q: query, hl, gl, ceid: `${gl}:${hl.slice(-2)}` });
    try {
      const xml = await fetchText(url, { retries: 1 });
      pool.push(...parseRssItems(xml));
    } catch {
      // skip feed
    }
  }
  const seen = new Map();
  for (const it of pool) {
    const norm = normalizeTitle(xmlUnescape(it.title));
    if (!norm || norm.length < 15) continue;
    const key = norm.slice(0, 60);
    if (!seen.has(key)) seen.set(key, it);
  }
  const ranked = [...seen.values()]
    .map((it) => ({
      ...it,
      score: (SOURCE_WEIGHTS[it.src] ?? 5) - Math.max(0, (now - it.ts) / 36e5) * 1.2,
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
  const ago = (ts) => {
    const secs = Math.max(0, Math.floor((now - ts) / 1000));
    if (secs < 3600) return `${Math.max(1, Math.floor(secs / 60))}分钟前`;
    if (secs < 86400) return `${Math.floor(secs / 3600)}小时前`;
    return `${Math.floor(secs / 86400)}天前`;
  };
  const lines = [];
  ranked.forEach((it, i) => {
    const title = it.title.length > 110 ? `${it.title.slice(0, 107)}…` : it.title;
    lines.push(`${i + 1}. ${title}`);
    lines.push(`   · ${it.src || '新闻'} · ${ago(it.ts)}`);
  });
  return lines.length ? lines.join('\n') : '（暂无抓取到新闻，请稍后重试）';
}

// ---------------------------------------------------------------- calendar

export function buildCalendarSection(events, monthlyNote, timeZone) {
  const now = new Date();
  const todayStr = fmtDateTime(now.getTime(), timeZone).date;
  const today = new Date(`${todayStr}T00:00:00`);
  const upcoming = [];
  for (const ev of events ?? []) {
    const start = new Date(`${ev.date}T00:00:00`);
    const end = ev.end ? new Date(`${ev.end}T00:00:00`) : start;
    if (start <= today && today <= end) upcoming.push({ off: 0, ev, start });
    else if (today < start && start <= new Date(today.getTime() + 3 * 864e5)) {
      upcoming.push({ off: Math.round((start - today) / 864e5), ev, start });
    }
  }
  upcoming.sort((a, b) => a.off - b.off);
  const lines = [];
  if (!upcoming.length) lines.push('今日无已排定的央行重大事件');
  const flags = { US: '🇺🇸', EU: '🇪🇺', CN: '🇨🇳', JP: '🇯🇵', GB: '🇬🇧', DE: '🇩🇪', FR: '🇫🇷', NL: '🇳🇱' };
  for (const { off, ev, start } of upcoming) {
    const when = off === 0 ? '今日' : `${off}天后`;
    const d = fmtDateTime(start.getTime(), timeZone);
    const line = `▸ ${when} (${d.dateCN}) ${flags[ev.country] ?? ''} ${ev.name}` +
      (ev.detail ? `（${ev.detail}）` : '');
    lines.push(line);
  }
  if (monthlyNote) lines.push(`\n📌 月度常规：${monthlyNote}`);
  return lines.join('\n');
}

// ---------------------------------------------------------------- assemble

export async function generateReport({ events, monthlyNote, timeZone = 'Europe/Amsterdam', maxNews = 8 } = {}) {
  const now = new Date();
  const ams = fmtDateTime(now.getTime(), timeZone);
  const bj = fmtDateTime(now.getTime(), 'Asia/Shanghai');
  const dateCN = `${Number(ams.date.slice(5, 7))}月${Number(ams.date.slice(8, 10))}日 ${WEEKDAYS_CN[now.getDay() === 0 ? 6 : now.getDay() - 1]}`;
  const [market, news, cal] = await Promise.all([
    buildMarketSection(),
    fetchNews(maxNews),
    Promise.resolve(buildCalendarSection(events, monthlyNote, timeZone)),
  ]);
  return [
    `📊 *财经日报* · ${dateCN}`,
    `🕗 阿姆斯特丹 ${ams.time} · 北京时间 ${bj.dateCN} ${bj.time}`,
    '',
    '━━━━━ 🌐 全球市场 ━━━━━',
    market,
    '',
    '━━━━━ 📰 今日要闻 ━━━━━',
    news,
    '',
    '━━━━━ 📅 宏观日历 ━━━━━',
    cal,
    '',
    '━━━━━',
    '数据源: Yahoo Finance / CoinGecko / Google News',
    '仅作信息参考，不构成投资建议',
  ].join('\n');
}
