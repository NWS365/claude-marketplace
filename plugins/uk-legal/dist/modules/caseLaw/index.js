import { registerCaseLawTools } from "./tools.js";
/**
 * case_law module — searching and reading judgments from TNA Find Case Law.
 *
 * Primary tools:     case_law_search, case_law_grep_judgment
 * Retrieval helpers: judgment_get_header, judgment_get_index, judgment_get_paragraph
 * Resource templates: judgment://{+slug}/header | /index | /para/{eId}
 */
export const registerCaseLaw = (server, deps) => {
    registerCaseLawTools(server, deps);
};
