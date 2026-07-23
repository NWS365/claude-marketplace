import { describe, it, expect, vi, afterEach } from "vitest";
import { registerCompaniesHouse } from "../../src/modules/companiesHouse/index.js";
import { registerModule, callTool, resultJson, isErr, fetched } from "../_harness.js";
import {
  parseCompanySearch,
  parseCompanyProfile,
  parseOfficers,
  parsePsc,
} from "../../src/modules/companiesHouse/parsers.js";

/* eslint-disable @typescript-eslint/no-explicit-any */

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

// The Basic header for the "k" test key: base64("k:") === "azo=".
const AUTH_FOR_K = "Basic " + Buffer.from("k:").toString("base64");

// --------------------------------------------------------------- parseCompanySearch
describe("companiesHouse/parsers parseCompanySearch", () => {
  it("returns an empty result set for a null body", () => {
    expect(parseCompanySearch("acme", null)).toEqual({ query: "acme", total: 0, results: [] });
  });

  it("shapes each item and reads total_results", () => {
    const out = parseCompanySearch("acme", {
      total_results: 42,
      items: [
        {
          company_number: "09446231",
          title: "ACME LTD",
          company_status: "active",
          company_type: "ltd",
          date_of_creation: "2015-02-19",
          address_snippet: "1 High St, London",
        },
      ],
    });
    expect(out).toEqual({
      query: "acme",
      total: 42,
      results: [
        {
          company_number: "09446231",
          title: "ACME LTD",
          company_status: "active",
          company_type: "ltd",
          date_of_creation: "2015-02-19",
          address_snippet: "1 High St, London",
        },
      ],
    });
  });

  it("applies null defaults for missing fields and a null entry", () => {
    const out = parseCompanySearch("acme", { items: [{}, null] });
    // total falls back to the item count when total_results is absent.
    expect(out.total).toBe(2);
    for (const r of out.results) {
      expect(r).toEqual({
        company_number: null,
        title: null,
        company_status: null,
        company_type: null,
        date_of_creation: null,
        address_snippet: null,
      });
    }
  });

  it("ignores a non-array items field", () => {
    const out = parseCompanySearch("acme", { items: "nope", total_results: 0 });
    expect(out).toEqual({ query: "acme", total: 0, results: [] });
  });
});

// --------------------------------------------------------------- parseCompanyProfile
describe("companiesHouse/parsers parseCompanyProfile", () => {
  it("returns all-null / empty defaults for a null body", () => {
    expect(parseCompanyProfile(null)).toEqual({
      company_number: null,
      company_name: null,
      company_status: null,
      company_type: null,
      date_of_creation: null,
      jurisdiction: null,
      registered_office_address: null,
      sic_codes: [],
      accounts_next_due: null,
      confirmation_statement_next_due: null,
    });
  });

  it("maps type→company_type, joins the address, and reads next_accounts.due_on", () => {
    const out = parseCompanyProfile({
      company_number: "09446231",
      company_name: "ACME LTD",
      company_status: "active",
      type: "ltd",
      date_of_creation: "2015-02-19",
      jurisdiction: "england-wales",
      registered_office_address: {
        address_line_1: "1 High St",
        address_line_2: "Floor 2",
        locality: "London",
        region: "Greater London",
        postal_code: "EC1A 1AA",
        country: "United Kingdom",
      },
      sic_codes: ["62012", "62020"],
      accounts: { next_accounts: { due_on: "2025-11-30" }, next_due: "2025-01-01" },
      confirmation_statement: { next_due: "2025-03-04" },
    });
    expect(out).toEqual({
      company_number: "09446231",
      company_name: "ACME LTD",
      company_status: "active",
      company_type: "ltd",
      date_of_creation: "2015-02-19",
      jurisdiction: "england-wales",
      registered_office_address: "1 High St, Floor 2, London, Greater London, EC1A 1AA, United Kingdom",
      sic_codes: ["62012", "62020"],
      accounts_next_due: "2025-11-30",
      confirmation_statement_next_due: "2025-03-04",
    });
  });

  it("falls back to accounts.next_due when next_accounts is absent", () => {
    const out = parseCompanyProfile({ accounts: { next_due: "2025-01-01" } });
    expect(out.accounts_next_due).toBe("2025-01-01");
  });

  it("yields a null address when no address lines are present, and [] sic_codes for a non-array", () => {
    const out = parseCompanyProfile({ registered_office_address: {}, sic_codes: "nope" });
    expect(out.registered_office_address).toBeNull();
    expect(out.sic_codes).toEqual([]);
  });

  it("drops blank/whitespace and non-string address parts and sic codes", () => {
    const out = parseCompanyProfile({
      registered_office_address: { address_line_1: "1 High St", address_line_2: "   ", locality: "London" },
      sic_codes: ["62012", 123 as any, null],
    });
    expect(out.registered_office_address).toBe("1 High St, London");
    expect(out.sic_codes).toEqual(["62012"]);
  });
});

// --------------------------------------------------------------- parseOfficers
describe("companiesHouse/parsers parseOfficers", () => {
  it("returns null counts and empty officers for a null body", () => {
    expect(parseOfficers("09446231", null)).toEqual({
      company_number: "09446231",
      active_count: null,
      resigned_count: null,
      officers: [],
    });
  });

  it("shapes each officer and reads the counts", () => {
    const out = parseOfficers("09446231", {
      active_count: 2,
      resigned_count: 1,
      total_results: 3,
      items: [
        {
          name: "SMITH, Jane",
          officer_role: "director",
          appointed_on: "2015-02-19",
          resigned_on: null,
          nationality: "British",
          occupation: "Director",
          country_of_residence: "England",
        },
      ],
    });
    expect(out).toEqual({
      company_number: "09446231",
      active_count: 2,
      resigned_count: 1,
      officers: [
        {
          name: "SMITH, Jane",
          officer_role: "director",
          appointed_on: "2015-02-19",
          resigned_on: null,
          nationality: "British",
          occupation: "Director",
          country_of_residence: "England",
        },
      ],
    });
  });

  it("applies null defaults for missing fields and a null entry, ignoring non-array items", () => {
    const out = parseOfficers("09446231", { items: [{}, null], active_count: "nope" });
    expect(out.active_count).toBeNull();
    expect(out.resigned_count).toBeNull();
    for (const o of out.officers) {
      expect(o).toEqual({
        name: null,
        officer_role: null,
        appointed_on: null,
        resigned_on: null,
        nationality: null,
        occupation: null,
        country_of_residence: null,
      });
    }
    expect(parseOfficers("09446231", { items: "nope" }).officers).toEqual([]);
  });
});

// --------------------------------------------------------------- parsePsc
describe("companiesHouse/parsers parsePsc", () => {
  it("returns a null count and empty psc for a null body", () => {
    expect(parsePsc("09446231", null)).toEqual({
      company_number: "09446231",
      active_count: null,
      psc: [],
    });
  });

  it("shapes each PSC entry, reading active_count and natures_of_control", () => {
    const out = parsePsc("09446231", {
      active_count: 1,
      items: [
        {
          name: "SMITH, Jane",
          kind: "individual-person-with-significant-control",
          nationality: "British",
          notified_on: "2016-04-06",
          ceased_on: null,
          natures_of_control: ["ownership-of-shares-75-to-100-percent"],
        },
      ],
    });
    expect(out).toEqual({
      company_number: "09446231",
      active_count: 1,
      psc: [
        {
          name: "SMITH, Jane",
          kind: "individual-person-with-significant-control",
          nationality: "British",
          notified_on: "2016-04-06",
          ceased_on: null,
          natures_of_control: ["ownership-of-shares-75-to-100-percent"],
        },
      ],
    });
  });

  it("applies defaults for missing fields, a null entry, and a non-array natures_of_control", () => {
    const out = parsePsc("09446231", { items: [{}, null, { natures_of_control: "nope" }] });
    expect(out.active_count).toBeNull();
    for (const p of out.psc) {
      expect(p).toEqual({
        name: null,
        kind: null,
        nationality: null,
        notified_on: null,
        ceased_on: null,
        natures_of_control: [],
      });
    }
    expect(parsePsc("09446231", { items: "nope" }).psc).toEqual([]);
  });
});

// --------------------------------------------------------------- companies_house_search
describe("companies_house_search", () => {
  it("returns a configuration error when the API key is unset", async () => {
    vi.stubEnv("COMPANIES_HOUSE_API_KEY", "");
    const reg = registerModule(registerCompaniesHouse);
    const r = await callTool(reg, "companies_house_search", { query: "acme" });
    expect(isErr(r)).toBe(true);
    expect(resultJson(r)).toMatchObject({
      error_category: "configuration",
      is_retryable: false,
      attempted: "companies_house_search(query='acme')",
    });
    expect(resultJson(r).description).toMatch(/COMPANIES_HOUSE_API_KEY/);
  });

  it("searches the register and shapes the results (happy path)", async () => {
    vi.stubEnv("COMPANIES_HOUSE_API_KEY", "k");
    vi.stubEnv("COMPANIES_HOUSE_API_BASE", "");
    const jsonGet = vi.fn(async () =>
      fetched(
        JSON.stringify({
          total_results: 1,
          items: [
            {
              company_number: "09446231",
              title: "ACME LTD",
              company_status: "active",
              company_type: "ltd",
              date_of_creation: "2015-02-19",
              address_snippet: "1 High St, London",
            },
          ],
        }),
        { contentType: "application/json" }
      )
    );
    const reg = registerModule(registerCompaniesHouse, { jsonGet });
    const out = resultJson(await callTool(reg, "companies_house_search", { query: "acme", limit: 20 }));
    expect(out).toMatchObject({ query: "acme", total: 1 });
    expect(out.results[0]).toMatchObject({ company_number: "09446231", title: "ACME LTD" });

    const [url, opts] = jsonGet.mock.calls[0]! as [string, any];
    expect(url).toBe("https://api.company-information.service.gov.uk/search/companies?q=acme&items_per_page=20");
    expect(opts.headers.Authorization).toBe(AUTH_FOR_K);
  });

  it("surfaces an upstream 500 as unknown", async () => {
    vi.stubEnv("COMPANIES_HOUSE_API_KEY", "k");
    const jsonGet = vi.fn(async () => fetched("boom", { status: 500, ok: false, contentType: "application/json" }));
    const reg = registerModule(registerCompaniesHouse, { jsonGet });
    const r = await callTool(reg, "companies_house_search", { query: "acme" });
    expect(isErr(r)).toBe(true);
    expect(resultJson(r)).toMatchObject({ error_category: "unknown", is_retryable: false });
  });

  it("surfaces an upstream 429 as a retryable transient error", async () => {
    vi.stubEnv("COMPANIES_HOUSE_API_KEY", "k");
    const jsonGet = vi.fn(async () => fetched("slow", { status: 429, ok: false, contentType: "application/json" }));
    const reg = registerModule(registerCompaniesHouse, { jsonGet });
    const r = await callTool(reg, "companies_house_search", { query: "acme" });
    expect(isErr(r)).toBe(true);
    expect(resultJson(r)).toMatchObject({ error_category: "transient", is_retryable: true });
  });
});

// --------------------------------------------------------------- companies_house_get_company
describe("companies_house_get_company", () => {
  it("returns a configuration error when the API key is unset", async () => {
    vi.stubEnv("COMPANIES_HOUSE_API_KEY", "");
    const reg = registerModule(registerCompaniesHouse);
    const r = await callTool(reg, "companies_house_get_company", { company_number: "09446231" });
    expect(isErr(r)).toBe(true);
    expect(resultJson(r)).toMatchObject({ error_category: "configuration", is_retryable: false });
  });

  it("fetches the profile and shapes it (happy path)", async () => {
    vi.stubEnv("COMPANIES_HOUSE_API_KEY", "k");
    vi.stubEnv("COMPANIES_HOUSE_API_BASE", "");
    const jsonGet = vi.fn(async () =>
      fetched(
        JSON.stringify({
          company_number: "09446231",
          company_name: "ACME LTD",
          company_status: "active",
          type: "ltd",
          date_of_creation: "2015-02-19",
          jurisdiction: "england-wales",
          registered_office_address: { address_line_1: "1 High St", locality: "London", postal_code: "EC1A 1AA" },
          sic_codes: ["62012"],
          accounts: { next_accounts: { due_on: "2025-11-30" } },
          confirmation_statement: { next_due: "2025-03-04" },
        }),
        { contentType: "application/json" }
      )
    );
    const reg = registerModule(registerCompaniesHouse, { jsonGet });
    const out = resultJson(await callTool(reg, "companies_house_get_company", { company_number: "09446231" }));
    expect(out).toMatchObject({
      company_number: "09446231",
      company_name: "ACME LTD",
      company_type: "ltd",
      registered_office_address: "1 High St, London, EC1A 1AA",
      accounts_next_due: "2025-11-30",
      confirmation_statement_next_due: "2025-03-04",
    });

    const [url, opts] = jsonGet.mock.calls[0]! as [string, any];
    expect(url).toBe("https://api.company-information.service.gov.uk/company/09446231");
    expect(opts.headers.Authorization).toBe(AUTH_FOR_K);
  });

  it("surfaces a 404 as not_found", async () => {
    vi.stubEnv("COMPANIES_HOUSE_API_KEY", "k");
    const jsonGet = vi.fn(async () => fetched("nope", { status: 404, ok: false, contentType: "application/json" }));
    const reg = registerModule(registerCompaniesHouse, { jsonGet });
    const r = await callTool(reg, "companies_house_get_company", { company_number: "00000000" });
    expect(isErr(r)).toBe(true);
    expect(resultJson(r)).toMatchObject({ error_category: "not_found", is_retryable: false });
  });
});

// --------------------------------------------------------------- companies_house_list_officers
describe("companies_house_list_officers", () => {
  it("returns a configuration error when the API key is unset", async () => {
    vi.stubEnv("COMPANIES_HOUSE_API_KEY", "");
    const reg = registerModule(registerCompaniesHouse);
    const r = await callTool(reg, "companies_house_list_officers", { company_number: "09446231" });
    expect(isErr(r)).toBe(true);
    expect(resultJson(r)).toMatchObject({ error_category: "configuration", is_retryable: false });
  });

  it("fetches the officers and shapes them (happy path)", async () => {
    vi.stubEnv("COMPANIES_HOUSE_API_KEY", "k");
    vi.stubEnv("COMPANIES_HOUSE_API_BASE", "");
    const jsonGet = vi.fn(async () =>
      fetched(
        JSON.stringify({
          active_count: 1,
          resigned_count: 0,
          items: [{ name: "SMITH, Jane", officer_role: "director", appointed_on: "2015-02-19" }],
        }),
        { contentType: "application/json" }
      )
    );
    const reg = registerModule(registerCompaniesHouse, { jsonGet });
    const out = resultJson(
      await callTool(reg, "companies_house_list_officers", { company_number: "09446231", limit: 35 })
    );
    expect(out).toMatchObject({ company_number: "09446231", active_count: 1, resigned_count: 0 });
    expect(out.officers[0]).toMatchObject({ name: "SMITH, Jane", officer_role: "director" });

    const [url, opts] = jsonGet.mock.calls[0]! as [string, any];
    expect(url).toBe("https://api.company-information.service.gov.uk/company/09446231/officers?items_per_page=35");
    expect(opts.headers.Authorization).toBe(AUTH_FOR_K);
  });

  it("surfaces an upstream 500 as unknown", async () => {
    vi.stubEnv("COMPANIES_HOUSE_API_KEY", "k");
    const jsonGet = vi.fn(async () => fetched("boom", { status: 500, ok: false, contentType: "application/json" }));
    const reg = registerModule(registerCompaniesHouse, { jsonGet });
    const r = await callTool(reg, "companies_house_list_officers", { company_number: "09446231" });
    expect(isErr(r)).toBe(true);
    expect(resultJson(r)).toMatchObject({ error_category: "unknown", is_retryable: false });
  });
});

// --------------------------------------------------------------- companies_house_get_psc
describe("companies_house_get_psc", () => {
  it("returns a configuration error when the API key is unset", async () => {
    vi.stubEnv("COMPANIES_HOUSE_API_KEY", "");
    const reg = registerModule(registerCompaniesHouse);
    const r = await callTool(reg, "companies_house_get_psc", { company_number: "09446231" });
    expect(isErr(r)).toBe(true);
    expect(resultJson(r)).toMatchObject({ error_category: "configuration", is_retryable: false });
  });

  it("fetches the PSC list and shapes it (happy path)", async () => {
    vi.stubEnv("COMPANIES_HOUSE_API_KEY", "k");
    vi.stubEnv("COMPANIES_HOUSE_API_BASE", "");
    const jsonGet = vi.fn(async () =>
      fetched(
        JSON.stringify({
          active_count: 1,
          items: [
            {
              name: "SMITH, Jane",
              kind: "individual-person-with-significant-control",
              natures_of_control: ["ownership-of-shares-75-to-100-percent"],
            },
          ],
        }),
        { contentType: "application/json" }
      )
    );
    const reg = registerModule(registerCompaniesHouse, { jsonGet });
    const out = resultJson(await callTool(reg, "companies_house_get_psc", { company_number: "09446231", limit: 25 }));
    expect(out).toMatchObject({ company_number: "09446231", active_count: 1 });
    expect(out.psc[0]).toMatchObject({
      name: "SMITH, Jane",
      natures_of_control: ["ownership-of-shares-75-to-100-percent"],
    });

    const [url, opts] = jsonGet.mock.calls[0]! as [string, any];
    expect(url).toBe(
      "https://api.company-information.service.gov.uk/company/09446231/persons-with-significant-control?items_per_page=25"
    );
    expect(opts.headers.Authorization).toBe(AUTH_FOR_K);
  });

  it("surfaces an upstream 429 as a retryable transient error", async () => {
    vi.stubEnv("COMPANIES_HOUSE_API_KEY", "k");
    const jsonGet = vi.fn(async () => fetched("slow", { status: 429, ok: false, contentType: "application/json" }));
    const reg = registerModule(registerCompaniesHouse, { jsonGet });
    const r = await callTool(reg, "companies_house_get_psc", { company_number: "09446231" });
    expect(isErr(r)).toBe(true);
    expect(resultJson(r)).toMatchObject({ error_category: "transient", is_retryable: true });
  });

  it("uses the COMPANIES_HOUSE_API_BASE override and encodes the company number", async () => {
    vi.stubEnv("COMPANIES_HOUSE_API_KEY", "k");
    vi.stubEnv("COMPANIES_HOUSE_API_BASE", "https://proxy.test");
    const jsonGet = vi.fn(async () => fetched(JSON.stringify({ items: [] }), { contentType: "application/json" }));
    const reg = registerModule(registerCompaniesHouse, { jsonGet });
    await callTool(reg, "companies_house_get_psc", { company_number: "AB/12" });
    const url = (jsonGet.mock.calls[0]! as [string, any])[0] as string;
    expect(url).toBe("https://proxy.test/company/AB%2F12/persons-with-significant-control?items_per_page=25");
  });
});

// --------------------------------------------------------------- registration
describe("companiesHouse registration", () => {
  it("registers exactly the four tools and no resources/prompts", () => {
    const reg = registerModule(registerCompaniesHouse);
    expect([...reg.tools.keys()].sort()).toEqual([
      "companies_house_get_company",
      "companies_house_get_psc",
      "companies_house_list_officers",
      "companies_house_search",
    ]);
    expect(reg.resources).toHaveLength(0);
    expect(reg.prompts.size).toBe(0);
  });
});
