---
'@dunky.dev/svelte-state-machine': minor
---

Add `@dunky.dev/svelte-state-machine` — the Svelte 5 bindings target.

A first-class Svelte bridge written in runes (not a React re-export):
`useMachine` builds the machine and connector once and exposes the connector's
snapshot as `view.api`, derived lazily — `connect()` runs once a transition
settles, only when read. It starts the machine after mount and stops it on
destroy before child components tear down (React's order), and runs each
`ComponentEffect` as its own `$effect`, re-run only when the value of one of its
named prop deps changes. Sends run untracked, so a send from inside an `$effect`
never makes that effect depend on what wakes on it — `connect()`, reactions,
your callbacks. `useSelector` returns `{ current }` and takes the machine as a
value or a getter. `normalize` maps the agnostic bindings to the props a Svelte
element spread expects — the DOM's lowercase event attributes (`onclick`,
`oninput`, `ondblclick`), `tabindex`, `aria-*` — and `mergeProps` chains
handlers consumer-first with the `defaultPrevented` veto, joins `class` and
`style` strings, merges other `class` shapes as `[consumer, library]`, and keeps
symbol-keyed attachments. The same `connect` and machine config run unchanged
across React, Solid, Svelte, React Native, and OpenTUI.

```svelte
<script lang="ts">
  import { normalize, useMachine } from '@dunky.dev/svelte-state-machine'

  let props: DialogProps = $props()
  const view = useMachine(createDialogConfig, connectDialog, dialogEffects, () => props)
</script>

<button {...normalize(view.api.triggerProps)}>Open</button>
```

Props go in as a getter (`() => props`): a component's script runs once and
its props are reactive bindings, so the bridge reads them inside its effects.
Like every target, it compares props shallowly — pass a new reference to change
a value `connect` reads. Read `view.api` where you use it instead of
destructuring it, and read `$derived` slices of it in effects.

The package ships `.svelte.js` runes modules and `.d.ts` files, built with
`@sveltejs/package`, for the consumer's Svelte build to compile: use it through
Vite with `@sveltejs/vite-plugin-svelte` or SvelteKit, and Vitest needs only
that same plugin. The peer range, `svelte` `>=5.16.0 <5.33.5 || ^5.34.5`, is
measured: 5.16 is where `class` arrays and objects resolve through clsx, which
the `mergeProps` merge relies on, and 5.33.5–5.34.4 kept stale spread event
handlers (sveltejs/svelte#16180).
