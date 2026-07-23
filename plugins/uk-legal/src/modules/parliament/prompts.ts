/**
 * Prompt templates for the parliament module.
 *
 * Wire names carry the parliament_ prefix: parliament_policy_reception_review
 * and parliament_member_record_on_topic. Each yields a single user message,
 * assembled by `+` string concatenation with {x!r}-style slots produced
 * through pyRepr.
 */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { pyRepr } from "./parsers.js";

export function registerParliamentPrompts(server: McpServer): void {
  server.registerPrompt(
    "parliament_policy_reception_review",
    {
      title: "policy_reception_review",
      description: `Examine how Parliament is responding to a policy topic, backed by citable evidence.

Coordinates the deterministic parliament_* tools and the hansard://
resources. It will NOT tag named members as 'supporters' or 'opponents' off
the back of brief snippets; instead it directs the model to quote and cite
them directly.`,
      argsSchema: {
        policy_description: z.string(),
        topic: z.string(),
      },
    },
    (args) => {
      const { policy_description, topic } = args;
      const t = pyRepr(topic);
      const text =
        "You are supporting a legal and policy team. Here is the policy under consideration:\n\n" +
        `${policy_description}\n\n` +
        `The Hansard search topic is: ${t}.\n\n` +
        `Step 1 — get the scope. Run parliament_policy_position_summary(topic=${t}) ` +
        "to survey the terrain: the number of contributions, the party, house, " +
        "and section breakdowns, the leading debates, and the leading " +
        "contributors. Treat these tallies as signals rather than stated " +
        "positions.\n\n" +
        `Step 2 — gather evidence. Run parliament_search_hansard(query=${t}, ` +
        "text_mode='full', limit=20). For every contribution, note the " +
        "attributed_to, date, column_ref, debate_ext_id, and contribution_ext_id.\n\n" +
        "Step 3 — go deeper. Take the top one to three debates from step 1's " +
        "top_debates and call read_resource(uri='hansard://debate/{debate_ext_id}/header') " +
        "for the ordered index of contributions; then, wherever you need text " +
        "beyond the search result's cap, read individual contributions with " +
        "read_resource(uri='hansard://debate/{debate_ext_id}/contribution/{contribution_ext_id}').\n\n" +
        "Step 4 — bring it together. Write a review that addresses:\n" +
        "  (a) The breadth of parliamentary attention (totals and the recent spread of dates)\n" +
        "  (b) Engagement across parties (the party breakdown from step 1)\n" +
        "  (c) The balance of ministerial against backbench voices (read the attributed_to prefixes)\n" +
        "  (d) Direct quotations from the most pertinent contributions, each " +
        "      footnoted with attributed_to, date, and column_ref\n" +
        "  (e) Unresolved questions raised during debate\n\n" +
        "IMPORTANT — never label a named member as 'supporting' or 'opposing' " +
        "the policy from search snippets on their own. A brief snippet of a " +
        "debate contribution cannot establish where a member stands; clarifying " +
        "questions, ministerial wind-ups, and deliberately provocative framings " +
        "all resemble positions without being them. When you do describe a " +
        "member's position, quote their exact words from the full contribution " +
        "text and give the column reference.";
      return { messages: [{ role: "user", content: { type: "text", text } }] };
    }
  );

  server.registerPrompt(
    "parliament_member_record_on_topic",
    {
      title: "member_record_on_topic",
      description: `Compile a citable record of one parliamentarian's contributions on a topic.

It surfaces their own words in their own context, with citation metadata.
It stops short of classifying their stance — that reading is left to the
caller.`,
      argsSchema: {
        member_name: z.string(),
        topic: z.string(),
      },
    },
    (args) => {
      const { member_name, topic } = args;
      const t = pyRepr(topic);
      const mn = pyRepr(member_name);
      const text =
        `Put together ${member_name}'s parliamentary record on '${topic}'. ` +
        "The aim is a citable evidence pack of their own contributions, not a " +
        "label for their position.\n\n" +
        `Step 1 — pin them down. Call parliament_find_member with name=${mn} ` +
        "to obtain their integer member ID and their house.\n" +
        "Step 2 — collect contributions. Call parliament_member_debates with that ID " +
        `and topic=${t}. For each one, record the attributed_to, date, debate_title, ` +
        "column_ref, contribution_ext_id, and the full text.\n" +
        "Step 3 — trace their roles. Call read_resource(uri='hansard://member/{member_id}/biography') " +
        "to list government, opposition, and committee posts with their start and " +
        "end dates. That lets you state which role they held when they made any " +
        "given contribution.\n\n" +
        "Deliver:\n" +
        "  • Verbatim quotations from their contributions, each footnoted with " +
        "    attributed_to, date, and column_ref.\n" +
        "  • The role they held at the time of each contribution (from the biography dates).\n" +
        "  • A list in chronological order rather than a synthesis — leave the " +
        "interpretation to the caller.\n\n" +
        "Do NOT assign their overall stance a label such as 'support / oppose / " +
        "nuanced'. That judgement turns on how the caller frames the topic and is " +
        "not this tool's to make. Quote and cite; do not characterise.";
      return { messages: [{ role: "user", content: { type: "text", text } }] };
    }
  );
}
