const express = require("express");
const cors = require("cors");
const axios = require("axios");
const dotenv = require("dotenv");
const path = require("path");

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const NEWS_API_KEY = process.env.NEWS_API_KEY || "";
const TRANSLATE_API_URL =
  process.env.TRANSLATE_API_URL || "https://libretranslate.de/translate";
const ALERT_INTERVAL_MINUTES = Number(process.env.ALERT_INTERVAL_MINUTES || 15);
const ALERT_BTC_CHANGE_THRESHOLD = Number(
  process.env.ALERT_BTC_CHANGE_THRESHOLD || 3
);
const ALERT_NASDAQ_CHANGE_THRESHOLD = Number(
  process.env.ALERT_NASDAQ_CHANGE_THRESHOLD || 2
);
const ALERT_USDKRW_CHANGE_THRESHOLD = Number(
  process.env.ALERT_USDKRW_CHANGE_THRESHOLD || 1
);
const ALERT_FG_EXTREME = Number(process.env.ALERT_FG_EXTREME || 20);
const ALERT_REQUIRE_NASDAQ_AND_USDKRW =
  String(process.env.ALERT_REQUIRE_NASDAQ_AND_USDKRW || "false").toLowerCase() ===
  "true";
const ALERT_MESSAGE_MODE = (
  process.env.ALERT_MESSAGE_MODE || "compact"
).toLowerCase();
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || "";
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL || "";

app.use(cors());
app.use(express.json());

const publicDir = path.join(__dirname, "public");
app.use(express.static(publicDir));
app.get("/", (_req, res) => {
  res.sendFile(path.join(publicDir, "index.html"));
});

const SYMBOLS = [
  { key: "nasdaq", symbol: "^IXIC", name: "NASDAQ Composite" },
  { key: "sp500", symbol: "^GSPC", name: "S&P 500" },
  { key: "kospi", symbol: "^KS11", name: "KOSPI" },
  { key: "gold", symbol: "GC=F", name: "Gold Futures" },
  { key: "silver", symbol: "SI=F", name: "Silver Futures" },
  { key: "btc", symbol: "BTC-USD", name: "Bitcoin" },
  { key: "eth", symbol: "ETH-USD", name: "Ethereum" },
  { key: "usdkrw", symbol: "KRW=X", name: "USD/KRW" },
  { key: "oil", symbol: "CL=F", name: "WTI Oil" },
  { key: "us10y", symbol: "^TNX", name: "US 10Y Yield" }
];

async function fetchYahooChart(symbol, range = "1mo", interval = "1d") {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
    symbol
  )}?range=${range}&interval=${interval}`;
  const { data } = await axios.get(url, { timeout: 10000 });
  const result = data?.chart?.result?.[0];

  if (!result || !result.timestamp || !result.indicators?.quote?.[0]?.close) {
    throw new Error(`Invalid Yahoo response for ${symbol}`);
  }

  const closes = result.indicators.quote[0].close;
  const points = result.timestamp
    .map((ts, idx) => ({
      date: new Date(ts * 1000).toISOString().slice(0, 10),
      value: closes[idx]
    }))
    .filter((p) => p.value !== null && p.value !== undefined);

  const latest = points.length ? points[points.length - 1].value : null;
  return { symbol, points, latest };
}

async function fetchFearGreed() {
  const { data } = await axios.get("https://api.alternative.me/fng/?limit=1", {
    timeout: 10000
  });
  const current = data?.data?.[0];
  if (!current) {
    throw new Error("Unable to fetch fear & greed");
  }
  return {
    value: Number(current.value),
    valueText: current.value_classification,
    timestamp: current.timestamp
  };
}

function summarizeText(text) {
  if (!text) return "";
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return "";
  if (clean.length <= 180) return clean;
  return `${clean.slice(0, 180)}...`;
}

async function translateToKorean(text) {
  if (!text) return "";
  const plain = text.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  if (!plain) return "";
  const hasKorean = (value) => /[ㄱ-ㅎ|ㅏ-ㅣ|가-힣]/.test(value || "");
  try {
    const { data } = await axios.post(
      TRANSLATE_API_URL,
      {
        q: plain,
        source: "auto",
        target: "ko",
        format: "text"
      },
      {
        timeout: 10000,
        headers: { "Content-Type": "application/json" }
      }
    );
    const first = data?.translatedText || "";
    if (first && hasKorean(first)) return first;
  } catch (error) {
    // fall through to fallback translator
  }
  try {
    const fallbackUrl = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=ko&dt=t&q=${encodeURIComponent(
      plain
    )}`;
    const { data } = await axios.get(fallbackUrl, { timeout: 10000 });
    const translated = (data?.[0] || []).map((chunk) => chunk?.[0] || "").join("");
    if (translated && hasKorean(translated)) return translated;
    return "";
  } catch (fallbackError) {
    return "";
  }
}

async function sendTelegramMessage(text) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return;
  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
  await axios.post(
    url,
    {
      chat_id: TELEGRAM_CHAT_ID,
      text
    },
    { timeout: 10000 }
  );
}

async function sendDiscordMessage(text) {
  if (!DISCORD_WEBHOOK_URL) return;
  await axios.post(
    DISCORD_WEBHOOK_URL,
    { content: text },
    { timeout: 10000 }
  );
}

async function sendAlerts(text) {
  const tasks = [];
  if (TELEGRAM_BOT_TOKEN && TELEGRAM_CHAT_ID) tasks.push(sendTelegramMessage(text));
  if (DISCORD_WEBHOOK_URL) tasks.push(sendDiscordMessage(text));
  if (!tasks.length) return;
  await Promise.allSettled(tasks);
}

async function evaluateAndSendAlerts() {
  try {
    const [btc, nasdaq, usdkrw, fg] = await Promise.all([
      fetchYahooChart("BTC-USD", "5d", "1d"),
      fetchYahooChart("^IXIC", "5d", "1d"),
      fetchYahooChart("KRW=X", "5d", "1d"),
      fetchFearGreed()
    ]);

    const getChangeData = (points) => {
      const last = points[points.length - 1]?.value;
      const prev = points[points.length - 2]?.value;
      if (!prev || !last) return { last: last || 0, prev: prev || 0, pct: 0 };
      return {
        last,
        prev,
        pct: Number((((last - prev) / prev) * 100).toFixed(2))
      };
    };

    const btcData = getChangeData(btc.points);
    const nasdaqData = getChangeData(nasdaq.points);
    const usdkrwData = getChangeData(usdkrw.points);
    const btcPctChange = btcData.pct;
    const nasdaqPctChange = nasdaqData.pct;
    const usdkrwPctChange = usdkrwData.pct;

    const isBtcAlert = Math.abs(btcPctChange) >= ALERT_BTC_CHANGE_THRESHOLD;
    const isNasdaqAlert =
      Math.abs(nasdaqPctChange) >= ALERT_NASDAQ_CHANGE_THRESHOLD;
    const isUsdKrwAlert =
      Math.abs(usdkrwPctChange) >= ALERT_USDKRW_CHANGE_THRESHOLD;
    const isFearGreedAlert =
      fg.value <= ALERT_FG_EXTREME || fg.value >= 100 - ALERT_FG_EXTREME;

    const isPairTrigger = isNasdaqAlert && isUsdKrwAlert;
    const isCoreMarketTrigger = ALERT_REQUIRE_NASDAQ_AND_USDKRW
      ? isPairTrigger
      : isBtcAlert || isNasdaqAlert || isUsdKrwAlert;
    const shouldAlert = isCoreMarketTrigger || isFearGreedAlert;

    if (!shouldAlert) {
      return;
    }

    const directionLabel = (pct) => {
      if (pct > 0) return "급등";
      if (pct < 0) return "급락";
      return "보합";
    };
    const directionEmoji = (pct) => {
      if (pct > 0) return "📈";
      if (pct < 0) return "📉";
      return "➖";
    };
    const formatValue = (value) => Number(value).toLocaleString("en-US", {
      maximumFractionDigits: 2
    });
    const marketSessionLabel = () => {
      const hourSeoul = Number(
        new Intl.DateTimeFormat("en-US", {
          hour: "2-digit",
          hour12: false,
          timeZone: "Asia/Seoul"
        }).format(new Date())
      );
      if (hourSeoul >= 9 && hourSeoul < 15) return "국내 장중";
      if (hourSeoul >= 15 && hourSeoul < 24) return "국내 장마감/미국장 프리";
      return "미국장/글로벌 야간";
    };
    const triggerReason = () => {
      if (ALERT_REQUIRE_NASDAQ_AND_USDKRW) {
        if (isPairTrigger && isFearGreedAlert) return "나스닥+원달러 동시 + 공포탐욕 극단";
        if (isPairTrigger) return "나스닥+원달러 동시 트리거";
        return "공포탐욕 극단";
      }
      const reasons = [];
      if (isNasdaqAlert) reasons.push("나스닥");
      if (isUsdKrwAlert) reasons.push("원달러");
      if (isBtcAlert) reasons.push("비트코인");
      if (isFearGreedAlert) reasons.push("공포탐욕");
      return reasons.join(", ");
    };

    const triggeredItems = [];
    if (isNasdaqAlert) {
      triggeredItems.push(
        `${directionEmoji(nasdaqPctChange)} NASDAQ ${directionLabel(nasdaqPctChange)} ${nasdaqPctChange}% (기준 ${ALERT_NASDAQ_CHANGE_THRESHOLD}%)`
      );
    }
    if (isUsdKrwAlert) {
      triggeredItems.push(
        `${directionEmoji(usdkrwPctChange)} USD/KRW ${directionLabel(usdkrwPctChange)} ${usdkrwPctChange}% (기준 ${ALERT_USDKRW_CHANGE_THRESHOLD}%)`
      );
    }
    if (isBtcAlert) {
      triggeredItems.push(
        `${directionEmoji(btcPctChange)} BTC ${directionLabel(btcPctChange)} ${btcPctChange}% (기준 ${ALERT_BTC_CHANGE_THRESHOLD}%)`
      );
    }
    if (isFearGreedAlert) {
      triggeredItems.push(`😨 Fear & Greed ${fg.value} (${fg.valueText})`);
    }

    const now = new Date().toLocaleString("ko-KR");
    const lines =
      ALERT_MESSAGE_MODE === "detailed"
        ? [
            "[Market Alert]",
            `세션: ${marketSessionLabel()}`,
            `트리거: ${triggerReason()}`,
            ...triggeredItems,
            `상세(NASDAQ): ${formatValue(nasdaqData.prev)} -> ${formatValue(nasdaqData.last)}`,
            `상세(USD/KRW): ${formatValue(usdkrwData.prev)} -> ${formatValue(usdkrwData.last)}`,
            `상세(BTC): ${formatValue(btcData.prev)} -> ${formatValue(btcData.last)}`,
            `Time: ${now}`
          ]
        : [
            `[Market Alert] ${marketSessionLabel()} | ${triggerReason()} | ${triggeredItems.join(" / ")} | ${now}`
          ];
    await sendAlerts(lines.join("\n"));
  } catch (error) {
    console.error("Alert check failed:", error.message);
  }
}

app.get("/api/markets", async (req, res) => {
  try {
    const range = req.query.range || "1mo";
    const interval = req.query.interval || "1d";
    const results = await Promise.all(
      SYMBOLS.map((item) => fetchYahooChart(item.symbol, range, interval))
    );

    const payload = SYMBOLS.map((item) => {
      const matched = results.find((r) => r.symbol === item.symbol);
      return {
        key: item.key,
        name: item.name,
        symbol: item.symbol,
        latest: matched?.latest ?? null,
        points: matched?.points ?? []
      };
    });
    res.json(payload);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.get("/api/fear-greed", async (req, res) => {
  try {
    const data = await fetchFearGreed();
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

async function fetchNewsPayload() {
  if (!NEWS_API_KEY) {
    return {
      us: [],
      kr: [],
      jp: [],
      eu: [],
      cn: [],
      warning: "NEWS_API_KEY is not set. Add key in .env to load news."
    };
  }

  const topHeadlinesBase = "https://newsapi.org/v2/top-headlines";
  const everythingBase = "https://newsapi.org/v2/everything";
  const buildTopHeadlinesUrl = (country) =>
    `${topHeadlinesBase}?country=${country}&category=business&pageSize=8&apiKey=${NEWS_API_KEY}`;
  const buildEverythingUrl = (query, language) => {
    const from = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    return `${everythingBase}?q=${encodeURIComponent(
      query
    )}&language=${language}&sortBy=publishedAt&pageSize=12&from=${from}&apiKey=${NEWS_API_KEY}`;
  };

  const [us, krTop, jp, gb, de, fr, cn] = await Promise.all([
    axios.get(buildTopHeadlinesUrl("us"), { timeout: 10000 }),
    axios.get(buildTopHeadlinesUrl("kr"), { timeout: 10000 }),
    axios.get(buildTopHeadlinesUrl("jp"), { timeout: 10000 }),
    axios.get(buildTopHeadlinesUrl("gb"), { timeout: 10000 }),
    axios.get(buildTopHeadlinesUrl("de"), { timeout: 10000 }),
    axios.get(buildTopHeadlinesUrl("fr"), { timeout: 10000 }),
    axios.get(buildTopHeadlinesUrl("cn"), { timeout: 10000 })
  ]);

  const normalize = (articles) =>
    (articles || []).map((a) => ({
      title: a.title,
      description: a.description || "",
      source: a.source?.name || "Unknown",
      url: a.url,
      publishedAt: a.publishedAt
    }));

  const mergeAndLimit = (...arrs) =>
    arrs
      .flat()
      .sort(
        (a, b) =>
          new Date(b.publishedAt || 0).getTime() -
          new Date(a.publishedAt || 0).getTime()
      )
      .slice(0, 12);

  let krArticles = normalize(krTop.data?.articles);
  if (!krArticles.length) {
    const krFallback = await axios.get(
      buildEverythingUrl("경제 OR 금융 OR 코스피 OR 환율", "ko"),
      { timeout: 10000 }
    );
    krArticles = normalize(krFallback.data?.articles);
  }

  return {
    us: normalize(us.data?.articles),
    kr: krArticles,
    jp: normalize(jp.data?.articles),
    eu: mergeAndLimit(
      normalize(gb.data?.articles),
      normalize(de.data?.articles),
      normalize(fr.data?.articles)
    ),
    cn: normalize(cn.data?.articles),
    warning: ""
  };
}

app.get("/api/news", async (req, res) => {
  try {
    const payload = await fetchNewsPayload();
    res.json(payload);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.get("/api/news-kr-summary", async (req, res) => {
  try {
    const data = await fetchNewsPayload();

    const convert = async (articles) => {
      const limited = (articles || []).slice(0, 5);
      const translated = await Promise.all(
        limited.map(async (item) => {
          const translatedTitle = await translateToKorean(item.title || "");
          const translatedDesc = await translateToKorean(item.description || "");
          return {
            ...item,
            titleKo: translatedTitle || item.title,
            summaryKo: summarizeText(translatedDesc || item.description || item.title)
          };
        })
      );
      return translated;
    };

    const [us, kr, jp, eu, cn] = await Promise.all([
      convert(data.us),
      convert(data.kr),
      convert(data.jp),
      convert(data.eu),
      convert(data.cn)
    ]);

    res.json({
      us,
      kr,
      jp,
      eu,
      cn,
      warning: data.warning || ""
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.get("/api/settings", (req, res) => {
  res.json({
    autoRefreshSeconds: Number(process.env.AUTO_REFRESH_SECONDS || 60),
    alertNasdaqThreshold: ALERT_NASDAQ_CHANGE_THRESHOLD,
    alertUsdKrwThreshold: ALERT_USDKRW_CHANGE_THRESHOLD,
    alertRequireNasdaqAndUsdKrw: ALERT_REQUIRE_NASDAQ_AND_USDKRW,
    alertMessageMode: ALERT_MESSAGE_MODE,
    alertEnabled: Boolean(
      (TELEGRAM_BOT_TOKEN && TELEGRAM_CHAT_ID) || DISCORD_WEBHOOK_URL
    )
  });
});

app.post("/api/alerts/test", async (_req, res) => {
  try {
    const text = [
      "[Market Alert Test]",
      "This is a manual test notification.",
      `Time: ${new Date().toLocaleString("ko-KR")}`
    ].join("\n");
    await sendAlerts(text);
    res.json({ ok: true, message: "Test alert sent." });
  } catch (error) {
    res.status(500).json({ ok: false, message: error.message });
  }
});

app.get("/healthz", (_req, res) => {
  res.status(200).json({ ok: true });
});

if (!process.env.VERCEL) {
  setInterval(
    evaluateAndSendAlerts,
    Math.max(1, ALERT_INTERVAL_MINUTES) * 60 * 1000
  );
  evaluateAndSendAlerts();
  app.listen(PORT, () => {
    console.log(`Dashboard server started: http://localhost:${PORT}`);
  });
}

module.exports = app;
