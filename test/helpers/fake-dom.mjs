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
  get previousSibling() {
    if (!this.parentNode) return null;
    const siblings = this.parentNode.childNodes;
    return siblings[siblings.indexOf(this) - 1] ?? null;
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
  contains(node) {
    for (let n = node; n; n = n.parentNode) if (n === this) return true;
    return false;
  }
  /** Moves document.activeElement here and fires a bubbling-style "focusin" on every ancestor's listeners. */
  focus() {
    this.ownerDocument.activeElement = this;
    for (let n = this; n; n = n.parentNode) n.dispatch?.("focusin", { target: this });
  }
  /** Times this element left the document (a real iframe would reload each time). */
  disconnects = 0;
  get isConnected() {
    let node = this;
    while (node.parentNode) node = node.parentNode;
    return node === this.ownerDocument.body;
  }
  #detach(node) {
    if (node.isConnected) node.disconnects++;
    if (node.parentNode) node.parentNode.childNodes.splice(node.parentNode.childNodes.indexOf(node), 1);
    node.parentNode = null;
  }
  /** State-preserving move (Chrome's Element.prototype.moveBefore): both ends must be connected. */
  moveBefore(node, reference) {
    if (!node.isConnected || !this.isConnected) throw new Error("HierarchyRequestError: moveBefore needs connected nodes");
    const before = node.disconnects;
    this.insertBefore(node, reference);
    node.disconnects = before;
    return node;
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
  /** Tests may assign `rect = { left, top, width, height }`; the default is 100×100 at the origin. */
  rect = null;
  getBoundingClientRect() {
    const { left = 0, top = 0, width = 100, height = 100 } = this.rect ?? {};
    return { left, top, width, height, right: left + width, bottom: top + height, x: left, y: top };
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
  const listeners = new Map();
  const doc = {
    defaultView: { CSS: { supports: () => true }, matchMedia: () => ({ matches: false }) },
    title: "",
    createElement: (tag) => new FakeElement(tag, doc),
    /** Real `Document.adoptNode`: re-parents `node` (and its subtree) to this document. */
    adoptNode(node) {
      node.remove?.();
      node.ownerDocument = doc;
      return node;
    },
    querySelector(selector) {
      return doc.querySelectorAll(selector)[0] ?? null;
    },
    querySelectorAll(selector) {
      return [...doc.head.querySelectorAll(selector), ...doc.body.querySelectorAll(selector)];
    },
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(fn);
    },
    removeEventListener(type, fn) {
      listeners.get(type)?.delete(fn);
    },
    /** Test helper: deliver an event to document listeners. */
    dispatch(type, event) {
      for (const fn of listeners.get(type) ?? []) fn(event);
    },
    listeners,
  };
  doc.body = new FakeElement("body", doc);
  // Not part of the body's tree (isConnected treats `body` as the root) — just
  // enough to give style-only consumers (e.g. the renderer's `animate` option)
  // somewhere to set document-level CSS custom properties.
  doc.documentElement = new FakeElement("html", doc);
  doc.head = new FakeElement("head", doc);
  doc.activeElement = doc.body;
  return doc;
};

/**
 * A minimal `window.open()`-style popup: its own fake document, plus the
 * handful of `Window` members `attachPopouts` uses (`close`, `closed`,
 * `addEventListener`/`removeEventListener`, and dispatching those events for
 * the test to simulate the user closing it or focusing it).
 */
export const createFakeWindow = () => {
  const document = createFakeDocument();
  const listeners = new Map();
  const win = {
    document,
    closed: false,
    close() {
      win.closed = true;
    },
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(fn);
    },
    removeEventListener(type, fn) {
      listeners.get(type)?.delete(fn);
    },
    dispatch(type, event) {
      for (const fn of listeners.get(type) ?? []) fn(event);
    },
  };
  document.defaultView = win;
  return win;
};
