const WEATHER_ENDPOINT = "https://api.open-meteo.com/v1/forecast?latitude=-31.442&longitude=-64.191&hourly=temperature_2m,precipitation_probability,weathercode&forecast_days=3&timezone=America/Argentina/Cordoba";
const REFRESH_MS = 30 * 60 * 1000;

let cache = {
  fetchedAt: 0,
  payload: null
};

const weatherIconFromCode = (code) => {
  if (code === 0) return "☀️";
  if (code >= 1 && code <= 3) return "🌤";
  if (code >= 45 && code <= 48) return "🌫";
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return "🌧";
  if (code >= 71 && code <= 77) return "❄️";
  return "☁️";
};

const dayName = (dateString, dayIndex) => {
  if (dayIndex === 0) return "Hoy";
  if (dayIndex === 1) return "Mañana";
  const date = new Date(`${dateString}T12:00:00`);
  return new Intl.DateTimeFormat("es-AR", { weekday: "long" })
    .format(date)
    .replace(/^./, (char) => char.toUpperCase());
};

const filterHours = (hourly) => {
  const buckets = new Map();
  hourly.time.forEach((time, index) => {
    const [datePart, hhmm] = time.split("T");
    const hour = Number(hhmm.slice(0, 2));
    if (Number.isNaN(hour) || hour < 6 || hour > 23) return;
    if (!buckets.has(datePart)) buckets.set(datePart, []);
    buckets.get(datePart).push({
      time: hhmm.slice(0, 5),
      temp: Math.round(hourly.temperature_2m[index]),
      rain: Math.round(hourly.precipitation_probability[index] || 0),
      code: Number(hourly.weathercode[index])
    });
  });

  return Array.from(buckets.entries()).slice(0, 3).map(([date, hours], idx) => {
    const temperatures = hours.map((slot) => slot.temp);
    return {
      date,
      label: dayName(date, idx),
      min: Math.min(...temperatures),
      max: Math.max(...temperatures),
      heavyRain: hours.some((slot) => slot.rain > 60),
      hours
    };
  });
};

const renderSkeleton = (container) => {
  container.innerHTML = `
    <div class="weather-skeleton" aria-hidden="true"></div>
    <div class="weather-skeleton" aria-hidden="true"></div>
    <div class="weather-skeleton" aria-hidden="true"></div>
  `;
};

const renderError = (container) => {
  container.innerHTML = '<div class="weather-error">No se pudo cargar el clima en este momento.</div>';
};

const renderWeather = (container, days) => {
  container.innerHTML = days.map((day) => `
    <article class="weather-day">
      <div class="weather-day-top">
        <span class="weather-day-label">${day.label}</span>
        <span class="weather-day-minmax">Min ${day.min}° · Max ${day.max}°</span>
      </div>
      ${day.heavyRain ? '<div class="weather-day-alert">⚠ Alta probabilidad de lluvia</div>' : ""}
      <div class="weather-hours" role="list" aria-label="Pronóstico horario ${day.label}">
        ${day.hours.map((hour) => `
          <div class="weather-hour" role="listitem">
            <div class="weather-hour-time">${hour.time}</div>
            <div class="weather-hour-icon" aria-hidden="true">${weatherIconFromCode(hour.code)}</div>
            <div class="weather-hour-temp">${hour.temp}°</div>
            <div class="weather-hour-rain">${hour.rain}% lluvia</div>
          </div>
        `).join("")}
      </div>
    </article>
  `).join("");
};

const fetchWeather = async () => {
  const now = Date.now();
  if (cache.payload && (now - cache.fetchedAt) < REFRESH_MS) return cache.payload;

  const response = await fetch(WEATHER_ENDPOINT, { method: "GET" });
  if (!response.ok) {
    throw new Error(`Weather request failed: ${response.status}`);
  }

  const payload = await response.json();
  cache = { fetchedAt: now, payload };
  return payload;
};

export function createHomeWeatherWidget({ root, isVisible }) {
  if (!root) return null;

  const body = root.querySelector("#homeWeatherWidgetBody");
  if (!body) return null;

  let refreshTimer = null;
  let hasLoaded = false;

  const stopRefresh = () => {
    if (refreshTimer) {
      clearInterval(refreshTimer);
      refreshTimer = null;
    }
  };

  const loadWeather = async ({ force = false } = {}) => {
    if (!isVisible()) return;
    if (!hasLoaded) renderSkeleton(body);

    try {
      if (force) cache.fetchedAt = 0;
      const payload = await fetchWeather();
      const days = filterHours(payload.hourly || {});
      if (!days.length) throw new Error("No hourly weather data available");
      renderWeather(body, days);
      hasLoaded = true;
    } catch (error) {
      console.error("[weather-widget]", error);
      renderError(body);
    }
  };

  const startRefresh = () => {
    stopRefresh();
    refreshTimer = window.setInterval(() => {
      if (isVisible()) {
        loadWeather({ force: true });
      }
    }, REFRESH_MS);
  };

  const handleVisibilityChange = () => {
    if (document.visibilityState === "visible" && isVisible()) {
      loadWeather();
      startRefresh();
      return;
    }

    if (!isVisible() || document.visibilityState !== "visible") {
      stopRefresh();
    }
  };

  return {
    onSectionChange(sectionId) {
      if (sectionId === "inicio") {
        loadWeather();
        if (document.visibilityState === "visible") startRefresh();
      } else {
        stopRefresh();
      }
    },
    mount() {
      document.addEventListener("visibilitychange", handleVisibilityChange);
    },
    unmount() {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      stopRefresh();
    }
  };
}
