# Accessibility

## Overview

Dunky is substrate-agnostic; its accessibility contract is not invented here.
The W3C's web accessibility specs are the baseline for every machine —
including the ones that never touch a browser.

Behavior is modeled once in `packages/core` and every target inherits it. That
needs a single external definition of what the behavior _is_, or each host
drifts toward whatever its platform makes easy. The W3C specs are that
definition: normative and stable, already mapped onto the native platform
accessibility APIs by [Core-AAM](https://www.w3.org/TR/core-aam-1.2/), and the
same documents our consumers audit against. It is why the binding vocabulary in
`packages/shared/bindings` is ARIA-shaped rather than invented — `role`,
`labelledBy`, `activeDescendant`, `live` are the spec's terms, minus the
`aria-` prefix.

So a machine's connector speaks in ARIA terms and holds itself to WCAG. A
target _translates_ those terms into its host's API through `normalize()` —
translation may change the words, never the behavior. If a host forces a
behavioral difference, the decision moves into the core machine, per
[Boundaries](./AGENTS.md#boundaries).

## References

Primary sources. When shaping an API they are looked up, not recalled.

| Spec                                                | Status                    | What we take from it                                                             |
| --------------------------------------------------- | ------------------------- | -------------------------------------------------------------------------------- |
| [WCAG 2.2](https://www.w3.org/TR/WCAG22/)           | Recommendation (2023)     | The success criteria a machine must not violate.                                 |
| [WAI-ARIA 1.2](https://www.w3.org/TR/wai-aria-1.2/) | Recommendation (2023)     | The role, state, and property vocabulary the core machine emits.                 |
| [UAAG 2.0](https://www.w3.org/TR/UAAG20/)           | Working Group Note (2015) | User-agent obligations we must not break or duplicate.                           |
| [ATAG 2.0](https://www.w3.org/TR/ATAG20/)           | Recommendation (2015)     | What lands on us when a consumer builds an authoring tool from these primitives. |
| [WCAG 3.0](https://www.w3.org/TR/wcag-3.0/)         | Working Draft             | Direction of travel only — never cite it as a requirement.                       |

Version notes, so nobody re-litigates them per package: **WAI-ARIA is pinned
to 1.2** — 1.1 is superseded, and [1.3](https://www.w3.org/TR/wai-aria-1.3/)
is a draft read for direction like WCAG 3.0. **WCAG 2.2 is a Recommendation**,
not a candidate one, and it is the bar.

Supporting, but repeatedly load-bearing:

- [APG](https://www.w3.org/WAI/ARIA/apg/) — the patterns. **Advisory**: we
  follow it by default, but a normative spec wins any conflict.
- [Accname](https://www.w3.org/TR/accname-1.2/) — how a name resolves. Needed
  by any machine with a labelling API.
- [WCAG2ICT](https://www.w3.org/TR/wcag2ict/) — applying WCAG to non-web
  software; why a native or terminal target is held to WCAG at all.
- [ARIA in HTML](https://www.w3.org/TR/html-aria/) and
  [`inert`](https://html.spec.whatwg.org/multipage/interaction.html#inert) —
  web target only.

## Packages

A `SPEC.md` sets a `## Reference` section when an external reference anchors
its surface, linking it. (Per [SPEC](./AGENTS.md#spec), don't add a `SPEC.md`
to a package that has none without asking.) For the binding vocabulary the
reference is inline: each ARIA-derived key in
`packages/shared/bindings/src/index.ts` names the ARIA term it carries.

The API must cross-match the reference: every user/dev semantics traces to a
referenced rule or is deliberately ours; every referenced rule is met; the
spec's names win unless there's a reason — and an ARIA-derived key keeps the
spec's meaning _and_ its value domain, not just its name. **Where the API and a
normative spec disagree, the API is the bug if not explicitly justified**.

A deliberate deviation is justified where it lives: in that package's SPEC, or
next to the key it affects in the vocabulary.

## Non-web substrates

Same behavior, same outcomes. What changes is the API it speaks. Each target's
`normalize()` is the entire translation surface, so the maps in it are the
record:

- **Mapping** — the ARIA term has a platform counterpart, so the target
  translates. The normal case; no justification needed.

  ```
  hidden: true
    |
    +-- react   -> aria-hidden
    +-- solid   -> aria-hidden
    +-- native  -> aria-hidden      (RN's web-aligned alias, fanned out per platform)
    +-- opentui -> visible={false}  (no accessibility tree; the visual analog)
  ```

  Where the mapping isn't mechanical — RN folding `disabled`/`expanded`/
  `selected`/`checked`/`busy` into `accessibilityState`, ARIA `live: 'off'`
  becoming RN's `'none'`, `focusable` becoming `tabIndex` on the DOM and
  `focusable` + `accessible` on RN — the target's `normalize()` header carries
  the note.

- **Extra instruction** — the platform adds obligations the web doesn't (touch
  targets, gestures, hardware Back, VoiceOver/TalkBack idioms). Additive, and
  documented in the target's own docs, per
  [Apple](https://developer.apple.com/design/human-interface-guidelines/accessibility),
  [Android](https://developer.android.com/guide/topics/ui/accessibility), and
  [React Native](https://reactnative.dev/docs/accessibility). It must not
  contradict the core contract.
- **Override** — a referenced rule genuinely can't hold here: the host lacks
  the premise (no accessibility tree in a terminal) or its own contract wins
  (the system Back gesture). Record it next to the API it affects: the rule,
  what happens instead, why the host forces it, and what the user still gets.
  An override reinterprets a _mechanism_; a different _decision_ is a core
  change.
- **Anything that doesn't port gets recorded, not skipped** — that is what
  `HANDLER_DROP` and `ATTR_DROP` are for. They're typed against the vocabulary
  (`HandlerKey` / `AttrKey`), so a drop is a named decision and a typo'd or
  unknown key is a compile error instead of a silent leak. The accounting is
  deliberately _not_ exhaustive at the type level — a target is not forced to
  answer every key — so when the vocabulary grows, walking each target is part
  of the change, not something the compiler will do for you. A silent gap is
  indistinguishable from an oversight.

Terminal UIs are the sharpest case: no ARIA, no accessibility tree, no
normative spec — `opentui` drops the whole attribute vocabulary. What survives
is the technology-independent WCAG criteria (via WCAG2ICT) plus the terminal's
own behavior.

## Audit

Accessibility claims are behavior, so they're tested like behavior — in `TEST`,
before the implementation exists.

- **Core** — the semantics the machine emits: resolved role, name and
  description references, which states gate which transitions, the keyboard
  contract.
- **Target** — the translation, against what the host consumes: ARIA
  attributes and focus order on the DOM, real native props on native, real
  widget props in the terminal. A drop is asserted too — a dropped key must not
  leak through as an invalid host prop.
- **Device / browser** — what a mocked host can't reach: real screen readers,
  real hardware Back, real touch. The per-substrate apps in `sandbox/` are
  where that happens.

Automated checks catch missing names and invalid attributes. They don't catch a
focus order that makes no sense or an announcement that misleads — those need a
citation and a human.
