import type { RegisterFn } from "../../shared/deps.js";
import { registerCitationsTools } from "./tools.js";

/** Wires up the four citations tools: citations_parse, citations_resolve, citations_network, and citations_format_oscola. */
export const registerCitations: RegisterFn = (server, deps) => {
  registerCitationsTools(server, deps);
};
