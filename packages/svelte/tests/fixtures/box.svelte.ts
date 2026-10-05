// Deep reactive state a parent might pass down as a prop value.
export function makeBox(): { n: number } {
  const box = $state({ n: 0 })
  return box
}
