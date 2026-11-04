---
version: 1
slug: "index-html"
primary_target: "index.html"
related_targets: ["mac.html"]
---

Scope: index.html (home); downloads live in its #telecharger section (decided during build: one page, no download.html); mac.html is a redirect to /#telecharger (no app links to it). Mode: Persuade.
Audience/job: EPFL students deciding to try StudyTrack; action: download for their device (iPhone TestFlight, Mac DMG, Windows EXE/MSI). Proof: real app screenshots (iPhone, Mac, Windows, demo data), real feature list; no testimonials or numbers exist.
Constraints: static GitHub Pages, mac/latest.json untouched, privacy.html/terms.html keep working, prefers-reduced-motion = still frame, French first + short English.

## Direction contract
THESIS: The semester is a building you walk across: the Rolex Learning Center's undulating slab, fourteen bays for fourteen weeks, its hills the heavy weeks and its patios the deadlines. Refuses the app-landing default (tilted phone + gradient + feature grid).
OWN-WORLD: White-grey concrete (#ECEBE7 slab, #D9DAD7 ground, #16181B ink), glass patios in Léman blue-grey (#7FA3B8), course colours only as small objects on the floor, one hot orange (#FF5A1F) reserved for "en retard". Archivo variable: expanded caps for plan-style labels (axis numbers, week marks like an architect's drawing), tight semi-expanded display. Hairline plan annotations (dimension lines, bay numbers), square-cornered concrete cards. Evening (dark) = the slab lit from below at night.
STORY: Understand: StudyTrack reads your EPFL courses and lays the semester out week by week, counts honest hours, gives a study desk, works in groups, on all your devices, privately. Believe: it is built for EPFL. Do: download for your device.
FIRST VIEWPORT: Full-bleed WebGL slab in soft daylight from a low oblique camera, week bays receding right, course objects resting in their bays, two patios cut at deadlines. Top-left: wordmark; left third: « Moodle, enfin rangé. » at ~9vw, one-line lede, then the three platform buttons (iPhone, Mac, Windows) in a row; bottom: plan annotation "SEMAINE 1 … 14" along the slab edge. Pointer moves the sun; shadows follow.
FORM: Rolex Learning Center slab, my #1 grounded candidate (chosen as IMPECCABLE'S PICK over the assigned Musica Viva), seed 460a0c57. Signature interaction: scroll walks the camera along the slab week by week; each section docks at a bay (import: items fall into their weeks; heures: a column rises; mode étude; groupes: people dots gather; partout: patio glass reflects the three devices).
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

Recorded adaptations: display capped at 6rem (craft floor) instead of ~9vw; the SEMAINE ruler is a fixed plan-cote HUD on its own field band (hidden under 560px where it would cover content) rather than drawn on the slab edge; evening theme lights the patio gardens warm from below; partout shows the three devices standing on the last hill with the real app on their screens (replaces "patio glass reflects the devices", which a still could not read); seed 460a0c57 is the concept-seed key printed this session.
