import type { LayoutNode } from "../types/tree.mjs";
import type { CompileOptions, PresentationContext, RenderNode } from "../types/render.mjs";

export type { CompileOptions, PresentationContext, RenderNode } from "../types/render.mjs";

/** A theme token's entry in `THEME_TOKENS`. */
export interface ThemeToken {
  description: string;
  light: string;
  dark: string;
  /** Values under `prefers-contrast: more`, per scheme; absent means the scheme value stands. */
  hc?: { light: string; dark: string };
}

/** Numbers become `px`; strings pass through. */
export function px(value: number): string;
export function px<T extends string>(value: T): T;
export function px(value: number | string): string;

/** A CSS dashed-ident for anchoring against a view id (`--wm-<id>`). */
export function anchorName(id: string): string;

/** A grid track option as `grid-template-*` syntax. */
export function tracks(value: number | Array<number | string> | { repeat?: string; min?: number | string; max?: number | string } | string | null | undefined): string | undefined;

/** Compile a layout tree into a render tree. CSS (flex, grid, anchor positioning, container queries) is the solver. */
export function compile(tree: LayoutNode, context?: PresentationContext, options?: CompileOptions): RenderNode;

/** Serialize a style object to a declaration string. */
export function styleText(style: Record<string, string | undefined | null>): string;

/** Render a render tree to an HTML string; `slot(viewId)` may return inner HTML for a view. */
export function toHTML(renderNode: RenderNode, options?: { slot?: (viewId: string) => string | undefined; indent?: string }): string;

/** DOM id of a tab button (page-scoped). */
export function tabId(id: string): string;
/** DOM id of a window's panel (page-scoped). */
export function panelId(id: string): string;

/** Default thickness (px) of a rendered splitter. */
export const SPLITTER_SIZE: number;

/** The default theme: the `--wa-*` tokens for light, dark and `prefers-contrast: more`. */
export const THEME_CSS: string;
/** The rules that read the tokens: sizing, chrome, focus ring, splitters, drag preview, touch. */
export const RULES_CSS: string;
/** The window chrome rules (title bar, buttons, grips); already inside `RULES_CSS`. */
export const CHROME_CSS: string;
/** `THEME_CSS` followed by `RULES_CSS`. */
export const BASE_CSS: string;
/** Every theme token with its description and light, dark and high-contrast values. */
export const THEME_TOKENS: Readonly<Record<`--wa-${string}`, ThemeToken>>;
