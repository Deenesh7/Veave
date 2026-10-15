# Container Runner

Build from `backend`: `npm run runner:build` (image `veave-validator:1`).
The image pins both the Playwright browser image and npm library to **1.58.2**.
It runs as `pwuser`; `/runner` and `/opt/veave-runner` are not writable by that user.
The backend does not need to be copied into the image.

## Integration Contract

Use a new disposable `/workspace` for each project. Make the project and any
mounted workspace/volume writable by `pwuser` (UID 1000 in the base image).
An optional `/runner` bind mount must be read-only and contain these trusted
runner files, never project-provided files. The image also includes the runner.

1. Mount validated source read-only at `/input` and a disposable writable volume at `/workspace`. Run the image with argument `install`; it copies the source into the volume. This performs `npm ci` when
   `package-lock.json` exists, otherwise `npm install`, always with
   `--ignore-scripts --no-audit --no-fund --include=dev`. It then runs `npm ls --all --json`.
2. Persist that workspace, including `node_modules` and the generated lockfile.
3. Run a **new container with `--network none`** and argument `validate`.
   It checks dependencies, validates an optional plan, parses all JS/JSX/TS/TSX
   sources with pinned Babel parser 7.29.9 (including unimported modules), runs installed
   `tsc --noEmit` if `tsconfig.json` exists, runs `npm run build`, starts
   `npm run preview -- --host 127.0.0.1 --port 4173 --strictPort`, and tests it.
   There is no dev-server or static-server fallback.
4. Accept only a complete successful result plus exit code 0. Install success
   is **not** build/browser success. Missing, duplicate, malformed or oversized
   results, nonzero exit, timeout, cancellation, and container failure must fail closed.

The orchestrator places installation on an internal Docker network and supplies
`registryProxy.cjs` as its only download proxy. It permits CONNECT to
`registry.npmjs.org:443` only. This worker itself is **not** an egress firewall for npm.
Do not use unrestricted host networking or pass backend environment variables,
credentials, Docker sockets, host directories, or cloud metadata access.
Project `.npmrc` and `npm-shrinkwrap.json` are rejected. npm dependency lifecycle
scripts are disabled during installation. The real build/preview scripts and their pre/post hooks execute inside the network-disabled validation container.
Project scripts receive a small fixed environment, not the backend environment.
Do not pass credentials to the worker itself either.

The parent must enforce a hard container deadline (suggested install 330s,
validate 480s), CPU/memory/PID limits, `--cap-drop ALL`,
`--security-opt no-new-privileges`, and no published ports. Allow adequate shared
memory for Chromium. Chromium keeps Playwright's default container launch policy;
the disposable container, not the browser sandbox, is the security boundary.
Use a read-only container root filesystem with writable workspace and `/tmp`
where supported. Terminate/remove the entire container at completion, even if a
project process escaped the worker's process-group cleanup.

## Output Protocol

Stdout contains one JSON object per prefixed line:

```text
VEAVE_EVENT {"stage":"build","status":"running"}
VEAVE_EVENT {"stage":"build","status":"passed"}
VEAVE_RESULT {"ok":true,"diagnostics":[],"checks":[],"coverage":{},"artifacts":[{"path":"dist/index.html","content":"...base64..."}],"lockfile":"...JSON text..."}
```

Events have `stage` and `status` (`running`, `passed`, `failed`). Result diagnostics
always have `{category,path,line,column,message}`; unknown locations are null.
Browser exceptions retain full stacks, and failed commands include their captured
output. Browser diagnostic messages over 64 KiB are explicitly truncated.
Child stdout/stderr is captured, never forwarded as protocol lines, so
printing `VEAVE_RESULT` from a project script does not create a result event.
The protocol is framing, not an attestation of malicious same-container code;
validate all paths, sizes and schemas in the parent.

`checks` are objects with `name`, `status` and optional contextual fields.
`coverage` describes viewports, limits, visited routes, controls exercised,
planned scenarios and skips. It explicitly states non-exhaustive coverage.
All external HTTP requests, including GET and mutations, and external WebSockets
are blocked and fail validation. Same-origin requests and data/blob resources
are allowed. Service workers are disabled. External anchors are not followed and
are reported as skipped; an external resource actually requested is a failure.
There is no external allowlist: supply local mocks instead.
HTTP redirects are fetched without following them and blocked (including local
redirects), preventing redirect chains from escaping request interception. Use
direct local URLs in fixtures. Preview readiness must serve the exact built
`dist/index.html`, and artifact hashes must remain unchanged during validation.

## Screenshot Comparison

Screenshot jobs mount one backend-validated PNG, JPEG, or WebP reference read-only
at `/reference/reference-image`. The project workspace cannot access or replace
this acceptance input. The runner renders `/` at the reference image dimensions,
disables CSS animations/transitions, captures the actual Chromium viewport, and
compares downsampled, lightly blurred RGB pixels to reduce font-rasterization noise.
The result includes a global score, threshold, image hashes, viewport, and the
three lowest-scoring page regions. A score below the threshold is a `visual`
diagnostic and fails the browser stage so the normal bounded repair loop runs.

Set `SCREENSHOT_VISUAL_THRESHOLD` on the backend to a value from `0.5` to `0.99`;
the default is `0.82`. Screenshot jobs always require the Docker runner and block
rather than being labeled verified when it is unavailable.

Install returns an empty artifact list and lockfile text. Validation returns
base64-encoded files with paths rooted at `dist/` only on success. Failures return
no artifacts; `lockfile` is an empty string if no lockfile was read successfully.
No build/preview script, absent output, symlinks/special files,
missing installed TypeScript, and exceeding a resource limit are failures, not
successful skips. Type checks are `not-applicable` only without `tsconfig.json`;
the required real build still performs source syntax checking.

Limits: each command captures at most 1 MiB; install 240s, dependency inspection
30s, TypeScript 60s, build 120s, preview lifetime 180s/readiness 30s, browser 90s.
Browser cleanup has a further 5s deadline and fails closed if it expires.
Artifacts are at most 5 MiB, 2000 entries, depth 20; lockfile at most 8 MiB.
The syntax scan excludes `node_modules`, `dist` and `.git`, rejects source
symlinks/special files, and permits 4000 tree entries, depth 20, 2 MiB/source file
and 16 MiB total source, with at most 100 syntax errors.
The final protocol line can be large due to base64; the parent enforces a 20 MiB
total output limit. Never log artifact
contents directly. Browser diagnostics are capped at 200 plus an overflow error.

## Optional Test Plan

`/workspace/veave.validation.json` is strict JSON, at most 128 KiB:

```json
{
  "version": 1,
  "tests": [
    {
      "name": "Search products",
      "path": "/",
      "viewports": ["desktop", "mobile"],
      "steps": [
        { "action": "fill", "selector": "input[type=search]", "value": "shoes" },
        { "action": "click", "selector": "button[type=submit]" },
        { "action": "assert", "selector": "#results", "text": "shoes", "visible": true }
      ]
    }
  ]
}
```

Actions are `click`, `fill` (string `value`), `select` (option string `value`),
`check` (boolean `checked`), and `assert` (string `text` and/or boolean `visible`).
Text assertions use Playwright's retrying `toContainText`; selectors use
Playwright locators and must be unambiguous for actions/assertions. Hidden
assertions can match an absent element. No JavaScript, evaluation, arbitrary
requests, or arbitrary action names are supported. Unknown fields are rejected.
Every test needs a unique name, nonempty steps and at least one assertion.
Paths are local absolute paths; omitted path is `/`, omitted viewports means both.
Limits are 20 tests, 50 steps/test, 200 total steps. Every scenario has a fresh
browser context, but server-side application state is not reset between tests.

Generic smoke visits at most 6 discovered anchor routes and exercises at most
12 controls per viewport. It fills text fields, searches with Enter, changes
select options, and clicks buttons, tabs, toggles, menu items and form submits.
It does not infer business expectations or guarantee all state combinations.
Use a plan for ordered workflows and expected outcomes. Desktop is 1440x900;
mobile is 390x844 with mobile/touch enabled. Smoke checks startup and post-action
visible root content, uncaught errors, console errors, failed requests and
HTTP >=400 responses across all pages in the browser context.

## Tests

From `backend`, with Playwright 1.58.2 and its Chromium installed:

```sh
node --test test/browserValidation.test.js
```

Tests require the backend's Playwright dependency directly; there is no silent
skip when Playwright or the browser is unavailable. Trusted local HTTP fixtures
exercise real Chromium; no generated project code or Docker daemon is needed.
