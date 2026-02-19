const WEATHER_ENDPOINT = "https://api.open-meteo.com/v1/forecast";
const WEATHER_PARAMS = new URLSearchParams({
  latitude: "-31.441",
  longitude: "-64.193",
  timezone: "America/Argentina/Cordoba",
  current: "temperature_2m,weather_code,wind_speed_10m,relative_humidity_2m,apparent_temperature,precipitation_probability",
  hourly: "temperature_2m,precipitation_probability,weather_code,apparent_temperature",
  daily: "temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum,weather_code"
});

const CACHE_KEY = "fcefyn.weatherWidget.v1";
const CACHE_TTL = 20 * 60 * 1000;
const REFRESH_INTERVAL = 30 * 60 * 1000;
const MIN_SKELETON_MS = 450;
const FETCH_TIMEOUT_MS = 8000;

const WIDGET_STATE = {
  section: "",
  selectedTab: 0,
  data: null,
  container: null,
  refreshTimer: null,
  visibilityHandler: null,
  pendingController: null,
  destroyed: false
};

const pad = (num) => String(num).padStart(2, "0");
const CORDOBA_TIMEZONE = "America/Argentina/Cordoba";
const formatTabDate = (isoDate) => {
  const date = new Date(`${isoDate}T12:00:00`);
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}`;
};
const formatHour = (isoDateTime) => {
  const date = new Date(isoDateTime);
  let h = date.getHours();
  const suffix = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return `${h}${suffix}`;
};
const toInt = (value) => Number.isFinite(Number(value)) ? Math.round(Number(value)) : null;

function mapWeatherCodeToIconAndLabelES(code, hourLocal = 12){
  const emoji = mapWeatherCodeToEmoji(code, hourLocal);
  const isNight = hourLocal < 6 || hourLocal >= 20;
  if (!Number.isFinite(Number(code))) return { label: "Condición desconocida", icon: "☁️" };

  if (code === 0) return { label: isNight ? "Despejado" : "Soleado", icon: emoji };
  if (code >= 1 && code <= 3) return { label: "Parcialmente nublado", icon: emoji };
  if (code >= 45 && code <= 48) return { label: "Niebla", icon: emoji };
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return { label: "Lluvia", icon: emoji };
  if (code >= 95 && code <= 99) return { label: "Tormenta", icon: emoji };
  return { label: "Nublado", icon: emoji };
}

function getHourInCordoba(dateValue){
  const sourceDate = dateValue ? new Date(dateValue) : new Date();
  if (Number.isNaN(sourceDate.getTime())) return 12;

  const hourPart = new Intl.DateTimeFormat("es-AR", {
    hour: "2-digit",
    hour12: false,
    timeZone: CORDOBA_TIMEZONE
  }).formatToParts(sourceDate).find((part) => part.type === "hour");

  const hour = Number(hourPart?.value);
  return Number.isFinite(hour) ? hour : 12;
}

function mapWeatherCodeToEmoji(code, hourLocal = 12){
  const isNight = hourLocal < 6 || hourLocal >= 20;

  if (code === 0) return isNight ? "🌙" : "☀️";
  if (code >= 1 && code <= 3) return isNight ? "☁️🌙" : "🌤️";
  if (code >= 45 && code <= 48) return "🌫️";
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return "🌧️";
  if (code >= 95 && code <= 99) return "⛈️";
  if ((code >= 71 && code <= 77) || (code >= 85 && code <= 86)) return "🌨️";
  if (code >= 4) return "☁️";
  return "☁️";
}

function getCachedWeather(){
  try{
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.timestamp || !parsed?.payload) return null;
    if (Date.now() - parsed.timestamp > CACHE_TTL) return null;
    return parsed.payload;
  }catch(_err){
    return null;
  }
}

function setCachedWeather(payload){
  try{
    localStorage.setItem(CACHE_KEY, JSON.stringify({ timestamp: Date.now(), payload }));
  }catch(_err){
    // silent
  }
}

async function fetchWeatherCUC({ signal } = {}){
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  const combinedSignal = signal || controller.signal;
  const url = `${WEATHER_ENDPOINT}?${WEATHER_PARAMS.toString()}`;
  try{
    const response = await fetch(url, { signal: combinedSignal });
    if (!response.ok) throw new Error(`weather_http_${response.status}`);
    return await response.json();
  }finally{
    clearTimeout(timeout);
  }
}

function buildTabs(daily){
  return (daily?.time || []).slice(0, 4).map((dateIso, idx) => ({
    index: idx,
    isoDate: dateIso,
    label: idx === 0 ? "Hoy" : idx === 1 ? "Mañana" : formatTabDate(dateIso)
  }));
}

function computeHourItems(payload, tabIndex){
  const nowIso = payload?.current?.time;
  const hourTimes = payload?.hourly?.time || [];
  const temperatures = payload?.hourly?.temperature_2m || [];
  const weatherCodes = payload?.hourly?.weather_code || [];

  if (!hourTimes.length) return [];

  if (tabIndex === 0){
    const nowTs = nowIso ? new Date(nowIso).getTime() : Date.now();
    const start = hourTimes.findIndex((entry) => new Date(entry).getTime() >= nowTs);
    const base = start >= 0 ? start : 0;
    return hourTimes.slice(base, base + 12).map((time, idx) => {
      const hour = getHourInCordoba(time);
      const mapped = mapWeatherCodeToIconAndLabelES(weatherCodes[base + idx], hour);
      return {
        label: idx === 0 ? "Ahora" : formatHour(time),
        icon: mapped.icon,
        temp: toInt(temperatures[base + idx])
      };
    });
  }

  const targetDate = payload?.daily?.time?.[tabIndex];
  const start = hourTimes.findIndex((time) => time.startsWith(`${targetDate}T12:`));
  const base = start >= 0 ? start : hourTimes.findIndex((time) => time.startsWith(`${targetDate}T`));
  const safeBase = base >= 0 ? base : 0;
  return hourTimes.slice(safeBase, safeBase + 12).map((time, idx) => {
    const hour = getHourInCordoba(time);
    const mapped = mapWeatherCodeToIconAndLabelES(weatherCodes[safeBase + idx], hour);
    return {
      label: formatHour(time),
      icon: mapped.icon,
      temp: toInt(temperatures[safeBase + idx])
    };
  });
}

function renderWeather(payload, selectedTab = 0){
  const root = WIDGET_STATE.container;
  if (!root || !payload) return;

  const tabs = buildTabs(payload.daily);
  const tab = tabs[selectedTab] || tabs[0];
  const current = payload.current || {};
  const daily = {
    min: toInt(payload?.daily?.temperature_2m_min?.[tab.index]),
    max: toInt(payload?.daily?.temperature_2m_max?.[tab.index]),
    rain: toInt(payload?.daily?.precipitation_probability_max?.[tab.index]),
    code: payload?.daily?.weather_code?.[tab.index]
  };

  const currentHour = getHourInCordoba(current.time || Date.now());
  const weatherMain = mapWeatherCodeToIconAndLabelES(tab.index === 0 ? current.weather_code : daily.code, currentHour);
  const tempPrimary = tab.index === 0 ? toInt(current.temperature_2m) : daily.max;
  const apparent = tab.index === 0 ? toInt(current.apparent_temperature) : null;
  const rainProb = tab.index === 0 ? toInt(current.precipitation_probability) ?? daily.rain : daily.rain;
  const hourItems = computeHourItems(payload, tab.index);

  root.innerHTML = `
    <div class="weather-widget__tabs" role="tablist" aria-label="Pronóstico por día">
      ${tabs.map((entry) => `
        <button class="weather-widget__tab ${entry.index === tab.index ? "is-active" : ""}" data-weather-tab="${entry.index}" type="button" role="tab" aria-selected="${entry.index === tab.index}">${entry.label}</button>
      `).join("")}
    </div>
    <div class="weather-widget__main weather-widget__fade">
      <div class="weather-widget__headline">
        <div>
          <div class="weather-widget__city">Ciudad Universitaria</div>
          <div class="weather-widget__temp-wrap">
            <div class="weather-widget__temp">${tempPrimary ?? "--"}°C</div>
            <span class="weather-widget__icon" aria-hidden="true">${weatherMain.icon}</span>
          </div>
        </div>
        <div class="weather-widget__right">
          <div class="weather-widget__cond">${weatherMain.label}</div>
          <div class="weather-widget__meta">Sensación: ${apparent != null ? `${apparent}°C` : "--"}</div>
          <div class="weather-widget__meta">Probabilidad de lluvia: ${rainProb != null ? `${rainProb}%` : "--"}</div>
          <div class="weather-widget__meta">Viento: ${toInt(current.wind_speed_10m) != null ? `${toInt(current.wind_speed_10m)} km/h` : "--"} · Humedad: ${toInt(current.relative_humidity_2m) != null ? `${toInt(current.relative_humidity_2m)}%` : "--"}</div>
          ${daily.min != null && daily.max != null ? `<div class="weather-widget__meta">Mín ${daily.min}° · Máx ${daily.max}°</div>` : ""}
        </div>
      </div>
      <div class="weather-widget__hours-title">Pronóstico 12 horas:</div>
      <div class="weather-widget__hours">
        ${hourItems.map((item) => `
          <div class="weather-widget__hour">
            <div class="weather-widget__hour-lbl">${item.label}</div>
            <div class="weather-widget__hour-ico" aria-hidden="true">${item.icon}</div>
            <div class="weather-widget__hour-temp">(${item.temp ?? "--"}°)</div>
          </div>
        `).join("")}
      </div>
    </div>
  `;
}

function renderSkeleton(){
  if (!WIDGET_STATE.container) return;
  WIDGET_STATE.container.innerHTML = '<div class="weather-widget__skeleton" aria-hidden="true"></div>';
}

function renderError(){
  if (!WIDGET_STATE.container) return;
  WIDGET_STATE.container.innerHTML = `
    <div class="weather-widget__error weather-widget__fade">
      <div>No se pudo cargar el clima</div>
      <button class="weather-widget__retry" data-weather-retry type="button">Reintentar</button>
    </div>
  `;
}

async function refreshWeather({ background = false } = {}){
  if (!WIDGET_STATE.container || WIDGET_STATE.section !== "inicio" || document.hidden) return;

  const start = Date.now();
  if (!background) renderSkeleton();

  if (WIDGET_STATE.pendingController) WIDGET_STATE.pendingController.abort();
  WIDGET_STATE.pendingController = new AbortController();

  try{
    const payload = await fetchWeatherCUC({ signal: WIDGET_STATE.pendingController.signal });
    const elapsed = Date.now() - start;
    if (!background && elapsed < MIN_SKELETON_MS) {
      await new Promise((resolve) => setTimeout(resolve, MIN_SKELETON_MS - elapsed));
    }
    WIDGET_STATE.data = payload;
    setCachedWeather(payload);
    renderWeather(payload, WIDGET_STATE.selectedTab);
  }catch(error){
    if (error?.name === "AbortError") return;
    if (!background && !WIDGET_STATE.data) renderError();
  }
}

function startAutoRefresh(){
  if (WIDGET_STATE.refreshTimer) clearInterval(WIDGET_STATE.refreshTimer);
  WIDGET_STATE.refreshTimer = setInterval(() => {
    if (WIDGET_STATE.section === "inicio" && !document.hidden) refreshWeather({ background: true });
  }, REFRESH_INTERVAL);
}

function stopAutoRefresh(){
  if (WIDGET_STATE.refreshTimer) clearInterval(WIDGET_STATE.refreshTimer);
  WIDGET_STATE.refreshTimer = null;
}

function onClickRoot(event){
  const tabBtn = event.target.closest("[data-weather-tab]");
  if (tabBtn && WIDGET_STATE.data){
    WIDGET_STATE.selectedTab = Number(tabBtn.dataset.weatherTab) || 0;
    renderWeather(WIDGET_STATE.data, WIDGET_STATE.selectedTab);
    return;
  }
  const retryBtn = event.target.closest("[data-weather-retry]");
  if (retryBtn) refreshWeather({ background: false });
}

export function initWeatherWidget(initialSection = ""){
  WIDGET_STATE.container = document.getElementById("weatherWidget");
  if (!WIDGET_STATE.container) return null;

  WIDGET_STATE.destroyed = false;
  WIDGET_STATE.section = initialSection;
  WIDGET_STATE.container.addEventListener("click", onClickRoot);

  const cached = getCachedWeather();
  if (cached){
    WIDGET_STATE.data = cached;
    renderWeather(cached, WIDGET_STATE.selectedTab);
  }

  WIDGET_STATE.visibilityHandler = () => {
    if (!document.hidden && WIDGET_STATE.section === "inicio") refreshWeather({ background: true });
  };
  document.addEventListener("visibilitychange", WIDGET_STATE.visibilityHandler);

  if (initialSection === "inicio") {
    refreshWeather({ background: Boolean(cached) });
    startAutoRefresh();
  }

  return {
    setActiveSection(section){
      WIDGET_STATE.section = section;
      if (section === "inicio"){
        if (WIDGET_STATE.data) renderWeather(WIDGET_STATE.data, WIDGET_STATE.selectedTab);
        refreshWeather({ background: Boolean(WIDGET_STATE.data) });
        startAutoRefresh();
      } else {
        stopAutoRefresh();
      }
    }
  };
}

export function destroyWeatherWidget(){
  WIDGET_STATE.destroyed = true;
  stopAutoRefresh();
  if (WIDGET_STATE.pendingController) WIDGET_STATE.pendingController.abort();
  if (WIDGET_STATE.container) {
    WIDGET_STATE.container.removeEventListener("click", onClickRoot);
  }
  if (WIDGET_STATE.visibilityHandler) {
    document.removeEventListener("visibilitychange", WIDGET_STATE.visibilityHandler);
  }
}

export { fetchWeatherCUC, getCachedWeather, setCachedWeather, mapWeatherCodeToIconAndLabelES, mapWeatherCodeToEmoji, renderWeather };
