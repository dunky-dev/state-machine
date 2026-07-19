---
'@dunky.dev/state-machine-utils': minor
'@dunky.dev/react-state-machine': minor
'@dunky.dev/native-state-machine': minor
'@dunky.dev/opentui-state-machine': minor
---

`mergeProps` is generic over the consumer's props: a framework prop type (an
interface without an index signature — `PressableProps`, `ComponentProps<'div'>`)
now passes in and comes back out cast-free. Behavior is unchanged; the merged
bag still carries the library's bindings, typed as the consumer's props (the
`Object.assign` convention), so the JSX spread stays clean.

```tsx
// before
const merged = mergeProps(props as Record<string, unknown>, bindings) as PressableProps
// after
const merged = mergeProps(props, bindings)
```
