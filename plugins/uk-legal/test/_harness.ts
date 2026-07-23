/**
 * Shared test harness.
 *
 * Modules register against an `McpServer` and read data through an injected
 * `Deps`. Neither needs a live server or the network to test: this harness
 * captures what a module registers (tools/resources/prompts + their handlers)
 * and builds a fully-stubbed `Deps` so handlers can be driven directly with
 * canned upstream bodies.
 */
import { vi } from "vitest";
import { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { Deps, RegisterFn } from "../src/shared/deps.js";
import type { Fetched, GetOpts } from "../src/shared/http.js";
import { TtlCache } from "../src/shared/cache.js";

/* eslint-disable @typescript-eslint/no-explicit-any */

export type ToolHandler = (args: any, extra?: any) => Promise<CallToolResult> | CallToolResult;
export type ResourceHandler = (uri: URL, variables: any, extra?: any) => Promise<any> | any;
export type PromptHandler = (args: any, extra?: any) => Promise<any> | any;

export interface CapturedTool {
  name: string;
  config: any;
  handler: ToolHandler;
}
export interface CapturedResource {
  name: string;
  template: any;
  config: any;
  handler: ResourceHandler;
}
export interface CapturedPrompt {
  name: string;
  config: any;
  handler: PromptHandler;
}

export interface Registered {
  tools: Map<string, CapturedTool>;
  resources: CapturedResource[];
  prompts: Map<string, CapturedPrompt>;
  deps: Deps;
  /** The fake server object the module registered against. */
  server: any;
}

/** A minimal `Fetched`; override any field. Defaults to a 200 XML body. */
export function fetched(text: string, over: Partial<Fetched> = {}): Fetched {
  return {
    status: 200,
    ok: true,
    url: "https://upstream.test/resource",
    contentType: "application/xml",
    text,
    ...over,
  };
}

type FetchLike = (url: string, opts?: GetOpts) => Promise<Fetched>;

/** Build a fully-stubbed Deps. Every fetcher throws unless overridden per test. */
export function makeDeps(over: Partial<Deps> = {}): Deps {
  const cache = new TtlCache();
  const unstubbed = (name: string): FetchLike =>
    vi.fn(async () => {
      throw new Error(`deps.${name} was called but not stubbed in this test`);
    });
  const base: Deps = {
    jsonGet: unstubbed("jsonGet"),
    xmlGet: unstubbed("xmlGet"),
    legislationGet: unstubbed("legislationGet"),
    legislationGetHtml: unstubbed("legislationGetHtml"),
    head: vi.fn(async () => ({ status: 200, ok: true })),
    cache,
    sample: vi.fn(async () => null),
    log: vi.fn(),
  };
  return { ...base, ...over };
}

/**
 * Register a module against a capturing fake server and return everything it
 * registered plus the `Deps` its handlers closed over.
 */
export function registerModule(register: RegisterFn, depsOver: Partial<Deps> = {}): Registered {
  const tools = new Map<string, CapturedTool>();
  const resources: CapturedResource[] = [];
  const prompts = new Map<string, CapturedPrompt>();
  const deps = makeDeps(depsOver);

  const server: any = {
    registerTool(name: string, config: any, handler: ToolHandler) {
      tools.set(name, { name, config, handler });
      return { name };
    },
    registerResource(name: string, template: any, config: any, handler: ResourceHandler) {
      resources.push({ name, template, config, handler });
      return { name };
    },
    registerPrompt(name: string, config: any, handler: PromptHandler) {
      prompts.set(name, { name, config, handler });
      return { name };
    },
  };

  register(server as any, deps);
  return { tools, resources, prompts, deps, server };
}

/**
 * Invoke a captured tool handler by wire name.
 *
 * Args are parsed through the tool's registered inputSchema (a ZodRawShape),
 * so Zod defaults and coercion are applied exactly as the real MCP SDK would
 * before dispatching to the handler — tests may omit defaulted params.
 */
export async function callTool(reg: Registered, name: string, args: any): Promise<CallToolResult> {
  const t = reg.tools.get(name);
  if (!t) throw new Error(`tool not registered: ${name} (have: ${[...reg.tools.keys()].join(", ")})`);
  const shape = t.config?.inputSchema;
  const parsed = shape && typeof shape === "object" ? z.object(shape).parse(args ?? {}) : args;
  return t.handler(parsed);
}

/** Find a captured resource by its uriTemplate (or the raw string URI). */
export function resourceByTemplate(reg: Registered, uriTemplate: string): CapturedResource {
  const r = reg.resources.find((res) => {
    const t = res.template;
    const tmpl = typeof t === "string" ? t : (t?.uriTemplate?.toString?.() ?? String(t));
    return tmpl === uriTemplate;
  });
  if (!r) {
    const all = reg.resources.map((res) =>
      typeof res.template === "string" ? res.template : res.template?.uriTemplate?.toString?.(),
    );
    throw new Error(`resource not registered: ${uriTemplate} (have: ${all.join(", ")})`);
  }
  return r;
}

/** Parse the JSON text payload out of a tool result. */
export function resultJson<T = any>(r: CallToolResult): T {
  const c = r.content?.[0] as { type: string; text: string } | undefined;
  if (!c || c.type !== "text") throw new Error("tool result has no text content");
  return JSON.parse(c.text) as T;
}

/** True if the tool returned a structured error result. */
export function isErr(r: CallToolResult): boolean {
  return r.isError === true;
}
