import { parse, type DefaultTreeAdapterTypes } from "parse5";

const BLOCKED_TAGS = new Set(["form", "iframe", "object", "embed", "applet", "base", "link"]);
const URL_ATTRIBUTES = new Set([
  "href",
  "src",
  "action",
  "formaction",
  "poster",
  "srcdoc",
  "xlink:href",
]);
const BLOCKED_PROTOCOLS = ["javascript:", "vbscript:", "file:"];
const ALLOWED_SCRIPT_TYPES = new Set(["", "text/javascript", "application/javascript"]);
const MAX_DEPTH = 512;

export type HtmlValidation = {
  ok: boolean;
  errors: string[];
  warnings: string[];
  title: string | null;
  stats: {
    hasInlineScript: boolean;
    externalImageHosts: string[];
  };
};

export function validateHtml(html: string, maxBytes: number): HtmlValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!html.trim()) {
    return result(["HTML document is empty."], warnings, null, false, new Set());
  }

  const byteLength = Buffer.byteLength(html, "utf8");
  if (byteLength > maxBytes) {
    errors.push(`HTML document is ${byteLength} bytes; maximum is ${maxBytes} bytes.`);
  }

  let document: DefaultTreeAdapterTypes.Document;
  try {
    document = parse(html, { scriptingEnabled: false });
  } catch {
    return result(
      [...errors, "HTML document could not be parsed."],
      warnings,
      null,
      false,
      new Set(),
    );
  }

  let title: string | null = null;
  let hasInlineScript = false;
  let tooDeep = false;
  const imageHosts = new Set<string>();
  const stack: Array<{ node: DefaultTreeAdapterTypes.Node; depth: number }> = [
    { node: document, depth: 0 },
  ];

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) break;
    const { node, depth } = current;

    if (isElement(node)) {
      const tagName = node.tagName.toLowerCase();
      if (BLOCKED_TAGS.has(tagName)) errors.push(`Blocked <${tagName}> tag found.`);

      const attributes = new Map(
        node.attrs.map((attribute) => [attribute.name.toLowerCase(), attribute.value.trim()]),
      );

      if (tagName === "script") {
        hasInlineScript = true;
        if (attributes.has("src")) errors.push("External script sources are not allowed.");
        const scriptType = (attributes.get("type") ?? "").toLowerCase();
        if (!ALLOWED_SCRIPT_TYPES.has(scriptType)) {
          errors.push(`Unsupported script type "${scriptType}" found.`);
        }
      }

      for (const [name, value] of attributes) {
        if (name.startsWith("on")) {
          errors.push(`Blocked inline event handler attribute "${name}" found.`);
        }
        if (name === "srcdoc") errors.push('Blocked "srcdoc" attribute found.');
        if (URL_ATTRIBUTES.has(name)) {
          const normalized = Array.from(value)
            .filter((character) => character.codePointAt(0)! > 0x20)
            .join("")
            .toLowerCase();
          if (BLOCKED_PROTOCOLS.some((protocol) => normalized.startsWith(protocol))) {
            errors.push(`Blocked unsafe URL in "${name}" attribute.`);
          }
        }
        if (
          name === "style" &&
          /expression\s*\(|behavior\s*:|url\s*\(\s*javascript:/i.test(value)
        ) {
          errors.push("Blocked unsafe inline CSS.");
        }
      }

      if (tagName === "meta" && attributes.get("http-equiv")?.toLowerCase() === "refresh") {
        errors.push("Blocked meta refresh tag found.");
      }
      if (tagName === "img") {
        const host = externalHost(attributes.get("src"));
        if (host) imageHosts.add(host);
      }
      if (tagName === "title" && title === null) {
        title = collectText(node).trim().slice(0, 140) || null;
      }
    }

    if (!hasChildren(node)) continue;
    if (depth >= MAX_DEPTH) {
      tooDeep = true;
      continue;
    }
    for (let index = node.childNodes.length - 1; index >= 0; index -= 1) {
      const child = node.childNodes[index];
      if (child) stack.push({ node: child, depth: depth + 1 });
    }
  }

  if (tooDeep) errors.push(`HTML is nested more than ${MAX_DEPTH} levels deep.`);
  if (!title) warnings.push("No <title> found; pp will use the filename.");
  return result(errors, warnings, title, hasInlineScript, imageHosts);
}

function result(
  errors: string[],
  warnings: string[],
  title: string | null,
  hasInlineScript: boolean,
  imageHosts: Set<string>,
): HtmlValidation {
  return {
    ok: errors.length === 0,
    errors: [...new Set(errors)],
    warnings: [...new Set(warnings)],
    title,
    stats: { hasInlineScript, externalImageHosts: [...imageHosts].sort() },
  };
}

function isElement(node: DefaultTreeAdapterTypes.Node): node is DefaultTreeAdapterTypes.Element {
  return "tagName" in node;
}

function hasChildren(
  node: DefaultTreeAdapterTypes.Node,
): node is DefaultTreeAdapterTypes.ParentNode {
  return "childNodes" in node;
}

function collectText(node: DefaultTreeAdapterTypes.Node): string {
  if ("value" in node && typeof node.value === "string") return node.value;
  if (!hasChildren(node)) return "";
  return node.childNodes.map(collectText).join("");
}

function externalHost(value: string | undefined): string | null {
  const raw = value?.trim();
  if (!raw) return null;
  try {
    const url = new URL(raw.startsWith("//") ? `https:${raw}` : raw);
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.hostname.toLowerCase()
      : null;
  } catch {
    return null;
  }
}
