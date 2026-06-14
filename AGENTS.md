# Agent + contributor guide

The working contract for anyone (human or agent) modifying code in this
repo. This file is the canonical entry point — read it first, every time.

## Preflight

Before touching any code, read these in order:

1. `AGENTS.md` (this file) — rules, boundaries, workflow.
2. `README.md` — what this project is and how to run it.
3. `ARCHITECTURE.md` — the layered model and where things live.

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
- **Targets never reimplement state.** Targets read from the machine
  via its connector. They do not fork the state graph, mirror context,
  or shadow transitions. If a target needs new state, the state goes in
  `core/`.
- **Substrate quirks live in the target.** Focus traps, escape-key
  listeners, back-button handling, RN gesture quirks are
  prop-dependent, so they live in the target as `ComponentEffect`s.
  Props-free, platform-free effects belong in the core machine config's
  `effects` (authored via `setup()`).

## Workflow

Before merging, walk this checklist:

1. **Do tests reflect the change?** Behavior added or changed in `core/`
   or a target must be exercised by a test under the package's `tests/`.
2. **Did `core/` change?** Verify the change is substrate-agnostic. If
   it depends on a React lifecycle, a DOM API, or an RN-only module,
   move it to `packages/<target>/machine/`.

## Diagrams in docs

Draw ASCII diagrams (boxes, trees, flows) with plain `|`, `-`, and `+`
only — never Unicode box-drawing characters (`┌ ┐ └ ┘ ─ │ ├ ┼ ▼` …).
Use `|` for verticals, `-` for horizontals, `+` for every corner and
junction, and a plain `v` / `^` / `>` / `<` for arrowheads. The
box-drawing glyphs render inconsistently across fonts, terminals, and
GitHub, and are awkward to edit; the ASCII set is portable and diffs
cleanly. This applies to every `.md` in the repo (README, ARCHITECTURE,
package READMEs).

## Per-package guidance

If a package needs rules of its own (build quirks, platform-only
constraints), add an `AGENTS.md` next to its `package.json`. The same
convention applies further down the tree — anywhere a directory has
rules its parent doesn't capture.

Resolution is nearest-wins: an `AGENTS.md` inside the directory you
are editing (or any ancestor up to the repo root) overrides everything
above it for that directory's code. When editing a file, read every
`AGENTS.md` between the repo root and that file, apply them top-down,
and let the closest one settle conflicts.

Keep nested files small. Only encode what genuinely differs from the
ancestor — duplicating rules invites drift. If a nested file would
just restate the root, delete it.
