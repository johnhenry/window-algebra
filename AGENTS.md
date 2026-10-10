# Agent playbook

`@johnhenry/window-algebra` is a functional window manager for the browser: a pure core (`update` → `derive` → `compile`), a layout algebra, and an effectful DOM edge (`src/browser/`). Single package, Node >= 26, `node:test` (`npm test`), zero dependencies; it ships source and has no build step. Everything under `src/` except `src/browser/` and `src/bindings/` is pure and tested in plain Node. The browser code is tested against a fake DOM (`test/helpers/fake-dom.mjs`), and the demos in `demo/` are the only real-browser check.

`CLAUDE.md` in this directory is a symlink to this file.

## The verification loop (before every push)

1. `npm test`: currently 1057 tests, **0 skipped**. Nothing in this suite skips, so a skip count above 0 means something is wrong.
2. `npm run examples`: six self-verifying scripts (`examples/NN-*.mjs`), each exiting non-zero on failure. `npm run test:types`: `tsc --noEmit` over `test/types/usage.mts` (its `@ts-expect-error` lines must fail to compile).
3. `npm pack --dry-run`: read the file list. Only `src/` (which holds the hand-written `.d.mts` declarations), `README.md`, `LICENSE` and `package.json` should ship; no `demo/`, `test/`, `docs/` or `examples/`.
4. A genuinely fresh clone: `git clone . /tmp/window-algebra-verifyN && cd $_ && npm ci && npm test && npm run examples`.
5. `npm run test:browser`: Playwright drives the demo pages in Chromium, Firefox and WebKit (`e2e/`, served by `e2e/serve.mjs`), including an axe-core scan of every demo page (no serious or critical violations). Locally pick engines with `--project=chromium`. `npm run bench` prints non-gating performance numbers.
   Also before a push that touches `src/`: `npm run size` (budgets) and `npx jsr publish --dry-run --allow-dirty` (JSR readiness); both are CI jobs.
6. For anything in `src/browser/`, `src/css/` or `demo/`: serve the repo root (`python3 -m http.server`), open `/demo/`, and exercise the page that covers the change (the hub's checklist says which).
7. Commit and push, then close the issue with a comment naming the commit SHA.

CI (`.github/workflows/ci.yml`) calls the family's reusable `johnhenry/workflows/.github/workflows/ci.yml@v1` for the Node 26 gate (`npm ci`, `npm test`, `npm run examples`, `npm run test:types`, `npm pack --dry-run`) and keeps four local jobs: `browser` (Playwright on all three engines plus the axe scan), `size`, `jsr` and `bench` (below). Match it locally. Node 24 also passes the suite, but `engines` stays at the family floor of 26; don't lower it to match a local install.

## Repo-specific gotchas

- **Never make a modal-blocked view itself `inert`, only its contents.** Inert elements are skipped by hit-testing, so a click on a blocked window fell through to (and raised) the window underneath (4bbcc08). `compile` marks `data-wm-blocked`; `dom.mjs` `syncBlocked` inerts the children.
- **Don't capture the pointer when the press is on a control inside a drag handle.** A title bar's close/minimize buttons never fired on floating windows, because the move gesture captured the pointer and retargeted `pointerup`/`click` (4bbcc08). See `INTERACTIVE` in `input.mjs`.
- **Paint order is not `state.stack` order.** Tiled windows paint above the `background` layer and beneath everything else (4bbcc08). Use `paintOrder`/`inTiledBase`, never raw `stackingOrder`, for anything visual.
- **Keyboard focus and WM focus are two things kept in sync.** `attachInput` needs `subscribe` (or `wm`) to move DOM focus after a command-driven focus, and it must never steal focus from a text field outside `root` (f6fc3a8). Tests use the fake DOM's `activeElement`.
- **A stateful layout needs a branch everywhere BSP has one.** `swapWindows`, `neighbourOrder` and `moveRelative` in `state/drops.mjs` special-cased only `bsp`, so tree workspaces emitted swap events while nothing moved (067191b). Grep for `"bsp"` when adding a layout.
- **Browser-side code must resolve its own stage's workspace, not `state.activeWorkspace`.** With multiple outputs, splitters and the drag ghost acted on the focused output's workspace (2cfbc90). Use `outputActiveWorkspace(state, output)`.
- **`config.snap` may be missing on a loaded version-1 state** (no migration backfills it; deliberate, see `docs/api/versioning.md`). Read `{ ...DEFAULT_CONFIG.snap, ...state.config.snap }`, as `input.mjs` does (f234a67).
- **Browsers cache ES modules aggressively.** When checking a `src/` change in a demo, hard-reload with the cache disabled, or you will be looking at the old module. A background tab also never runs `requestAnimationFrame`, and `createFrameScheduler` commits on it, so a hidden tab looks frozen.
- **The chrome's scrollable-body check cannot rely on box changes alone.** Rows added inside a child of fixed height (`height: 100%`) grow the body's scrollable overflow without resizing the body or any of its children, so a ResizeObserver never fires; `chrome.mjs` also watches the body's subtree with a MutationObserver (frame-coalesced). `e2e/chrome.spec.mjs` adds content in steps in five shapes on all three engines.
- **The React stage host needs a height** (7f01c31); a bare `div` collapses the stage to 0 px.

## Size budgets, bench baseline and JSR (CI)

**Size budgets** (`npm run size`, `scripts/size.mjs`, limits in `size-budgets.json`; CI job `size`, gating). Each `exports` entry is bundled with esbuild (devDependency; minified ESM, whole import graph, nothing external, as a no-build page would load it) and its gzip size is compared with the budget; the packed tarball (`npm pack --dry-run --json`) has budgets for packed size, unpacked size and file count. Numbers at 0.0.0 (gzip bytes): `.` 37921, `./browser` 53878, `./algebra` 1259, `./transforms` 1290, `./layouts` 3781, `./css` 8442, `./react` 56418, `./element` 56259; tarball 181335 packed, 632266 unpacked, 57 files. Budgets sit about 15% above those (`.` 44000, `./browser` 62000, `./algebra` 1500, `./transforms` 1500, `./layouts` 4500, `./css` 10000, `./react` 65000, `./element` 65000; tarball 210000 / 730000 / 62 files). `./react` and `./element` include the browser adapters, which is why they are large. When a budget fails, find out why the bundle grew before raising the number; raise it in the same commit as a deliberate, explained feature, and update the figures here. Adding an `exports` entry fails the job until it has a budget (it is reported without a limit; add one).

**Bench** (CI job `bench`, `continue-on-error`, never gating). `node bench/run.mjs --json --browsers=chromium` runs on CI, the JSON is uploaded as the `bench-results` artifact (30 days), and `bench/compare.mjs` compares it with the committed `bench/baseline.json`: throughput that is more than 3x lower, or a time that is more than 3x higher, prints a `::warning::` annotation and a table in the job summary. The threshold is generous because shared runners are noisy (a laptop run varies about 2x between runs); it catches order-of-magnitude regressions only. To refresh the baseline, download the `bench-results` artifact from a green `main` run and commit it as `bench/baseline.json` (a baseline from CI hardware is the useful one; the first one committed was measured locally on a Mac, so expect the CI numbers to look different). `node bench/compare.mjs a.json b.json --factor=2` also works locally.

**JSR (prepare only; nothing is published).** `jsr.json` names `@johnhenry/window-algebra`, 0.0.0, with `exports` mirroring `package.json` (minus `./package.json`) and `publish.include` of `src/**/*.mjs`, `src/**/*.d.mts`, `README.md`, `LICENSE`, `jsr.json`. JSR has no way to read `types` conditions from package.json, so each JS entry file starts with `// @ts-self-types="./<entry>.d.mts"` pointing at its sibling declaration file (`src/index.mjs`, `src/browser/index.mjs`, `src/algebra/nodes.mjs`, `src/algebra/transforms.mjs`, `src/layouts/index.mjs`, `src/css/compile.mjs`, `src/bindings/react.mjs`, `src/bindings/element.mjs`). A new entry needs its `exports` line in both manifests and that comment. CI job `jsr` runs `npx jsr publish --dry-run` (add `--allow-dirty` locally); it must pass. Keep `version` in `jsr.json` in step with `package.json` when a release bumps it. **Creating the JSR package is a manual browser step for the owner** (jsr.io/new, signed in as the `johnhenry` GitHub account; there is no CLI or API for it), then linking the package to this repository in its settings so CI can publish by OIDC with no token. See `~/Projects/@johnhenry/ecosystem/jsr-packages/README.md` (`request-jsr-package.mjs --scope johnhenry --repo johnhenry/window-algebra --packages window-algebra`). Until then no workflow publishes to JSR.

## Definition of done

A change is done when all of the following hold, not just when tests pass:

- A regression test exists for any bug fixed (`test/regressions.test.mjs` or the feature's own file).
- New commands, events, config keys, options or exports are in `docs/api/` **and in the `.d.mts` declarations** (`src/types/commands.d.mts`, `events.d.mts`, `state.d.mts`, the entry point's own file; `test/types.test.mjs` fails when they drift), (commands must match `COMMANDS`; each has payload, events, effects and rejections), and the README overview still links to them.
- Anything the feature does **not** do is stated in the README's `## Honest limitations` or the reference page.
- `CHANGELOG.md` has an entry citing the commit.
- Browser-facing features appear on a demo page and in the capability checklist (`demo/shared/coverage.mjs`). State-shape changes bump `STATE_VERSION` with a migration and a test (see `docs/api/versioning.md`).

## Non-goals

Replacing an operating-system window manager or compositor, and multi-user collaborative synchronization (cross-tab sync of one user's tabs exists, `attachSync`; merging concurrent edits between users does not). See `docs/PRD.md`, "Non-goals". A runtime dependency is also a non-goal: bindings take React as an argument rather than importing it.

## Releases

Bump `version` in `package.json` in a PR, add the `CHANGELOG.md` entry, merge, then `gh release create v<version>`. The release event triggers `.github/workflows/publish.yml`, which runs the full gate (tests, examples, types and the three-engine browser suite), skips if the version is already on npm, and publishes with `--provenance --access public`. It needs a scope-capable `NPM_TOKEN` secret, and `repository.url` must match the publishing repo for provenance.

### Publish workflow

`.github/workflows/publish.yml` calls `johnhenry/workflows/.github/workflows/npm-publish.yml@v1` with `secrets: inherit` and `id-token: write` on the caller job. Triggers: `release: published`, a redundant `push: tags: ["v*"]` (a release created soon after a push can drop the release event; the `npm view` guard makes a double fire a no-op), and `workflow_dispatch`. The gate runs inside the reusable workflow: `npx playwright install --with-deps`, `npm test`, `npm run examples`, `npm run test:types`, `npm run test:browser` (all three engines plus axe). The reusable workflow then runs the `npm view <name>@<version>` guard (a 404 for a never-published package is non-zero, which means "publish") and `npm publish --provenance --access public`.

### First release checklist (nothing has been published yet; the first release is `0.0.0`)

1. `npm view @johnhenry/window-algebra` returns 404 today; that is expected. Confirm the `@johnhenry` npm scope is the maintainer's and that the `NPM_TOKEN` repo secret exists and can create a new public scoped package (`gh api repos/johnhenry/window-algebra/actions/secrets`).
2. No bump: the first release is `0.0.0` itself (family convention: a new `@johnhenry/*` address starts at 0.0.0), and `CHANGELOG.md` already has its dated `## 0.0.0` entry. Add anything merged since to that entry and make sure `main` is green.
3. Run the whole loop above, then `npm pack --dry-run` and `npm publish --dry-run` (no token needed; the 57-file list must hold `src/` including every `.d.mts`, plus `README.md`, `LICENSE`, `package.json`; no `demo/`, `test/`, `e2e/`, `docs/`, `examples/`, `.env`).
4. `repository.url` must stay `git+https://github.com/johnhenry/window-algebra.git` (provenance compares it to the publishing repo); `homepage` is `https://opensource.johnhenry.me/window-algebra/`, which must be live (docs section on the opensource site) before announcing.
5. `gh release create v0.0.0`. Both the release and the `v*` tag trigger the publish; a same-second second run may show a red `403 cannot publish over` on the losing trigger. That is expected; confirm with an anonymous `npm view @johnhenry/window-algebra version`.
6. Afterwards: check the provenance badge on npmjs.com, and install the tarball into a scratch project to import each `exports` entry and its types.
