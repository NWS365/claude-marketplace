import { describe, it, expect } from "vitest";
import { parseXml, parseHtml, nsSelector, select, textOf, serialize, attr } from "../../src/shared/xml.js";

const SAMPLE = `<?xml version="1.0"?>
<root xmlns:a="urn:a">
  <a:item id="1">Hello <a:b>World</a:b></a:item>
  <a:item id="2">Second</a:item>
</root>`;

describe("parseXml", () => {
  it("parses well-formed XML into a DOM document", () => {
    const doc = parseXml(SAMPLE);
    expect(doc.documentElement.nodeName).toBe("root");
  });

  it("accepts a Buffer / Uint8Array input", () => {
    const doc = parseXml(Buffer.from(SAMPLE, "utf-8"));
    expect(doc.documentElement.nodeName).toBe("root");
    const doc2 = parseXml(new Uint8Array(Buffer.from(SAMPLE, "utf-8")));
    expect(doc2.documentElement.nodeName).toBe("root");
  });

  it("rejects a DOCTYPE / ENTITY declaration (XXE defense)", () => {
    const bomb = `<!DOCTYPE foo [ <!ENTITY x "y"> ]><root/>`;
    expect(() => parseXml(bomb)).toThrow(/DTD\/ENTITY/);
  });

  it("throws on malformed XML", () => {
    // @xmldom/xmldom raises its own ParseError for fatal problems (tag mismatch,
    // duplicate attributes, unbound prefixes) before our accumulated-error wrapper
    // is reached — either way, parseXml surfaces a throw for bad input.
    expect(() => parseXml("<root><unclosed></root>")).toThrow();
    expect(() => parseXml('<root a="1" a="2">y</root>')).toThrow();
  });
});

describe("parseHtml", () => {
  it("parses HTML into a document", () => {
    const doc = parseHtml("<html><body><p>hi</p></body></html>");
    expect(doc).toBeTruthy();
    expect(textOf(doc.documentElement)).toContain("hi");
  });
});

describe("nsSelector", () => {
  const sel = nsSelector({ a: "urn:a" });
  const doc = parseXml(SAMPLE);

  it("nodes() returns all matches as an array", () => {
    expect(sel.nodes("//a:item", doc)).toHaveLength(2);
  });

  it("nodes() wraps a single-node result in an array", () => {
    const one = sel.nodes("//a:item[@id='2']", doc);
    expect(one).toHaveLength(1);
    expect(attr(one[0], "id")).toBe("2");
  });

  it("nodes() returns [] when nothing matches", () => {
    expect(sel.nodes("//a:missing", doc)).toEqual([]);
  });

  it("first() returns the first match or null", () => {
    expect(attr(sel.first("//a:item", doc), "id")).toBe("1");
    expect(sel.first("//a:none", doc)).toBeNull();
  });

  it("text() returns flattened text or empty string", () => {
    expect(sel.text("//a:item[@id='1']", doc)).toContain("World");
    expect(sel.text("//a:none", doc)).toBe("");
  });
});

describe("select (non-namespaced)", () => {
  it("matches via local-name()", () => {
    const doc = parseXml(SAMPLE);
    const items = select("//*[local-name()='item']", doc);
    expect(items).toHaveLength(2);
  });
  it("returns [] on no match", () => {
    const doc = parseXml(SAMPLE);
    expect(select("//*[local-name()='nope']", doc)).toEqual([]);
  });
});

describe("textOf / serialize / attr", () => {
  const doc = parseXml(SAMPLE);
  const sel = nsSelector({ a: "urn:a" });

  it("textOf flattens mixed content and handles null/undefined", () => {
    expect(textOf(sel.first("//a:item[@id='1']", doc))).toContain("Hello");
    expect(textOf(null)).toBe("");
    expect(textOf(undefined)).toBe("");
  });

  it("textOf falls back to nodeValue for attribute/text nodes", () => {
    const idAttr = (sel.first("//a:item", doc) as any).getAttributeNode("id");
    expect(textOf(idAttr)).toBe("1");
  });

  it("serialize round-trips a subtree to XML", () => {
    const xml = serialize(sel.first("//a:item[@id='2']", doc));
    expect(xml).toContain("Second");
    expect(xml).toContain("item");
  });

  it("attr returns the value or null, and null for nodes without getAttribute", () => {
    expect(attr(sel.first("//a:item", doc), "id")).toBe("1");
    expect(attr(sel.first("//a:item", doc), "missing")).toBeNull();
    expect(attr(null, "id")).toBeNull();
    expect(attr({}, "id")).toBeNull();
  });
});
