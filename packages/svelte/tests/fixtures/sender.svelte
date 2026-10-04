<script lang="ts" generics="Event">
  // A child that sends on mount: Svelte runs a child's effects before its
  // parent's, so the event lands before the parent's own mount effects run.
  let { machine, event }: { machine: { send: (event: Event) => void }; event: Event } = $props()

  $effect(() => machine.send(event))
</script>
