/**
 * BobCall Relay Server
 *
 * Receives tool-approval requests from the Bob IDE PreToolUse hook,
 * fans them out to connected PWA clients over SSE, and holds the
 * pending decision until the user responds (or it times out).
 *
 * ENV:
 *   PORT          — HTTP port to listen on           (default: 3456)
 *   SECRET_TOKEN  — shared auth token                (default: "bobcall-dev")
 *   DECISION_TIMEOUT_MS — ms to wait for user input  (default: 120000 = 2 min)
 */

import express from "express";
import cors from "cors";
import { randomUUID } from "node:crypto";

const PORT = Number(process.env.PORT ?? 3456);
const SECRET = process.env.SECRET_TOKEN ?? "bobcall-dev";
const DECISION_TIMEOUT_MS = Number(process.env.DECISION_TIMEOUT_MS ?? 120_000);

const app = express();
app.use(cors());
app.use(express.json());

// ── Auth middleware ────────────────────────────────────────────────────────────
function requireAuth(req, res, next) {
  const token =
    req.headers["x-bobcall-token"] ??
    req.query.token;
  if (token !== SECRET) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
}

// ── State ──────────────────────────────────────────────────────────────────────
/**
 * pending: Map<id, { resolve, reject, meta, timer }>
 *   resolve(decision)  — "approve" | "approve_all" | "reject"
 * sseClients: Set<res>  — connected PWA SSE streams
 * sessionAutoApprove: Map<session_id, Set<tool_name>>
 */
const pending = new Map();
const sseClients = new Set();
const sessionAutoApprove = new Map();

// ── SSE helpers ────────────────────────────────────────────────────────────────
function broadcast(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients) {
    try { client.write(payload); } catch { sseClients.delete(client); }
  }
}

// ── Routes ─────────────────────────────────────────────────────────────────────

/**
 * GET /events?token=<SECRET>
 * PWA connects here to receive SSE notifications.
 */
app.get("/events", requireAuth, (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  // Send a heartbeat every 20 s so mobile browsers keep the connection alive
  const heartbeat = setInterval(() => {
    try { res.write(": heartbeat\n\n"); } catch { /* client gone */ }
  }, 20_000);

  sseClients.add(res);

  // Re-send any currently pending requests so a freshly opened PWA catches up
  for (const [id, entry] of pending) {
    const payload = `event: pending\ndata: ${JSON.stringify({ id, ...entry.meta })}\n\n`;
    try { res.write(payload); } catch { /* ignore */ }
  }

  req.on("close", () => {
    clearInterval(heartbeat);
    sseClients.delete(res);
  });
});

/**
 * POST /pending
 * Called by the Bob PreToolUse hook with the tool details.
 * Blocks until the user makes a decision (or timeout).
 *
 * Body: { session_id, cwd, tool_name, tool_input, tool_use_id }
 * Returns: { decision: "approve" | "approve_all" | "reject", reason? }
 */
app.post("/pending", requireAuth, (req, res) => {
  const { session_id, cwd, tool_name, tool_input, tool_use_id } = req.body;

  // Check session-level auto-approve list first
  const autoSet = sessionAutoApprove.get(session_id);
  if (autoSet?.has(tool_name)) {
    console.log(`[auto-approve] ${tool_name} (session ${session_id})`);
    return res.json({ decision: "approve", reason: "auto-approved for this task" });
  }

  const id = randomUUID();
  const meta = { session_id, cwd, tool_name, tool_input, tool_use_id, timestamp: Date.now() };

  console.log(`[pending] ${id} — ${tool_name}`);
  broadcast("pending", { id, ...meta });

  // Create a promise that resolves when the user responds
  let resolveDecision;
  const decisionPromise = new Promise((resolve) => { resolveDecision = resolve; });

  const timer = setTimeout(() => {
    pending.delete(id);
    broadcast("expired", { id });
    console.log(`[timeout] ${id} — defaulting to reject`);
    resolveDecision({ decision: "reject", reason: "Timed out waiting for user response" });
  }, DECISION_TIMEOUT_MS);

  pending.set(id, { resolve: resolveDecision, meta, timer });

  // Long-poll: hold the HTTP connection open until resolved
  decisionPromise.then((result) => {
    res.json(result);
  });
});

/**
 * POST /decision/:id
 * Called by the PWA when the user taps Approve / Approve All / Reject.
 *
 * Body: { decision: "approve" | "approve_all" | "reject", reason? }
 */
app.post("/decision/:id", requireAuth, (req, res) => {
  const { id } = req.params;
  const entry = pending.get(id);

  if (!entry) {
    return res.status(404).json({ error: "Request not found or already resolved" });
  }

  const { decision, reason } = req.body;
  if (!["approve", "approve_all", "reject"].includes(decision)) {
    return res.status(400).json({ error: "Invalid decision value" });
  }

  clearTimeout(entry.timer);
  pending.delete(id);

  // If "approve_all", register tool for auto-approval in this session
  if (decision === "approve_all") {
    const { session_id, tool_name } = entry.meta;
    if (!sessionAutoApprove.has(session_id)) {
      sessionAutoApprove.set(session_id, new Set());
    }
    sessionAutoApprove.get(session_id).add(tool_name);
    console.log(`[approve_all] ${tool_name} added to auto-approve for session ${session_id}`);
  }

  broadcast("resolved", { id, decision, reason: reason ?? null });
  console.log(`[resolved] ${id} — ${decision}`);

  entry.resolve({ decision, reason: reason ?? null });
  res.json({ ok: true });
});

/**
 * GET /status
 * Health check — also shows pending count for the PWA dashboard.
 */
app.get("/status", requireAuth, (_req, res) => {
  res.json({
    ok: true,
    pendingCount: pending.size,
    connectedClients: sseClients.size,
  });
});

/**
 * DELETE /session/:session_id
 * Clears auto-approve rules for a session (called by Stop hook).
 */
app.delete("/session/:session_id", requireAuth, (req, res) => {
  sessionAutoApprove.delete(req.params.session_id);
  res.json({ ok: true });
});

// ── Start ──────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`BobCall relay listening on http://localhost:${PORT}`);
  console.log(`  Token : ${SECRET}`);
  console.log(`  Timeout: ${DECISION_TIMEOUT_MS / 1000}s`);
});
