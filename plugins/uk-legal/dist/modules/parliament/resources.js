/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * hansard:// resource templates for the parliament module.
 *
 * Three URI templates that expose sizeable Hansard payloads as resources:
 *   hansard://debate/{debate_ext_id}/header
 *   hansard://debate/{debate_ext_id}/contribution/{contribution_ext_id}
 *   hansard://member/{member_id}/biography
 *
 * The parent debate JSON is fetched with cacheTtl TTL.HOUR, so repeated
 * contribution reads from the same debate cost nothing after the first.
 */
import { ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { assertOk, jsonOf } from "../../shared/http.js";
import { errorEnvelope, notFoundEnvelope } from "../../shared/envelope.js";
import { TTL } from "../../shared/cache.js";
import { HANSARD_API, MEMBERS_BASE, assignColumns, formatHttpError, hansardSourceLabel, itemIsContribution, stripHtml, } from "./parsers.js";
function jsonContents(uri, obj, indent) {
    return {
        contents: [
            {
                uri: uri.href,
                mimeType: "application/json",
                text: indent > 0 ? JSON.stringify(obj, null, indent) : JSON.stringify(obj),
            },
        ],
    };
}
async function fetchDebate(deps, debateExtId) {
    const f = assertOk(await deps.jsonGet(`${HANSARD_API}/debates/Debate/${debateExtId}.json`, { cacheTtl: TTL.HOUR }));
    return jsonOf(f);
}
async function fetchBiography(deps, memberId) {
    const f = assertOk(await deps.jsonGet(`${MEMBERS_BASE}/Members/${memberId}/Biography`, { cacheTtl: TTL.HOUR }));
    return jsonOf(f).value ?? {};
}
export function registerParliamentResources(server, deps) {
    // -------------------------------------------------------------------------
    // hansard://debate/{debate_ext_id}/header
    // -------------------------------------------------------------------------
    server.registerResource("Hansard Debate — header + ordered contribution index", new ResourceTemplate("hansard://debate/{debate_ext_id}/header", { list: undefined }), {
        description: "An overview of the debate (title, date, house, location, volume) " +
            "together with an ordered index of its contributions, each shown as " +
            "'OrderInSection: AttributedTo [col_ref] — first 100 chars'. " +
            "Pass the debate_ext_id (the DebateSectionExtId GUID) that " +
            "parliament_search_hansard or parliament_policy_position_summary returns. " +
            "Size runs about 3-8k tokens for a debate of 50-150 contributions.",
        mimeType: "application/json",
    }, async (uri, variables) => {
        const debateExtId = String(variables.debate_ext_id);
        let data;
        try {
            data = await fetchDebate(deps, debateExtId);
        }
        catch (e) {
            return jsonContents(uri, errorEnvelope(e, { error: formatHttpError(e), debate_ext_id: debateExtId }), 0);
        }
        const overview = data.Overview ?? {};
        const items = data.Items ?? [];
        const columnsByIdx = assignColumns(items);
        const index = [];
        for (let idx = 0; idx < items.length; idx++) {
            const item = items[idx];
            if (!itemIsContribution(item))
                continue;
            const preview = stripHtml(item.Value || "").slice(0, 100);
            const [colStart, colEnd] = columnsByIdx[idx] ?? [null, null];
            index.push({
                order: item.OrderInSection ?? null,
                contribution_ext_id: item.ExternalId ?? null,
                member_id: item.MemberId ?? null,
                attributed_to: item.AttributedTo ?? null,
                column_ref: item.HansardSection ?? null,
                column_start: colStart,
                column_end: colEnd,
                preview,
            });
        }
        const out = {
            debate_id: overview.Id ?? null,
            debate_ext_id: overview.ExtId || debateExtId,
            title: (overview.Title || "").trim(),
            date: (overview.Date || "").slice(0, 10),
            house: overview.House ?? null,
            location: overview.Location ?? null,
            volume_no: overview.VolumeNo ?? null,
            source_code: overview.Source ?? null,
            source: hansardSourceLabel(overview.Source),
            content_last_updated: overview.ContentLastUpdated ?? null,
            previous_debate_ext_id: overview.PreviousDebateExtId ?? null,
            previous_debate_title: (overview.PreviousDebateTitle || "").trim() || null,
            next_debate_ext_id: overview.NextDebateExtId ?? null,
            next_debate_title: (overview.NextDebateTitle || "").trim() || null,
            contribution_count: index.length,
            contributions_index: index,
        };
        return jsonContents(uri, out, 2);
    });
    // -------------------------------------------------------------------------
    // hansard://debate/{debate_ext_id}/contribution/{contribution_ext_id}
    // -------------------------------------------------------------------------
    server.registerResource("Hansard Contribution — single contribution full text", new ResourceTemplate("hansard://debate/{debate_ext_id}/contribution/{contribution_ext_id}", {
        list: undefined,
    }), {
        description: "The complete text of one contribution alongside its member metadata " +
            "and column reference, pulled from the debate it belongs to. Supply the " +
            "debate_ext_id and contribution_ext_id that parliament_search_hansard " +
            "returns. Size is usually 200-2000 tokens. The parent debate JSON stays " +
            "cached at the gateway for an hour, so further contribution reads from " +
            "the same debate cost nothing.",
        mimeType: "application/json",
    }, async (uri, variables) => {
        const debateExtId = String(variables.debate_ext_id);
        const contributionExtId = String(variables.contribution_ext_id);
        let data;
        try {
            data = await fetchDebate(deps, debateExtId);
        }
        catch (e) {
            return jsonContents(uri, errorEnvelope(e, {
                error: formatHttpError(e),
                debate_ext_id: debateExtId,
                contribution_ext_id: contributionExtId,
            }), 0);
        }
        const overview = data.Overview ?? {};
        const items = data.Items ?? [];
        const columnsByIdx = assignColumns(items);
        let matchIdx = -1;
        for (let i = 0; i < items.length; i++) {
            if ((items[i]?.ExternalId || "") === contributionExtId) {
                matchIdx = i;
                break;
            }
        }
        if (matchIdx === -1) {
            const detail = `Contribution ${contributionExtId} not found in debate ${debateExtId}.`;
            return jsonContents(uri, notFoundEnvelope(detail, {
                error: detail,
                debate_ext_id: debateExtId,
                contribution_ext_id: contributionExtId,
            }), 0);
        }
        const match = items[matchIdx];
        const htmlValue = match.Value || "";
        const [columnStart, columnEnd] = columnsByIdx[matchIdx] ?? [null, null];
        const out = {
            debate_ext_id: overview.ExtId || debateExtId,
            debate_title: (overview.Title || "").trim(),
            debate_date: (overview.Date || "").slice(0, 10),
            house: overview.House ?? null,
            contribution_ext_id: match.ExternalId ?? null,
            order_in_debate: match.OrderInSection ?? null,
            member_id: match.MemberId ?? null,
            attributed_to: match.AttributedTo ?? null,
            column_ref: match.HansardSection ?? null,
            column_start: columnStart,
            column_end: columnEnd,
            uin: match.UIN ?? null,
            is_reiteration: match.IsReiteration ?? null,
            text: stripHtml(htmlValue),
            html: htmlValue,
        };
        return jsonContents(uri, out, 2);
    });
    // -------------------------------------------------------------------------
    // hansard://member/{member_id}/biography
    // -------------------------------------------------------------------------
    server.registerResource("UK Parliament Member — biography", new ResourceTemplate("hansard://member/{member_id}/biography", { list: undefined }), {
        description: "The complete biography from the Members API: constituency " +
            "representations, house memberships, government and opposition posts, " +
            "committee memberships, and party affiliations. Every post records a " +
            "startDate and endDate, letting a caller work out the member's role at " +
            "the moment of any given contribution. Size is roughly 2-5k tokens.",
        mimeType: "application/json",
    }, async (uri, variables) => {
        // The URI template hands member_id over as a string; convert it to a number for the API.
        const memberId = Number(String(variables.member_id));
        let bio;
        try {
            bio = await fetchBiography(deps, memberId);
        }
        catch (e) {
            return jsonContents(uri, errorEnvelope(e, { error: formatHttpError(e), member_id: memberId }), 0);
        }
        return jsonContents(uri, { member_id: memberId, ...bio }, 2);
    });
}
