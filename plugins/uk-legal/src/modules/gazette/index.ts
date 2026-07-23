import type { RegisterFn } from "../../shared/deps.js";
import { registerGazetteTools } from "./tools.js";

/**
 * gazette module — searching and reading notices from The Gazette, the UK's
 * official public record (insolvency, corporate, personal, and probate
 * notices), served as keyless Atom feeds by the Gazette linked-data API.
 *
 * Tools: gazette_search_notices, gazette_get_notice
 */
export const registerGazette: RegisterFn = (server, deps) => {
  registerGazetteTools(server, deps);
};
