import { useEffect } from 'react'

/**
 * One substrate-specific effect, declared as a plain setup/teardown function
 * plus the prop names it depends on:
 *
 *   const escape: ComponentEffect<Machine, Props> = [
 *     (machine, props) => { ...addEventListener...; return () => ...remove... },
 *     ['closeOnEscape', 'onEscapeKeyDown'], // re-run when these props change
 *   ]
 *
 * The author writes no React. The deps are prop NAMES (typed `(keyof Props)[]`,
 * so typos are compile errors); the bridge turns them into a precise React dep
 * array, so the effect re-subscribes only when one of those props actually
 * changes — not every render, never stale. `machine` is always an implicit dep.
 */
export type ComponentEffect<Machine, Props> = [
  effect: (machine: Machine, props: Props) => (() => void) | void,
  deps: (keyof Props)[],
]

/**
 * A component's full set of substrate effects — a list, since one component can
 * have several independent effects with DIFFERENT deps (e.g. an Escape listener
 * gated by `closeOnEscape` and a Tab trap gated by `focusTrap`). Each gets its
 * own React effect so only the one whose dep changed re-subscribes.
 *
 * MUST be a stable module constant (e.g. `export const xEffects = [...]`): the
 * bridge calls one `useEffect` per entry, so the list's length has to be
 * identical across renders (React's rules-of-hooks). A static export guarantees
 * that — never build this array conditionally or per-render.
 */
export type ComponentEffects<Machine, Props> = ComponentEffect<Machine, Props>[]

/**
 * Run a component's `ComponentEffects` — one React effect per entry, each with
 * its own dependency array `[machine, ...the named prop values]`. The generated
 * `useApi` calls this with the component's static effects export, so authors
 * never touch `useEffect`.
 */
export function useEffects<Machine, Props>(
  machine: Machine,
  effects: ComponentEffects<Machine, Props>,
  props: Props,
): void {
  // Safe to loop hooks: `effects` is a stable module constant (see the type
  // doc), so the count never changes between renders.
  for (const [fn, deps] of effects) {
    useEffect(
      () => fn(machine, props),
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [machine, ...deps.map(k => props[k])],
    )
  }
}
