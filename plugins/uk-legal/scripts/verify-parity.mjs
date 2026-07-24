// Interface-compatibility + smoke verifier (compliance artifact): `npm run verify`.
//
// Asserts this server's PUBLIC MCP INTERFACE — the exact set of tool, resource,
// and prompt names it exposes — so that surface stays stable across changes. It
// spawns the built dist/server.js over stdio and runs one offline end-to-end
// tool call (citations_parse).
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { EXPECT_TOOLS, EXPECT_TEMPLATES, EXPECT_STATIC, EXPECT_PROMPTS } from "./expected-surface.mjs";

const pluginRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

const diff = (label, got, want) => {
  const gotS = new Set(got), wantS = new Set(want);
  const missing = want.filter((x) => !gotS.has(x));
  const extra = got.filter((x) => !wantS.has(x));
  const ok = missing.length === 0 && extra.length === 0;
  console.log(`${ok ? "PASS" : "FAIL"} ${label}: got ${got.length}, expected ${want.length}`);
  if (missing.length) console.log("  MISSING:", missing);
  if (extra.length) console.log("  EXTRA:", extra);
  return ok;
};

const transport = new StdioClientTransport({ command: "node", args: [join(pluginRoot, "dist", "server.js")], cwd: pluginRoot });
const client = new Client({ name: "parity-verify", version: "0" }, { capabilities: {} });
await client.connect(transport);

const tools = (await client.listTools()).tools.map((t) => t.name).sort();
const templates = (await client.listResourceTemplates()).resourceTemplates.map((t) => t.uriTemplate).sort();
const resources = (await client.listResources()).resources.map((r) => r.uri).sort();
const prompts = (await client.listPrompts()).prompts.map((p) => p.name).sort();

let ok = true;
ok = diff("tools", tools, EXPECT_TOOLS) && ok;
ok = diff("resource templates", templates, EXPECT_TEMPLATES) && ok;
ok = diff("static resources", resources, EXPECT_STATIC) && ok;
ok = diff("prompts", prompts, EXPECT_PROMPTS) && ok;

// End-to-end offline tool call: citations_parse is pure-regex (no network).
try {
  const res = await client.callTool({
    name: "citations_parse",
    arguments: { text: "See [2024] UKSC 12; s.47 Companies Act 2006; SI 2018/1234." },
  });
  const payload = JSON.parse(res.content[0].text);
  const n = (payload.citations?.length ?? 0) + (payload.ambiguous?.length ?? 0);
  const pass = n >= 3;
  console.log(`${pass ? "PASS" : "FAIL"} citations_parse e2e: parsed ${n} citations (expected >=3)`);
  ok = pass && ok;
} catch (e) {
  console.log("FAIL citations_parse e2e:", e?.message ?? e);
  ok = false;
}

await client.close();
console.log(`\n=== ${ok ? "PARITY + SMOKE PASS" : "VERIFY FAIL"} ===`);
process.exit(ok ? 0 : 1);
