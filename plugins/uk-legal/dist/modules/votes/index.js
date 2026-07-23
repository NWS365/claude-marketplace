import { registerVotesTools } from "./tools.js";
/** Wires up the votes_search_divisions and votes_get_division tools. */
export const registerVotes = (server, deps) => {
    registerVotesTools(server, deps);
};
