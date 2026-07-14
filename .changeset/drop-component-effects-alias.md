---
'@dunky.dev/react-state-machine': minor
'@dunky.dev/native-state-machine': minor
---

**Breaking:** remove the `ComponentEffects<M, P>` type alias. It was a pure
alias for `ComponentEffect<M, P>[]` — a second public name for the same
concept, with no semantics of its own (it can't enforce the static-list rule
it documented). One concept, one export.

Migration is mechanical:

```diff
-import { type ComponentEffects } from '@dunky.dev/react-state-machine'
+import { type ComponentEffect } from '@dunky.dev/react-state-machine'

-const tooltipEffects: ComponentEffects<TooltipMachine, TooltipProps> = [trackEscape]
+const tooltipEffects: ComponentEffect<TooltipMachine, TooltipProps>[] = [trackEscape]
```
