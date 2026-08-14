---
'@dunky.dev/vue-state-machine': minor
---

Add the Vue 3 bindings package (`@dunky.dev/vue-state-machine`). It mirrors the React package's API one-for-one — `useMachine`, `useSelector`, `normalize`, `mergeProps`, and the `ComponentEffect` type — implemented with Vue's reactivity: `useMachine` builds the machine + connector once in `setup()`, runs `start`/`stop` on the mount lifecycle, pushes prop changes through `setProps`, runs each `ComponentEffect` as its own dep-keyed `watch`, and exposes the connector snapshot as a `ComputedRef`; `useSelector` returns a value-deduped readonly ref; `normalize` translates the agnostic bindings to Vue DOM/ARIA props; `mergeProps` merges consumer + component props with Vue's `class`/`style` conventions.

```vue
<script setup lang="ts">
import { useAttrs } from 'vue'
import { useMachine, normalize, mergeProps } from '@dunky.dev/vue-state-machine'
import { toggleMachineConfig, connectToggle, toggleEffects, type ToggleProps } from './toggle'

const props = defineProps<ToggleProps>()
const attrs = useAttrs()

const { api } = useMachine(toggleMachineConfig, connectToggle, toggleEffects, props)
</script>

<template>
  <button v-bind="mergeProps(attrs, normalize(api.parts.trigger))">
    {{ api.pressed ? 'On' : 'Off' }}
  </button>
</template>
```
