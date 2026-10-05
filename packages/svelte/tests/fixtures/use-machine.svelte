<script lang="ts">
  import { useMachine, type ComponentEffect } from '@dunky.dev/svelte-state-machine'
  import Sender from './sender.svelte'
  import {
    connectToggle,
    createToggleConfig,
    type ToggleEvent,
    type ToggleMachine,
    type ToggleProps,
    type ToggleView,
  } from './toggle'

  type Harness = ToggleProps & {
    expose?: (view: ToggleView) => void
    createConfig?: typeof createToggleConfig
    connect?: typeof connectToggle
    effects?: ComponentEffect<ToggleMachine, ToggleProps>[]
    // Hand useMachine a getter that builds its own object (the destructured-
    // defaults shape) instead of the live props.
    copy?: boolean
    sendAtInit?: ToggleEvent
    sendInEffect?: ToggleEvent
    childSends?: { mount?: ToggleEvent; destroy?: ToggleEvent }
  }

  let {
    expose,
    createConfig = createToggleConfig,
    connect = connectToggle,
    effects = [],
    copy = false,
    sendAtInit,
    sendInEffect,
    childSends,
    ...props
  }: Harness = $props()

  // svelte-ignore state_referenced_locally
  const view = useMachine(createConfig, connect, effects, copy ? () => ({ ...props }) : () => props)
  // svelte-ignore state_referenced_locally
  expose?.(view)
  // svelte-ignore state_referenced_locally
  if (sendAtInit) view.machine.send(sendAtInit)

  // A consumer effect that sends; it runs after the bridge started the machine.
  $effect(() => {
    if (sendInEffect) view.machine.send(sendInEffect)
  })
</script>

<button data-testid="toggle" onclick={() => view.api.toggle()}>
  {`${view.api.label ?? '-'} ${view.api.open ? 'open' : 'closed'} ${view.api.count}`}
</button>
{#if childSends}
  <Sender machine={view.machine} mount={childSends.mount} destroy={childSends.destroy} />
{/if}
