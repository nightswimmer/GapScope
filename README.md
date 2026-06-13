# GAPSCOPE

**Capture integrity inspector** — a single-file, browser-based tool for spotting timing anomalies in timestamped data captures.

Drop a CSV with a timestamp column, a [Harp](https://harp-tech.org) `.bin` capture, or a whole **experiment folder** and GAPSCOPE tells you whether your streams are clean: how many samples were dropped, where the dropouts are, and whether any samples arrived suspiciously close together. Everything runs locally in your browser — **nothing is uploaded**.

## Features

- **Stream-type classification** — every stream is automatically classified as **constant** (a regular cadence covering most of the experiment — the missing-message model applies), **burst** (a regular cadence covering only part of it: one or more runs surrounded by silence — missing is counted *only within* the runs, never across the silences or the empty timeline before/after), or **pontual** (sporadic arrivals with no dominant cadence — Δt and missing don't apply). The split is by **coverage** of the experiment timeline (active time ÷ total span, >50% ⇒ constant). Each type shows as a color-coded chip (C / B / P) on the device cards and the stream selector, and can be overridden per stream.
- **Shared experiment timeline** — every device in an experiment runs concurrently, so a single register is placed on the whole experiment's clock (earliest start → latest end across all streams), not just its own span. Opening one stream shows it at its true position with the idle timeline before/after rendered as a distinct "no data" band — making it obvious when a device started late, stopped early, or transmitted in bursts.
- **Dropout detection** — finds gaps larger than a configurable threshold (× nominal Δt) and estimates how many samples are missing in each. Each missing message is drawn as its own line at its expected arrival time, colored by gap severity (collapsing to a single mark per pixel when too dense to resolve).
- **Too-close detection** — flags arrivals spaced under a configurable fraction of Δt (default 0.9×), useful for catching duplicated or jittered timestamps. The floor scales automatically with each stream's rate.
- **Auto interval detection** — infers the nominal sample interval (Δt) from the gap distribution: the median, refined to the mean of the gaps around it. The refinement makes it immune to clock-tick quantization (Harp timestamps tick every 32 µs, so a true 1 kHz register produces only 992/1024 µs gaps — the bare median would read 0.992 ms and report phantom missing samples). Δt re-detects for every loaded stream and can be overridden manually, with an **auto** button to re-detect on demand.
- **Large-file streaming** — the capture is read in byte-sized chunks and parsed incrementally, so it never has to fit in a single JavaScript string (which caps out around 512 MB). Multi-gigabyte files open, bounded only by the sample count. The chunk size is exposed as a **Read chunk** control (MB) for tuning throughput, and the loaded-file line reports how long the read+parse took.
- **Harp binary support** — reads [Harp](https://harp-tech.org) `.bin` capture files (the binary format used by [harp-python](https://github.com/harp-tech/harp-python)) in addition to CSV. Timestamps and per-register channels are decoded directly from the message stream, so the same dropout/timing analysis works on Harp data. Register snapshot dumps (the one-message-per-register state file written at connect) are recognized and used to identify the device via its WhoAmI register.
- **Known-device schema library** — drop a folder of Harp `device.yml` schemas (`<device>.device.yml`) once and they're remembered across sessions (browser local storage). Each loaded device is matched automatically — by WhoAmI when a snapshot dump is present, else by device-name prefix — and its channels get their real register/`payloadSpec` names.
- **Experiment folders** — drop a folder whose sub-folders each hold one device's files and GAPSCOPE opens a **device list**: one card per device with its matched schema, register inventory, and a per-stream table (type, messages, Δt, missing) filled in by a background scan. Click anywhere on a card to open its largest stream, or click a specific register row to open that one directly; a back button returns to the list.
- **Combine multiple Harp files** — select several `.bin` files, or point GapScope at a whole **folder** (pick or drag), and it stitches the files of each register into one continuous timeline in timestamp order — so a recording split across many files is analyzed as a single stream. When a selection spans several streams (registers, or a device's CSVs), a selector switches which one is inspected.
- **Smooth on huge datasets** — a multi-resolution overview (LOD pyramid) is precomputed once on load, so the trace draws from aggregated clusters when zoomed out instead of scanning every raw sample each frame. Combined with cached heatmap columns and binary-searched dropout drawing, pan/zoom stays responsive even with tens of millions of samples; full per-sample detail resolves as you zoom in.
- **Persisted settings** — thresholds (as multipliers of Δt), trace toggles, the read chunk size, and the device schema library are saved to the browser's local storage and restored automatically on the next visit. Δt itself is never persisted — each stream re-detects its own.
- **Interactive trace** — scroll to zoom, **left-drag to select a region to zoom into**, **right-drag to pan**, and double-click to reset. Hover for an exact readout, including the Δt between bracketing anomalies.
- **Per-sample timestamps** — an optional layer that draws a vertical line at every sample, alongside the anomaly marks in a distinct color. Dense regions collapse to one line per pixel column (the same way anomaly spikes do) and resolve into individual lines as you zoom in. On hover you get the spacing between the bracketing samples with a double-headed measurement arrow — shown together with the event-spacing arrow when anomalies are also visible.
- **Coverage heatmap** — a full-capture minimap showing sample density per slice; click or drag to navigate the trace.
- **Raw data overlay** — plots each data channel (min/max-decimated) alongside the anomaly view, with per-channel value ranges.
- **Largest dropouts / tightest spacings tables** — ranked lists of the worst events with timestamps and elapsed times.
- **Two time modes** — absolute wall-clock (UTC) timestamps or relative elapsed seconds, auto-detected from the data.
- **Nanosecond precision** — timestamps are parsed to exact nanoseconds using BigInt, with no floating-point drift.

## Usage

1. Open `index.html` in any modern browser (no server, no build step).
2. Drag a capture file onto the drop zone, or click to browse. Use **"pick a folder"** for a device folder or a whole experiment folder.
3. (Optional, once) Drop/pick your folder of `device.yml` schemas — they're remembered and matched to every device you load afterwards.
4. Adjust **Nominal Δt**, **Gap threshold** (× Δt), and **Too-close under** (× Δt) settings, then click **Apply** to re-analyze.
5. Toggle the trace layers — **Show Raw Data**, **Show Anomalies**, **Show All Timestamps** — independently.

### Input format

GAPSCOPE reads CSV/text where the **first column** is a timestamp. Additional columns are treated as data channels.

Absolute timestamps (epoch / wall-clock):

```
time,analog_input0,encoder,analog_input1
2026-06-09 22:20:33.475999832+00:00,7,0,7
2026-06-09 22:20:33.476992130+00:00,7,0,8
```

Or a plain seconds column (relative elapsed time):

```
time
2261.581536
2261.582496
```

Supported timestamp forms: `YYYY-MM-DD HH:MM:SS[.fraction][±HH:MM | Z]` (space or `T` separator), or a plain integer/decimal seconds value. A header row is optional — channel names are taken from it when present.

CSVs whose seconds column counts from the **Harp epoch (1904)** — e.g. camera frame logs — are detected automatically and shifted so wall-clock times read correctly.

**Harp binary (`.bin`):** Harp capture files are read directly — drop a `.bin` and GapScope walks its fixed-stride message stream, decoding timestamps (since-1904, shifted to wall-clock for clock-synced captures) and per-register payload values. To name the channels, add the device's `device.yml` to the schema library (drop it once — it's persisted), or drop it together with the `.bin`. Without a schema, channels are named `reg<addr>_<i>`. Channels declared in the schema but absent from the file — or extra channels not in the schema — fall back to generic names.

You can also load **multiple `.bin` files at once** — drag several, or pick/drop a whole folder. Files are grouped by register and the files of each register are concatenated in timestamp order into one continuous timeline; if more than one stream is present, a selector chooses which to analyze. (Each loaded view concatenates a single register; merging different registers onto one timeline is not done.)

**Experiment folders:** a folder whose **sub-folders** each hold one device's files opens as a device list instead. Each card shows the device's identity (matched against the schema library by WhoAmI or name prefix), its registers, and summary stats per stream — type, message counts, estimated Δt, and missing messages — computed by a background scan that walks only the timestamps. Streams are placed on a shared experiment timeline (earliest start to latest end across all devices) so each is shown and classified against the whole experiment, not just the span in which it transmitted. Root-level configuration files (`Metadata.json`, rig configuration) are recognized and set aside. Click a card (or a specific register row) to open the standard analysis view for that device, with a stream selector covering its registers and CSV files.

> **Loading a folder:** use the **"pick a folder"** button, which works regardless of how the page is opened. Folder *drag-and-drop* only works when the page is served over `http://` (e.g. `python -m http.server`); browsers block reading a dropped folder's contents on `file://` pages opened directly from disk. Dragging individual files always works.

## How it works

The entire tool is contained in [index.html](index.html) — HTML, CSS, and vanilla JavaScript with no dependencies. The capture is **streamed in byte-sized chunks** (decoded with a streaming `TextDecoder` that stitches lines across chunk boundaries) and parsed incrementally, which keeps the UI responsive and removes the single-string size ceiling on large files. Timestamps are converted to nanosecond offsets from the first sample, and gaps between consecutive samples drive the anomaly detection.

Rendering uses per-pixel column aggregation on `<canvas>`. To stay fast on very large captures, a **multi-resolution aggregate pyramid** is built once per load: each level clusters a power-of-two block of samples and stores their min/max gap, sample count, and per-channel value envelope. When zoomed out, the trace reads from the coarsest level that still has roughly one cluster per pixel — turning each frame from a full-dataset scan into work proportional to the screen width. The full-capture heatmap columns are cached and only recolored on pan/zoom, and dropout marks are located by binary search over the visible range. Full per-sample precision returns automatically as you zoom in.

Because it's a self-contained file, you can save it and reuse it entirely offline.

## License

See [LICENSE](LICENSE).
