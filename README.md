# Bounce & Echo

DESIGN 4106 · Found on the Oval · classroom prototype

A sound trail leads to three simple objects standing together: a throwing ring, a swinging weight and three note beacons. The interface has one Start button. Interaction happens on the objects, with a small return arrow and close button. There are no help/settings menus, reset/replay buttons, activity-selector buttons or completion dialogs.

## Run

The normal HTTPS URL checks the teacher start (`40.000211, -83.011224`) within 15 m using fresh GPS confirmations. Press **Start** once it shows **Start ✓**, then follow the rear-camera sound quest to the user-recorded ant project point (`40.000126, -83.013214`). The target capture reported approximately ±5 m accuracy; this is GPS capture metadata, not an AR anchor precision claim.

After arrival, **Enter** opens visual world tracking. The field appears automatically at the configured project coordinate after fresh GPS, compass and ground tracking are ready. The player never chooses a position or taps to place anything. GPS and compass establish an approximate geographic alignment once; visual SLAM then tracks the moving camera while the field remains fixed in that session. Walk closer or around the objects to interact.

The default runtime is the bundled **8th Wall Engine Binary 1.0.0** with SLAM and **8-Frame 1.5.0**. No account, API key, physical marker, or native app is needed by this integration. The engine binary is free to use under its bundled license; it is not open-source SLAM. Runtime files and notices are distributed unchanged. The user's GitHub Pages deployment must include the complete `vendor` folder.

Explicit development links:

- `?camera`: skip the start gate/sound trail and open the same automatic geographic AR. Location and compass are still required; go near the actual project coordinate. It does not place objects in your current room.
- `?marker`: legacy alias for `?camera`; no marker is needed.
- `?surface`: uses the ordinary automatic geographic flow, without manual surface placement.
- `?trail`: normal fixed-start GPS route.
- `?scout`: record a new destination for TARGET; START_POINT is separate.
- `?preview` / `?toy`: explicit desktop practice modes.

## Play

Tap the physical object to approach/select it. The small names are plain labels, not buttons. Picking includes a forgiving screen-space area around each object for phones.

- Toss: drag the orange ball and release through the ring three times. A green marker predicts a clear pass. A miss returns the ball automatically.
- Swing: pull the orange weight sideways and release. Gravity carries it through the three bells. Hit bells remain lit.
- Echo: watch/listen, then repeat the notes. Three short tunes complete this object; afterwards the notes can be played freely.

A completed object remains lit. The view returns to the area without interrupting with a dialog. All three complete together with a shared melody and local streamers. Reload to start fresh. The small arrow returns to all objects; × leaves the scene.

Audio uses the device volume. Reduced motion follows the operating system preference. The gestures use touch/mouse, not camera hand tracking.

## Automatic geographic alignment

`ground-tracking.js` combines the fixed `TARGET` coordinate with absolute-scale 8th Wall visual SLAM (`scale: absolute`, world tracking enabled). No floor-placement reticle or player placement method is created. `app.js` exposes only practice or this automatic world-tracking mode; the old optional native/marker helpers in `spatial-ar.js` are not selected by the public flow.

Once visual tracking is NORMAL, two distinct fresh GPS samples (at least 650 ms apart, reported accuracy at most 20 m) are paired with the tracked camera position. Samples farther than 60 m from the project point do not initialize the field. The compass establishes geographic north relative to the tracked camera's viewing direction. Relative device yaw is rejected; an iPhone compass or absolute orientation is needed. The camera optical axis accounts for device tilt and landscape orientation using the W3C orientation convention. Several stable heading samples spanning at least 350 ms are required.

The target's east/south offset from each GPS fix is rotated into the SLAM frame and combined with that sample's camera position. Accuracy-weighted candidates set the field's position; the three local station offsets remain oriented in a fixed geographic frame. Looking at a different part of the ground never selects the field position. Horizontal surface hits determine ground height only; absent a suitable hit, the absolute-scale SLAM estimated ground frame y=0 is used. No visible synthetic floor is added.

After the automatic alignment, GPS watches and compass listeners stop. Later GPS jitter, camera movement, surface hits and touches cannot reposition the field. Visual tracking loss hides the installation and pauses interaction; recovery restores the same session position. Exiting stops the runtime and ignores late location callbacks.

Every new session resolves the same configured geographic point automatically. This is approximate GPS/compass alignment, not persistent VPS localization: users and sessions may see positions differ by several metres or more, with compass and tracking error as well. The original ±5 m capture is not a guarantee of current accuracy. A one-plane ground estimate does not provide slopes, floor recognition, environmental occlusion, exact surface reconstruction or a precise shared anchor across phones. Starting a new session requires fresh sensors but no manual placement.

The three fixed station offsets are still in `field-layout.js`, with interaction mechanics in `app.js`. Contact shadows, impacts, lights, streamers and sounds stay local to those stations.

Runtime sources: [8th Wall integration](https://8thwall.org/docs/engine/overview), [absolute scale](https://8thwall.org/docs/api/engine/aframe/xrweb), and [official A-Frame World Effects](https://github.com/8thwall/aframe-world-effects-example). 8-Frame is pinned to example commit `582b28a94182f0243346f1c22df4b49091dbf2ad`, LFS SHA-256 `7617f92c289abf00ef6fbc6bfee35944f6c4c2b1e1200e8e8d4cc58ea4a067af`. The teacher source and the two route coordinates remain unchanged from the previous revision.

## Models

Four editable GLB mesh files are actually loaded through A-Frame `gltf-model`:

- `models/toss-station.glb`
- `models/swing-station.glb`
- `models/echo-station.glb`
- `models/throw-ball.glb`

`tools/build_models.py` is the original procedural modelling source. The files contain meshes, normals, PBR materials and named transform nodes, and can be imported into Blender. No hand-modelling history or native `.blend` project is claimed. Keep node names, origins and hierarchy when re-exporting. See `模型使用说明.txt`.

Hosted pages load external GLBs. Local file previews use identical embedded bytes in `models/model-data.js`. Use Live Server to check GLBs edited in Blender. Re-running the generator overwrites the supplied models; do not run it over your own edits.

## Publish yourself

Upload the extracted contents so `index.html`, `models/`, and `vendor/` sit at the repository root. Enable GitHub Pages from main / root. Nothing in this delivery publishes or pushes the project. Detailed steps are in `手机运行步骤.txt`.

## Design and open-source references

- [Big Walk — official game page](https://bigwalk.game/) and [official Steam description](https://store.steampowered.com/app/1478500/Big_Walk/) — exploring noticeable objects, experimenting with tools/toys, gestures, and sound that changes with space. Bounce & Echo is a small single-device adaptation of those design ideas; it does not use Big Walk art, audio, or code.
- [Three.js r169 XR dragging](https://github.com/mrdoob/three.js/blob/r169/examples/webxr_xr_dragging.html) — reference for highlighting a grabbed object and restoring it on release. Our touchscreen input uses screen-space picking, not a tracked XR controller.
- [Three.js r169 AR hit-test](https://github.com/mrdoob/three.js/blob/r169/examples/webxr_ar_hittest.html) — reference for a clear ring-shaped aim marker. The trajectory marker predicts ball clearance. The automatic geographic backend uses horizontal surface estimates only for ground height; the player does not choose a placement location.
- [Three.js r169 PositionalAudio](https://github.com/mrdoob/three.js/blob/r169/src/audio/PositionalAudio.js) and [orientation example](https://github.com/mrdoob/three.js/blob/r169/examples/webaudio_orientation.html) — reference for HRTF panning and distance attenuation. Our synthesized chirps use native Web Audio nodes in camera-relative coordinates. Sources inspected at commit `37d6f280a5cd642e801469bb048f52300d31258e` (MIT).
- [Enva-XR LightProbe](https://github.com/tentone/enva-xr/blob/main/src/object/LightProbe.ts) — reviewed light matching as a way to make a model sit more naturally in camera AR. Our version uses bounded camera-luminance matching, while Enva-XR uses WebXR light estimates. Source blob inspected: `03adc149a31ef1e30d74edc6ebc06ce7f55fadf2`.
- [pinball-xr TableAudio](https://github.com/patrick-s-young/pinball-xr/blob/main/src/audio/TableAudio.js) — reviewed position-, speed-, and event-dependent collision audio. Our sounds remain synthesized and use the existing native Web Audio panners. Source blob inspected: `ec8fcb197743a071fd555499e783d03d15f4d318`.
- [A-Frame Physics spring example](https://github.com/c-frame/aframe-physics-system/blob/master/examples/cannon/spring.html) and [grab component](https://github.com/c-frame/aframe-physics-system/blob/master/examples/components/grab.js) — reviewed damping/stiffness and distinct grab/release states. The ring uses a small analytic damped spring in `physics.js`, rather than an added physics-engine dependency. Source blobs inspected: `b4038fb1f3d2f57b721e15929fab513be0a391e4` and `9f12d774c610cb6be9bbb1f25d2631ef0cf7ab1f`.
- [AR.js GPS click example](https://github.com/AR-js-org/AR.js/blob/master/aframe/examples/location-based/click-places/index.html) — location-based entities and screen interaction.
- [fcor/arjs-gestures](https://github.com/fcor/arjs-gestures) — reference for translating touch start/move/end into AR object manipulation. The throw controls here use custom Pointer Events and a Three.js raycaster.
- [A-Frame raycaster documentation](https://aframe.io/docs/1.6.0/components/raycaster.html) — picking 3D objects from a screen position.
- [W3C device orientation convention](https://www.w3.org/TR/orientation-event/) — rear camera optical-axis heading for the automatic geographic alignment.
- [Device orientation reference](https://developer.mozilla.org/en-US/docs/Web/API/DeviceOrientationEvent) and [geolocation heading reference](https://developer.mozilla.org/en-US/docs/Web/API/GeolocationCoordinates/heading) — compass/motion and true-north walking-direction inputs for the sound trail.
- [AR.js location documentation](https://ar-js-org.github.io/AR.js-Docs/location-based/) — GPS placement, device orientation, and sensor limitations.

The sound trail, toy physics, reward instrument, generated streamers, and synthesized calls are implemented for this project. Upstream runtime sources and licenses are listed in `vendor/NOTICE.txt`.

## Verification

`node --test tests/*.test.cjs` covers the real geographic backend through `SpatialAR`: automatic appearance without a touch, geographic coordinate transforms, north/east/south/west and landscape heading, walking during initial sampling, camera movement and late GPS after locking, tracking recovery, high-rate sensor events, noisy/stale/distant fixes and permission/cleanup races. Earlier tests cover the start/quest flow, GLB model buffers and the games' physics. These are logic checks using sensor/session fakes, not phone tracking verification.

A real browser loaded the locally hosted 8-Frame 1.5.0 and SLAM runtime successfully, including the xrweb/xrconfig integrations. This caught and fixed an asynchronous initialization race: the page must await `xrloaded`, not just the script load event. The test does not start a camera session.

The available cloud browser has no usable WebGL camera/sensor environment for a full mobile AR test. Actual iPhone geographic alignment, drift, tracking recovery and the complete touch games remain unverified on hardware and need on-site phone testing. The runtime itself is unchanged from the browser-load check; automatic GPS/compass alignment is newly checked in the logic tests.
