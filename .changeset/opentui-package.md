---
'@dunky.dev/opentui-state-machine': minor
---

Add `@dunky.dev/opentui-state-machine` — the OpenTUI (terminal) binding target.

A framework-agnostic prop translator: `normalize` (logical bindings → OpenTUI
renderable props) and `mergeProps` (consumer + library merge). Pure functions over
plain objects, with no dependency on `react` or `@opentui/*`, so the same
translator serves every OpenTUI framework binding (`@opentui/react`,
`@opentui/solid`, …). The framework-specific lifecycle binding stays separate —
pair `normalize` with `useMachine`/`useSelector` from
`@dunky.dev/react-state-machine` for OpenTUI-on-React, or with a Solid binding
package for OpenTUI-on-Solid.

`normalize` maps the logical binding surface to OpenTUI's mouse-driven event model
(`onPress` → `onMouseDown`, pointer enter/leave → `onMouseOver`/`onMouseOut`,
`onValueChange` → `onChange` (handling both `<input>`'s bare value and
`<select>`'s `(index, option)` arity), `onWheel` → `onMouseScroll`), passes
`focusable`/`disabled` through, maps `hidden` → `visible`, and drops the ARIA
vocabulary plus the scroll handlers the terminal has no slot for.
