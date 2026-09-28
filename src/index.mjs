// Layout algebra: primitives
export {
  view,
  row,
  column,
  grid,
  stack,
  overlay,
  place,
  size,
  gap,
  inset,
  anchor,
  container,
  modifier,
  isNode,
  isContainer,
  isModifier,
  isView,
  validate,
  fromJSON,
  NODE_KINDS,
  CONTAINER_KINDS,
  MODIFIER_KINDS,
} from "./algebra/nodes.mjs";

// Layout algebra: tree transformations
export {
  transform,
  walk,
  fold,
  views,
  find,
  mapViews,
  replace,
  remove,
  mirror,
  flip,
  rotate,
  reverse,
  swap,
  count,
  equals,
} from "./algebra/transforms.mjs";

// Derived layouts (sugar over the primitives)
export * from "./layouts/index.mjs";

// Geometry and interaction (pure)
export * as geometry from "./geometry/rect.mjs";
export { positionPopup, SIDES as POPUP_SIDES } from "./geometry/positioner.mjs";
export { createDrag, updateDrag, createResize, updateResize, updateRatio, EDGES } from "./interaction/drag.mjs";
export { dropZoneAt, dropTargetAt, previewDrop, zoneRect } from "./interaction/drop.mjs";

// Logical state: update / derive
export { createState, createWorkspace, createWindowRecord, LAYERS, ROLES, STATUSES, DEFAULT_CONFIG, STATE_VERSION } from "./state/create.mjs";
export { migrate, MIGRATIONS } from "./state/migrate.mjs";
export { update, reduce, replay, COMMANDS } from "./state/update.mjs";
export { derive, presentationContext, LAYOUTS } from "./state/derive.mjs";
export { MODIFIERS, MODIFIER_TYPES, withModifiers, suppressesGaps, applyModifiersToOps, validModifiers } from "./state/modifiers.mjs";
export {
  DROPS,
  DROP_ZONES,
  DRAG_MODES,
  orderDrops,
  createDropHandler,
  dropInterpreterFor,
  dragMode,
  opAllowed,
  tiledOrder,
  isDroppable,
  reorder,
} from "./state/drops.mjs";
export * from "./state/queries.mjs";
export { createHistory, record, undo, redo, canUndo, canRedo } from "./state/history.mjs";

// CSS compilation (pure)
export { compile, toHTML, styleText, tracks, px, anchorName, BASE_CSS, SPLITTER_SIZE } from "./css/compile.mjs";

// Imperative facade
export { createWindowManager } from "./manager.mjs";
