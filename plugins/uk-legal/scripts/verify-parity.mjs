// Interface-compatibility + smoke verifier (compliance artifact): `npm run verify`.
//
// Asserts this server's PUBLIC MCP INTERFACE — the exact set of tool, resource,
// and prompt names it exposes — so that surface stays stable and remains
// compatible with the uk-legal-mcp interface it targets. These names are
// functional identifiers, not protected expression: the check verifies the
// interface contract, not any copying of source. It spawns the built
// dist/server.js over stdio and runs one offline end-to-end tool call
// (citations_parse).
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const pluginRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

const EXPECT_TOOLS = [
  "case_law_search", "case_law_grep_judgment",
  "legislation_search", "legislation_get_section", "legislation_get_toc",
  "parliament_search_hansard", "parliament_policy_position_summary", "parliament_find_member",
  "parliament_member_debates", "parliament_member_interests", "parliament_search_petitions",
  "parliament_get_debate_divisions", "parliament_get_debate_contributions", "parliament_lookup_by_column",
  "bills_search_bills", "bills_get_bill",
  "votes_search_divisions", "votes_get_division",
  "committees_search_committees", "committees_get_committee", "committees_search_evidence",
  "citations_parse", "citations_resolve", "citations_network", "citations_format_oscola",
  "hmrc_get_vat_rate", "hmrc_check_mtd_status", "hmrc_search_guidance",
  "companies_house_search", "companies_house_get_company", "companies_house_list_officers", "companies_house_get_psc",
  "gazette_search_notices", "gazette_get_notice",
  "eurlex_search", "eurlex_get_document",
  "epo_ops_search_patents", "epo_ops_get_patent",
  "judgment_get_header", "judgment_get_index", "judgment_get_paragraph",
];
const EXPECT_TEMPLATES = [
  "judgment://{+slug}/header", "judgment://{+slug}/index", "judgment://{+slug}/para/{eId}",
  "legislation://{type}/{year}/{number}/section/{section}{?date}",
  "legislation://{type}/{year}/{number}/toc{?date}",
  "hansard://debate/{debate_ext_id}/header",
  "hansard://debate/{debate_ext_id}/contribution/{contribution_ext_id}",
  "hansard://member/{member_id}/biography",
];
const EXPECT_STATIC = ["server://about"];
const EXPECT_PROMPTS = [
  "legislation_summarise_act", "legislation_compare_legislation",
  "parliament_policy_reception_review", "parliament_member_record_on_topic",
];

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
