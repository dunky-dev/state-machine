# @dunky.dev/react-state-machine

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
  import { setup } from '@dunky.dev/state-machine'

  const toggle = setup({
    initial: 'off',
    states: {
      off: { on: { TOGGLE: 'on' } },
      on: { on: { TOGGLE: 'off' } },
    },
  })
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
