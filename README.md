# GAPSCOPE

**Capture integrity inspector** — a single-file, browser-based tool for spotting timing anomalies in timestamped data captures.

Drop a CSV with a timestamp column and GAPSCOPE tells you whether your stream is clean: how many samples were dropped, where the dropouts are, and whether any samples arrived suspiciously close together. Everything runs locally in your browser — **nothing is uploaded**.

## Features

- **Dropout detection** — finds gaps larger than a configurable threshold (× nominal Δt) and estimates how many samples are missing in each.
- **Too-close detection** — flags arrivals spaced under a configurable floor (default 900 µs), useful for catching duplicated or jittered timestamps.
- **Auto interval detection** — infers the nominal sample interval (Δt) from the median gap; can be overridden manually.
- **Interactive trace** — zoom (scroll), pan (drag), and reset (double-click) over the full capture. Hover for an exact readout, including the Δt between bracketing anomalies.
- **Per-sample timestamps** — an optional layer that draws a vertical line at every sample, alongside the anomaly marks in a distinct color. Dense regions collapse to one line per pixel column (the same way anomaly spikes do) and resolve into individual lines as you zoom in. On hover you get the spacing between the bracketing samples with a double-headed measurement arrow — shown together with the event-spacing arrow when anomalies are also visible.
- **Coverage heatmap** — a full-capture minimap showing sample density per slice; click or drag to navigate the trace.
- **Raw data overlay** — plots each data channel (min/max-decimated) alongside the anomaly view, with per-channel value ranges.
- **Largest dropouts / tightest spacings tables** — ranked lists of the worst events with timestamps and elapsed times.
- **Two time modes** — absolute wall-clock (UTC) timestamps or relative elapsed seconds, auto-detected from the data.
- **Nanosecond precision** — timestamps are parsed to exact nanoseconds using BigInt, with no floating-point drift.

## Usage

1. Open `index.html` in any modern browser (no server, no build step).
2. Drag a capture file onto the drop zone, or click to browse.
3. Adjust **Nominal Δt**, **Gap threshold**, and **Too-close** settings, then click **Apply** to re-analyze.
4. Toggle the trace layers — **Show Raw Data**, **Show Anomalies**, **Show All Timestamps** — independently.

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

## How it works

The entire tool is contained in [index.html](index.html) — HTML, CSS, and vanilla JavaScript with no dependencies. The capture is parsed in chunks (to keep the UI responsive on large files), timestamps are converted to nanosecond offsets from the first sample, and gaps between consecutive samples drive the anomaly detection. Rendering uses per-pixel column aggregation on `<canvas>`, so it stays fast even with millions of samples.

Because it's a self-contained file, you can save it and reuse it entirely offline.

## License

See [LICENSE](LICENSE).
