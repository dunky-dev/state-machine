# @dunky.dev/native-state-machine

## 0.4.0

### Minor Changes

- [#62](https://github.com/dunky-dev/state-machine/pull/62) [`caafda4`](https://github.com/dunky-dev/state-machine/commit/caafda465663b2c2a64ce79a7e7c4a11e19f4360) Thanks [@ivanbanov](https://github.com/ivanbanov)! - The `modal` binding now reaches React Native instead of being dropped:
  `normalize()` maps it to `aria-modal`, the web-aligned alias RN routes to
  `accessibilityViewIsModal`.

  ```tsx
  normalize({ modal: true }); // { 'aria-modal': true }
  ```

  It was dropped on the assumption RN had no element-attr analog. It does —
  `aria-modal` sits in the same alias block as `aria-hidden`, which this
  normalizer already targets. The effect is iOS-only (VoiceOver stops reading
  siblings of the modal surface); Android has no sibling-inerting equivalent, so
  it degrades to a no-op there, the same per-platform fan-out `aria-hidden`
  already relies on.

  Without it, a dialog authored once in core announced as modal on the web and as
  an ordinary view on native — the substrate-agnostic contract leaking a hole
  exactly where a screen reader user would notice it.

### Patch Changes

- [#60](https://github.com/dunky-dev/state-machine/pull/60) [`c8e94e4`](https://github.com/dunky-dev/state-machine/commit/c8e94e42c2af112c61a4006ffd43a4b85729c258) Thanks [@ivanbanov](https://github.com/ivanbanov)! - Rolls back 0.4.0's translation-contract surface — it shipped by mistake.
  `DROPPED_HANDLERS`/`DROPPED_ATTRS` are removed, and `HandlerTargets`/
  `AttrTargets` are now the partial rename maps
  (`Partial<Record<HandlerKey, string>>`) instead of exhaustive
  null-accounting records.

  What stays is the part that mattered: maps and drop sets are typed by the
  real vocabulary keys (`HandlerKey`/`AttrKey`), so a typo'd or unknown entry
  is a compile error instead of a silent leak.

- Updated dependencies [[`e6caca8`](https://github.com/dunky-dev/state-machine/commit/e6caca8485fcdbb9b7afd4d5940781d4b1ce82e3), [`6deab75`](https://github.com/dunky-dev/state-machine/commit/6deab7569ee7854bb5b8b8efca611ef7e5db28ce), [`6deab75`](https://github.com/dunky-dev/state-machine/commit/6deab7569ee7854bb5b8b8efca611ef7e5db28ce), [`b70bedc`](https://github.com/dunky-dev/state-machine/commit/b70bedce257c1fedc0a5a47243ea9f56d211ade1), [`c8e94e4`](https://github.com/dunky-dev/state-machine/commit/c8e94e42c2af112c61a4006ffd43a4b85729c258), [`e6caca8`](https://github.com/dunky-dev/state-machine/commit/e6caca8485fcdbb9b7afd4d5940781d4b1ce82e3)]:
  - @dunky.dev/react-state-machine@0.3.4
  - @dunky.dev/state-machine-utils@0.4.0
  - @dunky.dev/state-machine@0.3.3
  - @dunky.dev/state-machine-bindings@0.4.1

## 0.3.3

### Patch Changes

- [#57](https://github.com/dunky-dev/state-machine/pull/57) [`2532b06`](https://github.com/dunky-dev/state-machine/commit/2532b066455c7b1cd3c03eda270d8ce53498df19) Thanks [@ivanbanov](https://github.com/ivanbanov)! - The translation contract: every target must account for every vocabulary key —
  mapped, or `null` as a declared drop. Previously the normalize maps were
  untyped, so a new binding compiled everywhere and silently leaked to the host;
  now it's a compile error in every target until that target decides.

  Bindings exports the contract (`HandlerKey`/`AttrKey`, `HandlerTargets`/
  `AttrTargets`) and the all-dropped bases `DROPPED_HANDLERS`/`DROPPED_ATTRS`
  for targets that express little of the vocabulary (they inherit `null` for
  future keys; the compile error fires at the base):

  ```ts
  export const HANDLER_MAP: HandlerTargets = {
    ...DROPPED_HANDLERS, // hover, keyboard, double-press, wheel: no RN analog
    onPress: "onPress",
    onPointerDown: "onPressIn",
    // ...everything this target can express
  };
  ```

  No behavior change in the targets; a conformance test per target walks its
  ledger and asserts every binding lands on its declared target — or, for a
  `null`, nowhere at all.

- [#59](https://github.com/dunky-dev/state-machine/pull/59) [`59f279e`](https://github.com/dunky-dev/state-machine/commit/59f279e8748d25f5c95999987bc1d944a9ff92d9) Thanks [@ivanbanov](https://github.com/ivanbanov)! - Internal dependencies on sibling workspace packages are now pinned to an
  exact version instead of a caret range, and every package versions
  independently — the `@dunky.dev/*` lockstep group is gone, so a release
  never bumps a package whose code didn't change.

  A caret range between two packages that both sit above a shared dependency
  lets a consumer's install resolve to two different physical copies of it
  once those packages' required ranges drift apart, silently breaking anything
  identity-sensitive in that shared dependency (a singleton, a `WeakMap`,
  module-level state). Pinning exact collapses that to one resolvable version:
  a mismatch now fails at publish time instead of surfacing as a runtime bug
  in a consumer's app.

- Updated dependencies [[`2532b06`](https://github.com/dunky-dev/state-machine/commit/2532b066455c7b1cd3c03eda270d8ce53498df19), [`59f279e`](https://github.com/dunky-dev/state-machine/commit/59f279e8748d25f5c95999987bc1d944a9ff92d9)]:
  - @dunky.dev/state-machine-bindings@0.4.0
  - @dunky.dev/react-state-machine@0.3.3

## 0.3.2

### Patch Changes

- [#53](https://github.com/dunky-dev/state-machine/pull/53) [`ff68b45`](https://github.com/dunky-dev/state-machine/commit/ff68b45343293a5f11bba6b032a6f89edf64c83e) Thanks [@ivanbanov](https://github.com/ivanbanov)! - Ship the `src` folder in the published packages, alongside `dist`. The
  READMEs point at source files for the full binding mappings (e.g.
  `./src/normalize.ts`), and those links were dead on the npm page because
  only `dist` was published. The sources are small, plain TypeScript, so the
  readable reference now travels with the package; the build outputs and the
  `exports` map are unchanged.
- Updated dependencies [[`ff68b45`](https://github.com/dunky-dev/state-machine/commit/ff68b45343293a5f11bba6b032a6f89edf64c83e)]:
  - @dunky.dev/state-machine@0.3.2
  - @dunky.dev/react-state-machine@0.3.2
  - @dunky.dev/state-machine-utils@0.3.2

## 0.3.1

### Patch Changes

- [#54](https://github.com/dunky-dev/state-machine/pull/54) [`2b5bac0`](https://github.com/dunky-dev/state-machine/commit/2b5bac01db11c6887fbff4154ba47617e6d76e1a) Thanks [@ivanbanov](https://github.com/ivanbanov)! - `normalize` fixes two accessibility translations that silently misfired:

  - `hidden` now maps to RN's web-aligned `aria-hidden` instead of folding into `accessibilityState` — which has no `hidden` slot, so the value was stored and ignored. `aria-hidden` is fanned out per platform by RN itself (`accessibilityElementsHidden` on iOS, `importantForAccessibility: 'no-hide-descendants'` on Android).
  - `describedBy` is now dropped. RN has no describe-by-reference slot (there is no `aria-describedby`); the old mapping routed it into `accessibilityLabelledBy`, which misnamed the element and clobbered `labelledBy` whenever a part emitted both — a dialog's content was announced by its description instead of its title.

  ```ts
  normalize({ hidden: true });
  // before: { accessibilityState: { hidden: true } }  -> ignored by RN
  // after:  { 'aria-hidden': true }

  normalize({ labelledBy: "title", describedBy: "desc" });
  // before: { accessibilityLabelledBy: 'desc' }  -> named by its description
  // after:  { accessibilityLabelledBy: 'title' }
  ```

- [#54](https://github.com/dunky-dev/state-machine/pull/54) [`2b5bac0`](https://github.com/dunky-dev/state-machine/commit/2b5bac01db11c6887fbff4154ba47617e6d76e1a) Thanks [@ivanbanov](https://github.com/ivanbanov)! - `normalize` now passes `role` through to React Native's web-aligned `role` prop instead of mapping it to the legacy `accessibilityRole`.

  `accessibilityRole` takes a narrow enum that Android validates in native code — any ARIA role outside it (e.g. `dialog`, emitted by the dialog machine) crashed on device with `Invalid accessibility role value`. The `role` prop (RN 0.71+) accepts the full ARIA vocabulary, takes precedence over `accessibilityRole`, and degrades gracefully for roles a platform can't map.

  ```ts
  normalize({ role: "dialog" });
  // before: { accessibilityRole: 'dialog' }  -> native crash on Android
  // after:  { role: 'dialog' }
  ```

- Updated dependencies []:
  - @dunky.dev/state-machine@0.3.1
  - @dunky.dev/react-state-machine@0.3.1
  - @dunky.dev/state-machine-utils@0.3.1

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

- Updated dependencies [[`521440e`](https://github.com/dunky-dev/state-machine/commit/521440e452c9686ad871e00a15a5af3f771a6228), [`a37c088`](https://github.com/dunky-dev/state-machine/commit/a37c088a542e32857efcb1aef226d0ebf34e689d), [`58f9d7e`](https://github.com/dunky-dev/state-machine/commit/58f9d7e2c2dc8e432650fcfdb9ebf91bda50bb5f)]:
  - @dunky.dev/react-state-machine@0.3.0
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

- Updated dependencies [[`d0e20a5`](https://github.com/dunky-dev/state-machine/commit/d0e20a5ac3ca953c923e05819034e420394af83b)]:
  - @dunky.dev/state-machine-react@0.2.0
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
  - @dunky.dev/react-state-machine@0.1.0
  - @dunky.dev/state-machine-utils@0.1.0
