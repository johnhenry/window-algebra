/**
 * A typed usage file, compiled by `npm run test:types` (`tsc --noEmit`). It exercises every entry point the
 * way a consumer would and pins the exactness of the types: `// @ts-expect-error` lines must *fail* to
 * compile, so a type that goes loose breaks the build.
 */
import {
  COMMANDS,
  createState,
  createWindowManager,
  update,
  reduce,
  replay,
  derive,
  compile,
  presentationContext,
  row,
  view,
  place,
  size,
  anchor,
  geometry,
  paletteEntries,
  buildCommand,
  directionOf,
  boundsOf,
  type Command,
  type CommandOf,
  type CommandType,
  type Event,
  type EventOf,
  type Effect,
  type State,
  type LayoutNode,
  type LayoutSpec,
  type WindowManager,
  type UpdateResult,
  type RenderNode,
} from "@johnhenry/window-algebra";
import {
  attachInput,
  attachPopouts,
  attachSync,
  createDomRenderer,
  createFrameScheduler,
  createPalette,
  createSurfaceRegistry,
  chromeSurface,
  lazySurface,
  CHROME_BUTTONS,
  type ChromeButton,
  type Surface,
  type StageCoordinates,
} from "@johnhenry/window-algebra/browser";
import { column, grid, overlay, isView, validate, type ViewNode, type RowNode } from "@johnhenry/window-algebra/algebra";
import { mirror, views, mapViews, find } from "@johnhenry/window-algebra/transforms";
import { masterStack, bspFrom, bspIds, treeFrom, treeIds, columns, type LayoutItem } from "@johnhenry/window-algebra/layouts";
import { BASE_CSS, CHROME_CSS, THEME_TOKENS, toHTML, px, tabId, type PresentationContext } from "@johnhenry/window-algebra/css";
import { createReactBindings } from "@johnhenry/window-algebra/react";
import { attachStage, defineWindowAlgebraElement, defineCommandPaletteElement } from "@johnhenry/window-algebra/element";

// ---------------------------------------------------------------- state and commands

const state: State = createState({ workspaces: ["main", { id: "docs", layout: { type: "tabs" } }], config: { gap: 8, direction: "rtl", drag: { tiled: "swap" } } });

const first: UpdateResult = update(state, { type: "window/create", id: "a", title: "Editor", mode: "floating", placement: { x: 10, y: "center", width: 300, height: 200 } });
const next: State = reduce(first.state, { type: "window/focus", id: "a" });
replay(state, [{ type: "window/create", id: "b" }, { type: "layout/set", layout: { type: "master-stack", ratio: 0.6, side: "right" } }]);

// Commands are a discriminated union keyed by `type`, with exact payloads.
const describeCommand = (command: Command): string => {
  switch (command.type) {
    case "window/create":
      return command.title ?? command.id; // title is optional, id is required
    case "window/move": {
      const x: number | "center" | undefined = command.x;
      return String(x);
    }
    case "window/drop":
      return `${command.id} on ${command.target} (${command.zone})`; // zone is a DropZone
    case "layout/resize-split":
      return String(command.weights ?? command.delta);
    case "config/set":
      return String(command.direction ?? command.gap); // the patch's fields are the command's
    case "focus/next":
      // @ts-expect-error `focus/next` carries no id
      return command.id;
    default:
      return command.type;
  }
};
describeCommand({ type: "window/blur" });

const closeIt: CommandOf<"window/close"> = { type: "window/close", id: "a" };
const type: CommandType = closeIt.type;
type;

// @ts-expect-error unknown command type
update(state, { type: "window/explode", id: "a" });
// @ts-expect-error `id` is required
update(state, { type: "window/close" });
// @ts-expect-error misspelled field
update(state, { type: "window/close", idd: "a" });
// @ts-expect-error a zone is one of five
update(state, { type: "window/drop", id: "a", target: "b", zone: "middle" });
// @ts-expect-error a layer is one of seven
update(state, { type: "window/set-layer", id: "a", layer: "overlay" });
// @ts-expect-error direction is "ltr" or "rtl"
update(state, { type: "config/set", direction: "auto" });
update(state, { type: "config/set", bounds: "none" });
createState({ config: { bounds: "none", snap: { magnet: 6 } } });
// @ts-expect-error bounds is "stage" or "none"
update(state, { type: "config/set", bounds: "infinite" });
// @ts-expect-error a mode is tiled or floating
update(state, { type: "window/set-mode", id: "a", mode: "docked" });

// A custom command needs the extensions that handle it.
update(state, { type: "my/ping", n: 1 }, { "my/ping": (s) => ({ state: s, events: [], effects: [{ type: "render" }] }) });
// @ts-expect-error without extensions a custom command is a typo
update(state, { type: "my/ping", n: 1 });

const all: readonly CommandType[] = COMMANDS;
all.length;

// ---------------------------------------------------------------- events and effects

const onEvent = (event: Event): string => {
  switch (event.type) {
    case "command/rejected":
      return `${event.command}: ${event.reason}`;
    case "window/focused":
      return `${event.id} (was ${event.previous})`;
    case "window/dropped":
      return `${event.op} ${event.zone} ${event.tiled === true}`;
    case "window/status-changed":
      return `${event.previous} -> ${event.status}`;
    case "state/load-rejected":
      return event.reason;
    case "config/changed":
      return String(event.patch.direction);
    default:
      return event.type;
  }
};
first.events.map(onEvent);
const focused: EventOf<"window/focused"> = { type: "window/focused", id: "a", previous: null };
focused.previous;
const effect: Effect = { type: "focus", id: null };
effect;
// @ts-expect-error `previous` is part of the event
const bad: EventOf<"window/focused"> = { type: "window/focused", id: "a" };
bad;

// ---------------------------------------------------------------- the manager

const wm: WindowManager = createWindowManager({ state, history: 50, onEffect: (e, m) => void (e.type === "focus" && m.getState()) });
wm.create({ id: "term", title: "Terminal" });
wm.focus("term");
wm.drop("term", "a", "left");
wm.setLayout({ type: "bsp" });
wm.resizeSplit("", { delta: 0.1 });
wm.undo();
const unsubscribe = wm.subscribe((s, events, command) => void [s.focus.window, events.length, command?.type]);
unsubscribe();
// @ts-expect-error wrong zone through the facade
wm.drop("term", "a", "diagonal");
wm.dispatch({ type: "window/set-title", id: "term", title: "Shell" });
// @ts-expect-error dispatch is typed too
wm.dispatch({ type: "window/set-title", id: "term" });

// A manager with commands of its own.
type Ping = { type: "my/ping"; n: number };
const custom = createWindowManager<Ping>({ extensions: { "my/ping": (s) => ({ state: s }) } });
custom.dispatch({ type: "my/ping", n: 2 });
custom.dispatch({ type: "window/blur" });
// @ts-expect-error not a built-in, not a Ping
custom.dispatch({ type: "my/pong" });

// ---------------------------------------------------------------- algebra, transforms, layouts, css

const tree: LayoutNode = overlay({}, row({ resize: { path: "", weights: [1, 1] } }, view("a"), column({ align: "center" }, view("b"), view("c"))), place({ right: 16, bottom: 16 }, size({ width: 200 }, view("pip"))));
const anchored = anchor({ to: "a", side: "bottom", align: "start", offset: 4 }, view("menu"));
anchored.options.to;
// @ts-expect-error anchor needs `to`
anchor({ side: "bottom" }, view("menu"));
const v: ViewNode = view("x");
const r: RowNode = row({}, v);
r.children.length;
isView(v);
validate(tree);
grid({ columns: 3 }, view("a"));
mirror(tree);
views(tree).includes("a");
mapViews(tree, (node) => place({ x: 0 }, node));
find(tree, "a");
const items: LayoutItem[] = ["a", view("b")];
masterStack({ ratio: 0.6, side: "right" }, items);
columns(undefined, ["a", "b"]);
bspIds(bspFrom(["a", "b", "c"]));
treeIds(treeFrom(["a", "b"], { type: "row" }));
const derived: LayoutNode = derive(next, { output: "primary" });
const context: PresentationContext = presentationContext(next);
const render: RenderNode = compile(derived, context);
toHTML(render, { slot: () => "" });
px(10);
tabId("a");
BASE_CSS.length;
THEME_TOKENS["--wa-color-accent"].light;
geometry.constrainSize({ width: 10, height: 10 }, { minWidth: 20, aspectRatio: { min: 1, max: 2 } });
directionOf(next) satisfies "ltr" | "rtl";
boundsOf(next) satisfies "stage" | "none";
next.config.bounds satisfies "stage" | "none";

const catalog = paletteEntries(next, { query: "close" });
catalog[0]?.fields[0]?.kind;
const built: { type: string } = buildCommand("window/close", { id: "a" });
built;

// ---------------------------------------------------------------- browser

declare const stage: HTMLElement;
const surfaces = createSurfaceRegistry();
const surface: Surface = lazySurface((target) => {
  target.textContent = "hello";
});
surfaces.set("a", surface);
const renderer = createDomRenderer({ root: stage, surfaceFor: surfaces, animate: { duration: 150 } });
renderer.commit(compile(derived, context), { immediate: true });
renderer.elementFor("a")?.classList;
const detach = attachInput({ root: stage, wm, keyboard: true, touch: { swipe: { tabs: true, workspaces: true, windows: true }, contextMenu: (press) => void press.pointerType } });
detach();
attachInput({ root: stage, wm, touch: { contextMenu: "window/toggle-floating" } });
// @ts-expect-error a context command must be a real command type
attachInput({ root: stage, wm, touch: { contextMenu: "window/explode" } });
const chromed = createDomRenderer({ root: stage, chrome: { buttons: ["close", "popout"], icon: (id) => id, icons: { close: "x" }, labels: { close: "Schliessen" }, for: (id) => id !== "tip" } });
chromed.bodyFor("a")?.classList;
createDomRenderer({ root: stage, chrome: true });
// @ts-expect-error a chrome button is one of five
createDomRenderer({ root: stage, chrome: { buttons: ["explode"] } });
// A pan/zoom canvas: one coordinate hook for the renderer and the input adapter.
let zoom = 1;
const coordinates: StageCoordinates = { toStage: (clientX, clientY) => ({ x: clientX / zoom, y: clientY / zoom }), scale: () => zoom };
createDomRenderer({ root: stage, coordinates }).measure().a?.width;
attachInput({ root: stage, wm, coordinates });
attachInput({ root: stage, wm, coordinates: { toStage: (x, y) => ({ x, y }) } });
// @ts-expect-error toStage returns a point
attachInput({ root: stage, wm, coordinates: { toStage: (x: number) => x } });
chromeSurface({ id: "a", title: "A", wm, body: (el) => void el.classList, buttons: ["maximize"] }) satisfies Surface;
CHROME_BUTTONS satisfies readonly ChromeButton[];
CHROME_CSS satisfies string;
const popouts = attachPopouts({ wm, renderer });
attachInput({ root: stage, wm, popouts });
popouts.popOut("a", { features: "popup" });
const sync = attachSync({ wm, channel: "demo", schedule: createFrameScheduler(), onSync: (info) => void info.applied });
sync.peers().length;
sync.detach();
const palette = createPalette({ wm, shortcut: ["Mod+K", "F1"], popouts });
palette.open({ query: "close" });
palette.detach();
// @ts-expect-error `wm` is required
createPalette({});

// ---------------------------------------------------------------- bindings

const bindings = createReactBindings({ useRef: () => ({}), useEffect() {}, useState: () => [], useSyncExternalStore: () => ({}), createElement: () => ({}), Fragment: null });
bindings.useWindowState(wm, (s) => s.focus.window) satisfies string | null;
const { WindowManagerStage } = bindings;
WindowManagerStage({ wm, className: "stage", as: "section" });

const handle = attachStage(stage, { wm, chrome: { buttons: ["close"] }, popouts: true, sync: true, palette: { shortcut: false }, direction: "auto", input: { keyboard: true }, coordinates });
handle.detach();
const Stage = defineWindowAlgebraElement("wa-stage");
const element = new Stage().configure({ wm });
element.wm?.getState();
element.palette?.open();
element.palette?.isOpen satisfies boolean | undefined;
element.sync?.peers() satisfies string[] | undefined;
element.renderer?.measure();
element.popouts?.isPoppedOut("a");
// @ts-expect-error the handles are read-only
element.palette = null;
handle.palette?.toggle();
handle.sync?.peers();
handle.popouts?.popIn("a");
const stageRef: { current: typeof handle | null } = { current: null };
WindowManagerStage({ wm, palette: true, sync: true, chrome: true, popouts: true, stageRef, onStage: (stage) => void stage?.palette?.open() });
WindowManagerStage({ wm, stageRef: (stage) => void stage?.sync?.peers() });
const Palette = defineCommandPaletteElement();
new Palette().configure({ wm }).open();

export type { Event as AnyEvent, LayoutSpec };
