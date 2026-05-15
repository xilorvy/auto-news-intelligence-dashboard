const fallbackStories = [
  {
    title: "China-Taiwan pressure keeps chip supply chain risk elevated",
    source: "Scenario desk",
    url: "#",
    publishedAt: new Date().toISOString(),
    summary:
      "Fresh military signaling around Taiwan raises the risk premium for semiconductors, with Nvidia and advanced foundry exposure likely to trade defensively if rhetoric escalates.",
    sentiment: "bearish",
    score: -78,
    tags: ["China-Taiwan", "Nvidia", "Semiconductors"],
    impacts: { equities: -70, crypto: -24, oil: 18, gold: 64 }
  },
  {
    title: "Crypto liquidity improves as dollar pressure cools",
    source: "Scenario desk",
    url: "#",
    publishedAt: new Date().toISOString(),
    summary:
      "Bitcoin and Ethereum show better breadth as macro volatility eases. Geopolitical headline risk remains the main drag on sustained risk-on positioning.",
    sentiment: "bullish",
    score: 46,
    tags: ["Crypto", "Liquidity", "Dollar"],
    impacts: { equities: 18, crypto: 72, oil: -8, gold: -16 }
  },
  {
    title: "Oil catches a bid while gold stays supported by safe-haven demand",
    source: "Scenario desk",
    url: "#",
    publishedAt: new Date().toISOString(),
    summary:
      "Energy traders price a modest supply risk premium while gold remains resilient. The move points to cautious hedging rather than outright panic.",
    sentiment: "neutral",
    score: -8,
    tags: ["Oil", "Gold", "Safe haven"],
    impacts: { equities: -12, crypto: -10, oil: 52, gold: 48 }
  }
];

let stories = [];
let activeFilter = "all";
let latestGeneratedAt = null;
let fearGreed = null;
const realtimeIntervalMs = 10000;
let realtimeSource = null;

const els = {
  feed: document.querySelector("#feed"),
  refreshBtn: document.querySelector("#refreshBtn"),
  briefingBtn: document.querySelector("#briefingBtn"),
  executiveSummary: document.querySelector("#executiveSummary"),
  updatedAt: document.querySelector("#updatedAt"),
  liveStatus: document.querySelector("#liveStatus"),
  riskScore: document.querySelector("#riskScore"),
  riskLabel: document.querySelector("#riskLabel"),
  equityScore: document.querySelector("#equityScore"),
  cryptoScore: document.querySelector("#cryptoScore"),
  commodityScore: document.querySelector("#commodityScore"),
  btcFearValue: document.querySelector("#btcFearValue"),
  btcFearLabel: document.querySelector("#btcFearLabel"),
  btcFearDate: document.querySelector("#btcFearDate"),
  btcFearMeter: document.querySelector("#btcFearMeter"),
  goldFearValue: document.querySelector("#goldFearValue"),
  goldFearLabel: document.querySelector("#goldFearLabel"),
  goldFearDate: document.querySelector("#goldFearDate"),
  goldFearMeter: document.querySelector("#goldFearMeter"),
  sectorGrid: document.querySelector("#sectorGrid"),
  watchlist: document.querySelector("#watchlist"),
  impactGrid: document.querySelector("#impactGrid"),
  toast: document.querySelector("#toast")
};

async function loadStories() {
  try {
    const response = await fetch(`./data/news.json?ts=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) throw new Error("No generated data yet");
    const payload = await response.json();
    stories = Array.isArray(payload.stories) && payload.stories.length ? payload.stories : fallbackStories;
    fearGreed = payload.fearGreed ?? buildFallbackFearGreed(stories);
    latestGeneratedAt = payload.generatedAt ?? new Date().toISOString();
    if (!realtimeSource) {
      els.liveStatus.textContent = `Live polling every ${Math.round(realtimeIntervalMs / 1000)}s`;
    }
  } catch {
    stories = fallbackStories;
    fearGreed = buildFallbackFearGreed(stories);
    latestGeneratedAt = new Date().toISOString();
    els.liveStatus.textContent = "Demo fallback feed";
  }

  render();
}

function average(values) {
  const valid = values.filter((value) => Number.isFinite(value));
  if (!valid.length) return 0;
  return Math.round(valid.reduce((sum, value) => sum + value, 0) / valid.length);
}

function classifyScore(score) {
  if (score > 20) return "bullish";
  if (score < -20) return "bearish";
  return "neutral";
}

function render() {
  const risk = average(stories.map((story) => story.score));
  const equities = average(stories.map((story) => story.impacts?.equities ?? 0));
  const crypto = average(stories.map((story) => story.impacts?.crypto ?? 0));
  const commodities = average(stories.map((story) => average([story.impacts?.oil ?? 0, story.impacts?.gold ?? 0])));

  els.riskScore.textContent = signed(risk);
  els.riskLabel.textContent = classifyScore(risk).toUpperCase();
  els.equityScore.textContent = signed(equities);
  els.cryptoScore.textContent = signed(crypto);
  els.commodityScore.textContent = signed(commodities);
  els.updatedAt.textContent = `Data ${new Date(latestGeneratedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;

  els.executiveSummary.textContent = buildExecutiveSummary(risk, equities, crypto, commodities);
  renderWatchlist();
  renderFearGreed();
  renderSectorTrends();
  renderFeed();
  renderImpactGrid({ risk, equities, crypto, commodities });
}

function signed(value) {
  return value > 0 ? `+${value}` : `${value}`;
}

function buildExecutiveSummary(risk, equities, crypto, commodities) {
  const lead = risk < -20 ? "Risk-off tone dominates" : risk > 20 ? "Risk appetite is improving" : "Markets are balanced but headline-sensitive";
  return `${lead}. Equities score ${signed(equities)}, crypto ${signed(crypto)}, commodities ${signed(commodities)}. Main driver: ${topTheme()}.`;
}

function topTheme() {
  const counts = new Map();
  stories.flatMap((story) => story.tags ?? []).forEach((tag) => counts.set(tag, (counts.get(tag) ?? 0) + 1));
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "macro uncertainty";
}

function renderWatchlist() {
  const items = [
    "China-Taiwan escalation language and naval activity",
    "Nvidia / TSMC supply chain sensitivity",
    "BTC reaction to dollar yields and liquidity",
    "Oil risk premium versus actual supply disruption",
    "Gold bid as stress thermometer"
  ];

  els.watchlist.innerHTML = items.map((item) => `<li>${item}</li>`).join("");
}

function renderFearGreed() {
  const btc = fearGreed?.btc ?? buildFallbackFearGreed(stories).btc;
  const gold = fearGreed?.gold ?? buildFallbackFearGreed(stories).gold;

  renderFearCard("btc", btc);
  renderFearCard("gold", gold);
}

function renderFearCard(asset, data) {
  const value = clampPercent(Number(data.value ?? 50));
  els[`${asset}FearValue`].textContent = value;
  els[`${asset}FearLabel`].textContent = data.label ?? fearGreedLabel(value);
  els[`${asset}FearDate`].textContent = data.updatedAt ? dailyDate(data.updatedAt) : "--";
  els[`${asset}FearMeter`].style.width = `${value}%`;
}

function renderSectorTrends() {
  const sectors = buildSectorTrends();
  els.sectorGrid.innerHTML = sectors
    .map(
      (sector) => `
        <article class="sector-card">
          <small>${sector.name}</small>
          <strong class="${sector.className}">${sector.trend}</strong>
          <strong class="sector-score ${sector.className}">${signed(sector.score)}</strong>
          <p>${sector.note}</p>
        </article>
      `
    )
    .join("");
}

function buildSectorTrends() {
  return [
    sectorTrend("Geopolitics", ["China-Taiwan"], "score", "Headline tension and diplomatic risk."),
    sectorTrend("Semiconductors", ["Nvidia", "Semiconductors"], "equities", "AI chip supply chain and export-control exposure."),
    sectorTrend("Crypto", ["Crypto"], "crypto", "BTC/ETH momentum from risk appetite and liquidity."),
    sectorTrend("Oil", ["Oil"], "oil", "Energy supply risk and macro inflation pressure."),
    sectorTrend("Gold", ["Gold"], "gold", "Safe-haven demand and stress hedging."),
    sectorTrend("Equities", ["Nvidia", "China-Taiwan", "Crypto", "Oil", "Gold"], "equities", "Broad market beta from all tracked headline clusters.")
  ];
}

function sectorTrend(name, tags, impactKey, note) {
  const matched = stories.filter((story) => tags.some((tag) => story.tags?.includes(tag)));
  const source = matched.length ? matched : stories;
  const score = average(source.map((story) => (impactKey === "score" ? story.score : story.impacts?.[impactKey] ?? story.score)));
  const trend = trendLabel(score);

  return {
    name,
    score,
    trend,
    note: `${note} ${matched.length} tracked headlines.`,
    className: score > 15 ? "trend-up" : score < -15 ? "trend-down" : "trend-flat"
  };
}

function trendLabel(score) {
  if (score > 35) return "Strong Uptrend";
  if (score > 15) return "Uptrend";
  if (score < -35) return "Strong Downtrend";
  if (score < -15) return "Downtrend";
  return "Sideways";
}

function buildFallbackFearGreed(items) {
  const btcScore = average(items.filter((story) => story.tags?.includes("Crypto")).map((story) => story.impacts?.crypto ?? story.score));
  const goldScore = average(items.filter((story) => story.tags?.includes("Gold")).map((story) => story.impacts?.gold ?? story.score));
  const now = new Date().toISOString();

  return {
    btc: {
      value: scoreToIndex(btcScore),
      label: fearGreedLabel(scoreToIndex(btcScore)),
      source: "News-derived fallback",
      updatedAt: now
    },
    gold: {
      value: scoreToIndex(goldScore),
      label: fearGreedLabel(scoreToIndex(goldScore)),
      source: "News-derived fallback",
      updatedAt: now
    }
  };
}

function renderFeed() {
  const visible = activeFilter === "all" ? stories : stories.filter((story) => story.sentiment === activeFilter);
  els.feed.innerHTML = visible
    .map(
      (story) => `
        <article class="story">
          <div class="story-meta">
            <span class="pill ${story.sentiment}">${story.sentiment.toUpperCase()} ${signed(story.score)}</span>
            <span>${story.source}</span>
            <span>${formatDate(story.publishedAt)}</span>
          </div>
          <h3>${story.url && story.url !== "#" ? `<a href="${story.url}" target="_blank" rel="noreferrer">${story.title}</a>` : story.title}</h3>
          <p>${story.summary}</p>
          <div class="tags">${(story.tags ?? []).map((tag) => `<span class="tag">${tag}</span>`).join("")}</div>
        </article>
      `
    )
    .join("");
}

function renderImpactGrid(scores) {
  const cards = [
    ["China-Taiwan", scores.risk, "Higher tension usually pressures semis and supports defensive hedges."],
    ["Nvidia", scores.equities, "AI chip momentum is sensitive to export controls and Taiwan supply risk."],
    ["Crypto", scores.crypto, "Risk appetite and liquidity remain the cleanest read-through."],
    ["Oil", average(stories.map((story) => story.impacts?.oil ?? 0)), "Supply risk premium can rise even before barrels are disrupted."],
    ["Gold", average(stories.map((story) => story.impacts?.gold ?? 0)), "Safe-haven demand tends to firm when geopolitical uncertainty widens."]
  ];

  els.impactGrid.innerHTML = cards
    .map(
      ([name, score, note]) => `
        <article class="impact-card">
          <small>${name}</small>
          <strong class="${classifyScore(score)}">${signed(score)}</strong>
          <p>${note}</p>
        </article>
      `
    )
    .join("");
}

function formatDate(value) {
  return new Intl.DateTimeFormat([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function dailyDate(value) {
  return new Intl.DateTimeFormat([], { month: "short", day: "numeric" }).format(new Date(value));
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

function briefingText() {
  return [
    "Auto News Intelligence - Morning Brief",
    "",
    els.executiveSummary.textContent,
    "",
    ...stories.slice(0, 5).map((story, index) => `${index + 1}. [${story.sentiment.toUpperCase()} ${signed(story.score)}] ${story.title} - ${story.summary}`)
  ].join("\n");
}

function toast(message) {
  els.toast.textContent = message;
  els.toast.classList.add("show");
  window.setTimeout(() => els.toast.classList.remove("show"), 1800);
}

document.querySelectorAll("[data-filter]").forEach((button) => {
  button.addEventListener("click", () => {
    activeFilter = button.dataset.filter;
    document.querySelectorAll("[data-filter]").forEach((item) => item.classList.toggle("active", item === button));
    renderFeed();
  });
});

els.refreshBtn.addEventListener("click", () => {
  loadStories();
  toast("Feed refreshed");
});

els.briefingBtn.addEventListener("click", async () => {
  await navigator.clipboard.writeText(briefingText());
  toast("Briefing copied");
});

loadStories();
window.setInterval(loadStories, realtimeIntervalMs);
connectRealtime();

function connectRealtime() {
  if (!("EventSource" in window)) return;

  realtimeSource = new EventSource("/events");
  realtimeSource.addEventListener("hello", () => {
    els.liveStatus.textContent = "Realtime stream connected";
  });
  realtimeSource.addEventListener("update", () => {
    els.liveStatus.textContent = "Realtime update received";
    loadStories();
  });
  realtimeSource.addEventListener("error", () => {
    realtimeSource?.close();
    realtimeSource = null;
    els.liveStatus.textContent = `Live polling every ${Math.round(realtimeIntervalMs / 1000)}s`;
  });
}
