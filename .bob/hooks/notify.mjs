/**
 * BobCall — PreToolUse hook
 *
 * For every tool call Bob wants to make, this script:
 *   1. POSTs the tool details to the local relay server
 *   2. Waits (long-poll) for the user's decision from the PWA
 *   3. Exits 0 (allow) or 2 (block) based on that decision
 *
 * ENV (set in your shell before starting Bob, or in a .env loaded by the relay):
 *   BOBCALL_RELAY_URL   — relay base URL  (default: http://localhost:3456)
 *   BOBCALL_TOKEN       — shared secret   (default: bobcall-dev)
 *   BOBCALL_TIMEOUT_MS  — fetch timeout   (default: 130000 — slightly longer than relay timeout)
 */

// ── Read stdin ─────────────────────────────────────────────────────────────────
let raw = "";
for await (const chunk of process.stdin) raw += chunk;

let input;
try {
  input = JSON.parse(raw);
} catch {
  // Malformed input — fail open so Bob continues normally
  process.exit(0);
}

const RELAY = process.env.BOBCALL_RELAY_URL ?? "http://localhost:3456";
const TOKEN = process.env.BOBCALL_TOKEN ?? "bobcall-dev";
const FETCH_TIMEOUT_MS = Number(process.env.BOBCALL_TIMEOUT_MS ?? 130_000);

// ── POST to relay and wait for decision ────────────────────────────────────────
let result;
try {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  const response = await fetch(`${RELAY}/pending`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-bobcall-token": TOKEN,
    },
    body: JSON.stringify({
      session_id: input.session_id,
      cwd: input.cwd,
      tool_name: input.tool_name,
      tool_input: input.tool_input,
      tool_use_id: input.tool_use_id,
    }),
    signal: controller.signal,
  });

  clearTimeout(timer);
  result = await response.json();
} catch (err) {
  // If the relay is unreachable, fail open so Bob is not permanently blocked
  process.stderr.write(`[BobCall] Relay unreachable (${err.message}), failing open.\n`);
  process.exit(0);
}

// ── Act on decision ────────────────────────────────────────────────────────────
const { decision, reason } = result ?? {};

if (decision === "reject") {
  const msg = reason ?? "Rejected by user via BobCall PWA";
  process.stderr.write(msg);
  process.exitCode = 2;
} else {
  // "approve" or "approve_all" — allow the tool call
  process.exitCode = 0;
}
