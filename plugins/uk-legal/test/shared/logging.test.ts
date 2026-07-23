import { describe, it, expect, vi, afterEach } from "vitest";
import { stderrLog, logToolCall } from "../../src/shared/logging.js";

afterEach(() => vi.restoreAllMocks());

describe("stderrLog", () => {
  it("writes a JSON line to stderr (never stdout)", () => {
    const err = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    const out = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    stderrLog({ evt: "test", a: 1 });
    expect(err).toHaveBeenCalledTimes(1);
    expect(out).not.toHaveBeenCalled();
    const line = err.mock.calls[0]![0] as string;
    expect(line.endsWith("\n")).toBe(true);
    expect(JSON.parse(line.trim())).toEqual({ evt: "test", a: 1 });
  });

  it("never throws even if the underlying write fails", () => {
    vi.spyOn(process.stderr, "write").mockImplementation(() => {
      throw new Error("pipe closed");
    });
    expect(() => stderrLog({ evt: "boom" })).not.toThrow();
  });
});

describe("logToolCall", () => {
  it("emits a tool_call event with rounded duration and extras", () => {
    const err = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    logToolCall("case_law_search", "ok", 12.7, { hits: 3 });
    const event = JSON.parse((err.mock.calls[0]![0] as string).trim());
    expect(event).toEqual({ evt: "tool_call", tool: "case_law_search", status: "ok", duration_ms: 13, hits: 3 });
  });

  it("works without the optional extras", () => {
    const err = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    logToolCall("t", "empty", 4.2);
    const event = JSON.parse((err.mock.calls[0]![0] as string).trim());
    expect(event).toEqual({ evt: "tool_call", tool: "t", status: "empty", duration_ms: 4 });
  });
});
