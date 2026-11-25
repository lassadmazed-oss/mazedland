import { describe, expect, it } from "vitest";
import { DOM_GUARD_SCRIPT } from "./domGuard";

/** A tiny stand-in for the DOM: parents, children, and the two calls the guard wraps. */
function fakeDom() {
  class FakeNode {
    parentNode: FakeNode | null = null;
    children: FakeNode[] = [];
    constructor(public name: string) {}
    removeChild(c: FakeNode) {
      const i = this.children.indexOf(c);
      if (i < 0) throw new Error("NotFoundError: removeChild — not a child of this node");
      this.children.splice(i, 1);
      c.parentNode = null;
      return c;
    }
    insertBefore(n: FakeNode, r: FakeNode | null) {
      if (r && r.parentNode !== this) throw new Error("NotFoundError: insertBefore — not a child of this node");
      n.parentNode?.removeChild(n);
      const i = r ? this.children.indexOf(r) : this.children.length;
      this.children.splice(i, 0, n);
      n.parentNode = this;
      return n;
    }
    append(c: FakeNode) {
      return this.insertBefore(c, null);
    }
  }
  return FakeNode;
}

function guarded() {
  const Node = fakeDom();
  new Function("Node", DOM_GUARD_SCRIPT)(Node);
  return Node;
}

describe("the DOM guard against translated pages (2026-11-25)", () => {
  it("without it, a moved node throws — what the visitor's phone hit", () => {
    const Node = fakeDom();
    const p = new Node("p"), font = new Node("font"), text = new Node("text");
    p.append(text);
    // The translation replaces the text with its own element.
    p.removeChild(text);
    p.append(font);
    expect(() => p.insertBefore(new Node("b"), text)).toThrow(/insertBefore/);
    expect(() => p.removeChild(text)).toThrow(/removeChild/);
  });

  it("with it, inserting before a moved node adds at the end instead of throwing", () => {
    const Node = guarded();
    const p = new Node("p"), font = new Node("font"), text = new Node("text"), b = new Node("b");
    p.append(text);
    p.removeChild(text);
    p.append(font);
    expect(() => p.insertBefore(b, text)).not.toThrow();
    expect(p.children.map((c) => c.name)).toEqual(["font", "b"]);
  });

  it("with it, removing a node that moved removes it where it is, or leaves it alone if gone", () => {
    const Node = guarded();
    const p = new Node("p"), font = new Node("font"), text = new Node("text"), gone = new Node("gone");
    p.append(font);
    font.append(text); // moved under the translation's wrapper
    expect(() => p.removeChild(text)).not.toThrow();
    expect(font.children).toEqual([]);
    expect(p.removeChild(gone)).toBe(gone); // detached already: nothing to do
  });

  it("leaves the normal calls untouched, and installs once", () => {
    const Node = guarded();
    const p = new Node("p"), a = new Node("a"), b = new Node("b");
    p.append(a);
    p.insertBefore(b, a);
    expect(p.children.map((c) => c.name)).toEqual(["b", "a"]);
    p.removeChild(a);
    expect(p.children.map((c) => c.name)).toEqual(["b"]);
    const wrapped = (Node.prototype as unknown as { insertBefore: unknown }).insertBefore;
    new Function("Node", DOM_GUARD_SCRIPT)(Node);
    expect((Node.prototype as unknown as { insertBefore: unknown }).insertBefore).toBe(wrapped);
  });
});
