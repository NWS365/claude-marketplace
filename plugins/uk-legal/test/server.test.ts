import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

// Stub the stdio transport so main() can connect without touching real stdin/stdout.
vi.mock("@modelcontextprotocol/sdk/server/stdio.js", () => ({
  StdioServerTransport: class {
    onclose?: () => void;
    onerror?: (e: unknown) => void;
    onmessage?: (m: unknown) => void;
    async start() {}
    async close() {}
    async send() {}
  },
}));

import { buildServer, main } from "../src/server.js";

/**
 * In-process integration: build the real McpServer (exercising server.ts wiring
 * and every module's registration) and enumerate the client-facing surface.
 * This mirrors scripts/verify-parity.mjs but runs under coverage.
 */
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
const EXPECT_PROMPTS = [
  "legislation_summarise_act", "legislation_compare_legislation",
  "parliament_policy_reception_review", "parliament_member_record_on_topic",
];

let client: Client;

beforeAll(async () => {
  const server = buildServer();
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: "test", version: "0" }, { capabilities: {} });
  await Promise.all([server.connect(serverT), client.connect(clientT)]);
});

afterAll(async () => {
  await client?.close();
});

describe("buildServer surface", () => {
  it("registers exactly the expected 41 tools", async () => {
    const tools = (await client.listTools()).tools.map((t) => t.name).sort();
    expect(tools).toEqual([...EXPECT_TOOLS].sort());
  });

  it("registers the expected 8 resource templates", async () => {
    const templates = (await client.listResourceTemplates()).resourceTemplates.map((t) => t.uriTemplate).sort();
    expect(templates).toEqual([...EXPECT_TEMPLATES].sort());
  });

  it("registers the server://about static resource", async () => {
    const resources = (await client.listResources()).resources.map((r) => r.uri);
    expect(resources).toContain("server://about");
  });

  it("registers the expected 4 prompts", async () => {
    const prompts = (await client.listPrompts()).prompts.map((p) => p.name).sort();
    expect(prompts).toEqual([...EXPECT_PROMPTS].sort());
  });

  it("serves server://about with provenance JSON", async () => {
    const res = await client.readResource({ uri: "server://about" });
    const about = JSON.parse((res.contents[0] as any).text);
    expect(about).toMatchObject({ name: "uk-legal", all_tools_read_only: true });
    expect(about.license).toMatch(/Proprietary/);
    expect(about.upstreams.length).toBe(12);
  });

  it("advertises server instructions on initialize", () => {
    const instructions = client.getInstructions();
    expect(instructions).toContain("UK legal research");
  });
});

describe("main() entrypoint", () => {
  it("builds the server, connects the stdio transport, and logs startup", async () => {
    const err = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    await main();
    expect(err.mock.calls.some((c) => String(c[0]).includes("server_start"))).toBe(true);
    err.mockRestore();
  });
});
