# Vendored Harp device schemas

These `device.yml` files are the **single source of truth** for register
addresses, payload layout, and column names used by the data readers in
`rig.py` (via `devices.harp_register`). They are pinned to the exact device
versions this rig acquires with — taken from the Bonsai package the workflows
load (`.bonsai/Bonsai.config`), which records the upstream repo and commit in
its `.nuspec`.

To refresh one, re-extract the embedded `device.yml` resource from the matching
`Harp.<Device>` package DLL (or pull it from the repo at the pinned ref), then
re-normalize line endings to LF.

| File | Device | WhoAmI | Bonsai package | Upstream source |
|------|--------|:------:|----------------|-----------------|
| `behavior.device.yml` | Behavior | 1216 | Harp.Behavior 0.2.0 | harp-tech/device.behavior @ `7e0cc83` (nuspec commit; extracted from DLL) |
| `cameracontrollergen2.device.yml` | CameraControllerGen2 | 1170 | Harp.CameraControllerGen2 0.1.0 | harp-tech/device.cameracontrollergen2 @ `55aab40` (tag `fw1.2-harp1.15`) |
| `timestampgeneratorgen3.device.yml` | TimestampGeneratorGen3 | 1158 | Harp.TimestampGeneratorGen3 0.1.1 | harp-tech/device.timestampgeneratorgen3 @ `756ac20` |
| `outputexpander.device.yml` | OutputExpander | 1108 | Harp.OutputExpander 0.2.0 | harp-tech/device.outputexpander @ `9d45def` |
| `faststepper.device.yml` | FastStepper | 2120 | Harp.FastStepper 0.1.0 | harp-tech/device.faststepper (fw 0.6; extracted from DLL) |

A device's readers combine **stock registers** (sourced from its `device.yml`
via `harp_register`, using the canonical register names) with **custom
application streams** that no `device.yml` describes (defined explicitly in
`rig.py`, with app-meaningful names; payload set by the local `Format*` Bonsai
combinators). Example: the Feeder reads stock `OutputSet`/`OutputClear`/
`MagneticEncoder` from the yml, plus a custom `deliver_pellet` stream (reg 203).
The MechanicalLoom is likewise a stock FastStepper (motor registers from the yml)
plus a custom `loom_action` stream (reg 200, requested loom actions).

**Local compatibility patches** (so the files parse under `harp-python 0.4.1`,
the version pinned via `swc-aeon`; upstream targets newer tooling):

- `cameracontrollergen2.device.yml`: `groupMasks` value entries rewritten from
  the shorthand `{0, description: ...}` to `{value: 0, description: ...}` (×25),
  and the boolean-like enum keys `No`/`Yes` quoted (YAML 1.1 parses them as
  `false`/`true`). Register definitions are unchanged.

<!-- Camera stays hardcoded (Bonsai tracking streams 200-203, no device.yml).
     AirPuff has a cross-device reader (reads its behaviorBoard's OutputSet):
     portNumber N maps to SupplyPort<N> = bit 0x8 << N (Behavior DigitalOutputs,
     confirmed against AirPuffs.bonsai and a 2026-06-11 session). -->