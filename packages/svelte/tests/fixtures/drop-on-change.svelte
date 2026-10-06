<script lang="ts">
  import { useSelector } from '@dunky.dev/svelte-state-machine'
  import UseSelector from './use-selector.svelte'
  import type { CountersMachine } from './counters'

  // A parent that renders a reader only while `a` is 0, and listens first.
  let {
    machine,
    pick,
  }: { machine: CountersMachine; pick: (machine: CountersMachine) => unknown } = $props()

  const a = useSelector(
    () => machine,
    () => machine.context.a,
  )
</script>

{#if a.current === 0}
  <UseSelector {machine} {pick} />
{/if}
