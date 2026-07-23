import type { RegisterFn } from "../../shared/deps.js";
import { registerHmrcTools } from "./tools.js";

/**
 * hmrc module — looks up UK VAT rates, MTD VAT status, and HMRC guidance.
 * Registers: hmrc_get_vat_rate, hmrc_check_mtd_status, hmrc_search_guidance.
 */
export const registerHmrc: RegisterFn = (server, deps) => {
  registerHmrcTools(server, deps);
};
