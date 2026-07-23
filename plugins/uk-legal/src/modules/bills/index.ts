import type { RegisterFn } from "../../shared/deps.js";
import { registerBillsTools } from "./tools.js";

// Bills module (U8): exposes bills_search_bills and bills_get_bill.
// Data comes from bills-api.parliament.uk, an open JSON API needing no auth.
export const registerBills: RegisterFn = (server, deps) => {
  registerBillsTools(server, deps);
};
