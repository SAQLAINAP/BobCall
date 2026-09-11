# BobCall 🤙

> Leave the room. Bob keeps coding. You keep approving — from the gym.

BobCall turns Bob IDE's tool-approval prompts into mobile push notifications on a PWA. Every time Bob wants to read, write, or execute something, your phone buzzes. Tap **Approve Once**, **Approve for Task**, or **Reject** — Bob gets the answer instantly.

---

## How it works

```
Bob IDE (PreToolUse hook)
    │  POST /pending  (blocks until user responds)
    ▼
relay/server.mjs   ──SSE──▶   BobCall PWA (mobile browser)
    ▲                               │
    └──── POST /decision/:id ───────┘
```

1. **Hook** (`.bob/hooks/notify.mjs`) — fires before every tool call, POSTs to the relay, and waits.
2. **Relay** (`relay/server.mjs`) — holds the pending request, fans it out to all connected PWA clients over SSE, then holds a promise until someone responds (or it times out after 2 min).
3. **PWA** (`pwa/`) — shows a notification card with the tool name and input detail. Three buttons: **Approve Once**, **Approve for Task**, **Reject**.

---

## Project structure

```
BobCall/
├── .bob/
│   ├── hooks/
│   │   ├── notify.mjs        ← PreToolUse hook (POSTs to relay)
│   │   └── session-stop.mjs  ← Stop hook (clears auto-approve list)
│   └── settings.json         ← Registers both hooks
├── relay/
│   ├── server.mjs            ← Express + SSE relay
│   └── package.json
└── pwa/
    ├── index.html
    ├── main.js               ← SSE listener + card UI + decision sender
    ├── style.css
    ├── sw.js                 ← Dev service worker (prod: vite-plugin-pwa)
    ├── vite.config.js
    └── package.json
```

---

## Setup

### 1. Start the relay

```bash
cd relay
npm install          # first time only
npm start
```

The relay listens on **http://localhost:3456** by default.

**Environment variables (all optional):**

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3456` | HTTP port |
| `SECRET_TOKEN` | `bobcall-dev` | Shared auth token |
| `DECISION_TIMEOUT_MS` | `120000` | How long to wait for a user response (ms) |

Set a strong token in production:

```bash
SECRET_TOKEN=my-secret npm start
```

### 2. Configure the hook

The hook reads two env vars. Set them in your shell **before** starting Bob IDE:

```bash
# PowerShell
$env:BOBCALL_TOKEN = "my-secret"       # must match SECRET_TOKEN above
# $env:BOBCALL_RELAY_URL = "http://localhost:3456"   # default, change if relay is remote

# bash / zsh
export BOBCALL_TOKEN="my-secret"
```

The hook script (`.bob/hooks/notify.mjs`) and settings (`.bob/settings.json`) are already in place — no further configuration needed.

### 3. Open the PWA on your phone

**Option A — Dev server (local network):**

```bash
cd pwa
npm install          # first time only
npm run dev -- --host
```

Vite prints a LAN URL like `http://192.168.1.x:5173`. Open that on your phone. The dev server proxies `/api` → relay.

**Option B — Production build (recommended for daily use):**

```bash
cd pwa
npm run build        # outputs to pwa/dist/
npm run preview -- --host
```

Or serve `pwa/dist/` from any static host (Netlify, Vercel, a local nginx).

### 4. Configure the PWA

On first launch the PWA shows a **Configure Relay** screen:

- **Relay URL** — `http://192.168.1.x:3456` (your machine's LAN IP + relay port)
- **Token** — the `SECRET_TOKEN` you set above

Tap **Save & Connect**. The status pill turns green when connected.

### 5. Install as PWA (optional but recommended)

- **Android Chrome**: tap ⋮ → "Add to Home screen"
- **iOS Safari**: tap Share → "Add to Home Screen"

This gives you a fullscreen app with proper push notifications.

---

## Usage

1. Open Bob IDE, select your project directory.
2. Start a chat in Agent mode — describe what you want to build.
3. Walk away. Go to the gym.
4. Every time Bob wants to use a tool, your phone shows a notification card:

```
┌─────────────────────────────────────┐
│ [execute_command]  myproject        │
│ Bob wants to run a tool             │
│ ┌─────────────────────────────────┐ │
│ │ {                               │ │
│ │   "command": "npm run build"    │ │
│ │ }                               │ │
│ └─────────────────────────────────┘ │
│ [Approve Once] [Approve for Task] [Reject] │
└─────────────────────────────────────┘
```

| Button | What it does |
|---|---|
| **Approve Once** | Allows this specific tool call, then asks again next time |
| **Approve for Task** | Auto-approves all further calls of the **same tool** in this session |
| **Reject** | Blocks the tool call; Bob receives the rejection and decides what to do next |

If you don't respond within 2 minutes, the request times out and Bob receives a rejection.

---

## Security notes

- The relay uses a **shared secret token** (`SECRET_TOKEN`). Keep it out of source control.
- The relay is designed for **local network use**. Do not expose it to the public internet without a reverse proxy + TLS.
- The hook **fails open** if the relay is unreachable — Bob continues as if approved. This prevents a network hiccup from permanently blocking your session.
- Timeouts default to **reject** so Bob doesn't hang forever if you lose connectivity.

---

## Extending

### Filter which tools send notifications

Edit [`.bob/hooks/notify.mjs`](.bob/hooks/notify.mjs) and add a skip list before the `fetch`:

```js
const SILENT_TOOLS = new Set(["read_file", "list_files", "glob"]);
if (SILENT_TOOLS.has(input.tool_name)) process.exit(0);
```

### Multiple devices

The relay broadcasts to **all connected SSE clients**. Any device that has the PWA open and is connected will receive the notification. The first device to respond wins.

### Persistent auto-approve across sessions

Currently auto-approve lists are in-memory and reset when the relay restarts or the session ends. To persist them, replace the `sessionAutoApprove` Map in [`relay/server.mjs`](relay/server.mjs) with a JSON file write.
