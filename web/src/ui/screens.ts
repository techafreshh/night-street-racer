// Shared DOM-screen factories (menu.gd scene-split idiom).
// Zero-dependency display helpers: no store, router, or race imports, so
// every screen stays a pure display sink in the hud.ts idiom. Every DOM
// touch is guarded; when no document exists (vitest under Node) the stub
// fallback keeps the screens renderable with no browser, WebGL, or WASM.
// Stub nodes implement the appendChild/addEventListener/click/
// dispatchEvent surface the tests drive, mirroring the real elements.

export const SCREEN_IDS = {
  menu: "screen-menu",
  eventSelect: "screen-event-select",
  garage: "screen-garage",
  settings: "screen-settings",
  results: "screen-results",
  pause: "screen-pause",
  race: "screen-race",
} as const;

export type ScreenId = (typeof SCREEN_IDS)[keyof typeof SCREEN_IDS];

type ElementLike = Record<string, unknown>;

type DocumentLike = {
  createElement?: (tag: string) => unknown;
};

// Live document behind a guard: null when no DOM exists (headless probe
// without a document), never throws.
function globalDocument(): DocumentLike | null {
  try {
    const doc = (globalThis as unknown as { document?: unknown }).document;
    if (doc !== null && typeof doc === "object") {
      return doc as DocumentLike;
    }
  } catch {
    // No DOM available.
  }
  return null;
}

// Dispatch stored listeners for one event type; shared by click() and
// dispatchEvent() on stub nodes. Never throws.
function dispatchStub(el: ElementLike, type: string, event?: unknown): boolean {
  try {
    const table = el.__listeners as
      | Map<string, Array<(e?: unknown) => void>>
      | undefined;
    const listeners = table?.get(type) ?? [];
    for (const listener of [...listeners]) {
      try {
        listener(event ?? { type, target: el });
      } catch {
        // One failing listener never blocks the rest.
      }
    }
  } catch {
    // Display sinks never throw.
  }
  return true;
}

// Minimal element fallback for document-less runtimes (vitest/Node): the
// id/text/disabled/hidden/value surface the screens drive, plus the
// appendChild/replaceChildren/addEventListener/click/dispatchEvent shape
// the stub-DOM tests assert through. Never throws.
function makeStub(tag: string): ElementLike {
  const el: ElementLike = {
    tagName: tag.toUpperCase(),
    id: "",
    className: "",
    textContent: "",
    disabled: false,
    hidden: false,
    value: "",
    checked: false,
    type: "",
    style: {} as Record<string, string>,
    children: [] as unknown[],
    __listeners: new Map<string, Array<(e?: unknown) => void>>(),
  };
  el.appendChild = (child: unknown): unknown => {
    try {
      (el.children as unknown[]).push(child);
    } catch {
      // Best effort on stub nodes.
    }
    return child;
  };
  el.replaceChildren = (...nodes: unknown[]): void => {
    try {
      (el.children as unknown[]).length = 0;
      for (const node of nodes) {
        (el.children as unknown[]).push(node);
      }
    } catch {
      // Best effort on stub nodes.
    }
  };
  el.addEventListener = (type: string, listener: (e?: unknown) => void): void => {
    try {
      const table = el.__listeners as Map<string, Array<(e?: unknown) => void>>;
      const list = table.get(type) ?? [];
      list.push(listener);
      table.set(type, list);
    } catch {
      // Best effort on stub nodes.
    }
  };
  el.removeEventListener = (
    type: string,
    listener: (e?: unknown) => void,
  ): void => {
    try {
      const table = el.__listeners as Map<string, Array<(e?: unknown) => void>>;
      table.set(
        type,
        (table.get(type) ?? []).filter((item) => item !== listener),
      );
    } catch {
      // Best effort on stub nodes.
    }
  };
  el.click = (): void => {
    dispatchStub(el, "click");
  };
  el.dispatchEvent = (event: { type: string }): boolean =>
    dispatchStub(el, event?.type ?? "", event);
  return el;
}

// Guarded element factory: the live document when present, the stub
// fallback otherwise. Never throws.
function createEl(tag: string): ElementLike {
  try {
    const doc = globalDocument();
    if (doc !== null && typeof doc.createElement === "function") {
      const node = doc.createElement(tag) as ElementLike | null;
      if (node !== null && typeof node === "object") {
        return node;
      }
    }
  } catch {
    // Fall through to the stub.
  }
  return makeStub(tag);
}

function setProp(el: ElementLike, key: string, value: unknown): void {
  try {
    el[key] = value;
  } catch {
    // Display sinks never throw.
  }
}

// Guarded child attach: works on live and stub nodes. Never throws.
export function appendChild(parent: unknown, child: unknown): void {
  try {
    const host = parent as {
      appendChild?: (node: unknown) => unknown;
    } | null;
    if (host !== null && typeof host === "object") {
      if (typeof host.appendChild === "function") {
        host.appendChild(child);
        return;
      }
      const children = (host as ElementLike).children;
      if (Array.isArray(children)) {
        children.push(child);
      }
    }
  } catch {
    // Display sinks never throw.
  }
}

// Guarded click wiring shared by every screen: stub nodes record the
// listener, live nodes behave natively. Never throws.
export function onPress(el: unknown, fn: () => void): void {
  try {
    const node = el as {
      addEventListener?: (type: string, listener: () => void) => void;
    } | null;
    if (node !== null && typeof node === "object") {
      if (typeof node.addEventListener === "function") {
        node.addEventListener("click", () => {
          try {
            fn();
          } catch {
            // Display sinks never throw.
          }
        });
      }
    }
  } catch {
    // Display sinks never throw.
  }
}

// Guarded change wiring for sliders/toggles. Never throws.
export function onChange(el: unknown, fn: () => void): void {
  try {
    const node = el as {
      addEventListener?: (type: string, listener: () => void) => void;
    } | null;
    if (node !== null && typeof node === "object") {
      if (typeof node.addEventListener === "function") {
        const handler = (): void => {
          try {
            fn();
          } catch {
            // Display sinks never throw.
          }
        };
        node.addEventListener("change", handler);
        node.addEventListener("input", handler);
      }
    }
  } catch {
    // Display sinks never throw.
  }
}

// Screen root: a <section> carrying the screen id plus an <h1> title.
// Never throws.
export function screenRoot(id: string, title: string): HTMLElement {
  try {
    const root = createEl("section");
    setProp(root, "id", id);
    const head = createEl("h1");
    setProp(head, "textContent", title);
    appendChild(root, head);
    return root as unknown as HTMLElement;
  } catch {
    return makeStub("section") as unknown as HTMLElement;
  }
}

// Menu button: a <button id label> wired later via onPress. Never throws.
export function menuButton(id: string, label: string): HTMLButtonElement {
  try {
    const button = createEl("button");
    setProp(button, "id", id);
    setProp(button, "type", "button");
    setProp(button, "textContent", label);
    return button as unknown as HTMLButtonElement;
  } catch {
    return makeStub("button") as unknown as HTMLButtonElement;
  }
}

// Form control: an <input> carrying the control id and type. Never throws.
export function controlInput(id: string, type: string): HTMLInputElement {
  try {
    const input = createEl("input");
    setProp(input, "id", id);
    setProp(input, "type", type);
    return input as unknown as HTMLInputElement;
  } catch {
    return makeStub("input") as unknown as HTMLInputElement;
  }
}

// Static line: a <div id text> for banners and result rows (no click
// surface, unlike menuButton). Never throws.
export function staticLine(id: string, text: string): HTMLElement {
  try {
    const line = createEl("div");
    setProp(line, "id", id);
    setProp(line, "textContent", text);
    return line as unknown as HTMLElement;
  } catch {
    return makeStub("div") as unknown as HTMLElement;
  }
}

// v1 snake_case aliases (same references).
export const screen_root = screenRoot;
export const menu_button = menuButton;
export const control_input = controlInput;
export const static_line = staticLine;
export const on_press = onPress;
export const on_change = onChange;
export const append_child = appendChild;
