// @vitest-environment jsdom
/**
 * Svelte mergeProps on a real element: the `[consumer, library]` class merge
 * leans on Svelte resolving any class shape through clsx (5.16+).
 */
import { render } from '@testing-library/svelte'
import { expect, it } from 'vitest'
import { mergeProps } from '@dunky.dev/svelte-state-machine'
import Spread from './fixtures/spread.svelte'

it('renders a merged class of mixed shapes as one class list', () => {
  const attrs = mergeProps({ class: ['a', { b: true, off: false }] }, { class: 'c' })
  const { getByTestId } = render(Spread, { attrs })
  expect(getByTestId('target').className).toBe('a b c')
})
