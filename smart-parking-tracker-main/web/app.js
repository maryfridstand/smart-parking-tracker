// Dashboard logic: polls the API every few seconds and rebuilds the page
// with DOM manipulation (no page refresh).

const API = "/api/cars"; // Nginx forwards /api/* to the API container
const POLL_MS = 2000;

const $ = (id) => document.getElementById(id);

// Our personal touch: a funny message for every car that comes in
const ENTRY_JOKES = [
  "parked like a pro. Probably. We didn't check.",
  "has arrived. The parking gods are pleased.",
  "found a spot faster than finding a free table at lunch.",
  "is here. Please don't scratch the other cars.",
  "entered. Its GPS is saying 'You have arrived' very proudly.",
  "rolled in. Engine off, vibes on.",
];

let knownPlates = null; // null = first load, so we don't toast every car on startup

// ---------- helpers ----------

function formatDuration(ms) {
  const mins = Math.floor(ms / 60000);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h ? `${h}h ${m}m` : `${m}m`;
}

function formatTime(ts) {
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function showToast(text) {
  const toast = $("toast");
  toast.textContent = text;
  toast.hidden = false;
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => (toast.hidden = true), 3500);
}

function randomPlate() {
  const d = (n) => Array.from({ length: n }, () => Math.floor(Math.random() * 10)).join("");
  return `${d(3)}-${d(2)}-${d(3)}`;
}

// ---------- rendering ----------

function renderCars(cars) {
  const tbody = $("cars");
  tbody.innerHTML = "";
  const now = Date.now();

  for (const car of cars) {
    const tr = document.createElement("tr");
    if (knownPlates && !knownPlates.has(car.plate)) tr.classList.add("new");

    const cells = [
      [car.plate, "plate"],
      [formatTime(car.enteredAt)],
      [formatDuration(now - car.enteredAt)],
      [`₪${car.currentPrice}`],
    ];
    for (const [text, cls] of cells) {
      const td = document.createElement("td");
      td.textContent = text; // textContent, not innerHTML: never trust input
      if (cls) td.className = cls;
      tr.appendChild(td);
    }

    const actionTd = document.createElement("td");
    const btn = document.createElement("button");
    btn.className = "release";
    btn.textContent = "Release";
    btn.addEventListener("click", () => releaseCar(car.plate));
    actionTd.appendChild(btn);
    tr.appendChild(actionTd);

    tbody.appendChild(tr);
  }

  $("empty").hidden = cars.length > 0;
}

function renderHistory(history) {
  const ul = $("history");
  ul.innerHTML = "";
  if (!history.length) {
    const li = document.createElement("li");
    li.className = "muted";
    li.textContent = "No cars have left yet.";
    ul.appendChild(li);
    return;
  }
  for (const h of history) {
    const li = document.createElement("li");
    li.textContent = `${h.plate}: left at ${formatTime(h.leftAt)} after ${formatDuration(
      h.leftAt - h.enteredAt
    )}, paid ₪${h.price}`;
    ul.appendChild(li);
  }
}

function render(data) {
  $("count").textContent = data.count;
  $("free").textContent = data.capacity - data.count;
  $("total").textContent = data.totalEntries;
  $("revenue").textContent = `₪${data.revenue}`;

  const ratio = data.count / data.capacity;
  const fill = $("meter-fill");
  fill.style.width = `${Math.min(100, ratio * 100)}%`;
  fill.style.background = ratio >= 1 ? "var(--danger)" : ratio >= 0.8 ? "orange" : "var(--ok)";
  $("full-alert").hidden = data.count < data.capacity;

  // Toast for cars we haven't seen before
  if (knownPlates) {
    const newCar = data.cars.find((c) => !knownPlates.has(c.plate));
    if (newCar) {
      const joke = ENTRY_JOKES[Math.floor(Math.random() * ENTRY_JOKES.length)];
      showToast(`🚗 ${newCar.plate} ${joke}`);
    }
  }

  renderCars(data.cars);
  renderHistory(data.history);
  knownPlates = new Set(data.cars.map((c) => c.plate));
}

// ---------- API calls ----------

async function refresh() {
  try {
    const res = await fetch(API);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    render(await res.json());
    $("status").textContent = `Live · updated ${new Date().toLocaleTimeString()}`;
  } catch (err) {
    $("status").textContent = `⚠️ API unreachable (${err.message}). Retrying…`;
  }
}

async function releaseCar(plate) {
  const res = await fetch(`${API}/${encodeURIComponent(plate)}`, { method: "DELETE" });
  if (res.ok) {
    const { price } = await res.json();
    showToast(`👋 ${plate} left and paid ₪${price}. Drive safe!`);
  }
  refresh();
}

async function sendPlate(plate) {
  const errorEl = $("form-error");
  errorEl.hidden = true;
  const res = await fetch(API, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ plate }),
  });
  if (!res.ok) {
    const { error } = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    errorEl.textContent = error;
    errorEl.hidden = false;
  }
  refresh();
}

// ---------- events ----------

$("camera-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const input = $("plate-input");
  sendPlate(input.value);
  input.value = "";
});

$("random-plate").addEventListener("click", () => sendPlate(randomPlate()));

// Dark mode, remembered in localStorage
function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  $("theme-toggle").textContent = theme === "dark" ? "☀️" : "🌙";
}
$("theme-toggle").addEventListener("click", () => {
  const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  applyTheme(next);
  try { localStorage.setItem("theme", next); } catch {}
});
try { applyTheme(localStorage.getItem("theme") || "light"); } catch { applyTheme("light"); }

// Easter egg: type "vroom" anywhere on the page 🏎️
let typed = "";
document.addEventListener("keydown", (e) => {
  if (e.target.tagName === "INPUT") return;
  typed = (typed + e.key.toLowerCase()).slice(-5);
  if (typed === "vroom") {
    document.body.style.transition = "transform 1s";
    document.body.style.transform = "rotate(360deg)";
    setTimeout(() => (document.body.style.transform = ""), 1000);
    showToast("🏎️ VROOM VROOM! You found the easter egg!");
  }
});

refresh();
setInterval(refresh, POLL_MS);

// --- Dark Mode Logic ---
document.addEventListener('DOMContentLoaded', () => {
  const toggleBtn = document.getElementById('theme-toggle');
  const savedTheme = localStorage.getItem('theme') || 'light';

  if (savedTheme === 'dark') {
    document.documentElement.setAttribute('data-theme', 'dark');
    if (toggleBtn) toggleBtn.textContent = '☀️ Light Mode';
  }

  if (toggleBtn) {
    toggleBtn.addEventListener('click', () => {
      const activeTheme = document.documentElement.getAttribute('data-theme');
      if (activeTheme === 'dark') {
        document.documentElement.removeAttribute('data-theme');
        localStorage.setItem('theme', 'light');
        toggleBtn.textContent = '🌙 Dark Mode';
      } else {
        document.documentElement.setAttribute('data-theme', 'dark');
        localStorage.setItem('theme', 'dark');
        toggleBtn.textContent = '☀️ Light Mode';
      }
    });
  }
});
