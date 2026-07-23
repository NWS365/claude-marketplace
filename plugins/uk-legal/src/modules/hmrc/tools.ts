/**
 * Tool registrations for the hmrc module.
 *
 * Exposed tool names: hmrc_get_vat_rate, hmrc_check_mtd_status, hmrc_search_guidance.
 * Backing services: HMRC APIs (OAuth 2.0 client-credentials flow) and the GOV.UK search API.
 */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Deps } from "../../shared/deps.js";
import { jsonResult, toolError, toolErrorFromException, UpstreamHttpError } from "../../shared/envelope.js";
import { assertOk, jsonOf } from "../../shared/http.js";
import { READ_ONLY_OPEN, READ_ONLY_CLOSED, withTitle } from "../../shared/annotations.js";
import { TTL } from "../../shared/cache.js";
import { lookupVat, parseMtdStatus, parseGuidanceResults } from "./parsers.js";

const HMRC_API_BASE_DEFAULT = "https://test-api.service.hmrc.gov.uk";
const GOVUK_SEARCH_BASE = "https://www.gov.uk/api/search.json";
const REQUEST_TIMEOUT_MS = 30_000;

// --- Tool description strings shown to the model ---

const GET_VAT_RATE_DESC = `Maps a UK product or service to its VAT band.

Returns the band (standard 20%, reduced 5%, zero 0%, or exempt), the date that
rate took effect, and any caveats or edge cases.

The figures come from a fixed reference table as at the 22 November 2023 Autumn
Statement; a later Budget may have moved them, so where the exact rate matters,
confirm it on GOV.UK via hmrc_search_guidance.`;

const CHECK_MTD_STATUS_DESC = `Given a 9-digit VAT Registration Number, reports whether that business is within the Making Tax Digital VAT mandate.

Returns the mandate flag, the date it applies from, and the registered trading
name.

Calls HMRC's sandbox by default; set HMRC_API_BASE to
'https://api.service.hmrc.gov.uk' for production. OAuth 2.0 access requires the
HMRC_CLIENT_ID and HMRC_CLIENT_SECRET environment variables — with them unset
the tool errors rather than guess a status.`;

const SEARCH_GUIDANCE_DESC = `Looks up HMRC tax guidance published on GOV.UK for a given subject (VAT, income tax, corporation tax, and the like).

Each result carries a title, link, short summary, and the date it was last
updated, drawn from the official GOV.UK content API and scoped to HMRC pages.

Use this as the authoritative source for current HMRC guidance; a general web
search tends to return stale copies or third-party rewrites, so do not top up
these results with it.`;

export function registerHmrcTools(server: McpServer, deps: Deps): void {
  // -------------------------------------------------------------------------
  // hmrc_get_vat_rate — offline table lookup, no network call (READ_ONLY_CLOSED).
  // -------------------------------------------------------------------------
  server.registerTool(
    "hmrc_get_vat_rate",
    {
      title: "Get VAT Rate for Commodity",
      description: GET_VAT_RATE_DESC,
      inputSchema: {
        commodity_code: z
          .string()
          .min(2)
          .max(200)
          .describe(
            "Either a commodity code or an everyday-language description, e.g. 'food', 'domestic fuel', 'software', 'financial services', 'new build residential'"
          ),
      },
      annotations: withTitle(READ_ONLY_CLOSED, "Get VAT Rate for Commodity"),
    },
    async (args) => {
      try {
        return jsonResult(lookupVat(args.commodity_code));
      } catch (err) {
        return toolErrorFromException(err, `hmrc_get_vat_rate(commodity_code='${args.commodity_code}')`);
      }
    }
  );

  // -------------------------------------------------------------------------
  // hmrc_check_mtd_status — queries HMRC MTD VAT obligations behind OAuth 2.0.
  // -------------------------------------------------------------------------
  server.registerTool(
    "hmrc_check_mtd_status",
    {
      title: "Check MTD VAT Status",
      description: CHECK_MTD_STATUS_DESC,
      inputSchema: {
        vrn: z
          .string()
          .min(9)
          .max(12)
          .describe(
            "A 9-digit VAT Registration Number, e.g. '123456789'. A leading GB prefix is allowed and is removed for you."
          ),
      },
      annotations: withTitle(READ_ONLY_OPEN, "Check MTD VAT Status"),
    },
    async (args) => {
      const clientId = process.env.HMRC_CLIENT_ID;
      const clientSecret = process.env.HMRC_CLIENT_SECRET;
      if (!clientId || !clientSecret) {
        return toolError("configuration", {
          isRetryable: false,
          attempted: "hmrc_check_mtd_status",
          description:
            "HMRC OAuth credentials are not set. Provide the HMRC_CLIENT_ID and HMRC_CLIENT_SECRET environment variables.",
        });
      }

      const attempted = `hmrc_check_mtd_status(vrn='${args.vrn}')`;
      try {
        const base = process.env.HMRC_API_BASE || HMRC_API_BASE_DEFAULT;

        // Mint a new OAuth 2.0 client-credentials token per request; nothing is cached.
        const tokenBody = new URLSearchParams();
        tokenBody.append("grant_type", "client_credentials");
        tokenBody.append("client_id", clientId);
        tokenBody.append("client_secret", clientSecret);
        tokenBody.append("scope", "read:vat");
        const tokenUrl = `${base}/oauth/token`;
        const tokenResp = await fetch(tokenUrl, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
          body: tokenBody,
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
        if (!tokenResp.ok) throw new UpstreamHttpError(tokenResp.status, tokenUrl);
        const tokenData = (await tokenResp.json()) as { access_token?: string };
        const accessToken = tokenData.access_token;

        // Normalise the VRN by dropping any leading GB/gb characters.
        const cleanVrn = args.vrn.trim().replace(/^[GBgb]+/, "");

        const qs = new URLSearchParams();
        qs.append("status", "O");
        const obligationsUrl = `${base}/organisations/vat/${cleanVrn}/obligations?${qs.toString()}`;
        const f = assertOk(
          await deps.jsonGet(obligationsUrl, { headers: { Authorization: `Bearer ${accessToken}` } })
        );
        const data = jsonOf(f);
        return jsonResult(parseMtdStatus(cleanVrn, data));
      } catch (err) {
        return toolErrorFromException(err, attempted);
      }
    }
  );

  // -------------------------------------------------------------------------
  // hmrc_search_guidance — hits GOV.UK search.json scoped to HMRC content.
  // -------------------------------------------------------------------------
  server.registerTool(
    "hmrc_search_guidance",
    {
      title: "Search HMRC Guidance",
      description: SEARCH_GUIDANCE_DESC,
      inputSchema: {
        query: z
          .string()
          .min(3)
          .max(300)
          .describe("Text to search HMRC guidance for, e.g. 'VAT digital services', 'R&D tax relief SME'"),
        limit: z
          .number()
          .int()
          .gte(1)
          .lte(25)
          .default(10)
          .describe("Upper bound on how many guidance entries come back (1–25); forwarded as the GOV.UK search count param."),
      },
      annotations: withTitle(READ_ONLY_OPEN, "Search HMRC Guidance"),
    },
    async (args) => {
      const attempted = `hmrc_search_guidance(query='${args.query}')`;
      try {
        const qs = new URLSearchParams();
        qs.append("q", args.query);
        qs.append("filter_organisations", "hm-revenue-customs");
        for (const field of ["title", "description", "link", "public_timestamp"]) {
          qs.append("fields[]", field);
        }
        qs.append("count", String(args.limit));
        const url = `${GOVUK_SEARCH_BASE}?${qs.toString()}`;
        const f = assertOk(await deps.jsonGet(url, { cacheTtl: TTL.NINETY_DAYS }));
        const data = jsonOf(f);
        return jsonResult(parseGuidanceResults(args.query, data));
      } catch (err) {
        return toolErrorFromException(err, attempted);
      }
    }
  );
}
