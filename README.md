# Touge Sakura — Initial Drift 峠・桜

An Initial D–inspired downhill touge racer for the browser, built with
Three.js (`three/webgpu` + TSL node materials) and WebXR. You race down a
sakura-lined mountain pass at twilight in an AE86 Trueno, FD3S RX-7 or Silvia
S13. It plays on a phone, on a desktop, and in the Meta Quest 3 browser, where
you sit in a full 6DoF cockpit.

The art direction is anime cel-shading (stepped toon ramps, ink outlines, a
painted twilight sky, emissive lamps) with a manga arcade UI.

## Running it

```bash
npm install
npm run dev          # http://localhost:5173
npm run build        # production build in dist/
npm run preview      # serve dist/ on the LAN
```

**Cloudflare Workers (static assets):** `wrangler.jsonc` points Wrangler at
`dist/`. With build command `npm run build` and deploy command
`npx wrangler deploy` it uploads the built site as-is (or run `npm run deploy`
locally). The Workers URL is HTTPS, so WebXR works there on the Quest.

**Meta Quest 3:** WebXR needs a secure context. Run `npm run dev:https`, open
`https://<your-PC-LAN-IP>:5173` in the Quest Browser, accept the self-signed
certificate, then choose **WebXR / VR Mode** on the title screen.

Useful URL parameters: `?preset=low|quest|high`, `?touch` (show touch
controls), `?noadapt` (fixed resolution), `?autostart`, `?autopilot`,
`?skipto=<metres>`, and `?q.<field>=<value>` to override a single quality
field (for example `?q.mirrors=0&q.petals=500`). For VR rendering
experiments on the headset: `?xrlayers` (WebXR Layers projection layer) and
`?xrmultiview` (projection layer + OVR_multiview2 single-pass stereo).

## Game loop

1. **Title.** An attract demo runs behind the menu: the AE86 and FD3S drift
   through the hairpins while the camera cuts between low tracking, rear,
   roadside-spotter and helicopter shots.
2. **Garage / vehicle select.** A tuner garage with the roll-up door open onto
   a moonlit cherry tree. Pick a car and livery, flip the headlights, check
   tyre wear under Parts, and orbit the turntable (in VR you walk around the
   life-size car).
3. **Summit staging.** Rev at the line. Countdown lamps on the start gantry
   and the radio call the start.
4. **Downhill run.** A battle against the AI rival or a solo time attack:
   esses, a carousel, hairpins and the five-hairpin complex. Drift chains
   build a multiplier up to ×5.
5. **Cooldown lot.** Both cars park under autopilot, then the results screen
   opens.
6. **Replay.** Watch the run from the auto director, a drone, roadside
   spotters, chase or onboard cameras, with slow motion on the apexes.

## Controls

| | Keyboard | Gamepad | Quest Touch Plus | Touch |
|---|---|---|---|---|
| Steer | A/D, ←/→ | Left stick | Grab the wheel rim (one or two hands, hand-over-hand), or either thumbstick with hands off the wheel | Tilt the phone (gyro, default) or drag pad — Settings › Driving |
| Throttle / brake | W/S, ↑/↓ | RT / LT | Right / left trigger | GAS / BRAKE |
| Handbrake | Space | A | Pull the lever up (or hold B) | HB |
| Shift | E / Q | RB / LB | Grab the shifter (sequential or H-pattern), slap, or A/X | + / − |
| Camera | C | Y | — | — |
| Pop-up headlights | H | D-pad ↑ | Press the dash switch | — |
| HUD mode | U | View | Press the dash switch | — |
| Pause | Esc / P | Start | Y | — |
| Recenter seat | — | — | Left stick click | — |
| Fullscreen | F or the ⛶ button | — | — | ⛶ button (top centre) |

Menus work with the mouse, the keyboard (arrows and Enter), a gamepad
(d-pad or stick, A to select, B to go back), touch, and VR laser pointers
(trigger selects; A picks the top option).

Every UI surface shares one look: heavy italic Kanit, slanted paper plates
with ink outlines and hard shadows, an orange-to-yellow selected bar with a
cyan focus ring, and comic-card panels. The DOM menus use it through CSS
variables. The canvas-painted surfaces (VR menu, controller legends, glass
HUD, VR captions) draw it with `src/ui/theme.js`. On landscape phones the
dialogs fit the screen, and the pause menu switches to two columns. On big
screens the menus and HUD scale up.

In VR the menu panel opens in front of wherever you're looking. If you look
away it drifts back into view. Look at a controller and a legend of its buttons pops up beside your hand
(in menus, through the countdown, for a few seconds after the start, and
after you unpause). Panels never hide behind the dashboard. Your hands
always draw in front of them. Anything you can grab glows
pink when your hand is close enough: the wheel rim, the shifter knob and the
handbrake. During staging the wheel rim pulses until you take hold of it.

## Features

- **Views:** a first-person cockpit and a third-person chase camera on
  flatscreens. In VR you get a native 6DoF cockpit that recenters to the
  driver's eye.
- **VR interactions:** a physics steering wheel with kinematic angular
  damping, a handbrake lever, a sequential or H-pattern shifter (slap shifts
  work too), pressable dashboard switches (pop-ups, hazards, HUD), and a tap
  on the windshield phone to cycle the GPS view. Touch Plus haptics give you
  an asphalt buzz, gutter pulses and an oversteer rumble.
- **Cockpit:** right-hand drive with a low bucket-seat eye point. It has an
  orange-backlit three-dial cluster in a binnacle, twin centre vents, a
  cassette deck, a clip-on cup holder whose water sloshes with g-forces, a
  portrait phone running GPS on a suction mount, door cards, visors, a
  three-spoke wheel with gloved hands and forearms, and working mirrors
  (one shared render target).
- **HUDs:**
  - Arcade HUD: race position and a whole-course map with every car (top left), race time and gap, drift
    score with chain multiplier, and an orange-to-red
    arc tachometer with a big gear digit, speed and a turbo gauge.
  - In the cockpit the arcade HUD collapses to a compact tach.
  - Other HUD modes: diegetic only, projected on the windshield, or a floating
    VR slate.
  - A comfort vignette keeps the cabin as a stable anchor.
- **World:**
  - A procedural pass built from curvature and grade integration with
    clothoid smoothing, a racing line and a speed profile.
  - Cut/fill terrain with retaining walls, U-gutters you can hook a wheel in,
    and guardrails.
  - A solid yellow centre line, utility poles with sagging power lines,
    red/white barricades, chevrons, street lamps with light pools, sakura and
    cedar forests, summit and cooldown lots, torii gates and lanterns.
- **Effects:**
  - GPU-instanced sakura petals that swirl in each car's slipstream.
  - Billboard drift smoke that dissolves near the lens, and velocity-stretched
    guardrail sparks.
  - Neon brake and tail-light halos, twin headlight spotlights, and hot brake
    discs that glow.
  - Selective bloom and drift-linked chromatic aberration on High.
  - Manga speed lines, which turn off when the system asks for reduced motion.
- **Audio:**
  - Spatial Web Audio, with HRTF in VR and on High.
  - Procedural engines: 4A-GE pops, a rotary lope, turbo whistle and blow-off
    valve.
  - Gear whine under the shifter, intake roar through the firewall, gravel
    pinging off the floor pan, and tyre squeal.
  - Walkie-talkie spotter calls run through a radio DSP chain. Their [CC]
    captions are timed to each clip and drawn below the sightline as
    `RADIO · speaker: "…"`.

## Quality presets

| | Low / Mobile | Meta Quest 3 | High / Desktop |
|---|---|---|---|
| Lighting | Unlit toon ramp, light-pool decals | Toon lighting, headlight spot shadow | Toon lighting, cascaded moon shadows |
| Post | — | — | Bloom, chromatic aberration, light shafts |
| Mirrors | Static | 384 px, every 2nd frame | 768 px, every 2nd frame |
| XR | — | 0.8 eye-buffer scale, foveation, 72 Hz, VR profile + governor | — |

On top of the presets the renderer uses culling, chunked LODs and merged
geometry everywhere. A road chunk and a terrain chunk each take one draw call.
Measured in headless Chromium on the Low preset: about 41 draw calls on the
title, 21 in the garage, 42 in a chase-camera race and 69 in the cockpit, all
under the 80-call budget. Adaptive resolution protects the frame rate on
flatscreens.

### WebXR details

- The renderer is `WebGPURenderer({ forceWebGL: true })`, and it renders
  through the standard `XRWebGLLayer`. On the Quest Browser, three.js's WebXR
  Layers projection-layer path (with `OVR_multiview2` single-pass stereo)
  drew the world upside down, left materials missing and the background
  uncleared. That path is now opt-in with `?xrmultiview`.
- It requests `local-floor`, a 72 Hz target and a 0.8 framebuffer scale.
- Stereo doubles every draw, so VR always runs a lean, race-first profile:
  - about 170 m of draw distance, ending in mountain mist and a painted
    silhouette ring of ridges and treelines (`MistRing`)
  - roadside trees only: each terrain chunk stores its trees roadside-first
    in shuffled order, so VR draws a prefix with `drawRange` and drops most
    of the forest behind them (no rebuild, still one draw call per chunk)
  - terrain switches to its coarse level sooner
  - lite lighting: every lit toon material is swapped for its unlit twin
    (the Low preset's baked toon ramp). Per-pixel lights were the biggest
    cost, because the cockpit fills most of each eye. The headlight
    spotlights are swapped for the road light-pool decal.
  - static mirror glass (a mirror re-renders the whole scene, which showed
    up as a periodic frame spike), few petals, no ink outlines
  - live canvas textures (glass HUD, phone, menus, captions) skip mipmaps.
    The HUD canvas is a third of the size and re-uploads only when its
    contents change, at 8 Hz (phone at 4 Hz). This was the single biggest
    win in profiling.
  - a governor steps down through four levels (to 100 m, with roadside
    trees thinned too) when the headset misses its frame rate, and back up
    when there's headroom
  - in the emulator a stereo frame drops from 194 to about 100 draw calls,
    and triangles per view drop from 425k to about 115k
- Pre-warm: during summit staging every mesh in the scene is forced to draw
  once, a few per frame, in both terrain LOD levels, so geometry uploads and
  pipeline builds happen before GO instead of hitching as each new stretch
  of the pass comes into view.
- In VR the arcade HUD becomes a glass HUD floating over the hood: RPM,
  speed, gear, position, time, gap and the start countdown.
- Fixed foveated rendering is set with `renderer.xr.setFoveation`.

## Project layout

```
src/
  core/      Game state machine, renderer + post pipeline, quality presets, settings
  world/     Track generation, terrain field + chunks, road mesh + roadside props, lots
  vehicle/   Car specs, livery painter, procedural car model, physics, AI, cockpit
  modes/     Race, replay, title attract demo, garage + garage set
  fx/        Petals, smoke / sparks / halos
  audio/     Audio engine, car audio, radio + script, ambience
  input/     Keyboard / gamepad / touch
  xr/        XR session, controllers + cockpit interactions, comfort vignette
  ui/        Menus, HUD, minimap, speed lines, telemetry panel + phone GPS, captions, VR menu
  render/    Toon materials, sky, procedural textures, geometry builder
tests/       Headless Playwright screenshot drivers and an IWER-based XR test
scripts/     Track and physics sanity checks (node)
public/audio/radio/   Spotter voice lines
```

## Testing

With the dev server running:

```bash
node tests/game-shot.mjs "?preset=quest&noadapt" /tmp/shot "wait:4000|shot:title|click:[data-act=battle]|wait:3000|shot:garage"
node tests/xr-drive.mjs /tmp/xr      # emulated Quest session (IWER)
node scripts/check-track.mjs         # track geometry sanity
```

`xr-drive.mjs` checks the emulated session end to end. The head sits on the
cockpit eye, both hands grab the wheel, turning the wheel steers the rack, and
the triggers drive the car.

IWER can't emulate multiview or a real XR framebuffer, so it logs
null-framebuffer errors. Those, and the mirror feedback-loop warnings that
follow them, come from the emulator. Multiview, foveation and frame-rate
locking need real Quest hardware.

## Credits

- **Voice lines:** generated with ElevenLabs text-to-speech for this project.
- **Sound effects:** every other sound is synthesised at runtime with Web
  Audio. Openverse (api.openverse.org) was searched for sound effects, but its
  audio CDN wasn't reachable from the build environment, so no third-party
  clips are used.
- **Fonts:** Kanit, Noto Sans JP and Noto Serif JP from Google Fonts.
- **Engine:** three.js (MIT).

All names, shops and teams on the liveries are fictional. Initial D is a
trademark of its respective owners; this is a fan-inspired project with no
affiliation.
