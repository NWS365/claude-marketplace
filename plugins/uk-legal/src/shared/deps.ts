/**
 * The dependency object injected into every module's `register(server, deps)`.
 * Bundles the shared HTTP clients, cache, MCP sampling hook, and stderr logger
 * that the modules draw on, and is the single seam the tests stub.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { HttpClients, type Fetched, type GetOpts } from "./http.js";
import { TtlCache } from "./cache.js";
import { stderrLog, type LogEvent } from "./logging.js";

export interface Deps {
  jsonGet(url: string, opts?: GetOpts): Promise<Fetched>;
  xmlGet(url: string, opts?: GetOpts): Promise<Fetched>;
  legislationGet(url: string, opts?: GetOpts): Promise<Fetched>;
  legislationGetHtml(url: string, opts?: GetOpts): Promise<Fetched>;
  head(url: string, opts?: GetOpts): Promise<{ status: number; ok: boolean }>;
  cache: TtlCache;
  /** MCP sampling — fail-soft: returns null if the client has no sampling capability or on any error. */
  sample(prompt: string, maxTokens?: number): Promise<string | null>;
  log(event: LogEvent): void;
}

export type RegisterFn = (server: McpServer, deps: Deps) => void;

export function createDeps(server: McpServer): Deps {
  const cache = new TtlCache();
  const http = new HttpClients(cache);

  return {
    jsonGet: (url, opts) => http.jsonGet(url, opts),
    xmlGet: (url, opts) => http.xmlGet(url, opts),
    legislationGet: (url, opts) => http.legislationGet(url, opts),
    legislationGetHtml: (url, opts) => http.legislationGetHtml(url, opts),
    head: (url, opts) => http.head(url, opts),
    cache,
    async sample(prompt, maxTokens = 64) {
      try {
        const caps = server.server.getClientCapabilities?.();
        if (!caps?.sampling) return null;
        const res = await server.server.createMessage({
          messages: [{ role: "user", content: { type: "text", text: prompt } }],
          maxTokens,
        });
        const content = res.content;
        if (content && content.type === "text") return content.text.trim();
        return null;
      } catch {
        return null;
      }
    },
    log: (event) => stderrLog(event),
  };
}
