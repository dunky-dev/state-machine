---
'@dunky.dev/state-machine': minor
'@dunky.dev/react-state-machine': minor
'@dunky.dev/native-state-machine': minor
'@dunky.dev/opentui-state-machine': minor
'@dunky.dev/state-machine-utils': minor
'@dunky.dev/state-machine-bindings': minor
---

🫏 **Dunky - STATE MACHINE**

Every UI is two things wearing one costume: _behavior_ and _render_. The behavior — open, close, focus, arrow-key through a list, announce it to a screen reader — is the same everywhere. So we write that behavior once for the web, then again for React Native, then again for the next whatever, chasing the same bugs in three places. Headless libraries cut the framework loose but kept the DOM; the logic still can't leave the browser. Dunky cuts the last cord: the behavior is a plain TypeScript state machine that assumes _nothing_ about where it runs, and a thin per-surface layer drops it into any runtime. Write it once. Run it anywhere a `<button>`, a `Pressable`, or a terminal cell can live.

### Why Dunky

**🔒 Locked in by design.** No external prop, no callback, no handle reaches into the machine — its behavior is a closed box, sealed off from the outside world. Consumers don't drive the machine; they react to it. Behavior you can trust because nothing can reach in and bend it.

**🌍 Take it anywhere.** Because it's a closed box, the machine carries its own universal, interactive UI — clickable, focusable, accessible — on _any_ JS surface. React DOM, React Native, a terminal. Same states, same transitions, same intent. Only the render differs.

**⚡️ Blazing fast.** Design systems and dense UIs can run hundreds of live machines at once — a trading wall, a canvas board, a data grid. Dunky is tuned for exactly that load: **~8× XState's event throughput** and **3×+ lighter than Zag** at scale, holding the frame where it counts. [See the benchmark →](https://github.com/dunky-dev/state-machine/tree/main/benchmark#readme)

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
