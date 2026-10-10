/** The compiler's output: a plain description of elements, attributes and CSS declarations. */
import type { Bounds, Direction } from "./state.mjs";

/** A render node. Views carry `view` and `primary`; text-only nodes (a tab button) carry `text`. */
export interface RenderNode {
  tag: string;
  key: string;
  attrs: Record<string, string>;
  /** kebab-case CSS properties. */
  style: Record<string, string>;
  children: RenderNode[];
  /** The window id, for a `wm-view`. */
  view?: string;
  /** `true` for the first occurrence of a view (it gets the surface); later ones are projections. */
  primary?: boolean;
  text?: string;
}

/** What `compile` needs besides the tree (see `presentationContext(state)`). */
export interface PresentationContext {
  /** `"rtl"` puts `dir="rtl"` on the root and mirrors placements and anchors. Default `"ltr"`. */
  direction?: Direction;
  /** `"none"` (an unbounded canvas) marks the root `data-wm-bounds="none"` and lets it overflow. Default `"stage"`. */
  bounds?: Bounds;
  focused?: string | null;
  blocked?: string[];
  titles?: Record<string, string>;
  modes?: Record<string, string>;
  /** Non-`"normal"` statuses only (maximized, minimized, fullscreen, popped-out): written as `data-status`. */
  statuses?: Record<string, string>;
  roles?: Record<string, string>;
  pinned?: string[];
  sticky?: string[];
  scratchpad?: string[];
  /** Ids currently marked urgent. */
  urgent?: string[];
  /** Ids of windows that are modal dialogs. */
  modal?: string[];
}

export interface CompileOptions {
  /** The key of the root element (default `"root"`). */
  key?: string;
}
