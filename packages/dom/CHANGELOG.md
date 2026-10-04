# @dunky.dev/state-machine-dom

## 0.1.0

### Minor Changes

- [#32](https://github.com/dunky-dev/state-machine/pull/32) [`e6caca8`](https://github.com/dunky-dev/state-machine/commit/e6caca8485fcdbb9b7afd4d5940781d4b1ce82e3) Thanks [@ivanbanov](https://github.com/ivanbanov)! - Add `@dunky.dev/state-machine-dom` — the DOM half of the bindings translation,
  shared by every DOM target. The `aria-*` attribute projection and the payload
  adapters (`onValueChange`/`onWheel`/`onScroll`/`onScrollEnd` → neutral
  payloads, with `preventDefault` bound to its event) were byte-identical in the
  React and Solid normalizers; they now live once, in this package, and each
  target keeps only what genuinely differs: its handler prop names
  (`onChange`/`onDoubleClick` vs `onInput`/`onDblClick`), the `focusable` →
  tabindex casing (`tabIndex` vs `tabindex`), and its value serialization
  (React passes ARIA booleans through; Solid stringifies them).

  No API change for consumers of the React or Solid packages — `normalize`
  behaves exactly as before; the shared package becomes a dependency of both.
  The motivation is drift-proofing: a payload-adapter fix previously had to be
  applied to each DOM target by hand, and had already diverged once.

### Patch Changes

- Updated dependencies [[`c8e94e4`](https://github.com/dunky-dev/state-machine/commit/c8e94e42c2af112c61a4006ffd43a4b85729c258)]:
  - @dunky.dev/state-machine-bindings@0.4.1
