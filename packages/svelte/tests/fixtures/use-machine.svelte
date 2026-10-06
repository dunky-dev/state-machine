<script lang="ts">
  import { useMachine, useSelector, type ComponentEffect } from '@dunky.dev/svelte-state-machine'
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
    // Deep reactive state a test's connect() reads through the props.
    box?: { n: number }
    sendAtInit?: ToggleEvent
    // Runs in a consumer effect, after the bridge started the machine.
    inEffect?: (view: ToggleView) => void
    // Also select `view.api.label` — reading the api from inside notifications.
    selectLabel?: boolean
    childSends?: { mount?: ToggleEvent; destroy?: ToggleEvent }
  }

  let {
    expose,
    createConfig = createToggleConfig,
    connect = connectToggle,
    effects = [],
    copy = false,
    sendAtInit,
    inEffect,
    selectLabel = false,
    childSends,
    ...props
  }: Harness = $props()

  // svelte-ignore state_referenced_locally
  const view = useMachine(createConfig, connect, effects, copy ? () => ({ ...props }) : () => props)
  // svelte-ignore state_referenced_locally
  expose?.(view)
  // svelte-ignore state_referenced_locally
  if (sendAtInit) view.machine.send(sendAtInit)
  // svelte-ignore state_referenced_locally
  const selected = selectLabel ? useSelector(view.machine, () => view.api.label) : undefined

  $effect(() => inEffect?.(view))
</script>

<button data-testid="toggle" onclick={() => view.api.toggle()}>
  {`${view.api.label ?? '-'} ${view.api.open ? 'open' : 'closed'} ${view.api.count}`}
</button>
{#if selected}
  <p data-testid="selected">{selected.current}</p>
{/if}
{#if childSends}
  <Sender machine={view.machine} mount={childSends.mount} destroy={childSends.destroy} />
{/if}
