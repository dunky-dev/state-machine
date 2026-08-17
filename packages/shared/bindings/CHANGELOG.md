# @dunky.dev/state-machine-bindings

## 0.4.0

### Minor Changes

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

## 0.3.2

### Patch Changes

- [#53](https://github.com/dunky-dev/state-machine/pull/53) [`ff68b45`](https://github.com/dunky-dev/state-machine/commit/ff68b45343293a5f11bba6b032a6f89edf64c83e) Thanks [@ivanbanov](https://github.com/ivanbanov)! - Ship the `src` folder in the published packages, alongside `dist`. The
  READMEs point at source files for the full binding mappings (e.g.
  `./src/normalize.ts`), and those links were dead on the npm page because
  only `dist` was published. The sources are small, plain TypeScript, so the
  readable reference now travels with the package; the build outputs and the
  `exports` map are unchanged.

## 0.3.1

## 0.3.0

## 0.2.0

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
