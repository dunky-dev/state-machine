For _rules_ (do this, never do that), see [`AGENTS.md`](./AGENTS.md).
For _packages_ specifics see `SPEC.md` files.

# Architecture

## The big picture

A component is a **state machine** describing how it reacts to interactions —
plain TypeScript that knows nothing about where it renders. A thin per-target
layer plugs that machine into a runtime and you get a real component: same
machine, same behavior, same accessibility intent, different render.

```
The host
+----------------------------------------------------------------------+
|  core/                                                             |
|  No runtime render — pure JS, runs anywhere                        |
|  +-----------------+  +----------------------+  +---------------+  |
|  | **machine**     |  | **components**       |  | **style-      |  |
|  | states, events, |  | behavior + intent    |  |   engine**    |  |
|  | select          |  |                      |  | Style specs   |  |
|  +-----------------+  +----------------------+  +---------------+  |
+----------------------------------------------------------------------+
                               |  consumed by every target
                               v
+-----------------------------------------------------------------------+
|  shared/                                                            |
|  Cross-target styles + utilities                                    |
|  +--------------------------------------+  +----------------------+ |
|  | **components** (per-component styles)|  | **utils** (position, | |
|  |                                      |  |  merge, …)           | |
|  +--------------------------------------+  +----------------------+ |
+-----------------------------------------------------------------------+
                               |  translated per target
                               v
+------------------------------------------------------------------------+
|  <target>/   (react, native, …)                                      |
|  Runtime-specific render logic                                       |
|  • connect the machine  • normalize events (onPress -> onClick)      |
|  • prop-aware effects (focus trap, escape listener) via effects.ts   |
|  • generated/ — component API + styled elements (from the spec)      |
+------------------------------------------------------------------------+
                               |  imported as a normal package
                               v
                            Consumer app
```

The rest of this document drills into each layer.

## Two halves

The repo splits in two halves. **`core/`** is the agnostic side — pure JS,
no renderer. It says _what_ a component is: its states, its transitions,
its bindings vocabulary, its style spec. Nothing in `core/` knows that
React or the DOM exists.

> **Status: experimental, but it compiles and runs.** The `core/machine` engine
> is a stable plain-mutation kernel (no signals; see
> [`packages/core/machine/README.md`](./packages/core/machine/README.md)). The
> two reference components (tooltip, dropdown-menu) build through the codegen
> pipeline to the React and native targets and run in their sandboxes; the suite
> is green and `tsc` is clean. It's an in-progress exploration — the API may still
> move — not a 1.0.

**`<target>/`** is the substrate side — `react`, `native`, etc, and
any future renderer. Each target is a complete implementation of the
agnostic spec for one runtime. The view, the lifecycle bridge, the
event normalization, and the substrate-specific effect impls all live
here.

Each _component_ appears at least twice: once in `core/components/<comp>/` as
the agnostic description, and once in each `<target>/components/<comp>/`
as the substrate-specific view. The agnostic side declares names; the
target side fulfills the contract.

## The core rule: the machine never sees props

A machine is pure behavior — states, transitions, context, effects. It does
**not** read the consumer's props. Props are where the environment leaks in (a
DOM event handed to `onOpenChange`, a platform timer, a host-specific callback);
if the machine read them, it would be coupled to the shape one runtime happens
to give it.

So props enter only at the **edge**, never the machine:

- **config the transitions need** (delays, flags like `disabled`) → seeded into
  the machine's **context** (and updated via `setContext` when props change);
- **callbacks + controlled state** (`onOpenChange`, controlled `open`) → handled
  by the **connector / connect**, which observes the machine and calls back;
- **initial state derived from props** → computed before `machine()` is built.

**Controlled state is initial-only.** A controlled `open`/`value` resolves into
the _initial_ state once, and the connector fires the prop callback on every
intent — the engine does not live-reconcile a controlled value after mount. The
consumer re-renders with the new value; the component never mutates it. ("It
reports the intent and the consumer decides," not "the component obeys the
controlled value frame-by-frame.")

This is the rule that makes one machine run byte-for-byte identically on React,
React Native, a canvas loop, or a test — each target varies only the thin
connector layer around it. (It's the one place this engine diverges from
Zag, whose machines read props directly.)

## Project structure

| File / location                        | What it owns                                                       |
| -------------------------------------- | ------------------------------------------------------------------ |
| `packages/core/machine/`               | State-machine engine (plain-mutation kernel) + bindings vocabulary |
| `packages/core/style-engine/`          | Agnostic style spec (`Style` / `StyleSpec`)                        |
| `packages/shared/utils/`               | mergeProps, composeHandlers, positioning, memo                     |
| `packages/core/components/<comp>/`     | Per-component agnostic spec — see structure below                  |
| `packages/<target>/machine/`           | Hook + normalize per substrate (react, native, ...)                |
| `packages/<target>/components/<comp>/` | View, context, effects, generated elements + api                   |
| `scripts/build.ts`, `scripts/watch.ts` | Codegen (one-shot + watcher)                                       |
| `sandbox/<target>/`                    | Runnable dev env                                                   |

## The map

```
core                                  agnostic logic — no React, no DOM, no RN
+-- machine                           plain-mutation state-machine engine (one
|   |                                 file per concern; public surface in index)
|   +-- machine()                     builds a stopped service from a config;
|   |                                 .start()/.stop()/.send()/.state/.select
|   +-- context / state               one plain-object context (mutated in
|   |                                 place, copy-on-write) + flat states
|   +-- guards / actions              and/or/not combinators · oneOf
|   +-- connector                     connect() -> live, subscribable snapshot
|   +-- compose                       run several machines as one (orthogonal
|   |                                 regions): start/stop + sync + combine
|   +-- bindings                      event + attr vocabulary (onPress, role, …)
|
+-- style-engine                      agnostic Style / StyleSpec types
|
+-- components
    +-- <component>                   per-component agnostic description
        +-- types                     TS declaration - vocabulary (what the component IS)
        +-- props                     defaults + raw-to-resolved
        +-- machine                   state graph + transitions
        +-- connect                   state + ctx -> handlers + attrs
        +-- parts                     anatomy: parts list + variant types

shared                                cross-target, cross-component artifacts
+-- utils                             pure helpers (composeHandlers, positioning, memo)
|
+-- components
    +-- <component>                   shared style and logic
        +-- styles

<target>                              one substrate (react, native, …)
+-- machine                           runtime, hooks, and props translator for this target
|   +-- use-machine                   lifecycle bridge (build + start/stop + useSyncExternalStore)
|   +-- use-effects                   runs a component's ComponentEffect (prop-dep'd transport)
|   +-- use-selector                  fine-grained leaf subscription (O(readers))
|   +-- normalize                     bindings -> target props
|
+-- components
    +-- <component>                   per-component substrate implementation
        +-- render                    the actual view (dev written - recommended AI support)
        +-- context                   component context
        +-- effects                   prop-aware, platform-specific ComponentEffects (run via useEffects)
        +-- utils                     local helpers
        +-- generated
            +-- api                   runtime function to hook into the machine API
            +-- elements              styled wrappers (based of shared/components styles)
```

Four top-level package groups, four jobs:

- **`core/`** — _the agnostic side_. Behavior, types, and engines that
  know nothing about a renderer.
- **`shared/`** — _the cross-target side_. Things that are agnostic but
  more about content than behavior: style specs, generic utilities like
  positioning math.
- **`<target>/`** — _the substrate side_. One folder per renderer
  (react, native). Owns its runtime, its style translator, and its
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
   -------------------------------------------------------------
   +-----------------------------------------------------------+
   |  RENDER COMPONENT                                       |
   |                                                         |
   |  Reads consumer props.                                  |
   |  Spreads handlers + attrs onto the right element.       |
   |  Renders styled elements.                               |
   +-----------------------------------------------------------+
              |                            ^
              | asks for the api           | uses generated parts
              v                            |
   +----------------------+     +--------------------------+
   |  GENERATED API       |     |  GENERATED ELEMENTS      |
   |                      |     |                          |
   |  Wires the machine   |     |  Styled wrappers, one    |
   |  to the substrate    |     |  per part. Built at      |
   |  and the target's    |     |  at codegen time.        |
   |  effects.ts, then     |     |                          |
   |  returns connect out.|     |                          |
   +----------------------+     +--------------------------+
              |
              | runs through
              v
   +------------------------------------------------------+
   |  TARGET LIFECYCLE BRIDGE                             |
   |  (target's runtime + normalize)                      |
   |                                                      |
   |  Runs the machine config under the substrate's       |
   |  scheduler. Translates agnostic bindings (onPress,   |
   |  describedBy) into the target props (onClick,        |
   |  aria-describedby).                                  |
   +------------------------------------------------------+
              |
              | drives
              v
   +------------------------------------------------------+
   |  AGNOSTIC MACHINE  (core)                            |
   |                                                      |
   |  State graph + transitions + named effects.          |
   |  Receives events, mutates context, fires effects.    |
   |  Its effects are prop-free and platform-free (e.g.   |
   |  a store subscription); prop-aware, platform-        |
   |  specific listeners live in the target's effects.ts. |
   +------------------------------------------------------+
              |
              | exposes via
              v
   +------------------------------------------------------+
   |  CONNECT  (core)                                     |
   |                                                      |
   |  Takes the machine snapshot (state, context,         |
   |  computed, send) + props, returns the logical        |
   |  surface: per-part bindings (handlers, attrs) the    |
   |  view spreads. Props enter HERE, not the machine.    |
   +------------------------------------------------------+
```

The consumer's app calls a view; the view asks for an API; the API
brings a machine + connect to life via the substrate lifecycle; the
machine surfaces handlers + attrs through connect back to the view,
which spreads them onto styled elements.

## The machine parts

`machine.ts` is the state graph (states, transitions, action impls). It
changes when behavior changes.

`connect.ts` is the function that translates the machine snapshot + props
into the surface a view consumes (handlers + attrs per part). This is the
layer that reads props (see "the machine never sees props" above) and fires
the consumer's callbacks. It changes when the API surface changes.

Cross-instance singletons (e.g. "only one tooltip open at a time") use
`createStore` from `machine-core` — a tiny reactive cell (plain value +
listeners) living outside any one machine. Per-machine state is the engine's own
plain-object context. (The old standalone `core/store` package is gone; the
store now ships from the engine itself.)

### Two homes for a side-effect

A behavior that runs as a side-effect lives in one of two places, depending on
whether it needs props/platform or not:

1. **Core config effect** — props-free **and** platform-free (e.g. a store
   subscription). It's registered by name in the machine's `setup({ effects })`
   and named on a state in `createMachine({ states })`, so it runs inside the
   machine, scoped to that state. Use this when the machine owns the lifecycle
   and the effect needs neither props nor the platform.

2. **Component effect (`ComponentEffect`)** — **prop-aware** and
   **platform-specific** (a DOM `keydown` for Escape on web, an RN `BackHandler`).
   The machine can't own it because [it never sees props](packages/core/machine/README.md#the-machine-never-sees-props).
   The tooltip's real Escape is this: it needs `closeOnEscape` and a prevent-able
   `onEscapeKeyDown` veto. It lives in the target's `effects.ts` as a plain
   `(machine, props) => cleanup` + the prop names it depends on; the view runs it
   via `useEffects`. The agnostic _decision_ still lives in core
   (`resolveEscape`); only the platform listener is per-target. On accept it
   `send()`s a plain event the machine already understands.

## The codegen pipeline

The build script reads each component's agnostic spec from `core/` and
`shared/`, then emits a `generated/` folder inside every target's
component package. It runs the same way in dev (via the watcher) and in
production (`pnpm build`) — there's no separate runtime path.

```
   READS
   ----------------------------------------------------------------
   core/components/<comp>/src/                  (behavior + anatomy)
   +-- index.ts                     names: <comp>MachineConfig, connect<Comp>, <COMP>_DEFAULTS
   +-- types.ts                     types referenced by api.ts
   +-- machine.ts                   imported by the generated api
   +-- connect.ts                   imported by the generated api
   +-- parts.ts                     parts list + variant types

   shared/components/<comp>/src/
   +-- styles.ts                    common styles for all targets

                       v  scripts/build.ts
                       v
                       v  For each target:
                       v    - emitApi       (template + core names)
                       v    - emitElements  (translates styles -> target props)

   EMITS (one set per target, overwritten each run)
   ----------------------------------------------------------------
   react/components/<comp>/src/generated/
   +-- api.ts          <- useXxxApi (imports core + react runtime)
   +-- elements.ts     <- styled wrappers

   native/components/<comp>/src/generated/
   +-- api.ts          <- useXxxApi (imports core + native runtime)
   +-- elements.ts     <- styled wrappers
```

**Part name → element.** `emitElements` picks each part's element by its name:
interactive parts (`trigger`, `item`, `close`) become a `<button>` / `Pressable`
(focusable, keyboard-operable); text parts (`title`, `description`) become
`<h2>` / `<p>` / `Text` (so the shared text style applies); everything else is a
`<div>` / `View`. The name sets live in `scripts/build.ts` (`INTERACTIVE_PARTS`,
`TEXT_PARTS`) — extend them there when a new component needs a clickable or text
part with a new name. A clickable part left as a `<div>` is not focusable (it
breaks focus traps); a native text part left as a `View` loses its text color.

## Vocabulary

| Term         | What it is                                                                                          |
| ------------ | --------------------------------------------------------------------------------------------------- |
| **host**     | The agnostic core — `packages/core/*`. Declares what a component is.                                |
| **target**   | A substrate-specific implementation package and its render environment — `packages/<target>/*` (`react`, `native`, …). |
| **machine**  | A state-graph config consumed by `machine()`; returns a startable service.                          |
| **connect**  | A function returning the logical surface a view spreads onto elements.                              |
| **bindings** | The substrate-agnostic event + attr vocabulary core's connect speaks.                               |
| **compose**  | Run several machines as one unit (orthogonal regions): bundled `start`/`stop` + `sync` + `combine`. |
| **element**  | A named part of a component (content, trigger, item, …) with a style.                               |
| **codegen**  | The build-time emission of `elements.ts` and `api.ts` per target.                                   |

## Sandboxes

Each target gets a sandbox under `sandbox/<target>/`. The sandboxes are
where the components actually run — a real app with the generated
target packages consumed end-to-end.

```
sandbox
+-- react        Vite + React DOM        — `pnpm dev:react`
+-- native       Expo + React Native     — `pnpm dev:native`
+-- <target>     env setup               — `pnpm dev:<target>`
```

Each sandbox depends on its target's packages. Editing a component in `core/`
cause changes in the targets, which should be picked up by the servers.

The sandboxes are not part of the library's published scope. They're dev env only.
