import fs from "node:fs/promises";
import path from "node:path";

const feeds = [
  "https://feeds.bbci.co.uk/news/world/rss.xml",
  "https://www.aljazeera.com/xml/rss/all.xml",
  "https://cointelegraph.com/rss",
  "https://www.investing.com/rss/news_25.rss",
  "https://news.google.com/rss/search?q=China%20Taiwan%20geopolitics%20when:2d&hl=en-US&gl=US&ceid=US:en",
  "https://news.google.com/rss/search?q=Nvidia%20semiconductor%20Taiwan%20when:2d&hl=en-US&gl=US&ceid=US:en",
  "https://news.google.com/rss/search?q=Bitcoin%20crypto%20market%20when:2d&hl=en-US&gl=US&ceid=US:en",
  "https://news.google.com/rss/search?q=oil%20gold%20market%20geopolitics%20when:2d&hl=en-US&gl=US&ceid=US:en"
];

const bullishWords = ["rally", "gain", "surge", "eases", "deal", "growth", "approval", "inflow", "rebound", "record"];
const bearishWords = ["conflict", "war", "sanction", "tariff", "risk", "attack", "falls", "slump", "ban", "escalation", "crisis"];
const topicMap = [
  ["China-Taiwan", ["taiwan", "china"]],
  ["Nvidia", ["nvidia", "chip", "chips", "semiconductor", "semiconductors", "tsmc"]],
  ["Crypto", ["bitcoin", "crypto", "ethereum", "btc", "eth"]],
  ["Oil", ["oil", "brent", "opec", "crude"]],
  ["Gold", ["gold", "bullion", "safe haven", "safe-haven"]]
];

const outputPath = path.join(process.cwd(), "data", "news.json");
const briefingMode = process.argv.includes("--briefing");
const watchMode = process.argv.includes("--watch");
const watchIntervalMs = Number(process.env.SCRAPE_INTERVAL_MS ?? 60000);
const maxStoryAgeHours = Number(process.env.MAX_STORY_AGE_HOURS ?? 48);

if (watchMode) {
  await scrapeOnce();
  console.log(`Watching feeds every ${Math.round(watchIntervalMs / 1000)}s`);
  setInterval(scrapeOnce, watchIntervalMs);
} else {
  const stories = await scrapeOnce();
  if (briefingMode) {
    console.log(buildBriefing(stories));
  }
}

async function scrapeOnce() {
  const rawItems = (await Promise.allSettled(feeds.map(readFeed))).flatMap((result) => (result.status === "fulfilled" ? result.value : []));
  const normalized = dedupeStories(rawItems.map(normalizeStory).filter((story) => story.tags.length > 0));
  const freshStories = normalized.filter((story) => storyAgeHours(story) <= maxStoryAgeHours);
  const storyPool = freshStories.length >= 12 ? freshStories : normalized.filter((story) => storyAgeHours(story) <= 168);
  const stories = storyPool
    .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt) || Math.abs(b.score) - Math.abs(a.score))
    .slice(0, 32);
  const fearGreed = await buildFearGreed(stories);
  const marketSignals = await buildMarketSignals();

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, JSON.stringify({ generatedAt: new Date().toISOString(), stories, fearGreed, marketSignals }, null, 2));
  console.log(`Saved ${stories.length} intelligence stories to ${outputPath}`);
  return stories;
}

async function readFeed(url) {
  const response = await fetch(url, { headers: { "user-agent": "AutoNewsIntelligence/0.1" } });
  if (!response.ok) throw new Error(`Failed ${url}: ${response.status}`);
  const xml = await response.text();
  const itemMatches = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)];
  const entryMatches = [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)];
  return [...itemMatches, ...entryMatches].map((match) => parseItem(match[1], url));
}

function parseItem(xml, sourceUrl) {
  const itemUrl = clean(readTag(xml, "link")) || clean(readHref(xml));
  const source = clean(readTag(xml, "source")) || new URL(sourceUrl).hostname.replace("www.", "");

  return {
    title: clean(readTag(xml, "title")),
    summary: clean(readTag(xml, "description")),
    url: itemUrl,
    publishedAt: clean(readTag(xml, "pubDate")) || clean(readTag(xml, "published")) || clean(readTag(xml, "updated")) || new Date().toISOString(),
    source
  };
}

function readTag(xml, tag) {
  const match = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return match?.[1] ?? "";
}

function readHref(xml) {
  const match = xml.match(/<link[^>]+href=["']([^"']+)["'][^>]*>/i);
  return match?.[1] ?? "";
}

function clean(value) {
  return value
    .replace(/<!\[CDATA\[|\]\]>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/<[^>]+>/g, " ")
    .replace(/\u00e2\u20ac\u02dc|\u00e2\u20ac\u2122/g, "'")
    .replace(/\u00e2\u20ac\u0153|\u00e2\u20ac\u009d/g, '"')
    .replace(/\u00e2\u20ac\u201c|\u00e2\u20ac\u201d/g, "-")
    .replace(/â€˜|â€™/g, "'")
    .replace(/â€œ|â€/g, '"')
    .replace(/â€™/g, "'")
    .replace(/â€œ|â€/g, '"')
    .replace(/â€"/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeStory(item) {
  const text = `${item.title} ${item.summary}`.toLowerCase();
  const score = scoreText(text);
  const sentiment = score > 20 ? "bullish" : score < -20 ? "bearish" : "neutral";
  const tags = topicMap.filter(([, words]) => words.some((word) => hasTerm(text, word))).map(([tag]) => tag);

  return {
    ...item,
    publishedAt: Number.isNaN(Date.parse(item.publishedAt)) ? new Date().toISOString() : new Date(item.publishedAt).toISOString(),
    summary: summarize(item.summary || item.title),
    sentiment,
    score,
    tags,
    impacts: inferImpacts(text, score)
  };
}

function dedupeStories(items) {
  const seen = new Set();
  return items.filter((item) => {
    const key = item.title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function storyAgeHours(story) {
  return (Date.now() - Date.parse(story.publishedAt)) / 36e5;
}

function scoreText(text) {
  const bullish = bullishWords.filter((word) => hasTerm(text, word)).length;
  const bearish = bearishWords.filter((word) => hasTerm(text, word)).length;
  return Math.max(-100, Math.min(100, (bullish - bearish) * 22));
}

function summarize(text) {
  const sentences = text.split(/(?<=[.!?])\s+/).filter(Boolean);
  return (sentences.slice(0, 2).join(" ") || text).slice(0, 260);
}

function inferImpacts(text, score) {
  const geoShock = ["taiwan", "china", "war", "attack", "sanction", "conflict"].some((word) => hasTerm(text, word));
  const crypto = ["bitcoin", "crypto", "ethereum", "btc", "eth"].some((word) => hasTerm(text, word));
  const oil = ["oil", "brent", "opec", "crude"].some((word) => hasTerm(text, word));
  const gold = ["gold", "safe haven", "safe-haven", "bullion"].some((word) => hasTerm(text, word));
  const nvidia = ["nvidia", "chip", "chips", "semiconductor", "semiconductors", "tsmc"].some((word) => hasTerm(text, word));

  return {
    equities: clamp(score - (geoShock ? 28 : 0) - (nvidia && geoShock ? 22 : 0)),
    crypto: clamp(crypto ? score + 28 : score / 2),
    oil: clamp(oil ? score + 34 : geoShock ? 20 : 0),
    gold: clamp(gold ? score + 34 : geoShock ? 48 : -score / 4)
  };
}

function clamp(value) {
  return Math.round(Math.max(-100, Math.min(100, value)));
}

async function buildFearGreed(stories) {
  const [btc, gold] = await Promise.all([readBtcFearGreed(), buildGoldFearGreed(stories)]);
  return { btc, gold };
}

async function readBtcFearGreed() {
  try {
    const response = await fetch("https://api.alternative.me/fng/?limit=1&format=json", {
      headers: { "user-agent": "AutoNewsIntelligence/0.1" }
    });
    if (!response.ok) throw new Error(`BTC fear greed failed: ${response.status}`);
    const payload = await response.json();
    const latest = payload?.data?.[0];
    const value = clampPercent(Number(latest?.value ?? 50));

    return {
      value,
      label: latest?.value_classification ?? fearGreedLabel(value),
      source: "Alternative.me Crypto Fear & Greed Index",
      updatedAt: latest?.timestamp ? new Date(Number(latest.timestamp) * 1000).toISOString() : new Date().toISOString()
    };
  } catch {
    const score = average(stories.filter((story) => story.tags.includes("Crypto")).map((story) => story.impacts.crypto));
    const value = scoreToIndex(score);
    return {
      value,
      label: fearGreedLabel(value),
      source: "News-derived BTC fallback",
      updatedAt: new Date().toISOString()
    };
  }
}

function buildGoldFearGreed(stories) {
  const goldStories = stories.filter((story) => story.tags.includes("Gold"));
  const goldImpact = average(goldStories.map((story) => story.impacts.gold));
  const safeHavenStress = average(
    stories
      .filter((story) => ["China-Taiwan", "Oil", "Gold"].some((tag) => story.tags.includes(tag)))
      .map((story) => (story.score < 0 ? Math.abs(story.score) : 0))
  );
  const value = clampPercent(Math.round(50 + goldImpact * 0.35 + safeHavenStress * 0.25));

  return {
    value,
    label: fearGreedLabel(value),
    source: "Gold news and safe-haven demand model",
    updatedAt: new Date().toISOString()
  };
}

function average(values) {
  const valid = values.filter((value) => Number.isFinite(value));
  if (!valid.length) return 0;
  return Math.round(valid.reduce((sum, value) => sum + value, 0) / valid.length);
}

function scoreToIndex(score) {
  return clampPercent(Math.round(50 + score / 2));
}

function clampPercent(value) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function fearGreedLabel(value) {
  if (value <= 24) return "Extreme Fear";
  if (value <= 44) return "Fear";
  if (value <= 55) return "Neutral";
  if (value <= 74) return "Greed";
  return "Extreme Greed";
}

async function buildMarketSignals() {
  return {
    btc: await readBtcPriceTrend()
  };
}

async function readBtcPriceTrend() {
  const binance = await readBtcFromBinance();
  if (binance) return binance;

  const coinGecko = await readBtcFromCoinGecko();
  if (coinGecko) return coinGecko;

  return {
    price: null,
    ma20: null,
    ma50: null,
    dailyReturn: null,
    sevenDayReturn: null,
    prior20Low: null,
    breakdown: false,
    trend: "Unavailable",
    score: 0,
    source: "Unavailable",
    updatedAt: new Date().toISOString()
  };
}

async function readBtcFromBinance() {
  try {
    const response = await fetch("https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1d&limit=60", {
      headers: { "user-agent": "AutoNewsIntelligence/0.1" }
    });
    if (!response.ok) throw new Error(`BTC price trend failed: ${response.status}`);
    const candles = await response.json();
    const closes = candles.map((candle) => Number(candle[4])).filter(Number.isFinite);
    if (closes.length < 30) throw new Error("Not enough BTC candles");

    const close = closes.at(-1);
    const previousClose = closes.at(-2);
    const ma20 = average(closes.slice(-20));
    const ma50 = average(closes.slice(-50));
    const prior20Low = Math.min(...closes.slice(-21, -1));
    const sevenDayReturn = ((close - closes.at(-8)) / closes.at(-8)) * 100;
    const dailyReturn = ((close - previousClose) / previousClose) * 100;
    const breakdown = close < ma20 && close < prior20Low;
    const trend = breakdown ? "Breakdown" : close > ma20 && ma20 > ma50 ? "Uptrend" : close < ma20 ? "Weakening" : "Sideways";
    const score = breakdown ? -70 : trend === "Weakening" ? -35 : trend === "Uptrend" ? 55 : 0;

    return {
      price: Math.round(close),
      ma20: Math.round(ma20),
      ma50: Math.round(ma50),
      dailyReturn: round(dailyReturn),
      sevenDayReturn: round(sevenDayReturn),
      prior20Low: Math.round(prior20Low),
      breakdown,
      trend,
      score,
      source: "Binance BTCUSDT daily candles",
      updatedAt: new Date(Number(candles.at(-1)[6])).toISOString()
    };
  } catch {
    return null;
  }
}

async function readBtcFromCoinGecko() {
  try {
    const response = await fetch("https://api.coingecko.com/api/v3/coins/bitcoin/market_chart?vs_currency=usd&days=90&interval=daily", {
      headers: { "user-agent": "AutoNewsIntelligence/0.1" }
    });
    if (!response.ok) throw new Error(`BTC price trend failed: ${response.status}`);
    const payload = await response.json();
    const prices = payload.prices ?? [];
    const closes = prices.map(([, price]) => Number(price)).filter(Number.isFinite);
    if (closes.length < 30) throw new Error("Not enough BTC prices");

    const close = closes.at(-1);
    const previousClose = closes.at(-2);
    const ma20 = average(closes.slice(-20));
    const ma50 = average(closes.slice(-50));
    const prior20Low = Math.min(...closes.slice(-21, -1));
    const sevenDayReturn = ((close - closes.at(-8)) / closes.at(-8)) * 100;
    const dailyReturn = ((close - previousClose) / previousClose) * 100;
    const breakdown = close < ma20 && close < prior20Low;
    const trend = breakdown ? "Breakdown" : close > ma20 && ma20 > ma50 ? "Uptrend" : close < ma20 ? "Weakening" : "Sideways";
    const score = breakdown ? -70 : trend === "Weakening" ? -35 : trend === "Uptrend" ? 55 : 0;

    return {
      price: Math.round(close),
      ma20: Math.round(ma20),
      ma50: Math.round(ma50),
      dailyReturn: round(dailyReturn),
      sevenDayReturn: round(sevenDayReturn),
      prior20Low: Math.round(prior20Low),
      breakdown,
      trend,
      score,
      source: "CoinGecko BTC daily market chart",
      updatedAt: new Date(prices.at(-1)[0]).toISOString()
    };
  } catch {
    return null;
  }
}

function round(value) {
  return Math.round(value * 100) / 100;
}

function hasTerm(text, term) {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, "i").test(text);
}

function buildBriefing(items) {
  return [
    "Auto News Intelligence - Daily Briefing",
    `Generated: ${new Date().toLocaleString()}`,
    "",
    ...items.slice(0, 8).map((story, index) => `${index + 1}. [${story.sentiment.toUpperCase()} ${story.score}] ${story.title}\n   ${story.summary}\n   Tags: ${story.tags.join(", ")}\n   ${story.url}`)
  ].join("\n");
}
