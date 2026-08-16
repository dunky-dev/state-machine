---
'@dunky.dev/state-machine-bindings': patch
'@dunky.dev/react-state-machine': patch
'@dunky.dev/native-state-machine': patch
'@dunky.dev/opentui-state-machine': patch
---

Rolls back 0.4.0's translation-contract surface — it shipped by mistake.
`DROPPED_HANDLERS`/`DROPPED_ATTRS` are removed, and `HandlerTargets`/
`AttrTargets` are now the partial rename maps
(`Partial<Record<HandlerKey, string>>`) instead of exhaustive
null-accounting records.

What stays is the part that mattered: maps and drop sets are typed by the
real vocabulary keys (`HandlerKey`/`AttrKey`), so a typo'd or unknown entry
is a compile error instead of a silent leak.
