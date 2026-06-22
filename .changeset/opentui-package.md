---
'@dunky.dev/opentui-state-machine': minor
---

Add `@dunky.dev/opentui-state-machine` — the OpenTUI (terminal) binding target.

A framework-agnostic prop translator: `normalize` (logical bindings → OpenTUI
renderable props) and `mergeProps` (consumer + library merge). Pure functions over
plain objects, with no dependency on `react` or `@opentui/*`, so the same
translator works under any of OpenTUI's reactive bindings (`@opentui/react`,
`@opentui/solid`, …). The lifecycle binding is the consuming app's concern — it
brings its own framework hook to drive the engine's connector — so this package
ships only the translator.

`normalize` maps the logical binding surface to OpenTUI's mouse-driven event model
(`onPress` → `onMouseDown`, pointer enter/leave → `onMouseOver`/`onMouseOut`,
`onValueChange` → `onChange` (handling both `<input>`'s bare value and
`<select>`'s `(index, option)` arity), `onWheel` → `onMouseScroll`), passes
`focusable`/`disabled` through, maps `hidden` → `visible`, and drops the ARIA
vocabulary plus the scroll handlers the terminal has no slot for.
