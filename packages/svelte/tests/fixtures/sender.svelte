<script lang="ts" generics="Event">
  // A child that sends: Svelte runs a child's mount effects before its
  // parent's, and tears the child down while its parent is being destroyed.
  let {
    machine,
    mount,
    destroy,
  }: { machine: { send: (event: Event) => void }; mount?: Event; destroy?: Event } = $props()

  $effect(() => {
    if (mount) machine.send(mount)
    return () => {
      if (destroy) machine.send(destroy)
    }
  })
</script>
