import { test } from "node:test";
import assert from "node:assert/strict";
import { CHROME_CSS } from "../src/index.mjs";

// An application that hides the title bar of some windows (a tiled window that has its own header, say) with
// `display: none` on `.wa-chrome-bar` leaves `.wa-chrome` (`grid-template-rows: auto minmax(0, 1fr)`) with one
// in-flow child. Auto-placement then puts the body in row 1, the `auto` row, so it is sized by its content and the
// window's body no longer fills the window. Pinning the body to row 2 keeps it in the `1fr` row whether or not
// the bar is rendered.
test("the chrome body is pinned to the 1fr row, so a hidden title bar does not hand it the auto row", () => {
  assert.match(CHROME_CSS, /\.wa-chrome-body\s*\{[^}]*grid-row:\s*2/);
});
