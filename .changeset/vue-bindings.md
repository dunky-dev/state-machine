---
'@dunky.dev/vue-state-machine': minor
---

Add `@dunky.dev/vue-state-machine` — the Vue bindings target, for `vue` `^3.4.0`.

A first-class Vue bridge with the same four exports as the React and Solid
targets. `useMachine` builds the machine and connector once in `setup()`,
exposes the connector's memoized snapshot as a `ComputedRef`, keeps props fresh
through `setProps`, and runs the lifecycle in React's order: `start()`, then
each `ComponentEffect`, after mount; on unmount, `stop()` first (parent before
its parts), then the effect cleanups once the component's DOM is gone. An effect re-runs only when one of its named prop deps changes, after
the DOM has been patched. Under `<KeepAlive>` a deactivated component pauses —
machine stopped, effects torn down — and resumes with its state intact, like
React's `<Activity>`; server rendering starts nothing and runs no effect.
`useSelector` returns a computed ref holding the selected value as-is; it
re-selects on machine changes and when a reactive value the selector reads
changes, and takes the machine as a value, ref, or getter.
`normalize` reuses the shared DOM translation from
`@dunky.dev/state-machine-dom` with Vue's listener names (`onPointerenter`,
`onKeydown` — Vue derives the DOM event by hyphenating a listener's camel tail).
`mergeProps` chains handlers with the `defaultPrevented` veto, which Vue's own
`mergeProps` doesn't, and merges `class`/`style` of any shape as
`[consumer, library]`.

```vue
<script setup lang="ts">
import { useMachine, normalize } from '@dunky.dev/vue-state-machine'
import { createDialogConfig, connectDialog, dialogEffects, type DialogProps } from './dialog'

// Vue casts an absent Boolean prop to `false`; `undefined` keeps the core's defaults.
const props = withDefaults(defineProps<DialogProps>(), { open: undefined, modal: undefined })
const { api } = useMachine(createDialogConfig, connectDialog, dialogEffects, props)
</script>

<template>
  <button v-bind="normalize(api.triggerProps)">Open</button>
  <div v-if="api.isOpen" v-bind="normalize(api.contentProps)">Dialog content</div>
</template>
```

Three Vue rules to know. Declare boolean props with `default: undefined`: an
absent `Boolean` prop is cast to `false`, which would make `open` permanently
controlled and drop a `modal: true` default. In an async `setup()`, call
`useMachine` before the first `await` — Vue binds only the lifecycle hooks
registered before it. And send from event handlers, `watch` callbacks, or hooks
rather than `watchEffect`, a `computed`, or a render function: `send()` runs prop
callbacks synchronously, so whatever they read would become a dependency of the
effect that sent.
