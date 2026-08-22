---
'@dunky.dev/react-state-machine': patch
'@dunky.dev/solid-state-machine': patch
---

`preventDefault` on the adapted payloads (`ChangePayload`, `WheelPayload`) now
actually works. `normalize()` used to copy the native event's `preventDefault`
onto the payload detached from its event, so the first `connect()` to call
`payload.preventDefault()` would throw `TypeError: Illegal invocation` — native
DOM methods require `this` to be a real `Event`. The payload now carries a
closure bound to the originating event:

```ts
// connect() side — this used to throw, now suppresses the default as promised
onValueChange: payload => {
  payload.preventDefault?.()
}
```

Latent until now (no in-repo `connect()` calls it yet), but it is the behavior
the bindings contract promises, so it's fixed in both DOM targets before a
component relies on it.
