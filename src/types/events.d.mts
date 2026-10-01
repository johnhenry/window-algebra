/**
 * Events record what actually happened (they can differ from the command:
 * policy may redirect or refuse it). Effects describe work for the effectful
 * shell. Both are discriminated unions keyed by `type`.
 */
import type { Constraints, DropOp, DropZone, Layer, LayoutSpec, Mode, Placement, Rule, Status, ConfigPatch } from "./state.mjs";

/** Why a command was refused. `command/rejected.reason` is one of these (an extension may add its own). */
export type RejectionReason =
  | "handler-threw"
  | "invalid-command"
  | "unknown-command"
  | "invalid-id"
  | "missing-id"
  | "duplicate-id"
  | "unknown-parent"
  | "unknown-window"
  | "unknown-workspace"
  | "unknown-output"
  | "unknown-layer"
  | "unknown-mode"
  | "unknown-role"
  | "unknown-status"
  | "unknown-zone"
  | "unknown-split"
  | "unknown-layout"
  | "invalid-layout"
  | "invalid-ratio"
  | "invalid-geometry"
  | "invalid-constraints"
  | "invalid-path"
  | "invalid-index"
  | "invalid-weights"
  | "missing-value"
  | "missing-weights"
  | "not-resizable"
  | "not-bsp"
  | "invalid-config"
  | "invalid-rules"
  | "invalid-urgent"
  | "invalid-sticky"
  | "no-urgent-window"
  | "empty-scratchpad"
  | "not-scratchpad"
  | "not-on-workspace"
  | "popped-out"
  | "not-visible"
  | "hidden-parent"
  | "parent-on-other-workspace"
  | "has-parent"
  | "popup-blocked"
  | "last-workspace"
  | "last-workspace-on-output"
  | "last-output"
  | "missing-workspaces"
  | "different-workspaces"
  | "same-window"
  | "not-tiled"
  | "not-draggable"
  | "drag-disabled"
  | "zone-disabled"
  | "too-small"
  | "blocked";

/** Why `wm.load` (or `migrate`) refused a state. */
export type LoadRejectionReason = "invalid-json" | "invalid-state" | "future-version" | "no-migration-path";

export interface CommandRejected {
  type: "command/rejected";
  /** The type of the refused command. */
  command: string;
  /** The command's `id`, even for commands whose subject is not `id`. */
  id: string | undefined;
  reason: RejectionReason | (string & {});
}

// ------------------------------------------------------------------ windows

export interface WindowCreated {
  type: "window/created";
  id: string;
  /** Indices of the `config.rules` that matched; present only when at least one did. */
  rules?: number[];
}
export interface WindowClosed {
  type: "window/closed";
  id: string;
}
export interface WindowFocused {
  type: "window/focused";
  id: string;
  previous: string | null;
}
export interface FocusRedirected {
  type: "focus/redirected";
  requested: string;
  /** The modal that received focus instead. */
  id: string;
}
export interface WindowBlurred {
  type: "window/blurred";
  /** The window that lost focus. */
  id: string;
}
export interface WindowRestored {
  type: "window/restored";
  id: string;
}
export interface WindowRaised {
  type: "window/raised";
  id: string;
}
export interface WindowLowered {
  type: "window/lowered";
  id: string;
}
export interface WindowLayerChanged {
  type: "window/layer-changed";
  id: string;
  layer: Layer;
}
export interface WindowMoved {
  type: "window/moved";
  id: string;
  placement: Placement;
}
export interface WindowResized {
  type: "window/resized";
  id: string;
  /** After `constrainSize`. */
  placement: Placement;
}
export interface WindowModeChanged {
  type: "window/mode-changed";
  id: string;
  mode: Mode;
}
export interface WindowDetached {
  type: "window/detached";
  id: string;
  placement: Placement;
}
export interface WindowStatusChanged {
  type: "window/status-changed";
  id: string;
  status: Status;
  previous: Status;
}
export interface WindowRetitled {
  type: "window/retitled";
  id: string;
  title: string;
}
export interface WindowConstrained {
  type: "window/constrained";
  id: string;
  /** The merged constraints. */
  constraints: Constraints;
}
export interface WindowSwapped {
  type: "window/swapped";
  id: string;
  target: string;
}
export interface WindowDropped {
  type: "window/dropped";
  id: string;
  target: string;
  /** The screen zone that was dropped on. */
  zone: DropZone;
  op: DropOp;
  workspace: string;
  /** `true` when a floating window joined the layout. */
  tiled?: true;
}
export interface WindowReordered {
  type: "window/reordered";
  id: string;
  target: string;
  position: "before" | "after";
}
export interface WindowDraggableChanged {
  type: "window/draggable-changed";
  id: string;
  draggable: boolean;
}
export interface WindowStickyChanged {
  type: "window/sticky-changed";
  id: string;
  sticky: boolean;
}
export interface WindowUrgentChanged {
  type: "window/urgent-changed";
  id: string;
  urgent: boolean;
}
export interface WindowWorkspaceChanged {
  type: "window/workspace-changed";
  id: string;
  workspace: string;
}

// ------------------------------------------------------------------ scratchpad

export interface ScratchpadShown {
  type: "scratchpad/shown";
  id: string;
}
export interface ScratchpadHidden {
  type: "scratchpad/hidden";
  id: string;
}
export interface ScratchpadRemoved {
  type: "scratchpad/removed";
  id: string;
}

// ------------------------------------------------------------------ workspaces and outputs

export interface WorkspaceCreated {
  type: "workspace/created";
  id: string;
  output: string;
}
export interface WorkspaceActivated {
  type: "workspace/activated";
  id: string;
  previous: string;
}
export interface WorkspaceRemoved {
  type: "workspace/removed";
  id: string;
  fallback: string;
}
export interface WorkspaceRenamed {
  type: "workspace/renamed";
  id: string;
  to: string;
}
export interface WorkspaceReordered {
  type: "workspace/reordered";
  id: string;
  index: number;
}
export interface WorkspaceMovedToOutput {
  type: "workspace/moved-to-output";
  id: string;
  output: string;
  from: string;
}
export interface OutputCreated {
  type: "output/created";
  id: string;
  workspaces: string[];
}
export interface OutputRemoved {
  type: "output/removed";
  id: string;
  fallback: string;
  /** The ids of the workspaces that moved. */
  workspaces: string[];
}
export interface OutputReordered {
  type: "output/reordered";
  id: string;
  index: number;
}
export interface OutputFocused {
  type: "output/focused";
  id: string;
  previous: string;
}

// ------------------------------------------------------------------ layout and configuration

export interface LayoutChanged {
  type: "layout/changed";
  workspace: string;
  layout: LayoutSpec;
}
export interface LayoutRatioChanged {
  type: "layout/ratio-changed";
  workspace: string;
  ratio: number;
}
export interface LayoutSplitRotated {
  type: "layout/split-rotated";
  workspace: string;
}
export interface LayoutSplitResized {
  type: "layout/split-resized";
  workspace: string;
  path: string;
}
export interface LayoutToggled {
  type: "layout/toggled";
  workspace: string;
  layout: LayoutSpec;
}
export interface ConfigChanged {
  type: "config/changed";
  /** The patch as given, without `type`. */
  patch: ConfigPatch;
}
export interface RulesChanged {
  type: "rules/changed";
  rules: Rule[];
}

// ------------------------------------------------------------------ manager-only

export interface HistoryChanged {
  type: "history/changed";
}
export interface StateLoaded {
  type: "state/loaded";
}
export interface StateLoadRejected {
  type: "state/load-rejected";
  reason: LoadRejectionReason;
  version?: number;
}

/** Events `update` can return. */
export type UpdateEvent =
  | CommandRejected
  | WindowCreated
  | WindowClosed
  | WindowFocused
  | FocusRedirected
  | WindowBlurred
  | WindowRestored
  | WindowRaised
  | WindowLowered
  | WindowLayerChanged
  | WindowMoved
  | WindowResized
  | WindowModeChanged
  | WindowDetached
  | WindowStatusChanged
  | WindowRetitled
  | WindowConstrained
  | WindowSwapped
  | WindowDropped
  | WindowReordered
  | WindowDraggableChanged
  | WindowStickyChanged
  | WindowUrgentChanged
  | WindowWorkspaceChanged
  | ScratchpadShown
  | ScratchpadHidden
  | ScratchpadRemoved
  | WorkspaceCreated
  | WorkspaceActivated
  | WorkspaceRemoved
  | WorkspaceRenamed
  | WorkspaceReordered
  | WorkspaceMovedToOutput
  | OutputCreated
  | OutputRemoved
  | OutputReordered
  | OutputFocused
  | LayoutChanged
  | LayoutRatioChanged
  | LayoutSplitRotated
  | LayoutSplitResized
  | LayoutToggled
  | ConfigChanged
  | RulesChanged;

/** Events only the manager sends (to subscribers, with `command` set to `null`). */
export type ManagerEvent = HistoryChanged | StateLoaded | StateLoadRejected;

/** Every event type. */
export type Event = UpdateEvent | ManagerEvent;

/** The event with a given type: `EventOf<"window/focused">`. */
export type EventOf<T extends Event["type"]> = Extract<Event, { type: T }>;

// ------------------------------------------------------------------ effects

export interface RenderEffect {
  type: "render";
}
export interface FocusEffect {
  type: "focus";
  /** The window to move keyboard focus to, or `null` to leave the stage. */
  id: string | null;
}
/** Work for the effectful shell. De-duplicated by `type`, the last one kept. */
export type Effect = RenderEffect | FocusEffect;
