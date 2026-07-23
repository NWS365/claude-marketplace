import type { RegisterFn } from "../../shared/deps.js";
import { registerTools } from "./tools.js";
import { registerResources } from "./resources.js";
import { registerPrompts } from "./prompts.js";

/**
 * Legislation module — covers Acts of Parliament and Statutory Instruments
 * sourced from legislation.gov.uk, using the Atom feed for search and CLML XML
 * for sections and the table of contents.
 *
 * Tools:     legislation_search, legislation_get_section, legislation_get_toc
 * Resources: legislation://{type}/{year}/{number}/section/{section}{?date}
 *            legislation://{type}/{year}/{number}/toc{?date}
 * Prompts:   legislation_summarise_act, legislation_compare_legislation
 */
export const registerLegislation: RegisterFn = (server, deps) => {
  registerTools(server, deps);
  registerResources(server, deps);
  registerPrompts(server, deps);
};
