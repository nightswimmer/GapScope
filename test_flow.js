// Node smoke test of the full experiment flow: drop the sample folder through
// the real handleFiles → startExperiment → background scan → openDevice path.
// Run with `node test_flow.js`.
"use strict";
const fs = require("fs");
const path = require("path");

function makeEl(){
  const el = {
    style: {}, dataset: {}, textContent: "", innerHTML: "", value: "",
    checked: false, disabled: false, width: 100, height: 100,
    clientWidth: 100, clientHeight: 100, offsetWidth: 100,
    classList: { add(){}, remove(){}, toggle(){} },
    addEventListener(){}, appendChild(){}, click(){},
    getBoundingClientRect(){ return { left: 0, top: 0, width: 100, height: 100 }; },
    getContext(){ return new Proxy({}, { get: () => () => {} }); },
  };
  el.parentNode = { clientWidth: 100, clientHeight: 100 };
  return el;
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

const html = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");
let body = html.match(/<script>\s*"use strict";\s*\(function\(\)\{([\s\S]*)\}\)\(\);\s*<\/script>/)[1];
body += `
;global.__t = {
  handleFiles, openDevice, pauseScan, resumeScan,
  exp(){ return experiment; },
  scan(){ return scanState; },
  schema(){ return harpSchema; },
  schemas(){ return Object.keys(deviceSchemas).sort(); },
  G(){ return { offsets, channelNames, firstNs, isAbsolute, streamList, streamIdx }; },
  getStream(){ return streamList; },
  thresholds(){ return { intervalNs, detectedNs, closeNs, closeFactor, tolerance, auto: intervalIn.dataset.auto }; },
};`;
new Function(body)();
const t = global.__t;

const ROOT = __dirname;
function collect(dir, baseRel){
  const out = [];
  for(const e of fs.readdirSync(dir, { withFileTypes: true })){
    const p = path.join(dir, e.name), rel = baseRel + "/" + e.name;
    if(e.isDirectory()) out.push(...collect(p, rel));
    else if(e.name.endsWith(".avi")) out.push(new NodeFile(Buffer.alloc(0), e.name, rel)); // don't read video bodies
    else out.push(new NodeFile(fs.readFileSync(p), e.name, rel));
  }
  return out;
}

let failures = 0;
function check(label, cond, detail){
  console.log((cond ? "PASS" : "FAIL") + "  " + label + (detail ? "   [" + detail + "]" : ""));
  if(!cond) failures++;
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  // import the schema library first (like dropping the devices folder once —
  // SOURCES.md rides along and must be ignored, not loaded as a capture)
  t.handleFiles(collect(path.join(ROOT, "devices"), "devices"));
  await sleep(100);
  check("5 schemas imported, docs ignored", t.schemas().length === 5 && els["note"].style.display !== "block",
        t.schemas().join(","));

  // drop the experiment folder
  const expFiles = collect(path.join(ROOT, "2026-06-12T010203Z"), "2026-06-12T010203Z");
  t.handleFiles(expFiles);
  await sleep(300);   // header scans are tiny

  const exp = t.exp();
  check("experiment open", !!exp, exp && exp.name);
  check("experiment name", exp.name === "2026-06-12T010203Z");
  check("13 devices", exp.devices.length === 13, exp.devices.map(d => d.name).join(","));
  check("2 config files", exp.configFiles.length === 2, exp.configFiles.map(f => f.name).join(","));

  const by = {}; exp.devices.forEach(d => by[d.name] = d);
  check("Behavior0 schema matched", by.Behavior0.schema && by.Behavior0.schema.device === "Behavior");
  check("Behavior0 snapshot", by.Behavior0.snapshot && by.Behavior0.snapshot.registers.length === 111
        && by.Behavior0.snapshot.whoAmI === 1216);
  check("Behavior0 1 bin stream", by.Behavior0.streams.length === 1 && by.Behavior0.streams[0].addr === 44);
  check("CameraController 4 bin streams", by.CameraController.streams.length === 4,
        by.CameraController.streams.map(s => s.addr).join(","));
  check("Center mixed streams", by.Center.streams.length === 2
        && by.Center.streams.some(s => s.kind === "bin" && s.addr === 200)
        && by.Center.streams.some(s => s.kind === "csv"),
        by.Center.streams.map(s => s.kind + (s.addr != null ? s.addr : "")).join(","));
  check("Environment csv-only", by.Environment.streams.length === 1 && by.Environment.streams[0].kind === "csv");
  check("LoomEast unknown device", by.LoomEast.schema === null);

  // pause mid-scan (what opening a device does), verify it parks, then resume.
  // Cycle pause/resume to catch a mid-chunk park (scanState.cont) at least once.
  let sawPark = false, held = true;
  for(let i = 0; i < 50 && t.scan().idx < t.scan().queue.length; i++){
    t.pauseScan();
    await sleep(40);                     // let any in-flight chunk park itself
    const frozenIdx = t.scan().idx;
    if(t.scan().cont) sawPark = true;
    await sleep(120);
    if(t.scan().idx !== frozenIdx) held = false;
    t.resumeScan();
    await sleep(30);
    if(sawPark) break;
  }
  check("paused scan holds still", held);
  check("mid-chunk park + resume", sawPark, sawPark ? "cont parked and continued" : "never caught mid-chunk");

  // wait for the background scan to finish (CameraController_36 has 1 message etc.)
  for(let i = 0; i < 600 && t.scan() && t.scan().idx < t.scan().queue.length; i++) await sleep(100);
  const sc = t.scan();
  check("scan finished", sc && sc.idx === sc.queue.length, sc && sc.idx + "/" + sc.queue.length);
  const b44 = by.Behavior0.streams[0].stats;
  check("Behavior0_44 scanned", b44 && b44.count > 1000000, b44 && JSON.stringify(b44));
  const cam36 = by.CameraController.streams.find(s => s.addr === 36).stats;
  check("1-message register scanned", cam36 && cam36.count === 1, cam36 && JSON.stringify(cam36));
  console.log("  card sample:", els["devgrid"] ? "(grid stub)" : "", JSON.stringify(
    exp.devices.map(d => ({ dev: d.name, streams: d.streams.map(s => ({ k: s.kind, a: s.addr, st: s.stats && { n: s.stats.count, miss: s.stats.missing } }) ) }))[0]));

  // open Behavior0 → register 44 with schema names
  t.openDevice(by.Behavior0);
  for(let i = 0; i < 600 && t.G().offsets.length < 2; i++) await sleep(100);
  await sleep(200);
  const g = t.G();
  check("Behavior0 loaded", g.offsets.length > 1000000, g.offsets.length.toLocaleString() + " msgs");
  check("schema active", t.schema() && t.schema().device === "Behavior");
  check("channels named from schema", g.channelNames.length > 0 && !/^reg44/.test(g.channelNames[0]),
        g.channelNames.join(","));
  check("absolute time mode", g.isAbsolute === true, "firstNs " + g.firstNs);
  const th = t.thresholds();
  check("Δt re-detected per stream", th.intervalNs === th.detectedNs && th.auto === "yes",
        "Δt " + th.intervalNs + " ns");
  check("too-close = 0.9 × Δt", th.closeFactor === 0.9 && th.closeNs === 0.9 * th.intervalNs,
        th.closeNs + " ns");

  // open Center → csv default? (csv is larger than the 3.2 MB bin)
  t.openDevice(by.Center);
  await sleep(100);
  check("Center default stream is the larger one", t.G().streamIdx === t.getStream().findIndex(
    (s, i, a) => s.bytes === Math.max.apply(null, a.map(x => x.bytes))));

  console.log(failures ? "\n" + failures + " FAILURE(S)" : "\nall flow tests passed");
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error("harness error:", e); process.exit(1); });
