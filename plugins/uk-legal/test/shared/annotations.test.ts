import { describe, it, expect } from "vitest";
import { READ_ONLY_OPEN, READ_ONLY_CLOSED, withTitle } from "../../src/shared/annotations.js";

describe("annotations", () => {
  it("READ_ONLY_OPEN marks a read-only open-world tool", () => {
    expect(READ_ONLY_OPEN).toEqual({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    });
  });

  it("READ_ONLY_CLOSED marks a read-only closed-world tool", () => {
    expect(READ_ONLY_CLOSED).toEqual({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    });
  });

  it("withTitle merges a title without mutating the base preset", () => {
    const out = withTitle(READ_ONLY_OPEN, "My Tool");
    expect(out).toEqual({ ...READ_ONLY_OPEN, title: "My Tool" });
    expect(READ_ONLY_OPEN).not.toHaveProperty("title");
  });
});
