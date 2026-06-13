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
    classList: { add(){}, remove(){} },
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
  buildStreams, largestStream, streamLabel, median, detectInterval, deviceSchemas,
  G(){ return { firstNs, offsets, gaps, channelNames, channelCount, malformed }; },
  setScan(st){ scanState = st; },
  scanStream,
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
  const stc = await t.scanStream({ kind: "csv", file: csv }, 1);
  check("csv stats count", stc && stc.count === csvLines.length - 1, stc && stc.count + " vs " + (csvLines.length - 1) + " data rows");
  check("csv Δt ≈ 25 ms (40 Hz)", stc && Math.abs(stc.dtNs - 25e6) < 1e6, stc && stc.dtNs);

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
