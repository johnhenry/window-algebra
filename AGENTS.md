# Agent playbook

`@johnhenry/window-algebra` is a functional window manager for the browser: a pure core (`update` → `derive` → `compile`), a layout algebra, and an effectful DOM edge (`src/browser/`). Single package, Node >= 26, `node:test` (`npm test`), zero dependencies; it ships source and has no build step. Everything under `src/` except `src/browser/` and `src/bindings/` is pure and tested in plain Node. The browser code is tested against a fake DOM (`test/helpers/fake-dom.mjs`), and the demos in `demo/` are the only real-browser check.

`CLAUDE.md` in this directory is a symlink to this file.

## The verification loop (before every push)

1. `npm test`: currently 785 tests, **0 skipped**. Nothing in this suite skips, so a skip count above 0 means something is wrong.
2. `npm run examples`: six self-verifying scripts (`examples/NN-*.mjs`), each exiting non-zero on failure.
3. `npm pack --dry-run`: read the file list. Only `src/`, `README.md`, `LICENSE` and `package.json` should ship; no `demo/`, `test/`, `docs/` or `examples/`.
4. A genuinely fresh clone: `git clone . /tmp/window-algebra-verifyN && cd $_ && npm ci && npm test && npm run examples`.
5. For anything in `src/browser/`, `src/css/` or `demo/`: serve the repo root (`python3 -m http.server`), open `/demo/`, and exercise the page that covers the change (the hub's checklist says which).
6. Commit and push, then close the issue with a comment naming the commit SHA.

CI (`.github/workflows/ci.yml`) runs `npm ci`, `npm test`, `npm run examples` and `npm pack --dry-run` on Node 26. Match it locally. Node 24 also passes the suite, but `engines` stays at the family floor of 26; don't lower it to match a local install.

## Repo-specific gotchas

- **Never make a modal-blocked view itself `inert`, only its contents.** Inert elements are skipped by hit-testing, so a click on a blocked window fell through to (and raised) the window underneath (4bbcc08). `compile` marks `data-wm-blocked`; `dom.mjs` `syncBlocked` inerts the children.
- **Don't capture the pointer when the press is on a control inside a drag handle.** A title bar's close/minimize buttons never fired on floating windows, because the move gesture captured the pointer and retargeted `pointerup`/`click` (4bbcc08). See `INTERACTIVE` in `input.mjs`.
- **Paint order is not `state.stack` order.** Tiled windows paint above the `background` layer and beneath everything else (4bbcc08). Use `paintOrder`/`inTiledBase`, never raw `stackingOrder`, for anything visual.
- **Keyboard focus and WM focus are two things kept in sync.** `attachInput` needs `subscribe` (or `wm`) to move DOM focus after a command-driven focus, and it must never steal focus from a text field outside `root` (f6fc3a8). Tests use the fake DOM's `activeElement`.
- **A stateful layout needs a branch everywhere BSP has one.** `swapWindows`, `neighbourOrder` and `moveRelative` in `state/drops.mjs` special-cased only `bsp`, so tree workspaces emitted swap events while nothing moved (067191b). Grep for `"bsp"` when adding a layout.
- **Browser-side code must resolve its own stage's workspace, not `state.activeWorkspace`.** With multiple outputs, splitters and the drag ghost acted on the focused output's workspace (2cfbc90). Use `outputActiveWorkspace(state, output)`.
- **`config.snap` may be missing on a loaded version-1 state** (no migration backfills it; deliberate, see `docs/api/versioning.md`). Read `{ ...DEFAULT_CONFIG.snap, ...state.config.snap }`, as `input.mjs` does (f234a67).
- **Browsers cache ES modules aggressively.** When checking a `src/` change in a demo, hard-reload with the cache disabled, or you will be looking at the old module. A background tab also never runs `requestAnimationFrame`, and `createFrameScheduler` commits on it, so a hidden tab looks frozen.
- **The React stage host needs a height** (7f01c31); a bare `div` collapses the stage to 0 px.

## Definition of done

A change is done when all of the following hold, not just when tests pass:

- A regression test exists for any bug fixed (`test/regressions.test.mjs` or the feature's own file).
- New commands, events, config keys, options or exports are in `docs/api/` (commands must match `COMMANDS`; each has payload, events, effects and rejections), and the README overview still links to them.
- Anything the feature does **not** do is stated in the README's `## Honest limitations` or the reference page.
- `CHANGELOG.md` has an entry citing the commit.
- Browser-facing features appear on a demo page and in the capability checklist (`demo/shared/coverage.mjs`). State-shape changes bump `STATE_VERSION` with a migration and a test (see `docs/api/versioning.md`).

## Non-goals

Replacing an operating-system window manager or compositor, and collaborative synchronization (the deterministic command log makes it possible, but it is not built). See `docs/PRD.md`, "Non-goals". A runtime dependency is also a non-goal: bindings take React as an argument rather than importing it.

## Releases

Bump `version` in `package.json` in a PR, add the `CHANGELOG.md` entry, merge, then `gh release create v<version>`. The release event triggers `.github/workflows/publish.yml`, which runs the tests and examples, skips if the version is already on npm, and publishes with `--provenance --access public`. It needs a scope-capable `NPM_TOKEN` secret, and `repository.url` must match the publishing repo for provenance.
