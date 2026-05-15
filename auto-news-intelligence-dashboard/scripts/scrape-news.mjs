import fs from "node:fs/promises";
import path from "node:path";

const feeds = [
  "https://feeds.bbci.co.uk/news/world/rss.xml",
  "https://www.aljazeera.com/xml/rss/all.xml",
  "https://cointelegraph.com/rss",
  "https://www.investing.com/rss/news_25.rss"
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
  const stories = rawItems
    .map(normalizeStory)
    .filter((story) => story.tags.length > 0)
    .sort((a, b) => Math.abs(b.score) - Math.abs(a.score))
    .slice(0, 24);
  const fearGreed = await buildFearGreed(stories);

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, JSON.stringify({ generatedAt: new Date().toISOString(), stories, fearGreed }, null, 2));
  console.log(`Saved ${stories.length} intelligence stories to ${outputPath}`);
  return stories;
}

async function readFeed(url) {
  const response = await fetch(url, { headers: { "user-agent": "AutoNewsIntelligence/0.1" } });
  if (!response.ok) throw new Error(`Failed ${url}: ${response.status}`);
  const xml = await response.text();
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((match) => parseItem(match[1], url));
}

function parseItem(xml, sourceUrl) {
  return {
    title: clean(readTag(xml, "title")),
    summary: clean(readTag(xml, "description")),
    url: clean(readTag(xml, "link")),
    publishedAt: clean(readTag(xml, "pubDate")) || new Date().toISOString(),
    source: new URL(sourceUrl).hostname.replace("www.", "")
  };
}

function readTag(xml, tag) {
  const match = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return match?.[1] ?? "";
}

function clean(value) {
  return value
    .replace(/<!\[CDATA\[|\]\]>/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
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
