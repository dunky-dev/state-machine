# @dunky.dev/react-state-machine

## 0.3.0

### Minor Changes

- [#49](https://github.com/dunky-dev/state-machine/pull/49) [`521440e`](https://github.com/dunky-dev/state-machine/commit/521440e452c9686ad871e00a15a5af3f771a6228) Thanks [@ivanbanov](https://github.com/ivanbanov)! - **Breaking:** remove the `ComponentEffects<M, P>` type alias. It was a pure
  alias for `ComponentEffect<M, P>[]` — a second public name for the same
  concept, with no semantics of its own (it can't enforce the static-list rule
  it documented). One concept, one export.

  Migration is mechanical:

  ```diff
  -import { type ComponentEffects } from '@dunky.dev/react-state-machine'
  +import { type ComponentEffect } from '@dunky.dev/react-state-machine'

  -const tooltipEffects: ComponentEffects<TooltipMachine, TooltipProps> = [trackEscape]
  +const tooltipEffects: ComponentEffect<TooltipMachine, TooltipProps>[] = [trackEscape]
  ```

- [#51](https://github.com/dunky-dev/state-machine/pull/51) [`a37c088`](https://github.com/dunky-dev/state-machine/commit/a37c088a542e32857efcb1aef226d0ebf34e689d) Thanks [@ivanbanov](https://github.com/ivanbanov)! - `mergeProps` is generic over the consumer's props: a framework prop type (an
  interface without an index signature — `PressableProps`, `ComponentProps<'div'>`)
  now passes in and comes back out cast-free. Behavior is unchanged; the merged
  bag still carries the library's bindings, typed as the consumer's props (the
  `Object.assign` convention), so the JSX spread stays clean.

  ```tsx
  // before
  const merged = mergeProps(
    props as Record<string, unknown>,
    bindings
  ) as PressableProps;
  // after
  const merged = mergeProps(props, bindings);
  ```

- [#43](https://github.com/dunky-dev/state-machine/pull/43) [`58f9d7e`](https://github.com/dunky-dev/state-machine/commit/58f9d7e2c2dc8e432650fcfdb9ebf91bda50bb5f) Thanks [@ivanbanov](https://github.com/ivanbanov)! - Rename the framework adapters back to a `*-state-machine` substrate-prefix convention.

  We tried the `state-machine-*` suffix convention (see the previous rename) to
  keep the whole `@dunky.dev/*` scope alphabetically consistent. In practice it
  proved ergonomically wrong once you picture it scaled to more than one
  package family:

  ```
  suffix (tried):        prefix (this change):
  button-react            react-button
  dropdown-react          react-dropdown
  state-machine-react     react-state-machine
  ```

  Picture browsing npm under `@dunky.dev/react-*` — every React package for
  this scope, together, in one look. That's the whole point of an org scope:
  someone building a React app should be able to find everything React-related
  under `@dunky.dev/react-*`. The suffix form breaks that; `button-react`,
  `dropdown-react`, and `state-machine-react` don't show up together anywhere,
  because "react" isn't what they're named _by_.

  It reads backwards at the import site too —
  `import { useMachine } from '@dunky.dev/state-machine-react'` names the
  library before the framework, when every other adapter a React codebase
  imports (`react-redux`, `react-query`, `react-hook-form`) names the framework
  first.

  - `@dunky.dev/state-machine-react` → `@dunky.dev/react-state-machine`
  - `@dunky.dev/state-machine-native` → `@dunky.dev/native-state-machine`
  - `@dunky.dev/state-machine-opentui` → `@dunky.dev/opentui-state-machine`

  The previous suffix-named packages are deprecated on npm in favor of these.

  ```diff
  - import { useMachine } from '@dunky.dev/state-machine-react'
  + import { useMachine } from '@dunky.dev/react-state-machine'
  ```

  `@dunky.dev/state-machine` (core), `@dunky.dev/state-machine-utils`, and `@dunky.dev/state-machine-bindings` are unchanged — they aren't tied to one substrate, so the prefix convention doesn't apply to them.

### Patch Changes

- Updated dependencies [[`a37c088`](https://github.com/dunky-dev/state-machine/commit/a37c088a542e32857efcb1aef226d0ebf34e689d)]:
  - @dunky.dev/state-machine-utils@0.3.0
  - @dunky.dev/state-machine@0.3.0

## 0.2.0

### Minor Changes

- [`d0e20a5`](https://github.com/dunky-dev/state-machine/commit/d0e20a5ac3ca953c923e05819034e420394af83b) Thanks [@ivanbanov](https://github.com/ivanbanov)! - Rename the framework adapters to the `state-machine-*` suffix convention so the whole scope is consistent (`state-machine`, `state-machine-react`, `state-machine-native`, `state-machine-opentui`, `state-machine-utils`, `state-machine-bindings`).

  - `@dunky.dev/react-state-machine` → `@dunky.dev/state-machine-react`
  - `@dunky.dev/native-state-machine` → `@dunky.dev/state-machine-native`
  - `@dunky.dev/opentui-state-machine` → `@dunky.dev/state-machine-opentui`

  The previous prefix-named packages are deprecated on npm in favor of these.

### Patch Changes

- Updated dependencies []:
  - @dunky.dev/state-machine@0.2.0
  - @dunky.dev/state-machine-utils@0.2.0

## 0.1.0

### Minor Changes

- [#21](https://github.com/dunky-dev/state-machine/pull/21) [`fd950db`](https://github.com/dunky-dev/state-machine/commit/fd950db7378c6af6a18aec5c234018d3345a61f4) Thanks [@ivanbanov](https://github.com/ivanbanov)! - 🫏 **Dunky - STATE MACHINE**

  Every UI is two things wearing one costume: _behavior_ and _render_. The behavior — open, close, focus, arrow-key through a list, announce it to a screen reader — is the same everywhere. So we write that behavior once for the web, then again for React Native, then again for the next whatever, chasing the same bugs in three places. Headless libraries cut the framework loose but kept the DOM; the logic still can't leave the browser. Dunky cuts the last cord: the behavior is a plain TypeScript state machine that assumes _nothing_ about where it runs, and a thin per-surface layer drops it into any runtime. Write it once. Run it anywhere a `<button>`, a `Pressable`, or a terminal cell can live.

  ### Why Dunky

  **🔒 Locked in by design.** No external prop, no callback, no handle into the machine. Its behavior is closed to the world. Consumers react to the machine from outside.

  **🌍 Take it anywhere.** The machine carries a universal, interactive UI of its own, clickable on any JS surface, precisely because it's a closed box.

  **⚡️ Blazing fast.** Design systems and complex UIs can run hundreds of live machines at once. Dunky is tuned for exactly that load. [See the benchmark →](https://github.com/dunky-dev/state-machine/tree/main/benchmark#readme)

  ```ts
  import { setup } from "@dunky.dev/state-machine";

  const toggle = setup({
    initial: "off",
    states: {
      off: { on: { TOGGLE: "on" } },
      on: { on: { TOGGLE: "off" } },
    },
  });
  ```

  This is our first public release (`0.1.0`). The engine is stable and tested; the target bridges are early and evolving. Come kick the tires, watch the live benchmark, and tell us where it breaks.

  👉 **[dunky.dev/state-machine](https://www.dunky.dev/state-machine)**

  ```
                            /\          /\
                           ( \\        // )
                            \ \\      // /
                             \_\\||||//_/
                             \\/ _  _ \
                              \\[ ]=[ ]
                            \/ |      |
        ___________________\/  \      /
       //                //     |____|
      //                ||     /      \
     //|                \|     \ 0  0 /
    // \       )         V    / \____/
   //   \     /        (     /
  ""     \   /_________|  |_/
         /  /\   /     |  ||
        /  / /  /      \  ||
        | |  | |        | ||
        | |  | |        | ||
        |_|  |_|        |_||
         \_\  \_\        \_\\
  ```

### Patch Changes

- Updated dependencies [[`fd950db`](https://github.com/dunky-dev/state-machine/commit/fd950db7378c6af6a18aec5c234018d3345a61f4)]:
  - @dunky.dev/state-machine@0.1.0
  - @dunky.dev/state-machine-utils@0.1.0
