<script lang="ts">
  import { useMachine } from '@dunky.dev/svelte-state-machine'
  import SliceLeaf from './slice-leaf.svelte'
  import { connectToggle, createToggleConfig, type ToggleView } from './toggle'

  // Derives a slice of its api, as the docs recommend, and hands a prop
  // computed from it to a leaf whose selector closes over that prop — so the
  // leaf's notification re-reads the slice in the middle of a send.
  let { expose }: { expose?: (view: ToggleView) => void } = $props()

  const view = useMachine(createToggleConfig, connectToggle, [], () => ({}))
  const isOpen = $derived(view.api.open)
  // svelte-ignore state_referenced_locally
  expose?.(view)
</script>

<p data-testid="parent">{String(isOpen)}</p>
<SliceLeaf machine={view.machine} wanted={isOpen ? 1 : 0} />
