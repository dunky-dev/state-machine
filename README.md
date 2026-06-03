# Agnostic Render

**Components as a state machines. Plug it into _any_ JS runtime.**

A component is a state machine describing how it reacts to interactions. That
machine is plain TypeScript. It doesn't know where it will be rendered.

Plug the machine into a runtime and you get a component. Same machine, same
behavior contract, same accessibility intent. Different render.

```
The host
┌────────────────────────────────────────────────────────────────────┐
│  core/                                                             │
│  No runtime render                                                 │
│  ┌─────────────────┐  ┌──────────────────────┐  ┌───────────────┐  │
│  │ **machine**     │  │ **components**       │  │ **style-      │  │
│  │ signals: state, │  │ behavior + intent    │  │   engine**    │  │
│  │ events, select  │  │                      │  │ Style specs   │  │
│  └─────────────────┘  └──────────────────────┘  └───────────────┘  │
└────────────────────────────────────────────────────────────────────┘
                               │  consumed by every target
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│  shared/                                                            │
│  Cross-target styles + utilities.                                   │
│  ┌──────────────────────────────────────┐  ┌──────────────────────┐ │
│  │ **components**                       │  │ **utils**            │ │
│  │ per-component style specs            │  │ positioning, merge   │ │
│  └──────────────────────────────────────┘  └──────────────────────┘ │
└─────────────────────────────────────────────────────────────────────┘
                               │  translated per target
                               ▼
┌──────────────────────────────────────────────────────────────────────┐
│  <target>/   (react, native, …)                                      │
│  Runtime-specific render logic.                                      │
│  ┌────────────────────────────────────────────────────────────────┐  │
│  │ runtime glue                                                   │  │
│  │  • connect to machine                                          │  │
│  │  • normalize events to the target (e.g. onPress → onClick)     │  │
│  │  • adapt/implement quirks (e.g. focusTrap logic)               │  │
│  └────────────────────────────────────────────────────────────────┘  │
│  ┌────────────────────────────────────────────────────────────────┐  │
│  │ generated/                                                     │  │
│  │  • component API out of the machine spec                       │  │
│  │  • elements out of the machine spec + shared styles            │  │
│  └────────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────┘
                               │  imported as a normal package
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│  App                                                                │
└─────────────────────────────────────────────────────────────────────┘
```

### core

Pure JS, runs in any JS runtime. No renderer. This is the host.

- **machine** — every component is a state machine, built on a signal
  kernel: states, events, guards, actions, effects, `computed`, `after`
  timers, `watch`. Fine-grained `select` so a change wakes only the
  observers that read the changed field. `compose` runs several machines as
  one (orthogonal regions). No idea what's painting it. See
  [`packages/core/machine/README.md`](./packages/core/machine/README.md).
- **components** — per-component behavior: the machine config and the
  connector function (e.g. `connectTooltip`) that turns state into
  logical bindings (handlers + attrs).
- **style-engine** — the agnostic `Style` / `StyleSpec` vocabulary each
  target translates into styled elements.

### shared

Cross-target styles and utilities. Runtime agnostic.

- **components** — per-component style specs, one per component,
  authored as plain objects (at `shared/components/<comp>/src/styles.ts`).
  Each target translates them via codegen into styled elements.
- **utils** — positioning, merge, and other cross-target helpers.

### \<target\>

The runtime-specific layer. Two responsibilities.

- **runtime glue** — connects to the core machine, normalizes events
  for the target (`onPress → onClick` on web, `onPress → onPress` on
  RN), and implements substrate quirks (focus trap, escape listener,
  back button, …).
- **generated/** — built by codegen. The component API derives from
  the machine spec; the elements derive from the machine spec plus
  shared styles. Never hand-edited.

See `ARCHITECTURE.md` for the full layered model, `AGENTS.md` for the
contributor / agent contract, and `packages/core/components/<comp>/SPEC.md`
for per-component behavior.
