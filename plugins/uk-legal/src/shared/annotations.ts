/**
 * Shared tool annotation presets (mirrors the source's mandated quartet).
 *
 * READ_ONLY_OPEN  — network tools that touch the open world (all upstream calls).
 * READ_ONLY_CLOSED — pure, self-contained tools (citations_parse, citations_format_oscola).
 */
import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";

export const READ_ONLY_OPEN: ToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
};

export const READ_ONLY_CLOSED: ToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};

/** Build annotations with a human-facing title. */
export function withTitle(base: ToolAnnotations, title: string): ToolAnnotations {
  return { ...base, title };
}
