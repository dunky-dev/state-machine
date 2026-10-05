<script lang="ts">
  import { untrack } from 'svelte'
  import { useSelector } from '@dunky.dev/svelte-state-machine'
  import Sender from './sender.svelte'
  import type { CountersMachine } from './counters'

  let {
    machine,
    pick,
    wanted = 0,
    isEqual,
    onread,
    sendOnMount,
  }: {
    machine: CountersMachine
    // The selector closes over `wanted`, the way a leaf's selector closes over its props.
    pick: (machine: CountersMachine, wanted: number) => unknown
    wanted?: number
    isEqual?: (a: unknown, b: unknown) => boolean
    // Called with every value the reader observes, once per wake.
    onread?: (value: unknown) => void
    sendOnMount?: { type: 'incA' }
  } = $props()

  const selection = useSelector(
    () => machine,
    () => pick(machine, wanted),
    (a, b) => (isEqual ?? Object.is)(a, b),
  )

  // Tracks only the selection, so it re-runs exactly when the reader is woken.
  $effect(() => {
    const value = selection.current
    untrack(() => onread?.(value))
  })
</script>

<span data-testid="value">{String(selection.current)}</span>
{#if sendOnMount}
  <Sender {machine} mount={sendOnMount} />
{/if}
