// @vitest-environment jsdom
/**
 * Svelte mergeProps on a real element: the `[consumer, library]` class merge
 * leans on Svelte resolving any class shape through clsx (5.16+), and an
 * attachment on the library side still attaches.
 */
import { render } from '@testing-library/svelte'
import { createAttachmentKey } from 'svelte/attachments'
import { expect, it, vi } from 'vitest'
import { mergeProps, normalize } from '@dunky.dev/svelte-state-machine'
import Spread from './fixtures/spread.svelte'

it('renders a merged class of mixed shapes as one class list', () => {
  const attrs = mergeProps({ class: ['a', { b: true, off: false }] }, { class: 'c' })
  const { getByTestId } = render(Spread, { attrs })
  expect(getByTestId('target').className).toBe('a b c')
})

it('attaches a library attachment through normalize and a merge with consumer props', () => {
  const attach = vi.fn()
  const library = normalize({ role: 'button', [createAttachmentKey()]: attach } as Record<
    string,
    unknown
  >)
  const { getByTestId } = render(Spread, { attrs: mergeProps({ id: 'mine' }, library) })
  expect(attach).toHaveBeenCalledWith(getByTestId('target'))
})
