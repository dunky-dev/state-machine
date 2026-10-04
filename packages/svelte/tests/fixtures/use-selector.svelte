<script lang="ts" generics="T">
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
    pick: (machine: CountersMachine, wanted: number) => T
    wanted?: number
    isEqual?: (a: T, b: T) => boolean
    // Called with every value the reader observes, once per wake.
    onread?: (value: T) => void
    sendOnMount?: { type: 'incA' }
  } = $props()

  // svelte-ignore state_referenced_locally
  const selection = useSelector(machine, () => pick(machine, wanted), isEqual)
  // svelte-ignore state_referenced_locally
  const report = onread

  // Reads only the selection, so it re-runs exactly when the reader is woken.
  $effect(() => report?.(selection.current))
</script>

<span data-testid="value">{String(selection.current)}</span>
{#if sendOnMount}
  <Sender {machine} event={sendOnMount} />
{/if}
