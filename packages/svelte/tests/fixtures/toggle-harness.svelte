<script lang="ts">
  import { useMachine, type ComponentEffects } from '@dunky.dev/state-machine-svelte'
  import {
    createToggleConfig,
    connectToggle,
    type ToggleApi,
    type ToggleProps,
  } from './toggle'

  type Sink = {
    api?: ToggleApi
    renders: number
    effectRuns: number
    effectCleanups: number
  }

  // The harness writes through a plain object the test holds a reference to, so
  // assertions can read the live api, the render count, and effect bookkeeping
  // without reaching into Svelte internals.
  let {
    label,
    sink,
    trackLabelEffect = false,
  }: { label?: string; sink: Sink; trackLabelEffect?: boolean } = $props()

  // `trackLabelEffect` is fixed per render in these tests; reading it once to
  // shape the effect list at setup is intentional.
  // svelte-ignore state_referenced_locally
  const effects: ComponentEffects<ReturnType<typeof useMachine>['machine'], ToggleProps> =
    trackLabelEffect
      ? [
          [
            (_machine, props) => {
              void props.label // depend on label
              sink.effectRuns++
              return () => {
                sink.effectCleanups++
              }
            },
            ['label'],
          ],
        ]
      : []

  const view = useMachine(createToggleConfig, connectToggle, effects, () => ({ label }))

  // Reading `view.api` in this reactive block counts a "render" per real change,
  // the Svelte analogue of the React harness's render counter.
  $effect(() => {
    void view.api
    sink.renders++
  })

  $effect(() => {
    sink.api = view.api
  })
</script>

<button data-testid="toggle" onclick={() => view.api.toggle()}>
  {view.api.label ?? '∅'} — {view.api.open ? 'open' : 'closed'} — {view.api.count}
</button>
