# Architecture

For _rules_ (do this, never do that), see [`AGENT.md`](./AGENT.md).
For _packages_ specifics see `SPEC.md` files.

## The map

```
core                                  agnostic logic
└── machine                           the state-machine + primitives package
│   ├── createMachine                 builds a running machine from a config
│   ├── createStore                   reactive value container
│   ├── bindings                      event + attr vocabulary (onPress, role…)
│   ├── adapter                       withAdapter() — merges substrate impls
│   ├── mergeProps                    composes consumer + library props
│   └── style-spec                    Style / StyleSpec types
│
└── components
    └── <component>                   per-component agnostic description
        ├── types                     vocabulary (what the component IS)
        ├── props                     defaults + raw-to-resolved
        ├── machine                   state graph + transitions
        ├── connect                   state + ctx → handlers + attrs
        ├── store                     singleton (when needed)
        ├── utils                     pure helpers (step, typeahead, …)
        └── elements                  named parts + per-part style spec

<target>                              one substrate (react, native, pixi, …)
└── machine                           hooks + props translator for this substrate
│   ├── useMachine                    React lifecycle bridge
│   └── normalize                     bindings → renderer-native props
│
└── style-engine                      translates StyleSpec → renderer styles
│
└── components
    └── <component>                   per-component substrate implementation
        ├── render                    the actual view (hand-written)
        ├── context                   adapter-specific React context
        ├── adapter                   substrate impls of host effects
        ├── utils                     adapter-local helpers
        ├── api                       generated — useXxxApi hook
        └── elements                  generated — styled wrappers
```

### How to read it

The repo splits in two halves. **`core/`** is the agnostic side — pure JS,
no renderer. It says _what_ a component is: its states, its transitions,
its bindings vocabulary, its style spec. Nothing in `core/` knows that
React or the DOM exists.

**`<target>/`** is the substrate side — `react`, `native`, `pixi`, and
any future renderer. Each target is a complete implementation of the
agnostic spec for one runtime. The view, the lifecycle bridge, the
event normalization, and the substrate-specific effect impls all live
here.

Each _component_ appears twice: once in `core/components/<comp>/` as
the agnostic description, and once in each `<target>/components/<comp>/`
as the substrate-specific view. The agnostic side declares names; the
target side fulfills the contract.

### What clicks together

A `Tooltip` in your React app:

1. **You import** `<Tooltip>` from `@render-experiment/tooltip-react`.
2. **The view** (`react/components/tooltip/render.tsx`) calls
   `useTooltipApi(props)`. That's the generated hook.
3. **`useTooltipApi`** wraps `tooltipMachine` (from
   `core/components/tooltip/machine`) with the substrate adapter (the
   React adapter's `adapter.ts` provides the DOM-specific `trackEscapeKey`).
4. **`useMachine`** (from `react/machine`) runs the machine and re-renders
   on state changes.
5. **`connect()`** (from `core/components/tooltip/connect`) translates
   `(state, context, props)` into handler + attr bindings.
6. **`normalize()`** (from `react/machine`) maps the agnostic bindings
   (`onPress`, `describedBy`) into real DOM props (`onClick`,
   `aria-describedby`).
7. **The view** spreads those onto a styled element generated from
   `core/components/tooltip/elements/content.ts`.

The same path runs on native or pixi — different normalize, different
styled element, same machine.

---

## Where things live

| File / location                        | What it owns                                         |
| -------------------------------------- | ---------------------------------------------------- |
| `packages/core/machine/`               | State-machine engine, store, bindings, mergeProps    |
| `packages/core/components/<comp>/`     | Per-component agnostic spec — see structure below    |
| `packages/<target>/machine/`           | Hook + normalize per substrate (react, native, pixi) |
| `packages/<target>/style-engine/`      | Style spec translator per substrate                  |
| `packages/<target>/components/<comp>/` | View, context, adapter, generated elements + api     |
| `scripts/build.ts`, `scripts/watch.ts` | Codegen (one-shot + watcher)                         |
| `sandbox/<target>/`                    | Runnable demos                                       |

### Per-component layout (core)

```
core/components/<comp>/src/
├── index.ts        public barrel
├── types.ts        vocabulary (types only)
├── props.ts        defaults + resolver
├── machine.ts      MachineConfig only (states + transitions + impls)
├── connect.ts      logical surface (handlers + attrs the view consumes)
├── store.ts        singleton state (when the component has one)
├── utils.ts        pure algorithmic helpers (step, typeahead, …)
├── elements/
│   ├── index.ts    barrel + parts list
│   └── <part>.ts   one file per element (content, positioner, …)
└── SPEC.md         behavior + styles + a11y for this component
```

### Per-component layout (adapter)

```
<target>/components/<comp>/src/
├── index.ts        public barrel
├── render.tsx      the view (hand-written)
├── context.ts      adapter-specific context
├── adapter.ts      substrate impls of host effects (DOM listeners, …)
├── utils.ts        adapter-local helpers (refs, cloning, anchor math)
├── api.ts          GENERATED — useXxxApi hook
└── elements.ts     GENERATED — styled wrappers
```

`api.ts` and `elements.ts` are overwritten on every codegen. The other
files are hand-written and codegen never touches them.

---

## Why the splits

### Why machine, connect, and store are separate files

`machine.ts` is the state graph (states, transitions, action impls). It
changes when behavior changes.

`connect.ts` is the function that translates `(state, context, props)`
into the surface a view consumes (handlers + attrs per part). It changes
when the API surface changes.

`store.ts` holds the singleton when a component has one (e.g. "only one
tooltip open at a time"). It changes rarely; lifting it out makes the
coupling visible at the import line.

Same intuition as Zag.js's machine package layout, minus the DOM file.

### Why elements is a folder, not a single file

Each part of a component (content, positioner, item, separator, …) gets
its own file. The codegen iterates the `elements/` directory; new parts
are picked up by adding a file. Variants and style specs co-locate with
the part, which is the unit you usually edit.

A single `styles.ts` was the original shape and became unwieldy at 6+
parts. The split also lets future per-part metadata (primitive type,
a11y annotations) live next to its element.

### Why machine-core hosts mergeProps and createStore

These are general-purpose primitives every adapter or component might
need. They live in `core/machine` because that's the canonical "shared
substrate-agnostic JS" package. Putting them in adapters would force
duplication; putting them in a new package would add ceremony.

### Why the host declares effects but adapters implement them

Some effects only make sense per substrate: a `trackEscapeKey` effect
on web uses `document.addEventListener`; on RN it uses `BackHandler`;
on a TV remote app it'd watch the remote's events. The machine declares
the effect by _name_ and provides a no-op placeholder; each adapter
overrides the named entry via `withAdapter()`. This keeps the machine
substrate-free without losing the contract.

---

## The codegen pipeline

The build script reads each component's core spec and emits per-target
files. It runs the same way in dev (via the watcher) and in production
(`pnpm build`) — there's no separate runtime path.

```
   READS (source of truth in core)
   ────────────────────────────────────────────────────────────────
   core/components/<comp>/src/
   ├── index.ts                     names: <comp>Machine, connect<Comp>
   ├── types.ts                     types referenced by api.ts
   ├── machine.ts                   imported by the generated hook
   ├── connect.ts                   imported by the generated hook
   └── elements/<part>.ts           per-part style specs

                       ↓  scripts/build.ts
                       ↓
                       ↓  For each target:
                       ↓    - emitApi    (template + names)
                       ↓    - emitElements (style-engine translates
                       ↓                    StyleSpec → native styles,
                       ↓                    inlined as JSON literal)

   EMITS (one set per target, overwritten each run)
   ────────────────────────────────────────────────────────────────
   react/components/<comp>/src/
   ├── api.ts          ← useXxxApi hook (imports core + react adapter)
   └── elements.ts     ← Stitches styled wrappers + inlined CSS

   native/components/<comp>/src/
   ├── api.ts          ← useXxxApi hook (imports core + native adapter)
   └── elements.ts     ← TranslatedNativeStyle + resolve helpers

   pixi/components/<comp>/src/
   ├── api.ts          ← useXxxApi hook
   └── elements.ts     ← Pixi sprite/container style records
```

The watcher (`scripts/watch.ts`) tracks `core/components/*/src/elements/`
and the per-component sibling files (`machine.ts`, `types.ts`, `props.ts`,
`utils.ts`). On change, the affected component is regenerated for every
target; Vite / Metro pick up the new generated files and HMR.

Style translation happens at codegen time, not at runtime — the
generated `elements.ts` is a static literal that ships to your bundler.
There's no per-render translation cost. If we ever want a runtime path
(useful for dev HMR without a watcher round-trip), it's an additive
change; nothing today depends on translation being build-only.

What codegen does NOT touch: `render.tsx`, `context.ts`, `adapter.ts`,
`utils.ts`, or `index.ts` in any adapter. Those are the
hand-written-once files.

## Sandboxes

Each target gets a sandbox under `sandbox/<target>/`. The sandboxes are
where the components actually run — a real app with the generated
adapter consumed end-to-end.

```
sandbox
├── react        Vite + React DOM        — `pnpm dev:react`
├── native       Expo + React Native     — `pnpm dev:native`
└── pixi         Vite + PixiJS           — `pnpm dev:pixi`
```

Each sandbox depends on its target's `@render-experiment/<comp>-<target>`
packages via the pnpm workspace. Editing a component in `core/` triggers
codegen, which rewrites the adapter's `elements.ts` and `api.ts`; the
sandbox's bundler (Vite or Metro) picks up the change and HMRs.

The sandboxes are not part of the library's published surface. They're
demos + integration tests by inspection — if a change to core breaks a
sandbox, you broke the contract somewhere.

The watcher (`scripts/watch.ts`) tracks `core/components/*/src/elements/`
and the per-component sibling files (`machine.ts`, `types.ts`, `props.ts`,
`utils.ts`). On change, the affected component is regenerated for every
target; Vite / Metro pick up the new generated files and HMR.

What codegen does NOT touch: `render.tsx`, `context.ts`, `adapter.ts`,
`utils.ts`, or `index.ts` in any adapter. Those are the
hand-written-once files.

---

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

---

## Build

## Watcher
