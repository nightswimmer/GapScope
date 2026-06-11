# GAPSCOPE — Project Instructions

This file is the starting reference for each Claude conversation. It captures the current state of the project so future chats have context. **Update it at the end of every working session.**

## What this project is

GAPSCOPE is a **capture integrity inspector**: a single-file, browser-based tool that analyzes timestamped data captures (CSV/text) for timing anomalies. The user drops a file and GAPSCOPE reports dropped samples, dropout locations, and arrivals that are too close together. It runs entirely client-side — no uploads, no server, no build step.

The whole application lives in **one file**: [index.html](index.html) (HTML + CSS + vanilla JS, no dependencies).

## Core concepts

- **Δt (nominal interval)** — the expected spacing between samples. Auto-detected from the median gap, or set manually.
- **Gap threshold** — multiplier of Δt above which a gap counts as a dropout (default 1.5×).
- **Too-close threshold** — a floor (default 900 µs) below which a spacing is flagged as suspiciously tight.
- **Time modes** — absolute (epoch/wall-clock UTC) vs. relative (elapsed seconds), auto-detected: a first sample beyond ~1973 in epoch terms is treated as absolute.
- **Nanosecond precision** — timestamps are parsed to exact ns using BigInt; offsets from the first sample are stored as Numbers.
- **Trace layers** — three independent toggles drive the trace canvas: `showRaw` (per-channel value plots), `showAnom` (dropout/too-close spikes + heatmap + tables), and `showTs` (a vertical line per sample). They compose; `showTs` lines are drawn under the anomaly/raw layers and collapse to one line per pixel column via the same `columns()` aggregation the spikes use.
- **Measurement arrows** — on hover, double-headed arrows on the overlay canvas show the Δt between the items bracketing the cursor: between events (when `showAnom`, accent blue) and/or between samples (when `showTs`, steel blue). Both can show at once, offset vertically.
- **Per-missing-message rendering** — a dropout is drawn as one line per missing message at its expected arrival time (`gap.start + k·Δt`), not as a single band spanning the gap. Lines are colored/height-scaled by the parent gap's severity (`spikeColor` + log scale). Below ~2px expected spacing the burst collapses to one spike per pixel column. Applies to both `drawAnomBipolar` and the raw-mode `overlayAnomBands`.
- **Settings persistence** — `tolerance`, `closeNs`, the three toggles, and a *pinned* Δt are saved to `localStorage` (`gapscope.settings`) and restored on load (`saveSettings`/`loadSettings`/`reflectSettings`). Δt auto-detects when no pin is saved; the **auto** button re-detects on demand and clears the pin.
- **Zoom depth** — tightest window is `intervalNs * 5` (~5 samples), uniform regardless of capture size (no duration-relative floor).
- **Chunked streaming load** — files are read as 8 MB (tunable) byte slices via `file.slice` + `FileReader.readAsArrayBuffer`, decoded with a streaming `TextDecoder` that carries an incomplete trailing line (`tail`) across chunk boundaries, and fed line-by-line into `makeLineParser().feed()`. This avoids both the V8 ~512 MB single-string cap (`readAsText`) and a giant lines array, so max file size is now bounded by sample-count memory, not raw bytes. The **Read chunk** control (`#chunk`, MB) is persisted in settings and read at the start of each load. The loaded-file meta line reports a `loaded in <ms/s>` read+parse time (measured from `performance.now()` at `handleFile` start) for benchmarking.
- **Big-capture render perf** — per-frame cost is kept proportional to what's on screen, not total dataset size: the trace's `columns`/`channelColumns` bind to visible samples via `lowerBound`; the full-capture heatmap `columns(w,0,full,true)` is cached (`heatCache`, keyed by a `heatEpoch` data counter bumped in `resetData` + canvas width) so pan/zoom only recolors (O(width)) and redraws the viewport box; and the dropout loops in `drawAnomBipolar`/`overlayAnomBands` use `visibleGapRange(t0,t1)` (binary search over the start/end-sorted `gapEvents`) to iterate only on-screen dropouts.
- **LOD aggregate pyramid** — `buildPyramid()` (run once per load, after parse, behind a "Building overview…" status) precomputes multi-resolution clusters: the finest level bins `LOD_BASE` (64) raw samples; each coarser level merges pairs until ≤2 bins. Per bin it stores start time, `maxGap`/`minGap` (each bin owns `gaps[a..e-1]` so boundary dropouts are caught), present-count, and per-channel `cmin`/`cmax`. `pickLevel(visibleSamples,cols)` returns the coarsest level with `size ≤ samples/pixel` (or `null` → raw scan when <64 samples/px or no pyramid). `columns`/`channelColumns` aggregate from the chosen level via `firstBin` (binary search), making zoomed-out draws O(cols) instead of O(visible raw samples). Gaps spread across their time extent (`[bin.t, nextBin.t]`); samples/channel envelopes bucket at the bin's start column. Memory ~N/32. The heatmap passes `forceRaw=true` to stay pixel-exact (it's cached). Known approximation: at LOD zoom, cluster placement within a pixel is by bin-start time, so a *very* wide dropout in the trace may under-fill its pixel extent (the heatmap still shows it exactly); precision returns on zoom-in to the raw path. Pyramid only built when `N ≥ LOD_BASE*4`; cleared in `resetData`.
- **Trace navigation** — scroll = wheel-zoom anchored at cursor; **left-drag = select a region to zoom into** (shaded phosphor band + span label drawn via `drawSelection` on the overlay; drags < 4px ignored; selections narrower than `minWindowNs` expand to that floor around the midpoint); **right-drag = pan** (with `contextmenu` suppressed on the trace canvas); double-click = reset to full extent. The heatmap minimap keeps its own left-click/drag navigation.

## File / code map (index.html)

- **CSS** (`:root` theme vars, dark "phosphor" oscilloscope aesthetic) — lines ~7–207.
- **Markup** — drop zone, loaded bar, progress, results (verdict, stat grid, trace, heatmap, dropout table, tight-spacing table) — lines ~209–372.
- **JS** (IIFE, `"use strict"`) — lines ~374 onward:
  - **State** — globals for offsets, gaps, channels, stats, view window.
  - **Parsing** — `parseTsNs` (timestamp → BigInt ns), `makeLineParser` (stateful per-line feeder), `streamParse` (chunked byte-slice reader + streaming decode), `median`.
  - **Analysis** — `analyze` builds `gapEvents`, `tightEvents`, merged `eventList`, and `stats`; `visibleGapRange` (binary-search the on-screen dropout slice).
  - **LOD pyramid** — `buildPyramid` / `newLevel` (precompute multi-resolution clusters), `pickLevel` (choose level by samples-per-pixel), `firstBin` (binary-search bins by time).
  - **Formatting** — `fmtGap`, `fmtDuration`, `absClock`, `absDate`, `absSecNum`, etc.
  - **Canvas** — `columns` / `channelColumns` (per-pixel aggregation, raw or LOD-sourced), `drawTrace`, `drawAnomBipolar`, `drawRawChannels`, `overlayAnomBands`, `drawAllTimestamps`, `drawHeat` (cached + worst-case coloured), `drawOneArrow` / `drawMeasureArrows`, `drawSelection` (zoom-select band).
  - **Render** — `render`, `renderTable`, `renderTightTable`, `buildChannelLegend`, `applyViewVisibility`.
  - **Interaction** — `bindHover` (hover readouts, measurement arrows, wheel zoom, drag pan, heatmap navigation), file handling, apply/reset/toggle handlers, resize.

## Current state

- Fully functional single-file tool.
- Initial commit done. Subsequent work added the **Show All Timestamps** trace layer (`showTs`) with per-sample vertical lines and inter-sample measurement arrows (dual arrows when anomalies are also shown).
- A prior session added: **localStorage settings persistence** + an **auto-detect Δt** button, **uniform zoom depth** regardless of capture size, and **per-missing-message dropout rendering** (one severity-colored line per missing message at its expected time, replacing the spanning band).
- A prior session added: **chunked streaming file load** (`makeLineParser` + `streamParse`) replacing the `readAsText`-then-`split` path, lifting the ~512 MB single-string ceiling so multi-GB captures open; a **Read chunk (MB)** tunable + persisted setting; a **`loaded in …` read-time readout** on the file meta line for benchmarking; and **new trace navigation** — left-drag selects a region to zoom into, right-drag pans (browser context menu suppressed).
- This session added: **worst-case heatmap colouring** (each slice takes its most-severe dropout colour via `spikeColor`, matching the trace's severity legend; removed the old `coverageColor`/`lerp`); a **wide-dropout fill fix** (`columns` spreads each gap across every column it covers, so bursts no longer render as one line with empty space until you zoom in); and a **big-dataset performance pass** — cached full-capture heatmap columns (`heatCache`/`heatEpoch`), binary-searched dropout drawing (`visibleGapRange`), and a **multi-resolution LOD pyramid** (`buildPyramid`/`pickLevel`/`firstBin`) so `columns`/`channelColumns` draw from precomputed clusters when zoomed out — keeping pan/zoom smooth on tens of millions of samples.

## Conventions / preferences

- Keep it dependency-free and single-file unless there's a strong reason not to.
- Vanilla JS, ES5-ish style (`var`, function expressions) consistent with the existing code.
- When asked about a bug/feature, answer first and confirm before changing anything (see CLAUDE.md).
- Remind the user to push to GitHub before big structural changes.

## Ideas / possible future work

(none recorded yet — add as they come up)
