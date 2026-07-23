/**
 * Prompt templates for the legislation module.
 *
 * Arguments come in from the wire as strings, so year and number are converted
 * to numbers here. Each prompt is registered under a module-prefixed name on
 * the flat server.
 */
import { z } from "zod";
export function registerPrompts(server, _deps) {
    server.registerPrompt("legislation_summarise_act", {
        title: "Summarise a UK Act or Statutory Instrument",
        description: "Write a summary of a UK Act of Parliament or Statutory Instrument.\n\n" +
            "Yields a structured legal overview that walks through the purpose, the " +
            "main definitions, the operative provisions, the territorial extent, and " +
            "the commencement position.",
        argsSchema: {
            type: z.string(),
            year: z.string(),
            number: z.string(),
        },
    }, (args) => {
        const type = args.type;
        const year = Number(args.year);
        const number = Number(args.number);
        const text = `Act as a UK legal analyst and summarise ${type}/${year}/${number}.\n\n` +
            `Step 1: Fetch the table of contents by calling legislation_get_toc with ` +
            `type='${type}', year=${year}, number=${number}, and use it to get a feel for the structure.\n\n` +
            `Step 2: Pull the sections that carry the most weight with legislation_get_section — ` +
            `usually the definitions, the core operative provisions, and whatever governs enforcement.\n\n` +
            `Step 3: Write up a structured summary that addresses:\n` +
            `  (1) Purpose and scope — what is this legislation trying to fix?\n` +
            `  (2) Key definitions — the defined terms that shape how it is read\n` +
            `  (3) Main operative provisions — what it mandates, forbids, or allows\n` +
            `  (4) Territorial extent — the jurisdictions it reaches\n` +
            `  (5) Commencement status — wholly in force, partly commenced, or still prospective?\n\n` +
            `Back up every point with the relevant section number, ` +
            `and call out anything tagged 'prospective' or not yet in force.`;
        return { messages: [{ role: "user", content: { type: "text", text } }] };
    });
    server.registerPrompt("legislation_compare_legislation", {
        title: "Compare two pieces of UK legislation",
        description: "Set two pieces of UK legislation side by side on a chosen topic.\n\n" +
            "Handy for weighing an original Act against an amending SI, or for lining up " +
            "parallel provisions in different jurisdictions such as England and Scotland.",
        argsSchema: {
            type1: z.string(),
            year1: z.string(),
            number1: z.string(),
            type2: z.string(),
            year2: z.string(),
            number2: z.string(),
            topic: z.string(),
        },
    }, (args) => {
        const type1 = args.type1;
        const year1 = Number(args.year1);
        const number1 = Number(args.number1);
        const type2 = args.type2;
        const year2 = Number(args.year2);
        const number2 = Number(args.number2);
        const topic = args.topic;
        const text = `Compare ${type1}/${year1}/${number1} with ${type2}/${year2}/${number2}, ` +
            `focusing specifically on '${topic}'.\n\n` +
            `Work through each piece of legislation:\n` +
            `  1. Call legislation_get_toc to spot the sections that matter\n` +
            `  2. Call legislation_get_section to pull those sections\n\n` +
            `Then lay out a side-by-side analysis covering:\n` +
            `  - Where the two take a similar approach\n` +
            `  - Where they diverge in a meaningful way (definitions, thresholds, scope, enforcement)\n` +
            `  - Any difference in territorial extent\n` +
            `  - Which regime is stricter, and on which points\n` +
            `  - What this means in practice for compliance`;
        return { messages: [{ role: "user", content: { type: "text", text } }] };
    });
}
