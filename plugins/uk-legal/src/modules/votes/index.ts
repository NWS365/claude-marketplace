import type { RegisterFn } from "../../shared/deps.js";
import { registerVotesTools } from "./tools.js";

/** Wires up the votes_search_divisions and votes_get_division tools. */
export const registerVotes: RegisterFn = (server, deps) => {
  registerVotesTools(server, deps);
};
