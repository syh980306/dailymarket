const cardsEl = document.getElementById("cards");
const rangeEl = document.getElementById("range");
const marketModeEl = document.getElementById("marketMode");
const refreshBtn = document.getElementById("refreshBtn");
const fgBox = document.getElementById("fgBox");
const autoRefreshEl = document.getElementById("autoRefresh");
const alertStatusEl = document.getElementById("alertStatus");

const newsUs = document.getElementById("news-us");
const newsKr = document.getElementById("news-kr");
const newsJp = document.getElementById("news-jp");
const newsEu = document.getElementById("news-eu");
const newsCn = document.getElementById("news-cn");
const newsWarning = document.getElementById("newsWarning");

const chartInstances = new Map();
let autoRefreshTimer = null;

function getMarketQuery() {
  const mode = marketModeEl.value;
  if (mode === "realtime") {
    return { range: "1d", interval: "1m" };
  }
  return { range: rangeEl.value, interval: "1d" };
}

function formatNumber(value) {
  if (value === null || value === undefined) return "-";
  return Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function renderMarketCards(items) {
  cardsEl.innerHTML = "";

  items.forEach((item) => {
    const card = document.createElement("div");
    card.className = "card";
    const id = `chart-${item.key}`;
    card.innerHTML = `
      <div class="card-title">
        <strong>${item.name}</strong>
        <span>${formatNumber(item.latest)}</span>
      </div>
      <canvas id="${id}"></canvas>
    `;
    cardsEl.appendChild(card);

    const ctx = document.getElementById(id);
    const labels = item.points.map((p) => p.date);
    const values = item.points.map((p) => p.value);

    if (chartInstances.has(id)) {
      chartInstances.get(id).destroy();
      chartInstances.delete(id);
    }

    const chart = new Chart(ctx, {
      type: "line",
      data: {
        labels,
        datasets: [
          {
            label: item.name,
            data: values,
            borderColor: "#60a5fa",
            pointRadius: 0,
            tension: 0.25
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { ticks: { maxTicksLimit: 6, color: "#94a3b8" } },
          y: { ticks: { color: "#94a3b8" } }
        }
      }
    });
    chartInstances.set(id, chart);
  });
}

function renderNewsList(el, items) {
  el.innerHTML = "";
  if (!items || !items.length) {
    el.innerHTML = "<li>뉴스 데이터 없음</li>";
    return;
  }
  items.forEach((item) => {
    const li = document.createElement("li");
    li.innerHTML = `
      <a href="${item.url}" target="_blank" rel="noreferrer">${item.titleKo || item.title}</a>
      <br/><small>${item.source}</small>
      <br/><small>${item.summaryKo || ""}</small>
    `;
    el.appendChild(li);
  });
}

async function loadFearGreed() {
  try {
    const res = await fetch("/api/fear-greed");
    const data = await res.json();
    fgBox.textContent = `${data.value} (${data.valueText})`;
  } catch (error) {
    fgBox.textContent = "불러오기 실패";
  }
}

async function loadMarkets() {
  const query = getMarketQuery();
  const res = await fetch(
    `/api/markets?range=${encodeURIComponent(query.range)}&interval=${encodeURIComponent(query.interval)}`
  );
  if (!res.ok) throw new Error("시장 지표 로드 실패");
  const data = await res.json();
  renderMarketCards(data);
}

async function loadNews() {
  const res = await fetch("/api/news-kr-summary");
  if (!res.ok) throw new Error("뉴스 로드 실패");
  const data = await res.json();
  renderNewsList(newsUs, data.us);
  renderNewsList(newsKr, data.kr);
  renderNewsList(newsJp, data.jp);
  renderNewsList(newsEu, data.eu);
  renderNewsList(newsCn, data.cn);
  newsWarning.textContent = data.warning || "";
}

function applyAutoRefresh() {
  if (autoRefreshTimer) {
    clearInterval(autoRefreshTimer);
    autoRefreshTimer = null;
  }
  const seconds = Number(autoRefreshEl.value);
  if (!seconds) return;
  autoRefreshTimer = setInterval(() => {
    loadAll();
  }, seconds * 1000);
}

function applyMarketModeDefaults() {
  if (marketModeEl.value === "realtime") {
    rangeEl.value = "1d";
    autoRefreshEl.value = "10";
  } else if (autoRefreshEl.value === "10") {
    autoRefreshEl.value = "60";
  }
  applyAutoRefresh();
}

async function loadSettings() {
  try {
    const res = await fetch("/api/settings");
    if (!res.ok) return;
    const data = await res.json();
    if (data.autoRefreshSeconds) {
      const value = String(data.autoRefreshSeconds);
      if ([...autoRefreshEl.options].some((opt) => opt.value === value)) {
        autoRefreshEl.value = value;
      }
    }
    alertStatusEl.textContent = data.alertEnabled
      ? "텔레그램/디스코드 알림 활성화됨"
      : "알림 비활성화 (.env 값 입력 필요)";
  } catch (error) {
    alertStatusEl.textContent = "설정 로드 실패";
  }
}

async function loadAll() {
  try {
    await Promise.all([loadMarkets(), loadFearGreed(), loadNews()]);
  } catch (error) {
    console.error(error);
  }
}

refreshBtn.addEventListener("click", loadAll);
rangeEl.addEventListener("change", loadMarkets);
autoRefreshEl.addEventListener("change", applyAutoRefresh);
marketModeEl.addEventListener("change", () => {
  applyMarketModeDefaults();
  loadMarkets();
});

async function init() {
  await loadSettings();
  applyMarketModeDefaults();
  await loadAll();
}

init();
