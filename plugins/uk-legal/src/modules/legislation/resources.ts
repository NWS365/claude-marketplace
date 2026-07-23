/**
 * Resource templates for UK legislation.
 *
 * There are two scoped resources here, and each takes an optional {?date} so
 * callers can pin research to a moment in time. They fetch through the shared
 * deps.legislationGet (impit), and the TOC resource reuses the same flattening
 * that legislation_get_toc applies.
 *
 *   legislation://{type}/{year}/{number}/section/{section}{?date} → raw CLML XML
 *   legislation://{type}/{year}/{number}/toc{?date}               → 'id: title' lines
 */
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Deps } from "../../shared/deps.js";
import { assertOk } from "../../shared/http.js";
import { TTL } from "../../shared/cache.js";
import { LEGISLATION_BASE, parseTocXml } from "./parsers.js";

function one(v: string | string[] | undefined): string {
  return Array.isArray(v) ? (v[0] ?? "") : (v ?? "");
}

export function registerResources(server: McpServer, deps: Deps): void {
  server.registerResource(
    "UK Legislation Section (CLML XML)",
    new ResourceTemplate("legislation://{type}/{year}/{number}/section/{section}{?date}", { list: undefined }),
    {
      title: "UK Legislation Section (CLML XML)",
      description:
        "The CLML XML for one section of an Act or SI — for example, " +
        "legislation://ukpga/2006/46/section/172. " +
        "Add ?date=YYYY-MM-DD to retrieve the section exactly as it read on " +
        "that day, which is handy for compliance audits, before-and-after " +
        "amendment comparisons, or historical legal research.",
      mimeType: "application/xml",
    },
    async (uri, variables) => {
      const type = one(variables.type);
      const year = one(variables.year);
      const number = one(variables.number);
      const section = one(variables.section);
      const date = one(variables.date);
      const url = date
        ? `${LEGISLATION_BASE}/${type}/${year}/${number}/section/${section}/${date}/data.xml`
        : `${LEGISLATION_BASE}/${type}/${year}/${number}/section/${section}/data.xml`;
      const f = assertOk(await deps.legislationGet(url, { cacheTtl: TTL.DAY }));
      return { contents: [{ uri: uri.href, mimeType: "application/xml", text: f.text }] };
    }
  );

  server.registerResource(
    "UK Legislation Table of Contents",
    new ResourceTemplate("legislation://{type}/{year}/{number}/toc{?date}", { list: undefined }),
    {
      title: "UK Legislation Table of Contents",
      description:
        "A flattened table of contents — parts, chapters, sections and " +
        "schedules — given as 'id: title' entries, one per line. For example, " +
        "legislation://ukpga/2006/46/toc. Add ?date=YYYY-MM-DD to get the TOC " +
        "as it stood on that day for historical research.",
      mimeType: "text/plain",
    },
    async (uri, variables) => {
      const type = one(variables.type);
      const year = one(variables.year);
      const number = one(variables.number);
      const date = one(variables.date);
      const url = date
        ? `${LEGISLATION_BASE}/${type}/${year}/${number}/${date}/data.xml`
        : `${LEGISLATION_BASE}/${type}/${year}/${number}/data.xml`;
      const f = assertOk(await deps.legislationGet(url, { cacheTtl: TTL.DAY }));
      const items = parseTocXml(f.text);
      return { contents: [{ uri: uri.href, mimeType: "text/plain", text: items.join("\n") }] };
    }
  );
}
