import type { RegisterFn } from "../../shared/deps.js";
import { registerCommitteesTools } from "./tools.js";

/**
 * committees — UK parliamentary select committees, their membership, and their
 * evidence submissions, sourced from committees-api.parliament.uk. Registers
 * committees_search_committees, committees_get_committee, and
 * committees_search_evidence.
 */
export const registerCommittees: RegisterFn = (server, deps) => {
  registerCommitteesTools(server, deps);
};
