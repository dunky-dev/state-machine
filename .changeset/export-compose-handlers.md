---
'@dunky.dev/state-machine-utils': minor
---

Export `composeHandlers` — the handler-pair composition `mergeProps` has
always applied to overlapping `on*` props, now public: the consumer handler
runs first, and the library handler is skipped when the consumer prevented
default (the first argument's `defaultPrevented`, per Radix/Ark conventions).
No behavior change anywhere — `mergeProps` calls the same function; it was
just private before.

```ts
import { composeHandlers } from '@dunky.dev/state-machine-utils'

const onClick = composeHandlers(consumerOnClick, libraryOnClick)
```
