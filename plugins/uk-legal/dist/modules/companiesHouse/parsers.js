/** Convert a company-search payload into a CompanySearchResult. */
export function parseCompanySearch(query, raw) {
    const data = (raw ?? {});
    const items = Array.isArray(data.items) ? data.items : [];
    const results = [];
    for (const entry of items) {
        const item = (entry ?? {});
        results.push({
            company_number: item.company_number ?? null,
            title: item.title ?? null,
            company_status: item.company_status ?? null,
            company_type: item.company_type ?? null,
            date_of_creation: item.date_of_creation ?? null,
            address_snippet: item.address_snippet ?? null,
        });
    }
    const total = typeof data.total_results === "number" ? data.total_results : results.length;
    return { query, total, results };
}
/** Build a CompanyProfile from a raw company-profile payload. */
export function parseCompanyProfile(raw) {
    const data = (raw ?? {});
    const address = (data.registered_office_address ?? {});
    const addressParts = [
        address.address_line_1,
        address.address_line_2,
        address.locality,
        address.region,
        address.postal_code,
        address.country,
    ].filter((p) => typeof p === "string" && p.trim() !== "");
    const registered_office_address = addressParts.length > 0 ? addressParts.join(", ") : null;
    const sic_codes = Array.isArray(data.sic_codes)
        ? data.sic_codes.filter((c) => typeof c === "string")
        : [];
    const accounts_next_due = data.accounts?.next_accounts?.due_on ?? data.accounts?.next_due ?? null;
    const confirmation_statement_next_due = data.confirmation_statement?.next_due ?? null;
    return {
        company_number: data.company_number ?? null,
        company_name: data.company_name ?? null,
        company_status: data.company_status ?? null,
        company_type: data.type ?? null,
        date_of_creation: data.date_of_creation ?? null,
        jurisdiction: data.jurisdiction ?? null,
        registered_office_address,
        sic_codes,
        accounts_next_due,
        confirmation_statement_next_due,
    };
}
/** Convert an officers payload into a CompanyOfficersResult. */
export function parseOfficers(companyNumber, raw) {
    const data = (raw ?? {});
    const items = Array.isArray(data.items) ? data.items : [];
    const officers = [];
    for (const entry of items) {
        const item = (entry ?? {});
        officers.push({
            name: item.name ?? null,
            officer_role: item.officer_role ?? null,
            appointed_on: item.appointed_on ?? null,
            resigned_on: item.resigned_on ?? null,
            nationality: item.nationality ?? null,
            occupation: item.occupation ?? null,
            country_of_residence: item.country_of_residence ?? null,
        });
    }
    return {
        company_number: companyNumber,
        active_count: typeof data.active_count === "number" ? data.active_count : null,
        resigned_count: typeof data.resigned_count === "number" ? data.resigned_count : null,
        officers,
    };
}
/** Convert a persons-with-significant-control payload into a CompanyPscResult. */
export function parsePsc(companyNumber, raw) {
    const data = (raw ?? {});
    const items = Array.isArray(data.items) ? data.items : [];
    const psc = [];
    for (const entry of items) {
        const item = (entry ?? {});
        psc.push({
            name: item.name ?? null,
            kind: item.kind ?? null,
            nationality: item.nationality ?? null,
            notified_on: item.notified_on ?? null,
            ceased_on: item.ceased_on ?? null,
            natures_of_control: Array.isArray(item.natures_of_control)
                ? item.natures_of_control.filter((n) => typeof n === "string")
                : [],
        });
    }
    return {
        company_number: companyNumber,
        active_count: typeof data.active_count === "number" ? data.active_count : null,
        psc,
    };
}
