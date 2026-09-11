/**
 * BobCall — Stop hook
 * Clears the session's auto-approve list from the relay when the task ends.
 */
let raw = "";
for await (const chunk of process.stdin) raw += chunk;

let input;
try { input = JSON.parse(raw); } catch { process.exit(0); }

const RELAY = process.env.BOBCALL_RELAY_URL ?? "http://localhost:3456";
const TOKEN = process.env.BOBCALL_TOKEN ?? "bobcall-dev";

try {
  await fetch(`${RELAY}/session/${input.session_id}`, {
    method: "DELETE",
    headers: { "x-bobcall-token": TOKEN },
  });
} catch {
  // Relay may already be stopped — ignore
}
