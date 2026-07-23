import type { RegisterFn } from "../../shared/deps.js";
import { registerEpoOpsTools } from "./tools.js";

/**
 * epoOps module — searches the European Patent Office Open Patent Services
 * (OPS v3.2) register (EP and national filings, GB/UK included) via an OAuth
 * 2.0 client-credentials flow.
 * Registers: epo_ops_search_patents, epo_ops_get_patent.
 */
export const registerEpoOps: RegisterFn = (server, deps) => {
  registerEpoOpsTools(server, deps);
};
