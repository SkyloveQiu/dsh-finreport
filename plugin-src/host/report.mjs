// dsh-finreport — 日报生成器（Node 版，无第三方运行时依赖）
// 数据源: Yahoo Finance v8 chart / CoinGecko(备用) / Google News RSS / 本地宏观日历
// 语言: 'zh'（中文）| 'en'（English）

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/126.0 Safari/537.36';

export const MARKETS = [
  // [symbol, zh, en, group]
  ['^GSPC', 'S&P 500', 'S&P 500', 'us'],
  ['^DJI', '道琼斯', 'Dow Jones', 'us'],
  ['^IXIC', '纳斯达克', 'Nasdaq', 'us'],
  ['^STOXX50E', 'Euro Stoxx 50', 'Euro Stoxx 50', 'eu'],
  ['^GDAXI', '德国DAX', 'DAX 40', 'eu'],
  ['^FCHI', '法国CAC 40', 'CAC 40', 'eu'],
  ['^AEX', '荷兰AEX', 'AEX (Amsterdam)', 'eu'],
  ['^N225', '日经225', 'Nikkei 225', 'asia'],
  ['^HSI', '恒生指数', 'Hang Seng', 'asia'],
  ['000001.SS', '上证指数', 'Shanghai Composite', 'asia'],
  ['^KS11', '韩国KOSPI', 'KOSPI', 'asia'],
  ['EURUSD=X', '欧元/美元', 'EUR/USD', 'fx'],
  ['USDCNY=X', '美元/人民币', 'USD/CNY', 'fx'],
  ['GBPUSD=X', '英镑/美元', 'GBP/USD', 'fx'],
  ['USDJPY=X', '美元/日元', 'USD/JPY', 'fx'],
  ['GC=F', '黄金 (COMEX)', 'Gold (COMEX)', 'comm'],
  ['CL=F', 'WTI原油', 'WTI Crude', 'comm'],
  ['BZ=F', '布伦特原油', 'Brent Crude', 'comm'],
  ['BTC-USD', '比特币', 'Bitcoin', 'crypto'],
  ['ETH-USD', '以太坊', 'Ethereum', 'crypto'],
];

const GROUP_ORDER = ['us', 'eu', 'asia', 'fx', 'comm', 'crypto'];
const GROUP_TITLES = {
  us: ['🇺🇸 美股', '🇺🇸 US Stocks'],
  eu: ['🇪🇺 欧股', '🇪🇺 Europe'],
  asia: ['🌏 亚洲', '🌏 Asia'],
  fx: ['💱 外汇', '💱 FX'],
  comm: ['🥇 大宗商品', '🥇 Commodities'],
  crypto: ['🪙 加密货币', '🪙 Crypto'],
};
const GROUP_DECIMALS = { us: 2, eu: 2, asia: 2, fx: 4, comm: 1, crypto: 0 };

const I18N = {
  zh: {
    title: '📊 *财经日报* · {date}',
    timeLine: '🕗 阿姆斯特丹 {ams} · 北京时间 {bj}',
    markets: '━━━━━ 🌐 全球市场 ━━━━━',
    news: '━━━━━ 📰 今日要闻 ━━━━━',
    calendar: '━━━━━ 📅 宏观日历 ━━━━━',
    usLabel: '上日收盘', euLabel: '上日收盘', asiaToday: '今日盘中', latest: '最新',
    noCalendarEvents: '今日无已排定的央行重大事件',
    monthlyPrefix: '📌 月度常规：',
    weekdays: ['周一', '周二', '周三', '周四', '周五', '周六', '周日'],
    tz: { asia: '北京', us: '美东', eu: '欧洲', fx: '伦敦', comm: '美东', crypto: 'UTC' },
    ago: (min, hr, day) => (min != null ? `${min}分钟前` : hr != null ? `${hr}小时前` : `${day}天前`),
    footer: ['数据源: Yahoo Finance / CoinGecko / Google News', '仅作信息参考，不构成投资建议'],
  },
  en: {
    title: '📊 *Daily Financial Report* · {date}',
    timeLine: '🕗 Amsterdam {ams} · Beijing {bj}',
    markets: '━━━━━ 🌐 Global Markets ━━━━━',
    news: '━━━━━ 📰 Top News ━━━━━',
    calendar: '━━━━━ 📅 Macro Calendar ━━━━━',
    usLabel: 'Last Close', euLabel: 'Last Close', asiaToday: 'Today', latest: 'Latest',
    noCalendarEvents: 'No major central-bank events scheduled today',
    monthlyPrefix: '📌 Monthly recurring: ',
    weekdays: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
    tz: { asia: 'BJ', us: 'ET', eu: 'EU', fx: 'LON', comm: 'ET', crypto: 'UTC' },
    ago: (min, hr, day) => (min != null ? `${min}min ago` : hr != null ? `${hr}h ago` : `${day}d ago`),
    footer: ['Sources: Yahoo Finance / CoinGecko / Google News', 'For information only, not investment advice'],
  },
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

function normalizeLang(language) {
  const lang = String(language ?? 'zh').toLowerCase();
  return lang === 'en' || lang === 'english' ? 'en' : 'zh';
}

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

function fmtDateTime(ts, tzName) {
  const dt = new Intl.DateTimeFormat('en-CA', {
    timeZone: tzName, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date(ts));
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

async function buildMarketSection(language) {
  const i18n = I18N[language];
  const quotes = new Map();
  for (const [symbol, zh, en, group] of MARKETS) {
    const q = await yahooQuote(symbol);
    if (q) quotes.set(symbol, { display: language === 'en' ? en : zh, group, ...q });
    await new Promise((r) => setTimeout(r, 220));
  }
  const cg = await coingeckoFallback();
  for (const [label, q] of Object.entries(cg)) {
    if (!quotes.has(label)) {
      quotes.set(label, {
        display: language === 'en' ? (label === 'BTC-USD' ? 'Bitcoin' : 'Ethereum') : (label === 'BTC-USD' ? '比特币' : '以太坊'),
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
    const [title] = GROUP_TITLES[group];
    const titleText = language === 'en' ? GROUP_TITLES[group][1] : title;
    let label;
    if (group === 'us' || group === 'eu') label = i18n.usLabel;
    else if (group === 'asia') {
      label = items.every(([, v]) => fmtDateTime(v.ts, SYMBOL_TZ[v.symbol] ?? 'UTC').date === todayBJ)
        ? i18n.asiaToday : i18n.latest;
    } else label = i18n.latest;
    lines.push(`\n${titleText} · ${label}`);
    const decimals = GROUP_DECIMALS[group];
    for (const [symbol, v] of items) {
      const pct = v.prev ? ((v.price - v.prev) / v.prev) * 100 : 0;
      const arrow = pct >= 0 ? '▲' : '▼';
      let tzLabel, tzForTime;
      if (group === 'asia') { tzLabel = i18n.tz.asia; tzForTime = 'Asia/Shanghai'; }
      else if (group === 'us') { tzLabel = i18n.tz.us; tzForTime = 'America/New_York'; }
      else if (group === 'eu') { tzLabel = i18n.tz.eu; tzForTime = SYMBOL_TZ[symbol] ?? 'Europe/Berlin'; }
      else if (group === 'fx') { tzLabel = i18n.tz.fx; tzForTime = 'Europe/London'; }
      else if (group === 'comm') { tzLabel = i18n.tz.comm; tzForTime = 'America/New_York'; }
      else { tzLabel = i18n.tz.crypto; tzForTime = 'UTC'; }
      const qt = fmtDateTime(v.ts, tzForTime);
      lines.push(`▸ ${v.display.padEnd(12)} ${formatNumber(v.price, decimals).padStart(14)}  ` +
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

async function fetchNews(language, limit = 8) {
  const i18n = I18N[language];
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
    if (secs < 3600) return i18n.ago(Math.max(1, Math.floor(secs / 60)), null, null);
    if (secs < 86400) return i18n.ago(null, Math.floor(secs / 3600), null);
    return i18n.ago(null, null, Math.floor(secs / 86400));
  };
  const lines = [];
  ranked.forEach((it, i) => {
    const title = it.title.length > 110 ? `${it.title.slice(0, 107)}…` : it.title;
    lines.push(`${i + 1}. ${title}`);
    lines.push(`   · ${it.src || 'news'} · ${ago(it.ts)}`);
  });
  return lines.length ? lines.join('\n') : (language === 'en' ? '(No news fetched, please retry later)' : '（暂无抓取到新闻，请稍后重试）');
}

// ---------------------------------------------------------------- calendar

export function buildCalendarSection({ events, monthlyNote, monthlyNoteEn, timeZone, language = 'zh' }) {
  const i18n = I18N[language];
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
  if (!upcoming.length) lines.push(i18n.noCalendarEvents);
  const flags = { US: '🇺🇸', EU: '🇪🇺', CN: '🇨🇳', JP: '🇯🇵', GB: '🇬🇧', DE: '🇩🇪', FR: '🇫🇷', NL: '🇳🇱' };
  for (const { off, ev, start } of upcoming) {
    const when = off === 0
      ? (language === 'en' ? 'Today' : '今日')
      : (language === 'en' ? `in ${off} day${off > 1 ? 's' : ''}` : `${off}天后`);
    const d = fmtDateTime(start.getTime(), timeZone);
    const name = language === 'en' ? (ev.nameEn ?? ev.name) : ev.name;
    const line = `▸ ${when} (${d.dateCN}) ${flags[ev.country] ?? ''} ${name}` +
      (ev.detail ? `（${ev.detail}）` : '');
    lines.push(line);
  }
  const note = language === 'en' ? (monthlyNoteEn ?? monthlyNote) : monthlyNote;
  if (note) lines.push(`\n${i18n.monthlyPrefix}${note}`);
  return lines.join('\n');
}

// ---------------------------------------------------------------- assemble

export async function generateReport({
  events, monthlyNote, monthlyNoteEn, timeZone = 'Europe/Amsterdam', maxNews = 8, language = 'zh',
} = {}) {
  const lang = normalizeLang(language);
  const i18n = I18N[lang];
  const now = new Date();
  const ams = fmtDateTime(now.getTime(), timeZone);
  const bj = fmtDateTime(now.getTime(), 'Asia/Shanghai');
  const weekday = lang === 'en'
    ? i18n.weekdays[now.getDay() === 0 ? 6 : now.getDay() - 1]
    : i18n.weekdays[now.getDay() === 0 ? 6 : now.getDay() - 1];
  const date = lang === 'en'
    ? `${weekday}, ${new Intl.DateTimeFormat('en-US', { month: 'short' }).format(now)} ${now.getDate()}`
    : `${now.getMonth() + 1}月${now.getDate()}日 ${weekday}`;
  const [market, news, cal] = await Promise.all([
    buildMarketSection(lang),
    fetchNews(lang, maxNews),
    Promise.resolve(buildCalendarSection({ events, monthlyNote, monthlyNoteEn, timeZone, language: lang })),
  ]);
  return [
    i18n.title.replace('{date}', date),
    i18n.timeLine
      .replace('{ams}', `${Number(ams.date.slice(5, 7))}/${Number(ams.date.slice(8, 10))} ${ams.time}`)
      .replace('{bj}', `${bj.dateCN} ${bj.time}`),
    '',
    i18n.markets,
    market,
    '',
    i18n.news,
    news,
    '',
    i18n.calendar,
    cal,
    '',
    '━━━━━',
    ...i18n.footer,
  ].join('\n');
}
