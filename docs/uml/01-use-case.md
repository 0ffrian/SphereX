# 01 Use cases

Who uses Shift & Spectrum and for what. Drawn from architecture spec §1.1 (tiers), §10 (hash routing), rendering doc §4 (display levels), §5.2–5.6 (view modes, honesty, interaction), §8.6–8.7 (spectrum haptics, calibration) and decisions D-06, D-07, D-08, D-25 and D-28, the sky view and shell (Q-89, Q-120, A21), Build it (Q-113, R5.8), the colour views (Q-93), Track (Q-131, Q-135, A19, A20), Area search (Q-146, A16 to A18) and Q-132 (the event is a desktop browser on the A15 laptop, sound only).

Mermaid has no native use-case diagram, so this is a `flowchart LR`: actors are circles, use cases are rounded boxes inside the system boundary. Dashed boxes are stretch goals, to-build features or post-event (Q-132).

```mermaid
flowchart LR
  Public((Public user))
  Blind((Blind or low-vision user))
  Judge((Judge))
  Admin((Team admin))
  Researcher((Researcher))

  subgraph System["Shift & Spectrum (web tool)"]
    direction TB
    UCSky(["Explore the sky view: pan, zoom, markers (A21.6)"])
    UCSearch(["Search by name or RA/Dec"])
    UCFlip(["Play flipbook of SPHEREx frames"])
    UCTrails(["Rainbow Trails view mode (P1)"])
    UCOverlay(["Toggle overlays: Gaia, WISE, flagged pixels, field of view (P1)"])
    UCCombine(["Add or subtract two frames (P1)"])
    UCSpectrum(["Open an object: object panel with spectrum and ObjectCard"])
    UCColour(["Flipbook colour views: wavelength tint, SPHEREx composite (Q-93)"])
    UCListen(["Listen (data sweep)"])
    UCFeelSpec(["Feel spectrum (drag along plot)"])
    UCView3D(["Build it: split view, moulding, 3D body (R5.8)"])
    UCFeel(["Feel mode: hear the body tone (desktop, Q-133)"])
    UCRotate(["Rotate / zoom (drag, keys, buttons)"])
    UCTouch(["Touch mode: feel surface (phones, after the event)"])
    UCViewMode(["Switch view mode: Visible / SPHEREx IR"])
    UCHonesty(["Honesty toggle (3 states)"])
    UCScrub(["Scrub epoch or light curve"])
    UCCalib(["Calibrate vibration (after the event)"])
    UCShare(["Share link (URL hash)"])
    UCPrebake(["Pre-fetch the cache and pre-bake demo assets"])
    UCGemini(["Gemini artistic repaint (P3 stretch)"])
    UCTrack(["Track a known object: path, frames, zoom, spectrum hop by hop, path sound (A19, A20)"])
    UCSpin(["Spin slider in Track (Q-135)"])
    UCExport(["Export the Track as ECSV (A19.9)"])
    UCArea(["Area search: draw a square, Known objects or Discovery (A16 to A18)"])
  end

  Archives((External archives))

  Public --- UCSky
  Public --- UCSearch
  Public --- UCTrack
  Public --- UCColour
  Public --- UCFlip
  Public --- UCSpectrum
  Public --- UCView3D
  Public --- UCRotate
  Public --- UCViewMode
  Public --- UCHonesty
  Public --- UCScrub
  Public --- UCShare
  Public --- UCOverlay
  Public --- UCCombine
  Public --- UCTrails

  Blind --- UCListen
  Blind --- UCFeelSpec
  Blind --- UCTouch
  Blind --- UCCalib
  Blind --- UCRotate
  Blind --- UCFeel

  Judge -.->|"is a"| Public
  Judge --- UCShare

  Researcher -.->|"is a"| Public
  Researcher --- UCTrack
  Researcher --- UCExport
  Researcher --- UCArea

  Admin --- UCPrebake
  Admin --- UCGemini

  UCSearch -.->|"«include»"| UCFlip
  UCSky -.->|"marker click opens"| UCSpectrum
  UCColour -.->|"«extend»"| UCFlip
  UCFeel -.->|"«extend»"| UCView3D
  UCSpin -.->|"«extend»"| UCTrack
  UCExport -.->|"«extend»"| UCTrack
  UCArea -.->|"Track it"| UCTrack
  UCSpectrum -.->|"«extend»"| UCFlip
  UCTrails -.->|"«extend»"| UCFlip
  UCOverlay -.->|"«extend»"| UCFlip
  UCCombine -.->|"«extend»"| UCFlip
  UCListen -.->|"«extend»"| UCSpectrum
  UCFeelSpec -.->|"«extend»"| UCSpectrum
  UCView3D -.->|"«extend»"| UCSpectrum
  UCTouch -.->|"«extend»"| UCView3D
  UCRotate -.->|"«extend»"| UCView3D
  UCViewMode -.->|"«extend»"| UCView3D
  UCHonesty -.->|"«extend»"| UCView3D
  UCScrub -.->|"«extend»"| UCView3D
  UCCalib -.->|"«extend»"| UCTouch

  UCSearch --- Archives
  UCSpectrum --- Archives
  UCOverlay --- Archives
  UCPrebake --- Archives
  UCGemini --- Archives
  UCTrack --- Archives

  classDef stretch stroke-dasharray: 5 5
  class UCGemini,UCTouch,UCCalib,UCArea,UCExport stretch
```

## Notes

- "External archives" stands for IRSA (SPHEREx), Gaia, CatWISE2020 (IRSA), Horizons, SkyBoT, SBDB, DAMIT, SIMBAD, the Exoplanet Archive and the Gemini API. See [03-deployment.md](03-deployment.md).
- Build it is not offered for `candidate`; the panel says "Not enough data for a 3D model" (rendering doc R4, R7.6). It opens from the object card, the object panel (*Build it in 3D*) or the rail's 3D viewer (Q-120 item 4).
- At the event (Q-132) the A15 laptop runs desktop Feel mode with sound only. Touch mode and vibration calibration are after the event, on Android Chrome; iPhone, iPad and desktop get the paired audio only (D-08, D-10).
- Track is the MVP (Q-131, Q-137: 433 Eros), built for researchers looking at known objects only; Area search (Q-146) is dashed because Discovery may be cut first (A14). The spin slider and export follow Q-135 and Q-145.
- Gemini repaint is server-side and behind the admin token (rendering doc §10, D-07).
- Post-event, not drawn: Gemini Live voice control (B-02), AI sound clips (B-03), image-to-3D (B-04).
- Rainbow Trails is a view mode of the flipbook (D-28), so it extends "Play flipbook". It is P1, built after basic playback works.
- Overlays and combine frames extend the flipbook (A4.9, issue #12). The overlays load on the first switch-on and query Gaia DR3 and CatWISE2020 through the cache.
- Pre-fetch fills the backend's read-through cache for the test targets and demo objects, so the demo runs offline (D-25).
