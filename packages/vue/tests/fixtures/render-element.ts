import { h, render } from 'vue'

// One element through Vue's DOM renderer — the real patchProp / patchEvent path.
export function renderElement<E extends Element = HTMLElement>(
  tag: string,
  props: Record<string, unknown>,
  container: Element = document.createElement('div'),
): E {
  render(h(tag, props), container)
  return container.firstElementChild as E
}
