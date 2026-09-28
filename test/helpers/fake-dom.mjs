/**
 * A deliberately tiny DOM stand-in: just enough surface for the renderer
 * (elements, attributes, inline style properties, child ordering).
 */
class FakeStyle {
  #props = new Map();
  setProperty(name, value) {
    this.#props.set(name, String(value));
  }
  removeProperty(name) {
    this.#props.delete(name);
  }
  getPropertyValue(name) {
    return this.#props.get(name) ?? "";
  }
  get cssText() {
    return [...this.#props].map(([k, v]) => `${k}: ${v}`).join("; ");
  }
  set cssText(text) {
    this.#props.clear();
    for (const decl of text.split(";")) {
      const [k, ...v] = decl.split(":");
      if (k.trim()) this.#props.set(k.trim(), v.join(":").trim());
    }
  }
  toObject() {
    return Object.fromEntries(this.#props);
  }
}

export class FakeElement {
  nodeType = 1;
  parentNode = null;
  childNodes = [];
  attributes = new Map();
  style = new FakeStyle();
  #text = "";
  listeners = new Map();

  constructor(tagName, ownerDocument) {
    this.tagName = tagName.toUpperCase();
    this.localName = tagName.toLowerCase();
    this.ownerDocument = ownerDocument;
  }
  get firstChild() {
    return this.childNodes[0] ?? null;
  }
  get nextSibling() {
    if (!this.parentNode) return null;
    const siblings = this.parentNode.childNodes;
    return siblings[siblings.indexOf(this) + 1] ?? null;
  }
  get children() {
    return this.childNodes.filter((node) => node.nodeType === 1);
  }
  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }
  getAttribute(name) {
    return this.attributes.has(name) ? this.attributes.get(name) : null;
  }
  hasAttribute(name) {
    return this.attributes.has(name);
  }
  removeAttribute(name) {
    this.attributes.delete(name);
  }
  #detach(node) {
    if (node.parentNode) node.parentNode.childNodes.splice(node.parentNode.childNodes.indexOf(node), 1);
    node.parentNode = null;
  }
  insertBefore(node, reference) {
    if (reference && reference.parentNode !== this) {
      throw new Error("NotFoundError: reference node is not a child of this node");
    }
    this.#detach(node);
    const index = reference ? this.childNodes.indexOf(reference) : -1;
    if (index === -1) this.childNodes.push(node);
    else this.childNodes.splice(index, 0, node);
    node.parentNode = this;
    return node;
  }
  appendChild(node) {
    return this.insertBefore(node, null);
  }
  append(...nodes) {
    nodes.forEach((node) => this.appendChild(node));
  }
  removeChild(node) {
    this.#detach(node);
    return node;
  }
  remove() {
    if (this.parentNode) this.#detach(this);
  }
  get textContent() {
    return this.#text + this.childNodes.map((node) => node.textContent).join("");
  }
  set textContent(value) {
    this.childNodes.forEach((node) => (node.parentNode = null));
    this.childNodes = [];
    this.#text = String(value);
  }
  getBoundingClientRect() {
    return { left: 0, top: 0, width: 100, height: 100, right: 100, bottom: 100 };
  }
  addEventListener(type, fn) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(fn);
  }
  removeEventListener(type, fn) {
    this.listeners.get(type)?.delete(fn);
  }
  dispatch(type, event) {
    for (const fn of this.listeners.get(type) ?? []) fn(event);
  }
  closest(selector) {
    const test = compileSelector(selector);
    let node = this;
    while (node) {
      if (node.nodeType === 1 && test(node)) return node;
      node = node.parentNode;
    }
    return null;
  }
  querySelectorAll(selector) {
    const test = compileSelector(selector);
    const out = [];
    const visit = (node) => {
      for (const child of node.children) {
        if (test(child)) out.push(child);
        visit(child);
      }
    };
    visit(this);
    return out;
  }
  querySelector(selector) {
    return this.querySelectorAll(selector)[0] ?? null;
  }
}

/** Supports `tag`, `[attr]`, `[attr="v"]`, and `tag[attr]...` compound selectors, comma-separated. */
function compileSelector(selector) {
  const alternatives = selector.split(",").map((part) => {
    const match = part.trim().match(/^([a-zA-Z-]*)((?:\[[^\]]+\])*)$/);
    if (!match) throw new Error(`fake-dom: unsupported selector ${part}`);
    const tag = match[1].toLowerCase();
    const attrs = [...match[2].matchAll(/\[([^\]=^]+)(\^?=)?"?([^\]"]*)"?\]/g)].map(([, name, op, value]) => ({
      name,
      op,
      value,
    }));
    return (element) =>
      (!tag || element.localName === tag) &&
      attrs.every(({ name, op, value }) => {
        if (!element.hasAttribute(name)) return false;
        if (op === "=") return element.getAttribute(name) === value;
        if (op === "^=") return element.getAttribute(name).startsWith(value);
        return true;
      });
  });
  return (element) => alternatives.some((test) => test(element));
}

export const createFakeDocument = () => {
  const doc = {
    defaultView: { CSS: { supports: () => true } },
    createElement: (tag) => new FakeElement(tag, doc),
  };
  doc.body = new FakeElement("body", doc);
  return doc;
};
