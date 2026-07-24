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
// Surface lists come from the single source of truth shared with verify-parity.mjs.
import { EXPECT_TOOLS, EXPECT_TEMPLATES, EXPECT_PROMPTS } from "../scripts/expected-surface.mjs";

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
