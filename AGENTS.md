# Agent + contributor guide

The working contract for anyone (human or agent) modifying code in this
repo. This file is the canonical entry point — read it first, every time.

## Preflight

Before touching any code, read these in order:

1. `AGENTS.md` (this file) — rules, boundaries, workflow.
2. `README.md` — what this project is and how to run it.
3. `ARCHITECTURE.md` — the layered model and where things live.

Before editing a specific component, also read:

- `packages/core/components/<comp>/SPEC.md` — the component's intent in
  human terms. This is the source of truth for behavior.

If a per-package `AGENTS.md` exists alongside a `package.json`, read it
before editing files in that package — it overrides anything here for
that scope.

## Boundaries

These are not preferences. They are invariants. Violating them breaks
the layered model:

- **Core never imports a substrate.** No React, no React Native, no
  DOM, no `window`, no `document`. `packages/core/*` is pure
  TypeScript. If you reach for a substrate API in `core/`, stop — the
  code belongs in a target.
- **Adapters never reimplement state.** Targets read from the machine
  via the component's connector (e.g. `connectTooltip`). They do not
  fork the state graph, mirror context, or shadow transitions. If a
  target needs new state, the state goes in `core/`.
- **Generated files are never manually edited.** Anything under
  `**/src/generated/` is overwritten by `scripts/build.ts`. To change
  generated output, edit the agnostic source spec (in `core/` or
  `shared/`) and rerun `pnpm codegen`.
- **Substrate quirks live in the target.** Focus traps, escape-key
  listeners, back-button handling, RN gesture quirks — implement them
  in `packages/<target>/components/<comp>/adapter.ts` and plug them in
  via `withAdapter()`. The machine declares the effect by name; the
  target supplies the impl.

## Specs are intent, not API mirrors

`SPEC.md` is the human-readable description of what the component is.
It describes behavior in **human terms**, not in prop names.

- Bad: `openDelay: number — ms before opening (default 400)`
- Good: `Trigger hover continues for the open delay → tooltip opens`

The spec describes _what_ so the doc survives renames and refactors.
SPECs are owned by the human — do not rewrite spec prose unless a
contradiction with code has been flagged and confirmed.

**Behavior described in `SPEC.md` must be covered by automated tests
and verified by manual run.** A behavior in the spec that no test
exercises is a gap; a behavior in code that the spec doesn't describe
is a leak. Reconcile both before merging.

## Workflow

The spec drives the tests; tests are the executable form of the spec;
code is the implementation we check against both. The human orchestrates
the AI.

Before merging, walk this checklist:

1. **Did behavior change?** Update the affected sections of `SPEC.md`.
   A bug fix that restores documented behavior → spec stays, tests
   catch the regression. A new behavior or contract change → spec
   changes too.
2. **Do tests reflect the spec?** A spec without a matching test is a
   gap; a test without a matching spec entry is a leak. Reconcile both.
3. **Did `core/` change?** Verify the change is substrate-agnostic. If
   it depends on a React lifecycle, a DOM API, or an RN-only module,
   move it to `packages/<target>/machine/` or to
   `packages/<target>/components/<comp>/adapter.ts`.

## New files

Before creating a new file, stop and check:

1. Does it fit into an existing module in `core/`, `shared/`, or a
   target? Prefer extending an existing file.
2. When introducing a new component, scaffold the standard layout:
   `core/components/<comp>/` (machine, connect, props, parts, types),
   `shared/components/<comp>/styles.ts`, and one
   `packages/<target>/components/<comp>/` per target.

When in doubt, raise the edge case before writing the file.

## Per-package guidance

If a package needs rules of its own (build quirks, codegen specifics,
platform-only constraints), add an `AGENTS.md` next to its
`package.json`. The same convention applies further down the tree —
per-component, per-target, anywhere a directory has rules its parent
doesn't capture.

Resolution is nearest-wins: an `AGENTS.md` inside the directory you
are editing (or any ancestor up to the repo root) overrides everything
above it for that directory's code. When editing a file, read every
`AGENTS.md` between the repo root and that file, apply them top-down,
and let the closest one settle conflicts. Per-component `SPEC.md` is
the human-readable description of what the component is — every line
in it must be covered by automated tests and verified by manual run.

Keep nested files small. Only encode what genuinely differs from the
ancestor — duplicating rules invites drift. If a nested file would
just restate the root, delete it.
