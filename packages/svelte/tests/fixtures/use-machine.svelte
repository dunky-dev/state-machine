<script lang="ts">
  import { useMachine, type ComponentEffect } from '@dunky.dev/svelte-state-machine'
  import Sender from './sender.svelte'
  import {
    connectToggle,
    createToggleConfig,
    type ToggleApi,
    type ToggleMachine,
    type ToggleProps,
  } from './toggle'

  type Harness = ToggleProps & {
    expose?: (view: { readonly api: ToggleApi; readonly machine: ToggleMachine }) => void
    connect?: typeof connectToggle
    effects?: ComponentEffect<ToggleMachine, ToggleProps>[]
    // Hand useMachine a getter that builds its own object (the destructured-
    // defaults shape) instead of the live props.
    copy?: boolean
    sendOnMount?: { type: 'toggle' }
  }

  let {
    expose,
    connect = connectToggle,
    effects = [],
    copy = false,
    sendOnMount,
    ...props
  }: Harness = $props()

  // svelte-ignore state_referenced_locally
  const view = useMachine(
    createToggleConfig,
    connect,
    effects,
    copy ? () => ({ ...props }) : () => props,
  )
  // svelte-ignore state_referenced_locally
  expose?.(view)
</script>

<button data-testid="toggle" onclick={() => view.api.toggle()}>
  {`${view.api.label ?? '-'} ${view.api.open ? 'open' : 'closed'} ${view.api.count}`}
</button>
{#if sendOnMount}
  <Sender machine={view.machine} event={sendOnMount} />
{/if}
