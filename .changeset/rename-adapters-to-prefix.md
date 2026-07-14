---
'@dunky.dev/react-state-machine': minor
'@dunky.dev/native-state-machine': minor
'@dunky.dev/opentui-state-machine': minor
---

Rename the framework adapters back to a `*-state-machine` substrate-prefix convention.

We tried the `state-machine-*` suffix convention (see the previous rename) to
keep the whole `@dunky.dev/*` scope alphabetically consistent. In practice it
proved ergonomically wrong once you picture it scaled to more than one
package family:

```
suffix (tried):        prefix (this change):
button-react            react-button
dropdown-react          react-dropdown
state-machine-react     react-state-machine
```

Picture browsing npm under `@dunky.dev/react-*` — every React package for
this scope, together, in one look. That's the whole point of an org scope:
someone building a React app should be able to find everything React-related
under `@dunky.dev/react-*`. The suffix form breaks that; `button-react`,
`dropdown-react`, and `state-machine-react` don't show up together anywhere,
because "react" isn't what they're named _by_.

It reads backwards at the import site too —
`import { useMachine } from '@dunky.dev/state-machine-react'` names the
library before the framework, when every other adapter a React codebase
imports (`react-redux`, `react-query`, `react-hook-form`) names the framework
first.

- `@dunky.dev/state-machine-react` → `@dunky.dev/react-state-machine`
- `@dunky.dev/state-machine-native` → `@dunky.dev/native-state-machine`
- `@dunky.dev/state-machine-opentui` → `@dunky.dev/opentui-state-machine`

The previous suffix-named packages are deprecated on npm in favor of these.

```diff
- import { useMachine } from '@dunky.dev/state-machine-react'
+ import { useMachine } from '@dunky.dev/react-state-machine'
```

`@dunky.dev/state-machine` (core), `@dunky.dev/state-machine-utils`, and `@dunky.dev/state-machine-bindings` are unchanged — they aren't tied to one substrate, so the prefix convention doesn't apply to them.
