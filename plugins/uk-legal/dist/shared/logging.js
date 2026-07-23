/**
 * stderr-only structured logging.
 *
 * CRITICAL: on the stdio transport, ANY write to stdout corrupts the JSON-RPC
 * stream. All diagnostic output MUST go to stderr. Never use console.log here.
 */
export function stderrLog(event) {
    try {
        process.stderr.write(JSON.stringify(event) + "\n");
    }
    catch {
        /* never let logging throw into a tool path */
    }
}
/** Log a completed tool call: name, envelope status, and duration. */
export function logToolCall(tool, status, durationMs, extra) {
    stderrLog({ evt: "tool_call", tool, status, duration_ms: Math.round(durationMs), ...extra });
}
