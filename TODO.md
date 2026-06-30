# TODO — Forward-jump-aware anomaly detection

> Agreed next task. This file is a standalone brief for a future chat. Read
> `PROJECT_INSTRUCTIONS.md` first for the overall architecture; everything below
> concerns the **anomaly-detection model**, not rendering.

## The problem

GapScope detects timing anomalies purely from **consecutive gaps** `g[i] = offsets[i+1] − offsets[i]`:

- `g > tol·Δt` → a **dropout**, and `≈ round(g/Δt) − 1` **missing** messages are counted.
- `g < 0` → an **out-of-order** message (its timestamp is earlier than its predecessor's).
- `g === 0` → a **duplicate**.

This consecutive-gap model misattributes a very common real-world corruption: **a single
message whose timestamp jumps far into the future.**

### Worked example (10 ms cadence)

| msg | true arrival | recorded timestamp | resulting gap | current verdict |
|-----|--------------|--------------------|---------------|-----------------|
| A   | t            | t                  | —             | ok |
| **B** | t+10ms     | **t + ~1 s** (corrupt) | `+~1 s` | **dropout → ~100 phantom "missing"** |
| C   | t+20ms       | t+20ms             | `−~980 ms`    | **out-of-order** |
| D   | t+30ms       | t+30ms             | `+10 ms`      | ok |
| …   |              |                    |               | ok |

One bad sample (**B**) produces:

1. **~100 phantom "missing" messages** for the A→B gap (the analyzer thinks a 1-second
   dropout happened), and
2. **a false "out-of-order"** on **C** (and potentially a short cascade if several
   samples sit between B's bogus time and the recovery), because the data appears to
   "go back in time" — when in reality it was **B** that went *forward*.

The actual fault — one message with a corrupt future timestamp — is never identified;
instead its neighbours are blamed.

## What "good" looks like

When a lone sample's timestamp is implausibly far ahead of the local cadence **and** the
stream immediately resumes its normal cadence after it (i.e. the jump is a spike, not a
real gap), the detector should:

- Flag **B itself** as the anomaly — a new category along the lines of
  **"corrupt / future timestamp"** (or "spike"), surfaced like the other types
  (verdict, stat grid, `#anom-note`, heatmap mark, device-card ⚠, background-scan stats).
- **Not** count the A→B span as ~100 missing messages.
- **Not** flag C (and successors) as out-of-order; they are fine — they only looked
  backwards relative to B's bogus value.

Conversely, a *genuine* long dropout (no data for a second, then cadence resumes at the
later time) must **still** be reported as missing/dropout as today. The discriminator is
roughly: **does the timeline continue from the pre-jump cadence (B was a spike) or from
the post-gap time (real outage)?**

## Sketch of an approach (to be designed, not prescriptive)

- Look at the sample **after** the suspected spike. If `offsets[i+2]` resumes close to
  `offsets[i] + k·Δt` for small `k` (the cadence as if B never happened), then B is a
  forward spike — reclassify B, drop the phantom missing for `g[i]`, and suppress the
  `g[i+1] < 0` out-of-order.
- Consider a small look-ahead / median-of-neighbours "expected next time" rather than
  only the immediate predecessor, so a single outlier can't redefine the baseline.
- Decide handling for **clusters** (several corrupt samples in a row) and for a spike
  that lands near the very end of the stream (no recovery sample to confirm).
- Keep duplicates (`g===0`) and genuine reorderings (a real swap of two adjacent
  messages) behaving as they do now.

## Where the logic lives (must stay consistent across both)

The same gap-classification is implemented **twice** and both must be updated together,
or the device-card estimates and the opened-stream figures will disagree:

- **`analyze`** (single opened stream) — `index.html`, the
  `for(i…) { var g = gaps[i]; if(g >= silenceNs)… else if(g > threshold)… else if(g < 0)… }`
  loop. Builds `gapEvents` / `oooEvents` / `silenceEvents` / `msgRuns`, `missSum`,
  `expected`/`dropped`, and `stats`.
- **`makeStatsAcc`** (background device-card scan) — the O(1)-memory walker that yields
  `{drops, missing, outOfOrder, duplicates, tight, …}` per stream. Same gap rules.

Both are validated by the Node harnesses — see `test_experiment.js` (unit-level,
including `classify`/stats cases) and `test_flow.js` (end-to-end). **Add test cases** for
the forward-spike scenario (and a contrast genuine-dropout case) to both, and run
`node test_experiment.js && node test_flow.js` after.

## Acceptance criteria

- The worked example above yields **1 corrupt/future-timestamp anomaly on B**,
  **0 missing**, **0 out-of-order** — instead of ~100 missing + ≥1 out-of-order.
- A genuine 1-second outage (no spike) is **unchanged**: still ~100 missing / dropout.
- A genuine adjacent swap / small backward reorder is **unchanged**: still out-of-order.
- `analyze` and `makeStatsAcc` agree on the counts for the same stream.
- New unit/flow tests cover spike vs. real-dropout vs. real-reorder; both harnesses green.

## Open questions for the next chat

- Exact name/wording + colour for the new anomaly category (reuse `PROB_COLORS`?).
- How far ahead counts as "implausible" — a fixed multiple of Δt, or a function of the
  observed gap distribution?
- Should a confirmed forward spike be *visually* repositioned/annotated on the trace
  (e.g. an arrow from B's bogus time back to where it should sit), mirroring the existing
  out-of-order arrows?
