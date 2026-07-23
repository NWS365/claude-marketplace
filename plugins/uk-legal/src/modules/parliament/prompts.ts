/**
 * Prompt definitions for the parliament module.
 *
 * Wire names carry the parliament_ prefix: parliament_policy_reception_review
 * and parliament_member_record_on_topic. Each returns a single user message
 * built by string concatenation.
 */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export function registerParliamentPrompts(server: McpServer): void {
  server.registerPrompt(
    "parliament_policy_reception_review",
    {
      title: "policy_reception_review",
      description: `Assess how Parliament is engaging with a policy topic, grounded in citable evidence.

Drives the deterministic parliament_* tools and the hansard:// resources, and
deliberately avoids pinning 'supporter' or 'opponent' labels on named members
from short snippets — it has the model quote and cite them instead.`,
      argsSchema: {
        policy_description: z.string(),
        topic: z.string(),
      },
    },
    (args) => {
      const { policy_description, topic } = args;
      const text =
        "You are supporting a legal and policy team. The policy under consideration is:\n\n" +
        `${policy_description}\n\n` +
        `Search Hansard for the topic '${topic}'.\n\n` +
        `Work in three passes. First, call parliament_policy_position_summary(topic='${topic}') for ` +
        "the overall shape — how many contributions there are, the party / house / section splits, " +
        "the busiest debates, and the most frequent contributors; read these as signals of " +
        "attention, not as stated positions. Second, call " +
        `parliament_search_hansard(query='${topic}', text_mode='full', limit=20) and record, for ` +
        "every contribution, its attributed_to, date, column_ref, debate_ext_id, and " +
        "contribution_ext_id. Third, for the busiest one to three debates, read " +
        "hansard://debate/{debate_ext_id}/header for the ordered contribution index, then pull " +
        "individual contributions via " +
        "hansard://debate/{debate_ext_id}/contribution/{contribution_ext_id} wherever you need " +
        "more text than the search result returns.\n\n" +
        "Then write the review. Cover the breadth of parliamentary attention (totals and how " +
        "recently the dates cluster); engagement across the parties; the balance between " +
        "ministerial and backbench voices (from the attributed_to prefixes); direct quotations " +
        "from the contributions that matter most, each footnoted with attributed_to, date, and " +
        "column_ref; and the questions left open in debate.\n\n" +
        "One rule overrides the rest: do not cast any named member as 'supporting' or 'opposing' " +
        "the policy on the strength of a search snippet. A snippet cannot fix a member's " +
        "position — a clarifying question, a ministerial wind-up, or a deliberately provocative " +
        "framing all read like positions without being one. When you do describe where a member " +
        "stands, quote their exact words from the full contribution and give the column reference.";
      return { messages: [{ role: "user", content: { type: "text", text } }] };
    }
  );

  server.registerPrompt(
    "parliament_member_record_on_topic",
    {
      title: "member_record_on_topic",
      description: `Build a citable record of one parliamentarian's contributions on a topic.

Their own words in context, with citation metadata. It does not classify their
stance — that reading is left to the caller.`,
      argsSchema: {
        member_name: z.string(),
        topic: z.string(),
      },
    },
    (args) => {
      const { member_name, topic } = args;
      const text =
        `Assemble ${member_name}'s parliamentary record on '${topic}' — a citable pack of their ` +
        "own contributions, not a verdict on where they stand.\n\n" +
        `Start with parliament_find_member (name='${member_name}') to get their integer member ID ` +
        `and house. Then call parliament_member_debates with that ID and topic='${topic}', ` +
        "capturing for each contribution the attributed_to, date, debate_title, column_ref, " +
        "contribution_ext_id, and full text. Finally read " +
        "hansard://member/{member_id}/biography for their government, opposition, and committee " +
        "posts with start and end dates, so you can say which role they held when each " +
        "contribution was made.\n\n" +
        "Deliver a chronological list rather than a synthesis: verbatim quotations, each footnoted " +
        "with attributed_to, date, and column_ref, alongside the role held at the time. Leave the " +
        "interpretation to the caller — do not attach an overall 'support / oppose / nuanced' " +
        "label, because that reading depends on how the caller frames the topic. Quote and cite; " +
        "do not characterise.";
      return { messages: [{ role: "user", content: { type: "text", text } }] };
    }
  );
}
