<script lang="ts">
  import { useSelector } from '@dunky.dev/state-machine-svelte'
  import type { CountersContext, CountersEvent } from './counters'
  import type { Machine } from '@dunky.dev/state-machine'

  type Sink = { value: unknown; updates: number }

  // `selector` and optional `isEqual` are passed in so each test can shape the
  // selection (primitive vs object) while sharing one harness.
  let {
    machine: m,
    selector,
    isEqual,
    sink,
  }: {
    machine: Machine<'idle', CountersContext, CountersEvent>
    selector: () => unknown
    isEqual?: (a: unknown, b: unknown) => boolean
    sink: Sink
  } = $props()

  // `selector`/`isEqual` are fixed per render in these tests, so reading them
  // once at setup is intentional.
  // svelte-ignore state_referenced_locally
  const selection = useSelector(m, selector, isEqual)

  // Count how many times the selected value actually changes (the metric the
  // React useSelector test counts as "re-renders").
  $effect(() => {
    void selection.current
    sink.value = selection.current
    sink.updates++
  })
</script>

<span data-testid="value">{String(selection.current)}</span>
