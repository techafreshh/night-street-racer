// Loading overlay helpers (loading-screen port).
// Pure display sink in the hud.ts idiom: paints and advances the static
// #screen-loading shell from index.html (first paint precedes the module
// script) through the boot stages in main.ts. No router, store, or engine
// imports; only ./screens factories. Every DOM touch is guarded so
// Node-without-document never throws; the shell is hidden, never
// removed, so probes can still assert the 100% bar after boot.

import { screenRoot, staticLine } from "./screens";

// Shell element ids (index.html is the source of truth; created here
// only when the static shell is absent, e.g. under stub-DOM tests).
export const LOADING_SHELL_ID = "screen-loading";
export const LOADING_BAR_ID = "loading-bar";
export const LOADING_STATUS_ID = "loading-status";
export const LOADING_ERROR_ID = "loading-error";

type DocumentLike = {
  body?: unknown;
  createElement?: (tag: string) => unknown;
  getElementById?: (id: string) => unknown;
};

// Live document behind a guard: null when no DOM exists. Never throws.
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

// Guarded lookup: the live element or null. Never throws.
function byId(id: string): HTMLElement | null {
  try {
    const doc = globalDocument();
    const get = doc?.getElementById;
    if (doc === null || typeof get !== "function") {
      return null;
    }
    const node = get.call(doc, id);
    if (node !== null && typeof node === "object") {
      return node as HTMLElement;
    }
  } catch {
    // Display sinks never throw.
  }
  return null;
}

// Guarded child attach for nodes built outside ./screens. Never throws.
function attachChild(parent: unknown, child: unknown): void {
  try {
    const host = parent as {
      appendChild?: (node: unknown) => unknown;
    } | null;
    if (host !== null && typeof host === "object") {
      if (typeof host.appendChild === "function") {
        host.appendChild(child);
      }
    }
  } catch {
    // Display sinks never throw.
  }
}

// Ensure the shell and its bar/status/error lines exist: no-op when the
// static index.html shell is present, otherwise builds an equivalent
// shell with the shared factories and mounts it on the body. Never
// throws; returns the shell or null when no document exists.
function ensureShell(): HTMLElement | null {
  try {
    const doc = globalDocument();
    if (doc === null) {
      return null;
    }
    const existing = byId(LOADING_SHELL_ID);
    if (existing !== null) {
      if (byId(LOADING_BAR_ID) !== null) {
        return existing;
      }
    }
    const shell = screenRoot(LOADING_SHELL_ID, "Night Street Racer");
    const bar = staticLine(LOADING_BAR_ID, "");
    try {
      const style = (bar as unknown as { style?: Record<string, string> })
        .style;
      if (style !== undefined && style !== null) {
        style.width = "0%";
      }
    } catch {
      // The bar paints at zero width from CSS when styles are missing.
    }
    const status = staticLine(LOADING_STATUS_ID, "Starting…");
    const error = staticLine(LOADING_ERROR_ID, "");
    try {
      (error as unknown as { hidden: boolean }).hidden = true;
    } catch {
      // The error line stays empty until failLoading unhides it.
    }
    attachChild(shell, bar);
    attachChild(shell, status);
    attachChild(shell, error);
    if (existing === null) {
      try {
        const body = doc.body as {
          appendChild?: (node: unknown) => unknown;
        } | null;
        if (body !== null && typeof body === "object") {
          if (typeof body.appendChild === "function") {
            body.appendChild(shell);
          }
        }
      } catch {
        // Mount faults never break the paint.
      }
    }
    return (existing ?? shell) as HTMLElement;
  } catch {
    return null;
  }
}

// Typed writer: idempotent paint of the loading shell. No-op when the
// elements already exist. Never throws, even with no document.
export function renderLoading(): void {
  try {
    ensureShell();
  } catch {
    // Display sinks never throw.
  }
}

// v1 snake_case alias (same reference).
export const render_loading = renderLoading;

// Typed writer: clamp pct to 0-100, paint it as the inline bar width,
// and replace the status line when a label is given. Never throws,
// even with no document.
export function setLoadingProgress(pct: number, label?: string): void {
  try {
    const value =
      typeof pct === "number" && Number.isFinite(pct)
        ? Math.min(100, Math.max(0, pct))
        : 0;
    const bar = byId(LOADING_BAR_ID);
    if (bar !== null) {
      try {
        const style = (bar as unknown as { style?: Record<string, string> })
          .style;
        if (style !== undefined && style !== null) {
          style.width = `${value}%`;
        }
      } catch {
        // Bar faults never break boot.
      }
    }
    if (label !== undefined) {
      const status = byId(LOADING_STATUS_ID);
      if (status !== null) {
        try {
          status.textContent = label;
        } catch {
          // Status faults never break boot.
        }
      }
    }
  } catch {
    // Display sinks never throw.
  }
}

// v1 snake_case alias (same reference).
export const set_loading_progress = setLoadingProgress;

// Typed writer: reveal the named error line as "name: detail" and keep
// the shell visible so the boot stall is never blank. Never throws,
// even with no document.
export function failLoading(name: string, detail?: unknown): void {
  try {
    const el = byId(LOADING_ERROR_ID);
    if (el === null) {
      return;
    }
    let message = typeof name === "string" && name !== "" ? name : "Load failed";
    if (detail !== undefined && detail !== null && detail !== "") {
      let extra = "";
      try {
        if (detail instanceof Error) {
          extra = detail.message;
        } else {
          extra = String(detail);
        }
      } catch {
        extra = "";
      }
      if (extra !== "") {
        message = `${message}: ${extra}`;
      }
    }
    try {
      el.textContent = message;
    } catch {
      // Text faults never break the error path.
    }
    try {
      (el as unknown as { hidden: boolean }).hidden = false;
    } catch {
      // Visibility faults never break the error path.
    }
    try {
      const remove = (el as unknown as { removeAttribute?: (key: string) => void })
        .removeAttribute;
      if (typeof remove === "function") {
        remove.call(el, "hidden");
      }
    } catch {
      // Attribute faults never break the error path.
    }
  } catch {
    // Display sinks never throw.
  }
}

// v1 snake_case alias (same reference).
export const fail_loading = failLoading;

// Typed writer: hide the shell without removing it, so probes can still
// assert the 100% bar after boot. Never throws, even with no document.
export function hideLoading(): void {
  try {
    const shell = byId(LOADING_SHELL_ID);
    if (shell === null) {
      return;
    }
    try {
      (shell as unknown as { hidden: boolean }).hidden = true;
    } catch {
      // Visibility faults never break boot.
    }
    try {
      const style = (shell as unknown as { style?: Record<string, string> })
        .style;
      if (style !== undefined && style !== null) {
        style.display = "none";
      }
    } catch {
      // Style faults never break boot.
    }
  } catch {
    // Display sinks never throw.
  }
}

// v1 snake_case alias (same reference).
export const hide_loading = hideLoading;
