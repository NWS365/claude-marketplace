import { registerParliamentTools } from "./tools.js";
import { registerParliamentResources } from "./resources.js";
import { registerParliamentPrompts } from "./prompts.js";
/**
 * Parliament module: nine parliament_* tools (Hansard search, member lookup,
 * financial interests, petitions, retrieval of divisions and contributions,
 * and OSCOLA column lookup), three hansard:// resource templates, and two
 * prefixed prompts.
 */
export const registerParliament = (server, deps) => {
    registerParliamentTools(server, deps);
    registerParliamentResources(server, deps);
    registerParliamentPrompts(server);
};
