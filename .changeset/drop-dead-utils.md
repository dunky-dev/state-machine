---
'@dunky.dev/state-machine-utils': minor
---

Remove the dead exports: the positioning module (`Placement`, `Side`,
`PositioningOptions`, `placementToSide`, `pickSide`), `memo`, and
`composeHandlers`. Nothing in the repo ever consumed them — `mergeProps`
composes handlers through its own private helper, and positioning was
speculative vocabulary for floating components that don't exist yet.
`mergeProps` is now the package's whole surface. Minor (not patch) because
the symbols were publicly exported: any external import of them breaks.
Positioning will come back designed against a real floating component when
one lands.
