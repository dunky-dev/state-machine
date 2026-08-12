---
'@dunky.dev/opentui-state-machine': patch
---

Ship a README and a LICENSE file with the package. The npm page was blank and
the package declared `"license": "MIT"` with no license text alongside — both
now match the react and native packages: the README mirrors their structure
(quick start, `normalize` and `mergeProps` reference, API table) and documents
the bring-your-own-lifecycle model, including the module-level, prop-gated
keyboard-handler pattern that stands in for `ComponentEffect` on a terminal.
