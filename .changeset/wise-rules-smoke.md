---
'@dunky.dev/state-machine': minor
---

Rework the authoring API: `setup()` / `setup<Ctx, Ev>()` become `setup.infer()` / `setup.as<Ctx, Ev>()`. Two symmetric, intent-named entry points share the same `.config(...).createMachine(...)` chain — `infer` infers `State` / `Context` / `Event` from the literal, `as` pins them explicitly so named guards/actions/effects/delays are compile-checked.
