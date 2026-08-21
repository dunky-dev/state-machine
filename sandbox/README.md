# cmdk sandbox — one machine, four substrates

A ⌘K **command palette** driven by a single substrate-agnostic state machine,
rendered four ways. The interesting parts — fuzzy filtering, arrow-key
navigation with wraparound, active-row tracking, selection — all live in
`shared/`, the same bytes on every target. Each app only supplies the markup and
runs its substrate's `normalize()` over the bindings the shared `connect()`
produces.

```
sandbox/
+-- shared/      @sandbox/cmdk-core — the machine + connect() + commands (NO framework)
|                + src/styles.css — the one stylesheet the React and Solid apps share
+-- react/       Vite + React DOM     → normalize → onClick / aria-* / role
+-- solid/       Vite + Solid         → normalize → onClick / aria-* / tabindex
+-- opentui/     Bun + @opentui/react → normalize → onMouseDown / focusable / cells
+-- native/      Expo + React Native  → normalize → onPress / accessibilityState
```

The split that makes this work: the **prop translator** (`normalize`) comes from
each target's own package, while the lifecycle hook (`useMachine`) comes from
whichever bridge fits the substrate. React, OpenTUI, and React Native all render
through a React reconciler, so they share `@dunky.dev/react-state-machine`'s
hook — the OpenTUI app is the clearest proof: it imports `useMachine` from the
React binding and `normalize` from `@dunky.dev/opentui-state-machine`, exactly
the "bring your own framework hook, pair it with the agnostic translator" model.

## Run

```bash
# DOM (React) — opens at http://localhost:5173
pnpm -C sandbox/react dev

# DOM (Solid) — opens at http://localhost:5173
pnpm -C sandbox/solid dev

# Terminal — needs Bun. Press ⌘K / Ctrl+K to open the palette.
pnpm -C sandbox/opentui dev

# Native — needs Expo + an iOS/Android simulator or device.
pnpm -C sandbox/native start    # then press i / a, or scan the QR
```

All four consume the workspace packages straight from their TypeScript `src/`
(Vite alias / Bun workspace / Metro watch-folders) — no build step.
