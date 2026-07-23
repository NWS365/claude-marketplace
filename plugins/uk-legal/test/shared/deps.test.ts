import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock impit so legislationGet delegation does not touch the network.
const impit = vi.hoisted(() => ({ responses: [] as any[] }));
vi.mock("impit", () => ({
  Impit: class {
    constructor(public opts: any) {}
    async fetch() {
      const r = impit.responses.shift();
      if (!r) throw new Error("no impit response");
      return r;
    }
  },
}));

const { createDeps } = await import("../../src/shared/deps.js");

function xmlResp(text: string) {
  return {
    status: 200,
    ok: true,
    url: "https://leg.test/x",
    headers: { get: () => "application/xml" },
    text: async () => text,
  };
}
function jsonResp(text: string) {
  return {
    status: 200,
    ok: true,
    url: "https://api.test/x",
    headers: { get: () => "application/json" },
    text: async () => text,
  };
}

/** Fake McpServer exposing just the `.server` sampling surface createDeps uses. */
function fakeServer(inner: any = {}) {
  return { server: inner } as any;
}

beforeEach(() => {
  impit.responses = [];
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("createDeps delegation", () => {
  it("jsonGet / xmlGet / head delegate to the native HTTP client", async () => {
    const fetchMock = vi.fn(async () => jsonResp("{}"));
    vi.stubGlobal("fetch", fetchMock);
    const deps = createDeps(fakeServer());
    expect((await deps.jsonGet("https://api.test/x")).text).toBe("{}");
    expect((await deps.xmlGet("https://api.test/x")).ok).toBe(true);
    expect(await deps.head("https://api.test/x")).toEqual({ status: 200, ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("legislationGet / legislationGetHtml delegate to the impit client", async () => {
    impit.responses.push(xmlResp("<L/>"), {
      status: 200,
      ok: true,
      url: "https://leg.test/x",
      headers: { get: () => "text/html" },
      text: async () => "<html>ok</html>",
    });
    const deps = createDeps(fakeServer());
    expect((await deps.legislationGet("https://leg.test/x")).text).toBe("<L/>");
    expect((await deps.legislationGetHtml("https://leg.test/x")).text).toContain("ok");
  });

  it("log writes to stderr", () => {
    const err = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    createDeps(fakeServer()).log({ evt: "hi" });
    expect(err).toHaveBeenCalled();
  });

  it("exposes the shared cache instance", () => {
    const deps = createDeps(fakeServer());
    deps.cache.set("k", "v", 10_000);
    expect(deps.cache.get("k")).toBe("v");
  });
});

describe("createDeps.sample", () => {
  it("returns null when the client has no capabilities", async () => {
    const deps = createDeps(fakeServer({ getClientCapabilities: () => undefined }));
    expect(await deps.sample("prompt")).toBeNull();
  });

  it("returns null when the client lacks the sampling capability", async () => {
    const deps = createDeps(fakeServer({ getClientCapabilities: () => ({ roots: {} }) }));
    expect(await deps.sample("prompt")).toBeNull();
  });

  it("returns null when getClientCapabilities is absent entirely", async () => {
    const deps = createDeps(fakeServer({}));
    expect(await deps.sample("prompt")).toBeNull();
  });

  it("returns trimmed text when sampling yields a text content block", async () => {
    const createMessage = vi.fn(async () => ({ content: { type: "text", text: "  KB  " } }));
    const deps = createDeps(fakeServer({ getClientCapabilities: () => ({ sampling: {} }), createMessage }));
    expect(await deps.sample("prompt", 32)).toBe("KB");
    expect(createMessage.mock.calls[0]![0].maxTokens).toBe(32);
  });

  it("returns null when the content block is not text", async () => {
    const createMessage = vi.fn(async () => ({ content: { type: "image", data: "..." } }));
    const deps = createDeps(fakeServer({ getClientCapabilities: () => ({ sampling: {} }), createMessage }));
    expect(await deps.sample("prompt")).toBeNull();
  });

  it("returns null when content is missing", async () => {
    const createMessage = vi.fn(async () => ({}));
    const deps = createDeps(fakeServer({ getClientCapabilities: () => ({ sampling: {} }), createMessage }));
    expect(await deps.sample("prompt")).toBeNull();
  });

  it("fails soft (null) when createMessage throws", async () => {
    const createMessage = vi.fn(async () => {
      throw new Error("no sampling");
    });
    const deps = createDeps(fakeServer({ getClientCapabilities: () => ({ sampling: {} }), createMessage }));
    expect(await deps.sample("prompt")).toBeNull();
  });
});
