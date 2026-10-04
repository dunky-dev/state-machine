<script lang="ts">
  // Spreads an attribute bag onto one real element, the way a component spreads
  // `normalize(...)` / `mergeProps(...)` output.
  let { tag = 'div', attrs }: { tag?: string; attrs: Record<string, unknown> } = $props()
</script>

<svelte:element this={tag} data-testid="target" {...attrs} />
