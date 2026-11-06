// Loading-progress acceptance suite (issue #226 contract): stub-DOM
// tests with no browser, no WebGL, no WASM. Covers the progress bar
// 0-100 paint, the named-error reveal, the no-document no-throw guards,
// the manifest warm fractions with a stubbed fetch (monotonic, and a
// 404 resolves instead of rejecting), the stock-manifest acceptance,
// and the hygiene rule (loading.ts carries no engine imports).
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ASSET_MANIFEST,
  fetchAssetManifest,
  validateAssets,
} from "../src/render/loaders";
import {
  failLoading,
  hideLoading,
  renderLoading,
  setLoadingProgress,
} from "../src/ui/loading";

type StubNode = {
  tagName: string;
  id: string;
  textContent: string | null;
  disabled: boolean;
  hidden: boolean;
  style: Record<string, string>;
  value: string;
  checked: boolean;
  type: string;
  children: StubNode[];
  appendChild: (child: StubNode) => StubNode;
  replaceChildren: (...nodes: StubNode[]) => void;
  addEventListener: (type: string, listener: (e?: unknown) => void) => void;
  removeAttribute: (key: string) => void;
  click: () => void;
  dispatchEvent: (event: { type: string }) => boolean;
};

function makeNode(tag: string): StubNode {
  const listeners = new Map<string, Array<(e?: unknown) => void>>();
  const node: StubNode = {
    tagName: tag.toUpperCase(),
    id: "",
    textContent: "",
    disabled: false,
    hidden: false,
    style: {},
    value: "",
    checked: false,
    type: "",
    children: [],
    appendChild: (child: StubNode): StubNode => {
      node.children.push(child);
      return child;
    },
    replaceChildren: (...nodes: StubNode[]): void => {
      node.children.length = 0;
      for (const next of nodes) {
        node.children.push(next);
      }
    },
    addEventListener: (type: string, listener: (e?: unknown) => void): void => {
      const list = listeners.get(type) ?? [];
      list.push(listener);
      listeners.set(type, list);
    },
    removeAttribute: (key: string): void => {
      if (key === "hidden") {
        node.hidden = false;
      }
    },
    click: (): void => {
      for (const listener of [...(listeners.get("click") ?? [])]) {
        listener({ type: "click", target: node });
      }
    },
    dispatchEvent: (event: { type: string }): boolean => {
      for (const listener of [...(listeners.get(event.type) ?? [])]) {
        listener({ type: event.type, target: node });
      }
      return true;
    },
  };
  return node;
}

type StubDoc = {
  body: StubNode;
  createElement: (tag: string) => StubNode;
  getElementById: (id: string) => StubNode | null;
};

function findById(root: StubNode, id: string): StubNode | null {
  if (root.id === id) {
    return root;
  }
  for (const child of root.children) {
    const hit = findById(child, id);
    if (hit !== null) {
      return hit;
    }
  }
  return null;
}

function makeDoc(): StubDoc {
  const doc: StubDoc = {
    body: makeNode("body"),
    createElement: (tag: string): StubNode => makeNode(tag),
    getElementById: (id: string): StubNode | null => findById(doc.body, id),
  };
  return doc;
}

// Mount a static-shell equivalent (the index.html shape) under the body.
function mountShell(doc: StubDoc): void {
  const shell = doc.createElement("section");
  shell.id = "screen-loading";
  const bar = doc.createElement("div");
  bar.id = "loading-bar";
  bar.style.width = "0%";
  const status = doc.createElement("div");
  status.id = "loading-status";
  status.textContent = "Starting…";
  const error = doc.createElement("div");
  error.id = "loading-error";
  error.hidden = true;
  shell.appendChild(bar);
  shell.appendChild(status);
  shell.appendChild(error);
  doc.body.appendChild(shell);
}

beforeEach(() => {
  (globalThis as unknown as { document?: unknown }).document = makeDoc();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function doc(): StubDoc {
  return (globalThis as unknown as { document: StubDoc }).document;
}

describe("loading bar", () => {
  it("paints 0 to 100 as the inline bar width", () => {
    mountShell(doc());
    setLoadingProgress(0);
    expect(doc().getElementById("loading-bar")?.style.width).toBe("0%");
    setLoadingProgress(50, "Physics ready");
    expect(doc().getElementById("loading-bar")?.style.width).toBe("50%");
    expect(doc().getElementById("loading-status")?.textContent).toBe(
      "Physics ready",
    );
    setLoadingProgress(100, "Ready");
    expect(doc().getElementById("loading-bar")?.style.width).toBe("100%");
  });

  it("clamps out-of-range input into 0-100", () => {
    mountShell(doc());
    setLoadingProgress(-25);
    expect(doc().getElementById("loading-bar")?.style.width).toBe("0%");
    setLoadingProgress(250);
    expect(doc().getElementById("loading-bar")?.style.width).toBe("100%");
  });
});

describe("loading error", () => {
  it("unhides #loading-error with the named message", () => {
    mountShell(doc());
    failLoading("Rapier initialization failed", new Error("out of memory"));
    const error = doc().getElementById("loading-error");
    expect(error?.hidden).toBe(false);
    expect(error?.textContent ?? "").toContain(
      "Rapier initialization failed",
    );
    expect(error?.textContent ?? "").toContain("out of memory");
  });

  it("names the failure even without a detail", () => {
    mountShell(doc());
    failLoading("Boot failed");
    const error = doc().getElementById("loading-error");
    expect(error?.hidden).toBe(false);
    expect(error?.textContent ?? "").toContain("Boot failed");
  });
});

describe("loading shell lifecycle", () => {
  it("builds the shell when the static markup is absent", () => {
    expect(doc().getElementById("screen-loading")).toBeNull();
    renderLoading();
    expect(doc().getElementById("screen-loading")).not.toBeNull();
    expect(doc().getElementById("loading-bar")).not.toBeNull();
    expect(doc().getElementById("loading-status")).not.toBeNull();
    expect(doc().getElementById("loading-error")).not.toBeNull();
    renderLoading();
    setLoadingProgress(100);
    expect(doc().getElementById("loading-bar")?.style.width).toBe("100%");
  });

  it("hides without removing so the 100% bar stays assertable", () => {
    mountShell(doc());
    setLoadingProgress(100);
    hideLoading();
    const shell = doc().getElementById("screen-loading");
    expect(shell).not.toBeNull();
    expect(shell?.hidden).toBe(true);
    expect(doc().getElementById("loading-bar")?.style.width).toBe("100%");
  });

  it("never throws with no document", () => {
    const saved = (globalThis as unknown as { document?: unknown }).document;
    try {
      delete (globalThis as unknown as { document?: unknown }).document;
      expect(() => {
        renderLoading();
        setLoadingProgress(50, "Physics ready");
        failLoading("Probe failure", new Error("probe"));
        hideLoading();
      }).not.toThrow();
    } finally {
      (globalThis as unknown as { document?: unknown }).document = saved;
    }
  });
});

describe("fetchAssetManifest", () => {
  it("reports monotonic fractions across the stock manifest", async () => {
    const seen: Array<[number, number]> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true })),
    );
    const result = await fetchAssetManifest((done, total) => {
      seen.push([done, total]);
    });
    expect(result.total).toBe(ASSET_MANIFEST.length);
    expect(result.total).toBeGreaterThan(0);
    expect(result.ok).toHaveLength(result.total);
    expect(result.missing).toHaveLength(0);
    expect(seen).toHaveLength(result.total);
    let prev = -1;
    for (const [done, total] of seen) {
      expect(total).toBe(result.total);
      expect(done).toBeGreaterThan(prev);
      prev = done;
      expect(done / total).toBeGreaterThanOrEqual(0);
      expect(done / total).toBeLessThanOrEqual(1);
    }
    expect(seen[seen.length - 1]?.[0]).toBe(result.total);
  });

  it("resolves with the missing URL named when a fetch 404s", async () => {
    const errors: string[] = [];
    const spy = vi
      .spyOn(console, "error")
      .mockImplementation((...args: unknown[]) => {
        errors.push(args.map(String).join(" "));
      });
    const bad = ASSET_MANIFEST[0] ?? "/assets/missing-probe.wav";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: unknown) => ({ ok: url !== bad })),
    );
    let resolved = false;
    const result = await fetchAssetManifest().then((value) => {
      resolved = true;
      return value;
    });
    expect(resolved).toBe(true);
    expect(result.missing).toContain(bad);
    expect(result.ok).not.toContain(bad);
    expect(
      errors.some(
        (line) => line.includes("[loaders]") && line.includes(bad),
      ),
    ).toBe(true);
    spy.mockRestore();
  });

  it("resolves instead of rejecting when every fetch throws", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("offline probe");
      }),
    );
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const result = await fetchAssetManifest();
      expect(result.total).toBe(ASSET_MANIFEST.length);
      expect(result.missing).toHaveLength(result.total);
    } finally {
      spy.mockRestore();
    }
  });

  it("exposes the fetch_asset_manifest alias by reference", async () => {
    const loaders = await import("../src/render/loaders");
    expect(loaders.fetch_asset_manifest).toBe(loaders.fetchAssetManifest);
  });
});

describe("loading contract", () => {
  it("validateAssets still accepts the stock manifest", () => {
    expect(validateAssets()).toBe(true);
    expect(validateAssets(ASSET_MANIFEST)).toBe(true);
  });

  it("carries no engine imports", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const text = readFileSync(
      join(here, "..", "src", "ui", "loading.ts"),
      "utf8",
    );
    expect(text).not.toMatch(/three/);
    expect(text).not.toMatch(/rapier/i);
    expect(text).not.toMatch(/@dimforge/);
  });
});
