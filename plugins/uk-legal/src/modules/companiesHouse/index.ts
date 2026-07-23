import type { RegisterFn } from "../../shared/deps.js";
import { registerCompaniesHouseTools } from "./tools.js";

/**
 * companiesHouse module — searches the UK companies register and looks up a
 * company's profile, officers, and persons with significant control.
 * Registers: companies_house_search, companies_house_get_company,
 * companies_house_list_officers, companies_house_get_psc.
 */
export const registerCompaniesHouse: RegisterFn = (server, deps) => {
  registerCompaniesHouseTools(server, deps);
};
