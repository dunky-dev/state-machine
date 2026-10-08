<script lang="ts">
  import { useSelector } from '@dunky.dev/svelte-state-machine'
  import type { ToggleMachine } from './toggle'

  let { machine, wanted }: { machine: ToggleMachine; wanted: number } = $props()

  const selection = useSelector(
    () => machine,
    () => `${machine.state}:${wanted}`,
  )
</script>

<span data-testid="leaf">{selection.current}</span>
