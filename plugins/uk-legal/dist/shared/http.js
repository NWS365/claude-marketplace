/**
 * HTTP client layer.
 *
 * Three profiles:
 *   jsonGet         — JSON APIs (Hansard, Members, Bills, Votes, Committees, HMRC, GOV.UK)
 *   xmlGet          — XML/Atom APIs (TNA Find Case Law)
 *   legislationGet  — legislation.gov.uk via impit Chrome impersonation (JA3/CloudFront
 *                     437 bypass) + 202-async-render poll + AWS-WAF challenge detection
 *
 * Bodies are read eagerly into a `Fetched` (so results are cacheable and impit's
 * single-consumption body is handled once). Non-2xx does NOT throw — call
 * `assertOk` at the call site to turn a non-2xx response into an error.
 */
import { Impit } from "impit";
import { LegislationUpstreamError, UpstreamHttpError } from "./envelope.js";
export const USER_AGENT = "uk-legal-ts/0.1 (+https://github.com/legal-plugins)";
const DEFAULT_TIMEOUT_MS = 30_000;
export function assertOk(f) {
    if (!f.ok)
        throw new UpstreamHttpError(f.status, f.url);
    return f;
}
export function jsonOf(f) {
    return JSON.parse(f.text);
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function readResp(resp) {
    const text = await resp.text();
    const headers = resp.headers;
    const contentType = (typeof headers?.get === "function" ? headers.get("content-type") : "") ?? "";
    return { status: resp.status, ok: resp.ok, url: resp.url ?? "", contentType, text };
}
export class HttpClients {
    cache;
    legislationImpit;
    constructor(cache) {
        this.cache = cache;
        this.legislationImpit = new Impit({
            browser: "chrome",
            timeout: DEFAULT_TIMEOUT_MS,
            followRedirects: true,
            // Without an explicit Accept, legislation.gov.uk's /search endpoint returns
            // the HTML search page, not the Atom feed the parser needs.
            headers: { Accept: "application/atom+xml, application/xml, text/xml" },
        });
    }
    async nativeGet(url, accept, opts = {}, method = "GET") {
        const run = async () => {
            const resp = await fetch(url, {
                method,
                headers: { "User-Agent": USER_AGENT, Accept: accept, ...(opts.headers ?? {}) },
                redirect: "follow",
                signal: AbortSignal.timeout(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS),
            });
            return readResp(resp);
        };
        if (opts.cacheTtl) {
            const cached = this.cache.get(`GET:${url}`);
            if (cached)
                return cached;
            const f = await run();
            if (f.ok)
                this.cache.set(`GET:${url}`, f, opts.cacheTtl);
            return f;
        }
        return run();
    }
    jsonGet(url, opts = {}) {
        return this.nativeGet(url, "application/json", opts);
    }
    xmlGet(url, opts = {}) {
        return this.nativeGet(url, "application/atom+xml, application/xml, text/xml", opts);
    }
    async head(url, opts = {}) {
        const f = await this.nativeGet(url, "application/json", { ...opts, cacheTtl: undefined }, "HEAD");
        return { status: f.status, ok: f.ok };
    }
    // --- legislation.gov.uk via impit (JA3 impersonation) ---
    static POLL_DELAYS = [1000, 2000, 4000];
    static WAF_MARKERS = ["awsWafCookieDomainList", "challenge-container", "AwsWafIntegration"];
    detectWaf(f) {
        const isHtml = f.contentType.toLowerCase().includes("html");
        if (isHtml && HttpClients.WAF_MARKERS.some((m) => f.text.includes(m))) {
            throw new LegislationUpstreamError(`legislation.gov.uk returned an AWS WAF JavaScript challenge for ${f.url}. ` +
                `This affects the heaviest Acts (notably Companies Act 2006) intermittently. Retry shortly.`);
        }
        if (!f.text.trim()) {
            throw new LegislationUpstreamError(`legislation.gov.uk returned an empty response for ${f.url}. The endpoint for this Act may be blocked. ` +
                `Use legislation_search with fulltext, or try again later.`);
        }
    }
    async impitGet(url, accept, opts) {
        const resp = await this.legislationImpit.fetch(url, {
            method: "GET",
            headers: { Accept: accept, ...(opts.headers ?? {}) },
            timeout: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        });
        return readResp(resp);
    }
    async legislationGet(url, opts = {}) {
        const fetchOnce = async () => {
            let f = await this.impitGet(url, "application/atom+xml, application/xml, text/xml", opts);
            // 202 + HTML: async render pending — poll then re-request.
            if (f.status === 202 && f.contentType.toLowerCase().includes("html")) {
                for (const delay of HttpClients.POLL_DELAYS) {
                    await new Promise((r) => setTimeout(r, delay));
                    f = await this.impitGet(url, "application/atom+xml, application/xml, text/xml", opts);
                    if (f.status !== 202)
                        break;
                }
            }
            if (f.status === 202) {
                throw new LegislationUpstreamError(`legislation.gov.uk is still rendering ${url} after polling. Very large Acts can take longer — retry in a few minutes.`);
            }
            this.detectWaf(f);
            return f;
        };
        if (opts.cacheTtl) {
            const cached = this.cache.get(`LEG:${url}`);
            if (cached)
                return cached;
            const f = await fetchOnce();
            if (f.ok)
                this.cache.set(`LEG:${url}`, f, opts.cacheTtl);
            return f;
        }
        return fetchOnce();
    }
    async legislationGetHtml(url, opts = {}) {
        const f = await this.impitGet(url, "text/html,application/xhtml+xml", opts);
        this.detectWaf(f);
        return f;
    }
}
