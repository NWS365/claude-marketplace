import { registerEurlexTools } from "./tools.js";
/**
 * eurlex module — looks up EU legal instruments by CELEX id via the keyless
 * public CELLAR SPARQL endpoint. For England & Wales these are relevant as
 * retained/assimilated EU law — a primary source whose in-force status must
 * still be checked against the UK legislation tools.
 * Registers: eurlex_search, eurlex_get_document.
 */
export const registerEurlex = (server, deps) => {
    registerEurlexTools(server, deps);
};
