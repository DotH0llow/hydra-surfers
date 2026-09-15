/** Mounts screens into #ui and shows exactly one at a time. */
import "./screens/Home";
import "./screens/Hud";
import "./screens/Overlays";
import "./screens/Menus";
import { h } from "./dom";
import { getScreenFactory, type Screen, type ScreenHost, type ScreenName } from "./screens/registry";

export class UiRoot {
  private readonly screens = new Map<string, Screen>();
  private current: Screen | null = null;
  private currentName: ScreenName = "";

  constructor(
    private readonly container: HTMLElement,
    private readonly host: ScreenHost,
  ) {}

  get name(): ScreenName {
    return this.currentName;
  }

  show(name: ScreenName): void {
    const next = this.get(name);
    if (this.current && this.current !== next) {
      this.current.el.hidden = true;
      this.current.hide();
    }
    this.current = next;
    this.currentName = name;
    next.el.hidden = false;
    next.show();
  }

  update(frameDt: number): void {
    this.current?.update?.(frameDt);
  }

  private get(name: ScreenName): Screen {
    let s = this.screens.get(name);
    if (s) return s;
    const factory = getScreenFactory(name);
    if (factory) s = factory(this.host);
    else {
      console.warn(`[ui] no screen registered for "${name}"`);
      s = { el: h("div", { class: "screen", text: name }), show() {}, hide() {} };
    }
    s.el.hidden = true;
    this.container.append(s.el);
    this.screens.set(name, s);
    return s;
  }
}
