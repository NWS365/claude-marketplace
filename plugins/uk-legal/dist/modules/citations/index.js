import { registerCitationsTools } from "./tools.js";
/** Wires up the four citations tools: citations_parse, citations_resolve, citations_network, and citations_format_oscola. */
export const registerCitations = (server, deps) => {
    registerCitationsTools(server, deps);
};
