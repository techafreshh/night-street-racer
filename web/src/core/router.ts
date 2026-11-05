// In-memory DOM-screen router (GameState typed-API-with-owner-comment idiom).
// Owns only the screen registry and container swap: show() replaces the
// container's children and nothing else, so #ui and <canvas> always stay
// mounted. Imports no app screens itself; main.ts registers them.

export type ScreenRender = (container: HTMLElement) => void;

export class Router {
  private readonly screens = new Map<string, ScreenRender>();
  private active: string | null = null;

  constructor(private readonly container: HTMLElement) {}

  // Typed writer: register a named screen render callback.
  register(name: string, render: ScreenRender): void {
    this.screens.set(name, render);
  }

  // Typed writer: swap to a registered screen; throws on unknown names.
  show(name: string): void {
    const render = this.screens.get(name);
    if (render === undefined) {
      throw new Error(`Unknown screen: ${name}`);
    }
    this.container.replaceChildren();
    render(this.container);
    this.active = name;
  }

  // Typed reader: return the active screen name (null before first show).
  current(): string | null {
    return this.active;
  }
}

// Typed factory: create a router bound to the given container.
export function createRouter(container: HTMLElement): Router {
  return new Router(container);
}
