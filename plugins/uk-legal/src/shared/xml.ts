/**
 * Safe, namespace-aware XML parsing. Uses @xmldom/xmldom (DOM) + xpath to give
 * us namespace-URI matching, parentNode walk-up, document-order iteration,
 * mixed-content textContent, and subtree serialisation.
 *
 * Security (defense in depth):
 *  1. byte/string-level rejection of DOCTYPE/ENTITY/NOTATION/ELEMENT/ATTLIST.
 *  2. xmldom does not expand external entities or fetch external DTDs.
 */
import { DOMParser, XMLSerializer } from "@xmldom/xmldom";
import * as xpath from "xpath";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type XmlNode = any;

const DTD_RE = /<!\s*(DOCTYPE|ENTITY|NOTATION|ELEMENT|ATTLIST)\b/i;

function toText(input: string | Uint8Array | Buffer): string {
  if (typeof input === "string") return input;
  return Buffer.from(input).toString("utf-8");
}

/** Parse external XML with XXE / entity-bomb / external-DTD protection. */
export function parseXml(input: string | Uint8Array | Buffer): XmlNode {
  const text = toText(input);
  if (DTD_RE.test(text)) {
    throw new Error(
      "XML payload contains DTD/ENTITY declaration — rejected for safety. " +
        "Legitimate CLML/Atom/LegalDocML payloads do not use DTDs."
    );
  }
  const errors: string[] = [];
  const doc = new DOMParser({
    onError: (level: string, msg: string) => {
      if (level === "error" || level === "fatalError") errors.push(msg);
    },
  }).parseFromString(text, "text/xml");
  if (errors.length) throw new Error(`XML parse error: ${errors[0]}`);
  return doc;
}

/** Best-effort HTML parse (legislation HTML fallback path only). */
export function parseHtml(input: string | Uint8Array | Buffer): XmlNode {
  return new DOMParser({ onError: () => {} }).parseFromString(toText(input), "text/html");
}

/** Build a namespace-bound selector. `ns` maps prefix -> namespace URI. */
export function nsSelector(ns: Record<string, string>) {
  const select = xpath.useNamespaces(ns);
  return {
    nodes(expr: string, node: XmlNode): XmlNode[] {
      const r = select(expr, node);
      return Array.isArray(r) ? r : r ? [r] : [];
    },
    first(expr: string, node: XmlNode): XmlNode | null {
      const r = select(expr, node, true);
      return (r as XmlNode) ?? null;
    },
    text(expr: string, node: XmlNode): string {
      const n = select(expr, node, true) as XmlNode | undefined;
      return n ? textOf(n) : "";
    },
  };
}

/** Non-namespaced select (local-name matching etc.). */
export function select(expr: string, node: XmlNode): XmlNode[] {
  const r = xpath.select(expr, node);
  return Array.isArray(r) ? r : r ? [r as XmlNode] : [];
}

/** Full text content of a node, with mixed content flattened to a single string. */
export function textOf(node: XmlNode | null | undefined): string {
  if (!node) return "";
  if (typeof node.textContent === "string") return node.textContent;
  if (typeof node.nodeValue === "string") return node.nodeValue ?? "";
  return "";
}

/** Serialise a node/subtree back to an XML string. */
export function serialize(node: XmlNode): string {
  return new XMLSerializer().serializeToString(node);
}

/** Get an attribute value, or null. */
export function attr(node: XmlNode, name: string): string | null {
  return node && typeof node.getAttribute === "function" ? node.getAttribute(name) : null;
}
