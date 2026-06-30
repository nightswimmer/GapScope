// Node harness: runs the page's real script with DOM stubs and exercises the
// new experiment-layer functions against the sample data. Not part of the app;
// run with `node test_experiment.js`.
"use strict";
const fs = require("fs");
const path = require("path");

// ---------- DOM / browser stubs ----------
function makeEl(){
  return {
    style: {}, dataset: {}, textContent: "", innerHTML: "", value: "",
    checked: false, disabled: false, width: 0, height: 0,
    classList: { add(){}, remove(){}, toggle(){} },
    addEventListener(){}, appendChild(){}, click(){},
    getBoundingClientRect(){ return { left: 0, top: 0, width: 100, height: 100 }; },
    getContext(){ return new Proxy({}, { get: () => () => {} }); },
  };
}
const els = {};
global.document = {
  getElementById(id){ return els[id] || (els[id] = makeEl()); },
  createElement(){ return makeEl(); },
};
global.window = { addEventListener(){}, devicePixelRatio: 1 };
global.localStorage = (() => {
  const m = {};
  return { getItem: k => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); }, removeItem: k => { delete m[k]; } };
})();
global.performance = { now: () => Date.now() };
global.requestAnimationFrame = fn => setTimeout(fn, 0);

// File + FileReader over local Buffers
class NodeFile {
  constructor(buf, name, relPath){ this._buf = buf; this.name = name; this.size = buf.length; if(relPath) this._relPath = relPath; }
  slice(start, end){ return new NodeFile(this._buf.subarray(start, end), this.name); }
}
global.FileReader = class {
  readAsArrayBuffer(f){
    setTimeout(() => {
      this.result = f._buf.buffer.slice(f._buf.byteOffset, f._buf.byteOffset + f._buf.byteLength);
      this.onload && this.onload();
    }, 0);
  }
  readAsText(f){
    setTimeout(() => { this.result = f._buf.toString("utf8"); this.onload && this.onload(); }, 0);
  }
};

// ---------- load the page script, un-IIFE'd, with internals exported ----------
const html = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");
let body = html.match(/<script>\s*"use strict";\s*\(function\(\)\{([\s\S]*)\}\)\(\);\s*<\/script>/)[1];
body += `
;global.__t = {
  parseHarpYaml, parseHarpSnapshot, readHarpHeader, makeStatsAcc, makeHarpStatsWalker,
  makeCsvStatsWalker, makeLineParser, splitByFolders, matchSchema, importSchemas,
  buildStreams, largestStream, streamLabel, streamChannelNames, csvBaseName, groupCsvs, readCsvHeader,
  median, detectInterval, classifyStream, deviceSchemas,
  G(){ return { firstNs, offsets, gaps, channelNames, channelCount, malformed }; },
  setScan(st){ scanState = st; },
  scanStream,
  analyze,
  // load a synthetic offsets array + analysis env, then read back the verdict bits
  setSynthetic(off, env){
    offsets = off.slice(); gaps = [];
    for(var i=1;i<offsets.length;i++) gaps.push(offsets[i]-offsets[i-1]);
    spikeGaps = null; pyrSpikeKey = ""; pyramid = null;
    channelCount = 0; channels = []; experiment = null; refOriginNs = null;
    intervalNs = env.intervalNs;
    tolerance = (env.tolerance != null) ? env.tolerance : 1.5;
    timelineNs = env.timelineNs;
    streamType = env.streamType || "auto";
    closeFactor = (env.closeFactor != null) ? env.closeFactor : 0.9;
  },
  A(){ return { stats: stats, spikes: spikeEvents, ooo: oooEvents, gapEvents: gapEvents }; },
};`;
new Function(body)();
const t = global.__t;

const ROOT = __dirname;
const EXP = path.join(ROOT, "2026-06-12T010203Z");
function fileOf(p, rel){ return new NodeFile(fs.readFileSync(p), path.basename(p), rel); }

let failures = 0;
function check(label, cond, detail){
  console.log((cond ? "PASS" : "FAIL") + "  " + label + (detail ? "   [" + detail + "]" : ""));
  if(!cond) failures++;
}

(async () => {
  // 1. parseHarpYaml: device identity + registers
  const yml = fs.readFileSync(path.join(ROOT, "devices", "behavior.device.yml"), "utf8");
  const schema = t.parseHarpYaml(yml);
  check("Behavior.yml device name", schema && schema.device === "Behavior", schema && schema.device);
  check("Behavior.yml whoAmI", schema && schema.whoAmI === 1216, schema && schema.whoAmI);
  check("Behavior.yml reg 32 named", schema && schema.registers[32] && schema.registers[32].name === "DigitalInputState",
        schema && schema.registers[32] && schema.registers[32].name);

  // 2. schema library matching
  t.deviceSchemas["Behavior"] = schema;
  check("prefix match Behavior0", t.matchSchema("Behavior0", null) === schema);
  check("whoAmI match beats name", t.matchSchema("UnknownDir", 1216) === schema);
  check("no match for Feeder0", t.matchSchema("Feeder0", null) === null);

  // 2b. importSchemas: <device>.device.yml file-name fallback when device: is absent
  {
    const noDevice = yml.split(/\r?\n/).filter(l => !/^device:/.test(l)).join("\n");
    await t.importSchemas([new NodeFile(Buffer.from(noDevice), "foo.device.yml")]);
    check("file-name fallback strips .device.yml", !!t.deviceSchemas["foo"],
          Object.keys(t.deviceSchemas).join(","));
  }

  // 3. header scan: snapshot detection
  const snapFile = fileOf(path.join(EXP, "Behavior0", "Behavior0_2026-06-12T010000Z.bin"));
  const regFile  = fileOf(path.join(EXP, "Behavior0", "Behavior0_44_2026-06-12T010000Z.bin"));
  const tinyFile = fileOf(path.join(EXP, "CameraController", "CameraController_36_2026-06-12T010000Z.bin"));
  const hSnap = await t.readHarpHeader(snapFile);
  const hReg  = await t.readHarpHeader(regFile);
  const hTiny = await t.readHarpHeader(tinyFile);
  check("snapshot dump detected", hSnap.snapshot === true && hSnap.ok);
  check("register file not snapshot", hReg.snapshot === false && hReg.ok && hReg.address === 44, "addr " + hReg.address);
  check("13-byte file not snapshot", hTiny.snapshot === false, JSON.stringify({ok: hTiny.ok, addr: hTiny.address}));

  // 3b. array arity (nEl) + value-line names from the schema (Behavior reg 44 =
  // AnalogData, S16×3: AnalogInput0 / Encoder / AnalogInput1)
  check("header nEl: AnalogData is 3 elements", hReg.nEl === 3, "nEl=" + hReg.nEl);
  const arrStream = { kind: "bin", addr: 44, nEl: hReg.nEl, group: [hReg] };
  const arrNames = t.streamChannelNames(arrStream, schema);
  check("streamChannelNames: array positions from device.yml",
    arrNames.length === 3 && arrNames[0] === "AnalogInput0" && arrNames[1] === "Encoder" && arrNames[2] === "AnalogInput1",
    JSON.stringify(arrNames));
  const scalarNames = t.streamChannelNames({ kind: "bin", addr: 250, nEl: 1, group: [hReg] }, schema);
  check("streamChannelNames: scalar w/o schema reg → reg<addr> name", scalarNames.length === 1 && scalarNames[0] === "reg250", JSON.stringify(scalarNames));
  const noSchemaNames = t.streamChannelNames({ kind: "bin", addr: 7, nEl: 2, group: [hReg] }, null);
  check("streamChannelNames: no schema → reg<addr>_<i> fallback",
    noSchemaNames[0] === "reg7_0" && noSchemaNames[1] === "reg7_1", JSON.stringify(noSchemaNames));

  // 4. snapshot walk: inventory + WhoAmI
  const snap = await t.parseHarpSnapshot(snapFile);
  check("snapshot registers", snap && snap.registers.length === 111, snap && snap.registers.length);
  check("snapshot WhoAmI", snap && snap.whoAmI === 1216, snap && snap.whoAmI);

  // 5. stats walker vs direct reference on Feeder0_90
  const f90buf = fs.readFileSync(path.join(EXP, "Feeder0", "Feeder0_90_2026-06-12T010000Z.bin"));
  // reference: walk directly
  const stride = f90buf[1] + 2;
  const refTs = [];
  for(let o = 0; o + stride <= f90buf.length; o += stride)
    refTs.push(BigInt(f90buf.readUInt32LE(o + 5)) * 1000000000n + BigInt(f90buf.readUInt16LE(o + 9)) * 32000n);
  const refGaps = [];
  for(let i = 1; i < refTs.length; i++) refGaps.push(Number(refTs[i] - refTs[i - 1]));
  const dtRef = t.detectInterval(refGaps.slice(0, 65536));
  let refDrops = 0, refMissing = 0;
  for(const g of refGaps) if(g > dtRef * 1.5){ refDrops++; refMissing += Math.max(1, Math.round(g / dtRef) - 1); }

  // through the chunked scanStream path (verifies carry across chunk boundaries)
  t.setScan({ epoch: 1, paused: false, queue: [1], idx: 0, cont: null });
  const f90 = fileOf(path.join(EXP, "Feeder0", "Feeder0_90_2026-06-12T010000Z.bin"));
  const st = await t.scanStream({ kind: "bin", group: [{ file: f90 }] }, 1);
  check("stats count", st && st.count === refTs.length, st && st.count + " vs " + refTs.length);
  check("stats Δt", st && st.dtNs === dtRef, st && st.dtNs + " vs " + dtRef);
  check("stats drops/missing", st && st.drops === refDrops && st.missing === refMissing,
        st && st.drops + "/" + st.missing + " vs " + refDrops + "/" + refMissing);

  // 6. CSV stats walker on a camera CSV
  const csvPath = path.join(EXP, "Center", "Center_2026-06-12T01-00-00.csv");
  const csvLines = fs.readFileSync(csvPath, "utf8").split(/\r?\n/).filter(l => l.trim());
  const csv = fileOf(csvPath);
  const stc = await t.scanStream({ kind: "csv", files: [csv] }, 1);
  check("csv stats count", stc && stc.count === csvLines.length - 1, stc && stc.count + " vs " + (csvLines.length - 1) + " data rows");
  check("csv Δt ≈ 25 ms (40 Hz)", stc && Math.abs(stc.dtNs - 25e6) < 1e6, stc && stc.dtNs);

  // 6c. CSV chunk combining: base-name grouping + header peek + column names
  check("csvBaseName strips trailing timestamp", t.csvBaseName("East_1904-01-06T04-00-00.csv") === "East", t.csvBaseName("East_1904-01-06T04-00-00.csv"));
  check("csvBaseName keeps role suffix", t.csvBaseName("Environment_EnvironmentState_2026-06-12T010000Z.csv") === "Environment_EnvironmentState",
        t.csvBaseName("Environment_EnvironmentState_2026-06-12T010000Z.csv"));
  const chunkFiles = ["East_1904-01-06T06-00-00.csv", "East_1904-01-06T04-00-00.csv", "East_1904-01-06T05-00-00.csv"]
    .map(n => new NodeFile(Buffer.from("x"), n));
  const grouped = t.groupCsvs(chunkFiles);
  check("groupCsvs: 3 chunks → 1 base, time-ordered", grouped.length === 1 && grouped[0].base === "East"
        && grouped[0].files.map(f => f.name)[0].endsWith("04-00-00.csv")
        && grouped[0].files.map(f => f.name)[2].endsWith("06-00-00.csv"),
        JSON.stringify(grouped.map(g => g.base + ":" + g.files.length)));
  const hd = await t.readCsvHeader(csv);
  check("readCsvHeader: data columns named from header", hd.nCols >= 1 && hd.cols.every(c => c && !/^col\d/.test(c)),
        JSON.stringify(hd.cols));
  const csvNames = t.streamChannelNames({ kind: "csv", nEl: hd.nCols, cols: hd.cols }, null);
  check("streamChannelNames: CSV columns = header names", csvNames.length === hd.nCols && csvNames[0] === hd.cols[0], JSON.stringify(csvNames));

  // 6b. tick-aware Δt estimate (median refined by trimmed mean)
  {
    // a 1 kHz register on the 32 µs Harp grid: 75% gaps of 992 µs, 25% of 1024 µs
    const mix = [];
    for(let i = 0; i < 40000; i++) mix.push(i % 4 === 3 ? 1024000 : 992000);
    check("Δt: 992/1024 mix → 1000 µs", t.detectInterval(mix) === 1000000, t.detectInterval(mix));
    // dropouts must not inflate the estimate (the old reason for using median)
    const withDrops = mix.concat([5e9, 12e9, 3e9]);
    check("Δt: immune to dropout gaps", t.detectInterval(withDrops) === 1000000, t.detectInterval(withDrops));
    // tight doublets fall outside the window too
    const withTight = mix.concat([1000, 2000, 1500]);
    check("Δt: immune to tight bursts", t.detectInterval(withTight) === 1000000, t.detectInterval(withTight));
    // clean un-quantized data: stays at the obvious value
    check("Δt: uniform data unchanged", t.detectInterval([1e6, 1e6, 1e6, 1e6]) === 1e6);
  }

  // 6c. stream-type classification — coverage of the experiment timeline
  {
    const tol = 1.5, dt = 1e6;
    const sum = (a) => a.reduce((x, y) => x + y, 0);

    // constant: steady cadence filling its whole span (coverage ≈ 1)
    const constant = [];
    for (let i = 0; i < 5000; i++) constant.push(i % 500 === 499 ? 3e6 : 1e6);
    check("classify: full-coverage cadence → constant",
          t.classifyStream(constant, dt, tol, constant.length + 1, sum(constant)).type === "constant",
          t.classifyStream(constant, dt, tol, constant.length + 1, sum(constant)).type);

    // pontual: gaps spread over orders of magnitude, no dominant interval
    const pontual = [];
    const spread = [2e5, 5e5, 1e6, 4e6, 2e7, 8e5, 3e6, 6e5, 1.5e7, 9e5];
    for (let i = 0; i < 3000; i++) pontual.push(spread[(i * 7) % spread.length]);
    check("classify: scattered gaps → pontual",
          t.classifyStream(pontual, t.detectInterval(pontual), tol, 3001, 1e12).type === "pontual",
          t.classifyStream(pontual, t.detectInterval(pontual), tol, 3001, 1e12).type);

    // a single dense burst occupying ~10% of the timeline → burst, no in-data silence
    const oneBurst = [];
    for (let i = 0; i < 999; i++) oneBurst.push(1e6);     // 1000 msgs, ~1e9 of data
    const cb1 = t.classifyStream(oneBurst, dt, tol, 1000, 1e10);
    check("classify: single low-coverage burst → burst",
          cb1.type === "burst" && cb1.silenceNs === Infinity,
          JSON.stringify({ type: cb1.type, silenceNs: cb1.silenceNs, cov: +cb1.coverage.toFixed(3) }));

    // multi-burst: 4 runs split by ~1 s silences, low coverage → burst + silence band
    const burst = [];
    for (let r = 0; r < 4; r++) {
      for (let i = 0; i < 1000; i++) burst.push(1e6);
      if (r < 3) burst.push(1e9);                          // 1000× Δt silence
    }
    const cb = t.classifyStream(burst, dt, tol, burst.length + 1, 1e11);
    check("classify: multi-burst → burst, silence band found",
          cb.type === "burst" && cb.silenceNs === 1e9,
          JSON.stringify({ type: cb.type, silenceNs: cb.silenceNs }));

    // a mostly-covered stream with one ordinary outage stays constant (the
    // outage's missing are still counted, unlike a low-coverage burst)
    const outage = [];
    for (let i = 0; i < 4000; i++) outage.push(i === 2000 ? 5e8 : 1e6);
    check("classify: mostly-covered stream with one outage → constant",
          t.classifyStream(outage, dt, tol, 4001, sum(outage)).type === "constant",
          t.classifyStream(outage, dt, tol, 4001, sum(outage)).type);

    // makeStatsAcc over a 5× timeline: low coverage → burst, silences excluded
    const acc = t.makeStatsAcc(2e10);
    let ts = 0n;
    for (let r = 0; r < 4; r++) {
      for (let i = 0; i < 1000; i++) { acc.add(ts); ts += (i === 500 ? 3000000n : 1000000n); }
      if (r < 3) ts += 1000000000n;                        // silence between runs
    }
    const res = acc.done();
    check("burst stats: silences excluded, in-burst drops counted",
          res.type === "burst" && res.missing === 8 && res.drops === 4,
          JSON.stringify({ type: res.type, missing: res.missing, drops: res.drops }));

    // makeStatsAcc with a span matching the data → constant, all drops counted
    const acc2 = t.makeStatsAcc(4e9);
    let ts2 = 0n;
    for (let i = 0; i < 4000; i++) { acc2.add(ts2); ts2 += (i % 1000 === 999 ? 3000000n : 1000000n); }
    const res2 = acc2.done();
    check("constant stats: full coverage counts every drop",
          res2.type === "constant" && res2.drops === 3 && res2.missing === 6,
          JSON.stringify({ type: res2.type, missing: res2.missing, drops: res2.drops }));
  }

  // 6d. forward-jump-aware anomaly detection (analyze + makeStatsAcc). One sample
  // whose timestamp jumps far into the future must be flagged as ONE spike — not a
  // ~100-message dropout plus a back-in-time out-of-order on its successor.
  {
    const DT = 1e7;                      // 10 ms cadence
    const N = 200, K = 100;              // spike at index K
    // (A) lone forward spike: every sample on cadence except offsets[K] +1 s
    const spike = [];
    for (let i = 0; i < N; i++) spike.push(i * DT + (i === K ? 1e9 : 0));
    t.setSynthetic(spike, { intervalNs: DT, tolerance: 1.5, timelineNs: N * DT });
    t.analyze();
    let a = t.A();
    check("spike: type constant", a.stats.type === "constant", a.stats.type);
    check("spike: 1 future-timestamp spike, 0 missing, 0 out-of-order",
          a.stats.spikes === 1 && a.stats.dropped === 0 && a.stats.events === 0 && a.stats.outOfOrder === 0,
          JSON.stringify({ spikes: a.stats.spikes, missing: a.stats.dropped, drops: a.stats.events, ooo: a.stats.outOfOrder }));
    check("spike: marked at its expected cadence slot",
          a.spikes.length === 1 && a.spikes[0].expected === (K - 1) * DT + DT && a.spikes[0].at === K * DT + 1e9,
          JSON.stringify(a.spikes[0]));

    // (B) genuine 1 s outage (everything after K shifted later, no back-step) stays
    // a dropout with ~100 missing — unchanged
    const drop = [];
    for (let i = 0; i < N; i++) drop.push(i * DT + (i >= K ? 1e9 : 0));
    t.setSynthetic(drop, { intervalNs: DT, tolerance: 1.5, timelineNs: 3e9 });
    t.analyze();
    a = t.A();
    check("genuine dropout unchanged: 0 spikes, 1 dropout, 100 missing",
          a.stats.spikes === 0 && a.stats.events === 1 && a.stats.dropped === 100 && a.stats.outOfOrder === 0,
          JSON.stringify({ spikes: a.stats.spikes, drops: a.stats.events, missing: a.stats.dropped, ooo: a.stats.outOfOrder }));

    // (C) genuine adjacent swap (K and K+1 transposed) stays out-of-order — the
    // back-step is only ~1 interval, far smaller than a spike's
    const swap = [];
    for (let i = 0; i < N; i++) swap.push(i * DT);
    swap[K] = (K + 1) * DT; swap[K + 1] = K * DT;
    t.setSynthetic(swap, { intervalNs: DT, tolerance: 1.5, timelineNs: N * DT });
    t.analyze();
    a = t.A();
    check("adjacent swap unchanged: 0 spikes, 1 out-of-order",
          a.stats.spikes === 0 && a.stats.outOfOrder === 1,
          JSON.stringify({ spikes: a.stats.spikes, ooo: a.stats.outOfOrder, drops: a.stats.events }));

    // makeStatsAcc (background scan) must agree on the spike vs. the dropout
    const accS = t.makeStatsAcc(N * DT);
    for (let i = 0; i < N; i++) accS.add(BigInt(i) * BigInt(DT) + (i === K ? 1000000000n : 0n));
    const rS = accS.done();
    check("scan agrees: spike → 1 spike, 0 missing, 0 out-of-order",
          rS.type === "constant" && rS.spikes === 1 && rS.missing === 0 && rS.drops === 0 && rS.outOfOrder === 0,
          JSON.stringify({ type: rS.type, spikes: rS.spikes, missing: rS.missing, drops: rS.drops, ooo: rS.outOfOrder }));

    const accD = t.makeStatsAcc(3e9);
    for (let i = 0; i < N; i++) accD.add(BigInt(i) * BigInt(DT) + (i >= K ? 1000000000n : 0n));
    const rD = accD.done();
    check("scan agrees: genuine outage → 0 spikes, 1 drop, 100 missing",
          rD.spikes === 0 && rD.drops === 1 && rD.missing === 100 && rD.outOfOrder === 0,
          JSON.stringify({ spikes: rD.spikes, drops: rD.drops, missing: rD.missing, ooo: rD.outOfOrder }));

    t.setSynthetic([], { intervalNs: 1e6, timelineNs: 0 });   // clear the synthetic globals so later tests see a clean offsets array
  }

  // 7. splitByFolders classification
  const mk = (rel) => new NodeFile(Buffer.alloc(1), rel.split("/").pop(), rel);
  const sExp = t.splitByFolders([mk("exp/Behavior0/a.bin"), mk("exp/Feeder0/b.bin"), mk("exp/Metadata.json")]);
  check("experiment detected", sExp.experiment === true && sExp.name === "exp"
        && sExp.dirNames.join(",") === "Behavior0,Feeder0" && sExp.configFiles.length === 1,
        JSON.stringify({ name: sExp.name, dirs: sExp.dirNames, cfg: sExp.configFiles.length }));
  const sFlat = t.splitByFolders([mk("Behavior0/a.bin"), mk("Behavior0/b.bin")]);
  check("single device folder stays flat", sFlat.experiment === false);
  const sLoose = t.splitByFolders([new NodeFile(Buffer.alloc(1), "a.bin"), new NodeFile(Buffer.alloc(1), "b.bin")]);
  check("loose files stay flat", sLoose.experiment === false);
  const sMulti = t.splitByFolders([mk("Behavior0/a.bin"), mk("Feeder0/b.bin")]);
  check("two device folders → experiment", sMulti.experiment === true && sMulti.dirNames.length === 2);

  // 8. CSV 1904-epoch shift in makeLineParser
  {
    const p = t.makeLineParser();
    p.feed("Seconds,Value");
    p.feed("3864070916.0000319,1");
    p.feed("3864070916.024992,2");
    const g = t.G();
    const expected = 3864070916000031900n - 2082844800000000000n;
    check("CSV 1904 shift → 2026 wall clock", g.firstNs === expected,
          g.firstNs + " → " + new Date(Number(g.firstNs / 1000000n)).toISOString());
    check("CSV offsets unaffected by shift", g.offsets.length === 2 && g.offsets[0] === 0 && Math.abs(g.offsets[1] - 24960100) < 2,
          JSON.stringify(g.offsets));
  }

  console.log(failures ? "\n" + failures + " FAILURE(S)" : "\nall tests passed");
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error("harness error:", e); process.exit(1); });
