<script lang="ts">
  import { useSelector } from '@dunky.dev/svelte-state-machine'
  import UseSelector from './use-selector.svelte'
  import type { CountersMachine } from './counters'

  // A parent that renders a reader only while `a` is 0, and listens first.
  let {
    machine,
    pick,
    isEqual,
    onteardown,
  }: {
    machine: CountersMachine
    pick: (machine: CountersMachine) => unknown
    isEqual?: (a: unknown, b: unknown) => boolean
    onteardown?: (value: unknown) => void
  } = $props()

  const a = useSelector(
    () => machine,
    () => machine.context.a,
  )
</script>

{#if a.current === 0}
  <UseSelector {machine} {pick} {isEqual} {onteardown} />
{/if}
