/**
 * Every built-in command, as a discriminated union keyed by `type`, with the
 * exact payload each one takes. `Command` is what `update` and `wm.dispatch`
 * accept; `COMMANDS` (a runtime array) lists the same 58 types, and a test
 * keeps the two in step.
 */
import type {
  AnchorOptions,
  ConfigPatch,
  Constraints,
  DropZone,
  Layer,
  LayoutSpec,
  Mode,
  Placement,
  Role,
  Rule,
} from "./state.mjs";

/** Fields any command may carry: the manager reads them, `update` ignores them. */
export interface CommandMeta {
  /** Commands with the same token in a row form one history step and one log entry (a drag). */
  gesture?: string;
  /** Commit the render at once, never inside a view transition. */
  immediate?: boolean;
}

// ------------------------------------------------------------------ windows: lifecycle and focus

export interface WindowCreate extends CommandMeta {
  type: "window/create";
  id: string;
  title?: string;
  role?: Role;
  parent?: string | null;
  modal?: boolean;
  mode?: Mode;
  placement?: Partial<Placement>;
  constraints?: Constraints;
  layer?: Layer;
  anchor?: AnchorOptions | null;
  /** Default: the parent's workspace, else the active one. */
  workspace?: string;
  data?: unknown;
  draggable?: boolean;
  /** An application or window-class id, matched by rules. */
  app?: string;
  /** `false` creates the window without focusing it. */
  focus?: boolean;
}
export interface WindowClose extends CommandMeta {
  type: "window/close";
  id: string;
}
export interface WindowFocus extends CommandMeta {
  type: "window/focus";
  id: string;
}
export interface WindowBlur extends CommandMeta {
  type: "window/blur";
}
export interface FocusNext extends CommandMeta {
  type: "focus/next";
}
export interface FocusPrevious extends CommandMeta {
  type: "focus/previous";
}
export interface FocusUrgent extends CommandMeta {
  type: "focus/urgent";
}
export interface WindowSetUrgent extends CommandMeta {
  type: "window/set-urgent";
  id: string;
  /** Default `true`. */
  urgent?: boolean;
}

// ------------------------------------------------------------------ stacking

export interface WindowRaise extends CommandMeta {
  type: "window/raise";
  id: string;
}
export interface WindowLower extends CommandMeta {
  type: "window/lower";
  id: string;
}
export interface WindowSetLayer extends CommandMeta {
  type: "window/set-layer";
  id: string;
  layer: Layer;
}

// ------------------------------------------------------------------ geometry and mode

export interface WindowMove extends CommandMeta {
  type: "window/move";
  id: string;
  /** Pixels or `"center"`. Under `rtl` `x` is measured from the right edge. */
  x?: number | "center";
  y?: number | "center";
}
export interface WindowResize extends CommandMeta {
  type: "window/resize";
  id: string;
  width?: number;
  height?: number;
  x?: number | "center";
  y?: number | "center";
}
export interface WindowSetMode extends CommandMeta {
  type: "window/set-mode";
  id: string;
  mode: Mode;
}
export interface WindowDetach extends CommandMeta {
  type: "window/detach";
  id: string;
  x?: number | "center";
  y?: number | "center";
  width?: number;
  height?: number;
}
export interface WindowToggleFloating extends CommandMeta {
  type: "window/toggle-floating";
  id: string;
}
export interface WindowSetConstraints extends CommandMeta {
  type: "window/set-constraints";
  id: string;
  /** Merged into the window's constraints; `undefined`/`null` clears a key. */
  constraints: { [K in keyof Constraints]?: Constraints[K] | null };
}

// ------------------------------------------------------------------ status

export interface WindowMinimize extends CommandMeta {
  type: "window/minimize";
  id: string;
}
export interface WindowMaximize extends CommandMeta {
  type: "window/maximize";
  id: string;
}
export interface WindowFullscreen extends CommandMeta {
  type: "window/fullscreen";
  id: string;
}
export interface WindowRestore extends CommandMeta {
  type: "window/restore";
  id: string;
}
export interface WindowToggleMaximize extends CommandMeta {
  type: "window/toggle-maximize";
  id: string;
}
export interface WindowToggleFullscreen extends CommandMeta {
  type: "window/toggle-fullscreen";
  id: string;
}
export interface WindowPopOut extends CommandMeta {
  type: "window/pop-out";
  id: string;
}
export interface WindowPopIn extends CommandMeta {
  type: "window/pop-in";
  id: string;
}

// ------------------------------------------------------------------ properties

export interface WindowSetTitle extends CommandMeta {
  type: "window/set-title";
  id: string;
  title: string;
}
export interface WindowSetDraggable extends CommandMeta {
  type: "window/set-draggable";
  id: string;
  /** Anything but `false` means draggable. */
  draggable?: boolean;
}
export interface WindowSetSticky extends CommandMeta {
  type: "window/set-sticky";
  id: string;
  /** Default `true`. */
  sticky?: boolean;
}
export interface WindowToggleSticky extends CommandMeta {
  type: "window/toggle-sticky";
  id: string;
}

// ------------------------------------------------------------------ order within a layout

export interface WindowSwap extends CommandMeta {
  type: "window/swap";
  id: string;
  target: string;
}
export interface WindowPromote extends CommandMeta {
  type: "window/promote";
  id: string;
}
export interface WindowDrop extends CommandMeta {
  type: "window/drop";
  id: string;
  target: string;
  /** The screen side the pointer is on (mirrored in a right-to-left stage). */
  zone: DropZone;
  /** Estimated slot sizes after the drop, for `config.drag.tooSmall: "reject"`. */
  geometry?: Record<string, { width: number; height: number }>;
}
export interface WindowSwapNext extends CommandMeta {
  type: "window/swap-next";
  /** Default: the focused window. */
  id?: string;
}
export interface WindowSwapPrevious extends CommandMeta {
  type: "window/swap-previous";
  id?: string;
}
export interface WindowMoveBefore extends CommandMeta {
  type: "window/move-before";
  id?: string;
  /** Default: the previous window in layout order. */
  target?: string;
}
export interface WindowMoveAfter extends CommandMeta {
  type: "window/move-after";
  id?: string;
  /** Default: the next window in layout order. */
  target?: string;
}

// ------------------------------------------------------------------ workspaces and the scratchpad

export interface WindowMoveToWorkspace extends CommandMeta {
  type: "window/move-to-workspace";
  id: string;
  workspace: string;
  /** Also activate the workspace and focus the window. */
  follow?: boolean;
}
export interface WindowToScratchpad extends CommandMeta {
  type: "window/to-scratchpad";
  id: string;
}
export interface ScratchpadToggle extends CommandMeta {
  type: "scratchpad/toggle";
  /** Default: the last scratchpad window used. */
  id?: string;
}
export interface WindowFromScratchpad extends CommandMeta {
  type: "window/from-scratchpad";
  id: string;
}
export interface WorkspaceCreate extends CommandMeta {
  type: "workspace/create";
  id: string;
  /** Default: a copy of the active workspace's layout (without its tree or sizes). */
  layout?: LayoutSpec;
  /** Default: the focused output. */
  output?: string;
  activate?: boolean;
}
export interface WorkspaceActivate extends CommandMeta {
  type: "workspace/activate";
  id: string;
}
export interface WorkspaceRemove extends CommandMeta {
  type: "workspace/remove";
  id: string;
  /** Where its windows go. Default: another workspace on the same output. */
  fallback?: string;
}
export interface WorkspaceRename extends CommandMeta {
  type: "workspace/rename";
  id: string;
  to: string;
}
export interface WorkspaceReorder extends CommandMeta {
  type: "workspace/reorder";
  id: string;
  index: number;
}
export interface WorkspaceMoveToOutput extends CommandMeta {
  type: "workspace/move-to-output";
  id: string;
  output: string;
  activate?: boolean;
}

// ------------------------------------------------------------------ outputs

export interface OutputCreate extends CommandMeta {
  type: "output/create";
  id: string;
  /** Workspace ids or `{ id, layout }` objects. Default `["<id>-1"]`. */
  workspaces?: Array<string | { id: string; layout?: LayoutSpec }>;
  focus?: boolean;
}
export interface OutputRemove extends CommandMeta {
  type: "output/remove";
  id: string;
  /** Where its workspaces go. Default: another output. */
  fallback?: string;
}
export interface OutputFocus extends CommandMeta {
  type: "output/focus";
  id: string;
}
export interface OutputReorder extends CommandMeta {
  type: "output/reorder";
  id: string;
  index: number;
}

// ------------------------------------------------------------------ layout

export interface LayoutSet extends CommandMeta {
  type: "layout/set";
  layout: LayoutSpec;
  /** Default: the active workspace. */
  workspace?: string;
}
export interface LayoutToTree extends CommandMeta {
  type: "layout/to-tree";
  workspace?: string;
}
export interface LayoutSetRatio extends CommandMeta {
  type: "layout/set-ratio";
  ratio: number;
  workspace?: string;
  /** For BSP: the window whose containing split is resized. */
  id?: string;
}
export interface LayoutRotateSplit extends CommandMeta {
  type: "layout/rotate-split";
  workspace?: string;
  id?: string;
}
export interface LayoutResizeSplit extends CommandMeta {
  type: "layout/resize-split";
  workspace?: string;
  /** Which split: `""` is the root (see "Split sizing"). */
  path?: string;
  /** For `delta`: the pair `index`/`index + 1` is nudged. */
  index?: number;
  /** Move the divider by this share of the pair's total weight. */
  delta?: number;
  /** Set the weights outright (one per child, or `[a, b]` for a pair). */
  weights?: number[];
}
export interface LayoutToggle extends CommandMeta {
  type: "layout/toggle";
  /** Default: the stored pair, or the current layout. */
  a?: LayoutSpec;
  b?: LayoutSpec;
  workspace?: string;
}

// ------------------------------------------------------------------ configuration

/** `config/set` takes the patch as the command's own fields. */
export interface ConfigSet extends CommandMeta, ConfigPatch {
  type: "config/set";
}
export interface RulesSet extends CommandMeta {
  type: "rules/set";
  rules: Rule[];
}

// ------------------------------------------------------------------ the union

/** Every built-in command. Narrow it with `switch (command.type)`. */
export type Command =
  | WindowCreate
  | WindowClose
  | WindowFocus
  | WindowBlur
  | FocusNext
  | FocusPrevious
  | FocusUrgent
  | WindowSetUrgent
  | WindowRaise
  | WindowLower
  | WindowSetLayer
  | WindowMove
  | WindowResize
  | WindowSetMode
  | WindowDetach
  | WindowToggleFloating
  | WindowSetConstraints
  | WindowMinimize
  | WindowMaximize
  | WindowFullscreen
  | WindowRestore
  | WindowToggleMaximize
  | WindowToggleFullscreen
  | WindowPopOut
  | WindowPopIn
  | WindowSetTitle
  | WindowSetDraggable
  | WindowSetSticky
  | WindowToggleSticky
  | WindowSwap
  | WindowPromote
  | WindowDrop
  | WindowSwapNext
  | WindowSwapPrevious
  | WindowMoveBefore
  | WindowMoveAfter
  | WindowMoveToWorkspace
  | WindowToScratchpad
  | ScratchpadToggle
  | WindowFromScratchpad
  | WorkspaceCreate
  | WorkspaceActivate
  | WorkspaceRemove
  | WorkspaceRename
  | WorkspaceReorder
  | WorkspaceMoveToOutput
  | OutputCreate
  | OutputRemove
  | OutputFocus
  | OutputReorder
  | LayoutSet
  | LayoutToTree
  | LayoutSetRatio
  | LayoutRotateSplit
  | LayoutResizeSplit
  | LayoutToggle
  | ConfigSet
  | RulesSet;

/** The command type strings (`COMMANDS` at runtime). */
export type CommandType = Command["type"];

/** The command with a given type: `CommandOf<"window/close">`. */
export type CommandOf<T extends CommandType> = Extract<Command, { type: T }>;

/** A command no built-in handler knows: allowed only together with the `extensions` that handle it. */
export interface CustomCommand extends CommandMeta {
  type: string;
  [field: string]: unknown;
}

