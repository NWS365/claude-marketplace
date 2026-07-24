// Opt-in LIVE smoke test: `npm run smoke:live`.
//
// Unlike the unit tests (which stub every upstream) and verify-parity (which is
// offline), this hits the real APIs to validate that our parsers still match
// the live response shapes — especially the newer, less-battle-tested modules
// (EPO OPS JSON nesting, EUR-Lex CELLAR SPARQL, Gazette Atom facets, Companies
// House). It is NOT part of CI: it needs network and, for the keyed sources,
// credentials. Keyless probes always run; keyed probes SKIP when their env vars
// are absent, so the script is safe to run with no keys (it just covers less).
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const pluginRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const transport = new StdioClientTransport({
  command: "node",
  args: [join(pluginRoot, "dist", "server.js")],
  cwd: pluginRoot,
});
const client = new Client({ name: "smoke-live", version: "0" }, { capabilities: {} });
await client.connect(transport);

let ok = true;
let ran = 0;
let skipped = 0;

async function probe(label, name, args, requiresEnv = []) {
  const missing = requiresEnv.filter((k) => !process.env[k]);
  if (missing.length) {
    console.log(`SKIP ${label} — set ${missing.join(", ")} to include it`);
    skipped++;
    return;
  }
  ran++;
  try {
    const res = await client.callTool({ name, arguments: args });
    const text = res.content?.[0]?.text ?? "";
    if (res.isError) {
      console.log(`FAIL ${label}: ${text.slice(0, 200)}`);
      ok = false;
      return;
    }
    JSON.parse(text); // must be shaped JSON, not an opaque error
    console.log(`PASS ${label}`);
  } catch (e) {
    console.log(`FAIL ${label}: ${e?.message ?? e}`);
    ok = false;
  }
}

// Keyless — always run.
await probe("gazette_search_notices", "gazette_search_notices", { query: "insolvency", limit: 2 });
await probe("eurlex_search", "eurlex_search", { query: "data protection", limit: 2 });
// Keyed — run only when credentials are present.
await probe("companies_house_search", "companies_house_search", { query: "tesco", limit: 2 }, ["COMPANIES_HOUSE_API_KEY"]);
await probe("epo_ops_search_patents", "epo_ops_search_patents", { query: "blockchain", limit: 2 }, [
  "EPO_OPS_CONSUMER_KEY",
  "EPO_OPS_CONSUMER_SECRET",
]);

await client.close();
console.log(`\n=== ${ok ? "LIVE SMOKE PASS" : "LIVE SMOKE FAIL"} — ${ran} ran, ${skipped} skipped ===`);
process.exit(ok ? 0 : 1);
