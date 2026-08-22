# @dunky.dev/state-machine

## 0.3.3

### Patch Changes

- [#65](https://github.com/dunky-dev/state-machine/pull/65) [`b70bedc`](https://github.com/dunky-dev/state-machine/commit/b70bedce257c1fedc0a5a47243ea9f56d211ade1) Thanks [@ivanbanov](https://github.com/ivanbanov)! - Harden the notify and teardown paths across the core, and cut hot-path
  allocations:

  - A listener removed during a notify pass no longer fires again when a nested
    notify (a send from inside a subscriber) rebuilds the iteration snapshot
    mid-pass — unsubscribing is now final even under re-entrancy. The same
    guarantee now holds for connector and store subscribers, and the mechanism
    lives in one shared primitive instead of three near-copies.
  - A state cleanup that throws no longer skips the remaining cleanups or leaves
    the pass populated: every cleanup runs (timers and subscriptions all
    release), the first error is rethrown after the pass, and the next stop
    cannot double-run them.
  - A `sync()` rule or `combine().subscribe()` disposed by hand now detaches from
    the composition's registry — long-lived groups with subscribe/unsubscribe
    churn no longer grow it without bound, and `stop()` no longer re-runs
    hand-run disposers.
  - Computed recompute is allocation-free: dep keys/values live in reused
    buffers and are captured at read time, so the old post-pass that re-read
    every dep is gone. In the benchmark suite this lands recompute ~1.5× and
    4-deep computed chains ~1.6× faster.
  - `machine.select` is built once and reused instead of allocating a fresh
    facade object on every property access, so its identity is stable (safe for
    dependency arrays).
  - Dropped the internal write-only `version` counter — bumped on every notify,
    read by nothing.

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
