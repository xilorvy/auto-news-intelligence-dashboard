# Auto News Intelligence Dashboard

Daily dashboard untuk geopolitics-to-market sentiment: scrape RSS, summarize, classify bullish/bearish/neutral, dan render cross-asset impact untuk equities, crypto, oil, dan gold.

Termasuk Fear & Greed harian untuk:

- BTC: dari Alternative.me Crypto Fear & Greed Index, fallback ke headline crypto kalau API gagal.
- Gold: model news-derived dari headline gold, oil shock, dan safe-haven stress.

Dashboard juga menghitung overall trend per sector:

- Geopolitics
- Semiconductors / Nvidia
- Crypto
- Oil
- Gold
- Equities

Crypto sector trend now blends news momentum with BTC price confirmation. If headlines are bullish but BTC price action is weak or breaking down, the dashboard marks Crypto as divergence/caution instead of a clean uptrend.

## Run

```powershell
npm run live
```

Buka `http://localhost:4173`.

`npm run live` menjalankan web server, scraper RSS otomatis tiap 60 detik, dan realtime event stream. Dashboard langsung update saat scrape selesai, dengan polling 10 detik sebagai fallback.

Kalau mau jalan manual:

```powershell
npm run scrape
npm run dev
```

Kalau cuma mau updater data realtime tanpa server:

```powershell
npm run scrape:watch
```

## Daily Briefing

```powershell
npm run briefing
```

Command ini update `data/news.json` dan print email briefing harian ke terminal.

## Notes

- Dashboard menerima Server-Sent Events dari `/events`, lalu auto-refresh tiap 10 detik sebagai fallback.
- Live server scrape RSS tiap 60 detik. Bisa diubah dengan env `SCRAPE_INTERVAL_MS`.
- Scraper default memprioritaskan berita 48 jam terakhir. Bisa diubah dengan env `MAX_STORY_AGE_HOURS`.
- Fear & Greed ikut disimpan di `data/news.json` pada field `fearGreed`.
- Overall trend per sector dihitung langsung di dashboard dari headline score dan impact map terbaru.
- BTC price confirmation uses Binance daily candles first, then CoinGecko daily market chart as fallback.
- If both price APIs fail, BTC confirmation reuses the last valid cached signal for up to 24 hours. Override with `MAX_CACHED_SIGNAL_AGE_HOURS`.
- Kalau scrape belum jalan atau network gagal, UI pakai scenario fallback supaya dashboard tetap kebaca.
- Scoring sekarang keyword-based agar ringan dan bisa jalan tanpa API key. Nanti bisa diganti OpenAI classification/summarization untuk hasil lebih tajam.
