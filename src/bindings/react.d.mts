import type { Scheduler, State, WindowManager, WindowManagerOptions } from "../index.mjs";
import type { AttachInputOptions } from "../browser/index.mjs";
import type { Stage, StageOptions } from "./element.mjs";

/**
 * The slice of React the bindings use. Pass React itself (or a compatible
 * stub); no dependency on `react` is declared, so these are structural.
 */
export interface ReactLike {
  useRef: (...args: any[]) => any;
  useEffect: (...args: any[]) => any;
  useState: (...args: any[]) => any;
  useSyncExternalStore: (...args: any[]) => any;
  createElement: (...args: any[]) => any;
  Fragment: any;
}

export interface WindowManagerStageProps {
  /** The window manager to render. Required. */
  wm: WindowManager<any>;
  /** Window content as a React node, mounted as a portal into each view (needs `createPortal`). */
  renderSurface?: (id: string) => any;
  /** react-dom's `createPortal`. */
  createPortal?: (children: any, container: Element) => any;
  anchorFallback?: boolean;
  /** Merged into `attachInput`'s options. */
  input?: Partial<Omit<AttachInputOptions, "root" | "wm">>;
  /** When commits run after a state change (default: one per frame). */
  schedule?: Scheduler;
  /** Built-in window chrome around every window, as for `attachStage`. Read when the stage attaches. */
  chrome?: StageOptions["chrome"];
  /** Pop-outs, as for `attachStage`. */
  popouts?: StageOptions["popouts"];
  /** Cross-tab sync, as for `attachStage`; reach it through `stageRef` (`stage.sync.peers()`). */
  sync?: StageOptions["sync"];
  /** A command palette, as for `attachStage`; reach it through `stageRef` (`stage.palette.open()`). */
  palette?: StageOptions["palette"];
  direction?: StageOptions["direction"];
  /** Receives the stage's handles (`wm`, `renderer`, `sync`, `palette`, `popouts`, `detach`) once attached, `null` when it detaches. A ref object or a callback. */
  stageRef?: { current: Stage | null } | ((stage: Stage | null) => void);
  /** The same as a callback prop: the handles on attach, `null` on detach. */
  onStage?: (stage: Stage | null) => void;
  /** The host tag (default `"div"`). Give the host a height: the stage fills it. */
  as?: string;
  /** Everything else (`className`, `style`, `id`, ...) lands on the host element. */
  [prop: string]: unknown;
}

export interface ReactBindings {
  /** Create a window manager once and subscribe the component to it. `wm` is stable across renders. */
  useWindowManager<C extends { type: string } = never>(options?: WindowManagerOptions<C>): { wm: WindowManager<C>; state: State };
  /** Subscribe to a derived slice of state; re-renders only when the selected value changes (`Object.is`). */
  useWindowState<T = State>(wm: WindowManager<any>, selector?: (state: State) => T): T;
  /** Mount a DOM renderer and input adapter into a host element for the component's lifetime. */
  WindowManagerStage: (props: WindowManagerStageProps) => any;
}

export function createReactBindings(React: ReactLike): ReactBindings;
