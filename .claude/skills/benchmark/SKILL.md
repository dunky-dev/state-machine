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
to update the documented result tables. Offer at least:

- **Update both docs** — refresh the tables in `benchmark/README.md` and
  `packages/core/README.md`.
- **Update benchmark/README.md only**.
- **Don't update** — just keep the run output.

Do not proceed to Step 3 unless the user picks an update option.

## Step 3 — update the tables (only on a yes)

Update **only the numbers** — never reword the surrounding prose, change column
layouts, or alter footnotes. Keep each table's existing formatting and alignment.

Two files hold result tables; keep them consistent:

1. **`benchmark/README.md`** → the "Representative results" section. Tables:
   throughput, construction (µs/machine), memory (KB/machine, 2-field + 64-field),
   React rendering (rows woken / mount / re-render).

2. **`packages/core/README.md`** → the "Benchmark" / Performance section. More
   tables, plus a headline "Overview" table and prose multipliers. Update:
   - **Overview** table (events/sec, spin-up 10k, memory 64-field, render mount,
     re-render).
   - **Throughput** table (single-event, fine-grain 1/5000).
   - **Construction + memory** table (construct µs/machine, 2-field, 64-field).
   - **Idle vs written** memory table (64-field idle + written rows).
   - **React rendering** table (rows woken, mount, re-render wall).
   - Any **prose multipliers** that cite ratios (e.g. "~3.5× XState's throughput",
     "~28× core's memory"). Recompute them from the fresh numbers and only change
     the figure if it actually moved — don't churn a "~3.5×" to "~3.4×" unless it
     genuinely crossed.

### Mapping run output → table cells

The run prints `core`, `xstate`, `xstate-raw`, `zag` rows per scenario. For the
docs:

- **Throughput → single machine, one event**: `core` and `xstate-raw` from
  section C ("Throughput — single machine, one event"). Convert ops/sec to
  millions (e.g. `2,944,305` → `2.94 M`).
- **Throughput → fine-grain 1/5000**: `core` and `xstate` from section B
  ("Fine-grain … 5000 cells"). (Use `xstate`, the diffed variant, to match the
  existing table — note which variant the table already uses and stay consistent.)
- **Construct 10k (µs/machine)**: the `µs / machine` column of "Construct 10,000
  machines".
- **Memory (KB/machine)**: the `KB / machine` column. Use the **written** rows
  for the main construction+memory table (thin = 2-field, fat = 64-field). Use the
  **idle** AND **written** 64-field rows for the idle-vs-written table.
- **Rendering**: the "list of 1000" table — `mount (ms)` and `re-render wall (ms)`
  for `core/instance` (the headline core row), `xstate/selector`, and `zag`. Rows
  woken / move = the `avg rows / move` column (≈2 for the fine-grained strategies).

### After updating

- Re-read both edited tables to confirm columns still line up (markdown table
  pipes aligned).
- Run `pnpm format` (oxfmt) at the repo root so table formatting matches the
  repo style, then `pnpm lint` if any `.ts` changed (docs-only edits don't need
  it).
- Remind the user these are disposable first-look numbers from one machine — a
  single run is a snapshot, not a verdict.
