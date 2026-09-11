/**
 * BobCall PWA — main.js
 *
 * Connects to the relay via SSE, renders pending tool-approval cards,
 * and sends decisions back to the relay.
 */

// ── Config persistence ────────────────────────────────────────────────────────
const STORAGE_KEY = "bobcall-config";

function loadConfig() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return { relayUrl: "", token: "" };
}

function saveConfig(cfg) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
}

// ── DOM refs ──────────────────────────────────────────────────────────────────
const statusPill      = document.getElementById("status-pill");
const setupScreen     = document.getElementById("setup-screen");
const emptyState      = document.getElementById("empty-state");
const notifList       = document.getElementById("notification-list");
const footerCount     = document.getElementById("footer-count");
const openSettingsBtn = document.getElementById("open-settings");
const cfgUrlInput     = document.getElementById("cfg-url");
const cfgTokenInput   = document.getElementById("cfg-token");
const cfgSaveBtn      = document.getElementById("cfg-save");

// ── State ─────────────────────────────────────────────────────────────────────
let cfg = loadConfig();
let evtSource = null;
// Map<id, HTMLElement>
const cards = new Map();

// ── Setup / settings screen ───────────────────────────────────────────────────
function showSetup() {
  cfgUrlInput.value   = cfg.relayUrl;
  cfgTokenInput.value = cfg.token;
  setupScreen.classList.remove("hidden");
  emptyState.classList.add("hidden");
  notifList.innerHTML = "";
}

function hideSetup() {
  setupScreen.classList.add("hidden");
}

cfgSaveBtn.addEventListener("click", () => {
  cfg.relayUrl = cfgUrlInput.value.trim().replace(/\/$/, "");
  cfg.token    = cfgTokenInput.value.trim() || "bobcall-dev";
  saveConfig(cfg);
  hideSetup();
  connect();
});

openSettingsBtn.addEventListener("click", () => {
  if (evtSource) { evtSource.close(); evtSource = null; }
  setStatus("disconnected");
  showSetup();
});

// ── Status pill ───────────────────────────────────────────────────────────────
function setStatus(state) {
  statusPill.className = "status-pill";
  if (state === "connected") {
    statusPill.textContent = "● Connected";
    statusPill.classList.add("connected");
  } else if (state === "error") {
    statusPill.textContent = "✕ Error";
    statusPill.classList.add("error");
  } else {
    statusPill.textContent = "Connecting…";
  }
}

// ── SSE connection ────────────────────────────────────────────────────────────
function connect() {
  if (!cfg.relayUrl) { showSetup(); return; }

  setStatus("connecting");
  const url = `${cfg.relayUrl}/events?token=${encodeURIComponent(cfg.token)}`;

  if (evtSource) evtSource.close();
  evtSource = new EventSource(url);

  evtSource.addEventListener("open", () => setStatus("connected"));

  evtSource.addEventListener("error", () => {
    setStatus("error");
    // Reconnect after 5 s
    setTimeout(connect, 5_000);
  });

  evtSource.addEventListener("pending", (e) => {
    const data = JSON.parse(e.data);
    addCard(data);
    updateFooter();
    sendBrowserNotification(data);
  });

  evtSource.addEventListener("resolved", (e) => {
    const { id } = JSON.parse(e.data);
    removeCard(id);
    updateFooter();
  });

  evtSource.addEventListener("expired", (e) => {
    const { id } = JSON.parse(e.data);
    removeCard(id);
    updateFooter();
  });
}

// ── Browser / Web Push notification ──────────────────────────────────────────
async function sendBrowserNotification(data) {
  if (!("Notification" in window)) return;
  if (Notification.permission === "default") {
    await Notification.requestPermission();
  }
  if (Notification.permission !== "granted") return;

  const notif = new Notification(`Bob wants to: ${data.tool_name}`, {
    body: summariseInput(data.tool_input),
    icon: "/icon-192.png",
    tag: data.id,
    requireInteraction: true,
  });

  notif.onclick = () => { window.focus(); notif.close(); };
}

function summariseInput(input) {
  if (!input) return "";
  const s = JSON.stringify(input);
  return s.length > 120 ? s.slice(0, 117) + "…" : s;
}

// ── Card rendering ────────────────────────────────────────────────────────────
function addCard(data) {
  if (cards.has(data.id)) return;

  const li = document.createElement("li");
  li.className = "notif-card";
  li.dataset.id = data.id;

  const inputStr = data.tool_input
    ? JSON.stringify(data.tool_input, null, 2)
    : "(no input)";

  const briefPath = data.cwd
    ? data.cwd.replace(/\\/g, "/").split("/").slice(-2).join("/")
    : "";

  li.innerHTML = `
    <div class="notif-tool">
      <span class="tool-badge">${escHtml(data.tool_name)}</span>
      <span>${escHtml(briefPath)}</span>
    </div>
    <div class="notif-title">Bob wants to run a tool</div>
    <pre class="notif-detail">${escHtml(inputStr)}</pre>
    <div class="notif-actions">
      <button class="btn btn-approve"  data-decision="approve">Approve Once</button>
      <button class="btn btn-all"      data-decision="approve_all">Approve for Task</button>
      <button class="btn btn-reject"   data-decision="reject">Reject</button>
    </div>
  `;

  li.querySelectorAll("[data-decision]").forEach((btn) => {
    btn.addEventListener("click", () => sendDecision(data.id, btn.dataset.decision, li));
  });

  notifList.prepend(li);
  cards.set(data.id, li);
  emptyState.classList.add("hidden");
}

function removeCard(id) {
  const li = cards.get(id);
  if (!li) return;
  li.classList.add("resolved");
  li.addEventListener("animationend", () => { li.remove(); }, { once: true });
  cards.delete(id);
  if (cards.size === 0) emptyState.classList.remove("hidden");
}

function updateFooter() {
  const n = cards.size;
  footerCount.textContent = n > 0 ? `${n} pending` : "";
}

// ── Decision dispatch ─────────────────────────────────────────────────────────
async function sendDecision(id, decision, li) {
  li.classList.add("resolving");
  try {
    const res = await fetch(`${cfg.relayUrl}/decision/${id}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-bobcall-token": cfg.token,
      },
      body: JSON.stringify({ decision }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    // The SSE "resolved" event will remove the card
  } catch (err) {
    console.error("Failed to send decision:", err);
    li.classList.remove("resolving");
    alert(`Failed to send decision: ${err.message}`);
  }
}

// ── Utility ───────────────────────────────────────────────────────────────────
function escHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ── Boot ──────────────────────────────────────────────────────────────────────
if (!cfg.relayUrl) {
  showSetup();
} else {
  emptyState.classList.remove("hidden");
  connect();
}

// Register SW (handled by vite-plugin-pwa in prod; this is a fallback for dev)
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js").catch(() => { /* sw optional in dev */ });
}
