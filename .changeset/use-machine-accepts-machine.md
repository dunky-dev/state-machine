---
'@dunky.dev/state-machine': minor
'@dunky.dev/react-state-machine': minor
'@dunky.dev/solid-state-machine': minor
---

`useMachine` now accepts a ready machine as well as a config. The first argument
may return either, so a machine built elsewhere — for example a machine written
in Rust and wrapped with `fromWasm` — plugs into the same hook, connector and
component effects:

```ts
// a config (unchanged)
useMachine(commandPaletteMachineConfig, connect, effects, props)

// a ready machine, e.g. one written in Rust
useMachine(props => fromWasm(new PaletteMachine(props.commands)), connect, effects, props)
```

A ready machine must come fresh from the factory (one per component instance): the
hook owns its lifecycle, as it does for a config-built machine.

Core exports the helper both bridges use, `toMachine(source)`, and its
`MachineSource` type: a config is built into a stopped service, a ready
machine is returned as is.
