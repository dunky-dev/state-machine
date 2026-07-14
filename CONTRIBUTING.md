# Contributing

Thanks for looking into Dunky. This is the fast path to a working setup, the
commands you'll actually run, and how to file something useful.

For the contribution _workflow_ (SPEC -> TEST -> IMPLEMENT -> RECONCILE), code
conventions, and boundaries, see [`AGENTS.md`](./AGENTS.md) — it's the same
contract agents follow here, and it applies to you too.

## Setup

```bash
git clone git@github.com:dunky-dev/state-machine.git
cd state-machine
nvm use          # Node 24, pinned in .nvmrc
corepack enable  # pnpm 11.10.0, pinned in package.json#packageManager
pnpm install
```

## Commands

| Command                        | What it does                                               |
| ------------------------------ | ---------------------------------------------------------- |
| `pnpm test`                    | Full test suite, watch mode                                |
| `pnpm test:ci`                 | Full test suite, once                                      |
| `pnpm typecheck`               | `tsc -b` across the whole workspace                        |
| `pnpm lint`                    | `oxlint`                                                   |
| `pnpm format` / `format:check` | `oxfmt`                                                    |
| `pnpm build`                   | Build every publishable package                            |
| `pnpm changeset`               | Add a changeset — see [Versioning](./AGENTS.md#versioning) |

Target one package or one file instead of the whole workspace:

```bash
pnpm --filter @dunky.dev/state-machine test       # one package's tests
pnpm vitest packages/core/tests/machine.test.ts    # one test file
pnpm --filter @dunky.dev/react-state-machine build
```

## Run the sandboxes

Each sandbox renders the same command-palette machine on a different
substrate — the fastest way to see a change actually work end to end. See
[`sandbox/README.md`](./sandbox/README.md) for what each one demonstrates;
the short version:

```bash
pnpm -C sandbox/react dev     # DOM   — http://localhost:5173
pnpm -C sandbox/opentui dev   # terminal — needs Bun
pnpm -C sandbox/native start  # Expo  — needs a simulator or device
```

## Filing an issue

A bug report is only as useful as its reproduction. Use an **SSCCE** — Short,
Self-Contained, Correct (Compilable) Example:

- **Short** — the smallest machine config that still reproduces it. Strip
  every state, guard, and action that isn't load-bearing.
- **Self-contained** — no missing imports, no "assume you have X set up."
  Someone should be able to paste it and run it with nothing else.
- **Correct (compilable)** — it actually runs and actually reproduces the
  bug. Not what you _think_ is happening — what you pasted and ran.

The [bug report template](.github/ISSUE_TEMPLATE/bug_report.md) asks for
exactly this. If you can't shrink your repro to an SSCCE, that's often a sign
the bug isn't where you think it is — shrinking it is frequently how you find
the real cause yourself.

## Pull requests

Fill in the [PR template](.github/PULL_REQUEST_TEMPLATE.md) — it mirrors
`AGENTS.md`'s RECONCILE step: tests pass, lint and typecheck are clean, and a
changeset is included if the change is user-visible.
