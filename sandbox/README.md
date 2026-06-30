# cmdk sandbox — one machine, four substrates

A ⌘K **command palette** driven by a single substrate-agnostic state machine,
rendered four ways. The interesting parts — fuzzy filtering, arrow-key
navigation with wraparound, active-row tracking, selection — all live in
`shared/`, the same bytes on every target. Each app only supplies the markup and
runs its substrate's `normalize()` over the bindings the shared `connect()`
produces.

```
sandbox/
├── shared/      @sandbox/cmdk-core — the machine + connect() + commands (NO framework)
├── react/       Vite + React DOM     → normalize → onClick / aria-* / role
├── svelte/      Vite + Svelte 5      → normalize → onclick / aria-* / role
├── opentui/     Bun + @opentui/react → normalize → onMouseDown / focusable / cells
└── native/      Expo + React Native  → normalize → onPress / accessibilityState
```

The split that makes this work: each app pairs a **lifecycle hook** (`useMachine`)
with a **prop translator** (`normalize`), both from the target's binding package.
The React, OpenTUI, and React Native apps all render through a React reconciler, so
they share React's `useMachine` and only swap `normalize` — the OpenTUI app is the
clearest proof, importing `useMachine` from the React binding and `normalize` from
`@dunky.dev/state-machine-opentui`. The **Svelte** app shows the other axis: it
brings its _own_ `useMachine` (built on runes) from
`@dunky.dev/state-machine-svelte` — a different reconciler entirely — yet runs the
exact same `shared/` machine and `connect()` unchanged. Same behavior, bring your
own framework.

## Run

```bash
# DOM (React) — opens at http://localhost:5173
pnpm -C sandbox/react dev

# DOM (Svelte 5) — opens at http://localhost:5173
pnpm -C sandbox/svelte dev

# Terminal — needs Bun. Press ⌘K / Ctrl+K to open the palette.
pnpm -C sandbox/opentui dev

# Native — needs Expo + an iOS/Android simulator or device.
pnpm -C sandbox/native start    # then press i / a, or scan the QR
```

All four consume the workspace packages straight from their TypeScript `src/`
(Vite alias / Bun workspace / Metro watch-folders) — no build step. The Svelte app
aliases `@dunky.dev/state-machine-svelte` to its `src` too, so the `vite-plugin-svelte`
compiles the binding's `.svelte.ts` runes modules live — exactly how a consumer's
Svelte build processes the package.
