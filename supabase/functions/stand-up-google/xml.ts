export type XmlNode = {
  name: string;
  attributes: Record<string, string>;
  children: XmlNode[];
  text: string;
};

function decodeXml(value: string): string {
  return value.replace(
    /&(#x[0-9a-f]+|#[0-9]+|amp|lt|gt|quot|apos);/gi,
    (_, entity: string) => {
      const named: Record<string, string> = {
        amp: "&",
        lt: "<",
        gt: ">",
        quot: '"',
        apos: "'",
      };
      if (entity[0] !== "#") return named[entity.toLowerCase()];
      const hex = entity[1]?.toLowerCase() === "x";
      const codePoint = Number.parseInt(
        entity.slice(hex ? 2 : 1),
        hex ? 16 : 10,
      );
      if (
        !Number.isSafeInteger(codePoint) || codePoint < 0 ||
        codePoint > 0x10ffff
      ) {
        throw new Error("Invalid XML character reference");
      }
      return String.fromCodePoint(codePoint);
    },
  ).replace(/&[a-z][a-z0-9._-]*;/gi, () => {
    throw new Error("XML entities are not supported");
  });
}

function localName(name: string): string {
  return name.includes(":") ? name.slice(name.indexOf(":") + 1) : name;
}

export function parseXml(source: string): XmlNode {
  if (/<!DOCTYPE|<!ENTITY/i.test(source)) {
    throw new Error("XML entities are not supported");
  }
  const document: XmlNode = {
    name: "#document",
    attributes: {},
    children: [],
    text: "",
  };
  const stack = [document];
  const tokenPattern =
    /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[[\s\S]*?\]\]>|<[^>]+>|[^<]+/g;
  let consumed = 0;
  for (const match of source.matchAll(tokenPattern)) {
    if (match.index !== consumed) throw new Error("Malformed XML");
    consumed += match[0].length;
    const token = match[0];
    if (token.startsWith("<!--") || token.startsWith("<?")) continue;
    if (token.startsWith("<![CDATA[")) {
      stack.at(-1)!.text += token.slice(9, -3);
      continue;
    }
    if (!token.startsWith("<")) {
      stack.at(-1)!.text += decodeXml(token);
      continue;
    }
    if (token.startsWith("</")) {
      const name = localName(token.slice(2, -1).trim());
      if (stack.length === 1 || stack.at(-1)!.name !== name) {
        throw new Error("Malformed XML nesting");
      }
      stack.pop();
      continue;
    }
    if (token.startsWith("<!")) throw new Error("Unsupported XML declaration");
    const selfClosing = /\/\s*>$/.test(token);
    const inside = token.slice(1, selfClosing ? token.lastIndexOf("/") : -1)
      .trim();
    const nameMatch = /^([^\s/>]+)/.exec(inside);
    if (!nameMatch) throw new Error("Malformed XML element");
    const rawName = nameMatch[1];
    const attributes: Record<string, string> = {};
    const rest = inside.slice(rawName.length);
    const attributePattern = /\s+([^\s=/>]+)\s*=\s*("[^"]*"|'[^']*')/g;
    let attributeEnd = 0;
    for (const attribute of rest.matchAll(attributePattern)) {
      if (rest.slice(attributeEnd, attribute.index).trim()) {
        throw new Error("Malformed XML attribute");
      }
      attributeEnd = attribute.index! + attribute[0].length;
      const key = attribute[1];
      if (key in attributes) throw new Error("Duplicate XML attribute");
      attributes[key] = decodeXml(attribute[2].slice(1, -1));
    }
    if (rest.slice(attributeEnd).trim()) {
      throw new Error("Malformed XML attribute");
    }
    const node: XmlNode = {
      name: localName(rawName),
      attributes,
      children: [],
      text: "",
    };
    stack.at(-1)!.children.push(node);
    if (!selfClosing) stack.push(node);
  }
  if (
    consumed !== source.length || stack.length !== 1 ||
    document.children.length !== 1
  ) {
    throw new Error("Malformed XML document");
  }
  return document.children[0];
}

export function descendants(node: XmlNode, name: string): XmlNode[] {
  const result: XmlNode[] = [];
  for (const child of node.children) {
    if (child.name === name) result.push(child);
    result.push(...descendants(child, name));
  }
  return result;
}

export function child(node: XmlNode, name: string): XmlNode | undefined {
  return node.children.find((candidate) => candidate.name === name);
}

export function nodeText(node: XmlNode | undefined): string {
  if (!node) return "";
  return node.text + node.children.map(nodeText).join("");
}
