For _rules_ (do this, never do that), see [`AGENTS.md`](./AGENTS.md).
For _packages_ specifics see `SPEC.md` files.

# Architecture

The repo splits in two halves. **`core/`** is the agnostic side — pure JS,
no renderer. It says _what_ a component is: its states, its transitions,
its bindings vocabulary, its style spec. Nothing in `core/` knows that
React or the DOM exists.

**`<target>/`** is the substrate side — `react`, `native`, etc, and
any future renderer. Each target is a complete implementation of the
agnostic spec for one runtime. The view, the lifecycle bridge, the
event normalization, and the substrate-specific effect impls all live
here.

Each _component_ appears at least twice: once in `core/components/<comp>/` as
the agnostic description, and once in each `<target>/components/<comp>/`
as the substrate-specific view. The agnostic side declares names; the
target side fulfills the contract.

## Project structure

| File / location                        | What it owns                                        |
| -------------------------------------- | --------------------------------------------------- |
| `packages/core/machine/`               | State-machine engine, store, bindings, mergeProps   |
| `packages/core/components/<comp>/`     | Per-component agnostic spec — see structure below   |
| `packages/<target>/machine/`           | Hook + normalize per substrate (react, native, ...) |
| `packages/<target>/components/<comp>/` | View, context, adapter, generated elements + api    |
| `scripts/build.ts`, `scripts/watch.ts` | Codegen (one-shot + watcher)                        |
| `sandbox/<target>/`                    | Runnable dev env                                    |

## The map

```
core                                  agnostic logic — no React, no DOM, no RN
├── machine                           state-machine engine + primitives
│   ├── createMachine                 builds a running machine from a config
│   ├── connector                     wraps state + connect + adapter into one snapshot
│   ├── bindings                      event + attr vocabulary (onPress, role, …)
│   ├── adapter                       withAdapter() — merges substrate effect impls
│   ├── style-spec                    Style / StyleSpec types
│   └── utils                         engine-internal helpers
│
├── store                             reactive singleton state container
│
└── components
    └── <component>                   per-component agnostic description
        ├── types                     TS declaration - vocabulary (what the component IS)
        ├── props                     defaults + raw-to-resolved
        ├── machine                   state graph + transitions
        ├── connect                   state + ctx → handlers + attrs
        ├── store                     singleton (when needed)
        └── parts                     anatomy: parts list + variant types

shared                                cross-target, cross-component artifacts
├── utils                             pure helpers (composeHandlers, positioning, memo)
│
└── components
    └── <component>                   shared style and logic
        └── styles

<target>                              one substrate (react, native, pixi, …)
├── machine                           runtime, hooks, and props translator for this target
│   ├── use-machine / use-api         lifecycle bridge for hook-based targets (react, native)
│   ├── runtime / create-runtime      lifecycle bridge for runtime-based targets (pixi)
│   └── normalize                     bindings → target props
│
├── store                             store bridge for the target
│
└── components
    └── <component>                   per-component substrate implementation
        ├── render                    the actual view (dev written - recommended AI support)
        ├── context                   component context
        ├── adapter                   substrate impls of core declaration
        ├── utils                     local helpers
        └── generated
            ├── api                   runtime function to hook into the machine API
            └── elements              styled wrappers (based of shared/components styles)
```

Four top-level package groups, four jobs:

- **`core/`** — _the agnostic side_. Behavior, types, and engines that
  know nothing about a renderer.
- **`shared/`** — _the cross-target side_. Things that are agnostic but
  more about content than behavior: style specs, generic utilities like
  positioning math.
- **`<target>/`** — _the substrate side_. One folder per renderer
  (react, native, pixi). Owns its runtime, its style translator, and its
  per-component logic.
- **`sandbox/<target>/`** — runnable demos consuming the target.

Each _component_ appears at least twice: once in `core/components/<comp>/`
(agnostic description), once in `shared/components/<comp>/` (style
specs), and once in each `<target>/components/<comp>/` (the substrate-
specific view). The agnostic side declares names; the target side
fulfills the contract; the shared side provides the paint.

### Rendering the components

What happens when a consumer renders a component in their app:

```
   CONSUMER APP
   ─────────────────────────────────────────────────────────────
   ┌─────────────────────────────────────────────────────────┐
   │  RENDER COMPONENT                                       │
   │                                                         │
   │  Reads consumer props.                                  │
   │  Spreads handlers + attrs onto the right element.       │
   │  Renders styled elements.                               │
   └─────────────────────────────────────────────────────────┘
              │                            ▲
              │ asks for the api           │ uses generated parts
              ▼                            │
   ┌──────────────────────┐     ┌──────────────────────────┐
   │  GENERATED API       │     │  GENERATED ELEMENTS      │
   │                      │     │                          │
   │  Wires the machine   │     │  Styled wrappers, one    │
   │  to the substrate    │     │  per part. Built at      │
   │  via withAdapter,    │     │  at codegen time.        │
   │  then returns the    │     │                          │
   │  connect output.     │     │                          │
   └──────────────────────┘     └──────────────────────────┘
              │
              │ runs through
              ▼
   ┌──────────────────────────────────────────────────────┐
   │  TARGET LIFECYCLE BRIDGE                             │
   │  (target's runtime + normalize)                      │
   │                                                      │
   │  Runs the machine config under the substrate's       │
   │  scheduler. Translates agnostic bindings (onPress,   │
   │  describedBy) into the target props (onClick,        │
   │  aria-describedby).                                  │
   └──────────────────────────────────────────────────────┘
              │
              │ drives
              ▼
   ┌──────────────────────────────────────────────────────┐
   │  AGNOSTIC MACHINE  (core)                            │
   │                                                      │
   │  State graph + transitions + named effects.          │
   │  Receives events, mutates context, fires effects.    │
   │  Substrate-supplied effect impls plug in via the     │
   │  per-target adapter (DOM listener on web,            │
   │  BackHandler on RN, etc).                            │
   └──────────────────────────────────────────────────────┘
              │
              │ exposes via
              ▼
   ┌──────────────────────────────────────────────────────┐
   │  CONNECT  (core)                                     │
   │                                                      │
   │  Takes (state, context, props), returns the          │
   │  logical surface: per-part bindings (handlers,       │
   │  attrs) the view will spread.                        │
   └──────────────────────────────────────────────────────┘
```

The consumer's app calls a view; the view asks for an API; the API
brings a machine + connect to life via the substrate lifecycle; the
machine surfaces handlers + attrs through connect back to the view,
which spreads them onto styled elements.

## The machine parts

`machine.ts` is the state graph (states, transitions, action impls). It
changes when behavior changes.

`connect.ts` is the function that translates `(state, context, props)`
into the surface a view consumes (handlers + attrs per part). It changes
when the API surface changes.

`store.ts` holds the singleton when a component has one (e.g. "only one
tooltip open at a time"). It changes rarely; lifting it out makes the
coupling visible at the import line.

### Host declares effects consumers implement them

Some effects only make sense per substrate: a `trackEscapeKey` effect
on web uses `document.addEventListener`; on RN it uses `BackHandler`;
on a TV remote app it'd watch the remote's events. The machine declares
the effect by _name_ and provides a no-op placeholder; each adapter
overrides the named entry via `withAdapter()`. This keeps the machine
substrate-free without losing the contract.

## The codegen pipeline

The build script reads each component's agnostic spec from `core/` and
`shared/`, then emits a `generated/` folder inside every target's
component package. It runs the same way in dev (via the watcher) and in
production (`pnpm build`) — there's no separate runtime path.

```
   READS
   ────────────────────────────────────────────────────────────────
   core/components/<comp>/src/                  (behavior + anatomy)
   ├── index.ts                     names: <comp>Machine, connect<Comp>
   ├── types.ts                     types referenced by api.ts
   ├── machine.ts                   imported by the generated api
   ├── connect.ts                   imported by the generated api
   └── parts.ts                     parts list + variant types

   shared/components/<comp>/src/
   └── styles.ts                    common styles for all targets

                       ↓  scripts/build.ts
                       ↓
                       ↓  For each target:
                       ↓    - emitApi       (template + core names)
                       ↓    - emitElements  (translates styles → target props)

   EMITS (one set per target, overwritten each run)
   ────────────────────────────────────────────────────────────────
   react/components/<comp>/src/generated/
   ├── api.ts          ← useXxxApi (imports core + react runtime)
   └── elements.ts     ← styled wrappers

   native/components/<comp>/src/generated/
   ├── api.ts          ← useXxxApi (imports core + native runtime)
   └── elements.ts     ← styled wrappers

   pixi/components/<comp>/src/generated/
   ├── api.ts          ← createXxxBridge (imports core + pixi runtime)
   └── elements.ts     ← styled wrappers
```

## Vocabulary

| Term         | What it is                                                             |
| ------------ | ---------------------------------------------------------------------- |
| **host**     | The agnostic core — `packages/core/*`. Declares what a component is.   |
| **adapter**  | A substrate-specific implementation package — `packages/<target>/*`.   |
| **target**   | A render environment (`react`, `native`, `pixi`, …).                   |
| **machine**  | A state-graph config consumed by `createMachine`.                      |
| **connect**  | A function returning the logical surface a view spreads onto elements. |
| **bindings** | The substrate-agnostic event + attr vocabulary core's connect speaks.  |
| **store**    | A reactive container (shared singleton, per-instance, or both).        |
| **element**  | A named part of a component (content, trigger, item, …) with a style.  |
| **codegen**  | The build-time emission of `elements.ts` and `api.ts` per target.      |

## Sandboxes

Each target gets a sandbox under `sandbox/<target>/`. The sandboxes are
where the components actually run — a real app with the generated
adapter consumed end-to-end.

```
sandbox
├── react        Vite + React DOM        — `pnpm dev:react`
├── native       Expo + React Native     — `pnpm dev:native`
└── <target>     env setup               — `pnpm dev:<target>`
```

Each sandbox depends on its target's packages. Editing a component in `core/`
cause changes in the targets, which should be picked up by the servers.

The sandboxes are not part of the library's published scope. They're dev env only.
