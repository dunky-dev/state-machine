# cmdk sandbox — one machine, three substrates

A ⌘K **command palette** driven by a single substrate-agnostic state machine,
rendered three ways. The interesting parts — fuzzy filtering, arrow-key
navigation with wraparound, active-row tracking, selection — all live in
`shared/`, the same bytes on every target. Each app only supplies the markup and
runs its substrate's `normalize()` over the bindings the shared `connect()`
produces.

```
sandbox/
├── shared/      @sandbox/cmdk-core — the machine + connect() + commands (NO framework)
├── react/       Vite + React DOM    → normalize → onClick / aria-* / role
├── opentui/     Bun + @opentui/react → normalize → onMouseDown / focusable / cells
└── native/      Expo + React Native  → normalize → onPress / accessibilityState
```

The split that makes this work: the lifecycle hook (`useMachine`) comes from
`@dunky.dev/state-machine-react` — all three targets render through a React
reconciler — while the **prop translator** (`normalize`) comes from each target's
own package. The OpenTUI app is the clearest proof: it imports `useMachine` from
the React binding and `normalize` from `@dunky.dev/state-machine-opentui`, exactly
the "bring your own framework hook, pair it with the agnostic translator" model.

## Run

```bash
# DOM — opens at http://localhost:5173
pnpm -C sandbox/react dev

# Terminal — needs Bun. Press ⌘K / Ctrl+K to open the palette.
pnpm -C sandbox/opentui dev

# Native — needs Expo + an iOS/Android simulator or device.
pnpm -C sandbox/native start    # then press i / a, or scan the QR
```

All three consume the workspace packages straight from their TypeScript `src/`
(Vite alias / Bun workspace / Metro watch-folders) — no build step.
