---
name: benchmark
description: This skill should be used whenever the user asks to run the benchmark, or perf tests for this state-machine engine (e.g. "run the benchmark", "run the benchmarks", "check perf", "pnpm benchmark", "how fast is it now"). It runs the suite, shows the results, and then ASKS whether to update the documented result tables before touching any docs.
---

# Run the benchmark suite

Runs the `@chimba-ui/state-machine` benchmark and, only after asking, refreshes
the documented result tables.

## The rule

**Running the benchmark and updating the docs are two separate steps.** Always
run first, show the user the numbers, and then **ask** whether to update the
documented tables. Never edit docs as part of "run the benchmark" without an
explicit yes — benchmark numbers are noisy and the user may just want a look.

## Step 1 — run it

The suite is its own workspace package under `benchmark/`, but the root has a
delegating script, so this works from the repo root or from `benchmark/`:

```bash
pnpm benchmark
```

It runs in one Node process with `--expose-gc` (~1–2 min) and prints a series of
`console.table`s grouped by section (fan-out, compose, computed, engine,
construction, memory, rendering). If the run errors:

- **memory numbers look wildly noisy / a `no --expose-gc` warning** → the script
  passes `--expose-gc` itself via the `benchmark` npm script; make sure you're
  running `pnpm benchmark`, not `tsx index.ts` directly.

Show the user the result tables (or a tidy summary of the headline rows:
single-event throughput, fine-grain 1/5000, construct 10k, memory 64-field,
rendering 1000-row mount + re-render).

## Step 2 — ASK before updating docs

After showing the numbers, ask the user — use the AskUserQuestion tool — whether
to update the documented results. Offer at least:

- **Update the benchmark README** — refresh the "Representative results" tables.
- **Don't update** — just keep the run output.

Do not proceed to Step 3 unless the user says yes.

## Step 3 — update the results (only on a yes)

`benchmark/README.md` is the **single source of truth** for result tables. Update
its "Representative results" section and nothing else — the engine README
(`packages/core/README.md`) deliberately carries only a short prose claim + a
link, no tables, so leave it alone unless a headline ratio genuinely moved (see
below).

Update **only the numbers** — never reword prose, change column layouts, or alter
footnotes. Keep each table's existing alignment. Map the run output:

- **Throughput → single machine, one event**: `core` + `xstate-raw` from section
  C. Convert ops/sec to millions (`2,944,305` → `2.9 M`).
- **Throughput → fine-grain 1/5000**: `core` + `xstate` from section B
  ("Fine-grain … 5000 cells") — the diffed variant, to match the table.
- **Construct 10k**: the `µs / machine` column of "Construct 10,000 machines".
- **Memory**: the `KB / machine` column, **written** rows (thin = 2-field,
  fat = 64-field).
- **Rendering**: the "list of 1000" table — `mount (ms)` + `re-render wall (ms)`
  for `core/instance`, `xstate/selector`, `zag`; rows-woken = `avg rows / move`.

If a fresh ratio clearly crossed a round number (e.g. throughput drops from ~4×
to ~3×, or memory from ~28× to ~20×), also fix the one-line claim in
`packages/core/README.md` ("up to ~4× …", "~28×"). Don't churn it for a rounding
wobble.

### After updating

- Re-read the edited tables to confirm the markdown pipes still line up.
- Run `pnpm format` at the repo root so formatting matches the repo style.
- Remind the user these are disposable first-look numbers from one machine — a
  single run is a snapshot, not a verdict.
