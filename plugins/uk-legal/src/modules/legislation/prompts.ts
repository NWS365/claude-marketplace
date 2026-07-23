/**
 * Prompt definitions for the legislation module.
 *
 * Arguments arrive from the wire as strings, so year and number are coerced to
 * numbers here. Each prompt is registered under a module-prefixed name on the
 * flat server.
 */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Deps } from "../../shared/deps.js";

export function registerPrompts(server: McpServer, _deps: Deps): void {
  server.registerPrompt(
    "legislation_summarise_act",
    {
      title: "Summarise a UK Act or Statutory Instrument",
      description:
        "Generate a structured overview of a single UK Act or Statutory " +
        "Instrument: what it is for, the terms it defines, what it enacts, where " +
        "it applies, and whether it is yet in force.",
      argsSchema: {
        type: z.string(),
        year: z.string(),
        number: z.string(),
      },
    },
    (args) => {
      const type = args.type;
      const year = Number(args.year);
      const number = Number(args.number);
      const text =
        `You are acting as a UK legal analyst. Summarise ${type}/${year}/${number}.\n\n` +
        `Begin by retrieving the table of contents with legislation_get_toc ` +
        `(type='${type}', year=${year}, number=${number}) to map the structure, then use ` +
        `legislation_get_section to pull the sections that carry the substance — typically the ` +
        `interpretation/definitions section, the principal operative provisions, and anything ` +
        `dealing with enforcement.\n\n` +
        `Frame the summary around five questions:\n` +
        `  • What is the legislation for — the mischief it addresses and how far it reaches?\n` +
        `  • Which defined terms govern how it is to be read?\n` +
        `  • What does it actually do — the duties, prohibitions, and powers it creates?\n` +
        `  • How far does it extend territorially?\n` +
        `  • Where does commencement stand — fully in force, partly commenced, or prospective?\n\n` +
        `Cite the section number behind every point, and single out anything marked ` +
        `prospective or not yet in force.`;
      return { messages: [{ role: "user", content: { type: "text", text } }] };
    }
  );

  server.registerPrompt(
    "legislation_compare_legislation",
    {
      title: "Compare two pieces of UK legislation",
      description:
        "Place two pieces of UK legislation side by side on one topic — for " +
        "example an original Act against the SI that amends it, or equivalent " +
        "provisions in different jurisdictions such as England and Scotland.",
      argsSchema: {
        type1: z.string(),
        year1: z.string(),
        number1: z.string(),
        type2: z.string(),
        year2: z.string(),
        number2: z.string(),
        topic: z.string(),
      },
    },
    (args) => {
      const type1 = args.type1;
      const year1 = Number(args.year1);
      const number1 = Number(args.number1);
      const type2 = args.type2;
      const year2 = Number(args.year2);
      const number2 = Number(args.number2);
      const topic = args.topic;
      const text =
        `Set ${type1}/${year1}/${number1} against ${type2}/${year2}/${number2} ` +
        `on the topic of '${topic}'.\n\n` +
        `For each instrument in turn, call legislation_get_toc to locate the sections that bear ` +
        `on '${topic}', then legislation_get_section to read them.\n\n` +
        `Present the result as a side-by-side analysis that draws out where the two align; where ` +
        `they genuinely differ (in definitions, thresholds, scope, or enforcement); any divergence ` +
        `in territorial extent; which regime is the more stringent and on what points; and what ` +
        `the differences mean in practice for compliance.`;
      return { messages: [{ role: "user", content: { type: "text", text } }] };
    }
  );
}
