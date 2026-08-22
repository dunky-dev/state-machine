# @dunky.dev/solid-state-machine

## 0.3.0

### Minor Changes

- [#32](https://github.com/dunky-dev/state-machine/pull/32) [`e6caca8`](https://github.com/dunky-dev/state-machine/commit/e6caca8485fcdbb9b7afd4d5940781d4b1ce82e3) Thanks [@ivanbanov](https://github.com/ivanbanov)! - Add `@dunky.dev/solid-state-machine` — the Solid bindings target.

  A first-class Solid bridge (not a React re-export): `useMachine` mirrors the
  connector's snapshot into a Solid `createStore` (via `reconcile`) so reading a
  field in JSX is fine-grained, runs the lifecycle through `onSettled`/`onCleanup`,
  keeps props fresh with a tracked `setProps` effect, and runs each
  `ComponentEffect` as its own dep-tracked `createEffect(compute, apply)`.
  `useSelector` returns a Solid accessor. `normalize` maps the agnostic bindings
  to Solid DOM props (`onInput`, `onDblClick`, `tabindex`) and `mergeProps`
  applies Solid's `class` concat + single-object `style` merge. The same `connect`
  and machine config run unchanged across React, Solid, React Native, and OpenTUI.

  Targets Solid 2.0 as a first-class citizen: the peer range is `solid-js`
  `^2.0.0-rc.1`. Solid 1.x is not supported — 2.0 removed the surface a 1.x
  bridge would stand on (`solid-js/store`, single-argument `createEffect`,
  `onMount`) and 1.x lacks the root exports this package imports, so, like the
  rest of the Solid ecosystem (router, TanStack, solid-primitives), the majors
  are version-split. Two consumer-facing 2.0 behaviors: writes commit on the
  microtask queue (call `flush()` in tests before asserting), and JSX comes from
  the renderer package (`"jsxImportSource": "@solidjs/web"`, `render` from
  `@solidjs/web`).

### Patch Changes

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

- [#32](https://github.com/dunky-dev/state-machine/pull/32) [`e6caca8`](https://github.com/dunky-dev/state-machine/commit/e6caca8485fcdbb9b7afd4d5940781d4b1ce82e3) Thanks [@ivanbanov](https://github.com/ivanbanov)! - `preventDefault` on the adapted payloads (`ChangePayload`, `WheelPayload`) now
  actually works. `normalize()` used to copy the native event's `preventDefault`
  onto the payload detached from its event, so the first `connect()` to call
  `payload.preventDefault()` would throw `TypeError: Illegal invocation` — native
  DOM methods require `this` to be a real `Event`. The payload now carries a
  closure bound to the originating event:

  ```ts
  // connect() side — this used to throw, now suppresses the default as promised
  onValueChange: (payload) => {
    payload.preventDefault?.();
  };
  ```

  Latent until now (no in-repo `connect()` calls it yet), but it is the behavior
  the bindings contract promises, so it's fixed in both DOM targets before a
  component relies on it.

- [#32](https://github.com/dunky-dev/state-machine/pull/32) [`e6caca8`](https://github.com/dunky-dev/state-machine/commit/e6caca8485fcdbb9b7afd4d5940781d4b1ce82e3) Thanks [@ivanbanov](https://github.com/ivanbanov)! - A `ComponentEffect` body now runs untracked, so its authored `deps` list is the
  whole re-run contract — identical to the React target's dep array. Previously
  the body executed inside the tracking scope, so any prop the effect merely read
  became a hidden dependency and re-ran it (cleanup + re-subscribe) on changes to
  props it never declared.

  ```ts
  const escape: ComponentEffect<M, Props> = [
    (machine, props) => {
      void props.onEscapeKeyDown; // read, but NOT a dep — no longer re-runs on change
    },
    ["closeOnEscape"], // ONLY this prop re-runs the effect, on every target
  ];
  ```

- Updated dependencies [[`e6caca8`](https://github.com/dunky-dev/state-machine/commit/e6caca8485fcdbb9b7afd4d5940781d4b1ce82e3), [`6deab75`](https://github.com/dunky-dev/state-machine/commit/6deab7569ee7854bb5b8b8efca611ef7e5db28ce), [`6deab75`](https://github.com/dunky-dev/state-machine/commit/6deab7569ee7854bb5b8b8efca611ef7e5db28ce), [`b70bedc`](https://github.com/dunky-dev/state-machine/commit/b70bedce257c1fedc0a5a47243ea9f56d211ade1)]:
  - @dunky.dev/state-machine-dom@0.1.0
  - @dunky.dev/state-machine-utils@0.4.0
  - @dunky.dev/state-machine@0.3.3
