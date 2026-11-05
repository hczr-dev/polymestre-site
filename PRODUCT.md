# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

delegated: plain static HTML/CSS/JS on GitHub Pages (polymestre.ch, `CNAME`), no build step; Three.js loaded as an ES module from a CDN for the 3D scene. Chosen because the site is a handful of pages, deploys by pushing `main`, and the Mac app reads `mac/latest.json` from the same host, which must keep working.

## Users

EPFL students first (Bachelor/Master), on iPhone, Mac and Windows. They juggle Moodle, IS-Academia timetables, Botafogo/Courseware/Ed and weekly exercise series, and want to know each day what to do and whether they are keeping up with the workload their ECTS imply. Other schools are not promised.

## Product Purpose

StudyTrack reads a student's courses (Moodle, Botafogo, Courseware, Ed, MediaSpace) and the IS-Academia timetable, sorts lectures, series, exercises and deadlines week by week, counts the hours actually studied, and gives a focused study mode to work in. Success: the student opens the app and knows what to do next, and sees honestly whether they are on track.

## Positioning

Built around EPFL's real sources and rhythm (weekly series, flipped classes, ECTS load), not a generic planner: it imports the course structure itself and works series by series, exercise by exercise.

## Operating Context

- Daily: Today screen (week progress, timetable, catch-up), timer, « J'y étais » on lectures.
- Study mode: fullscreen desk with the series, the course, a calculator/grapher, music (Apple Music, Spotify), Claude (Claude Code subscription or a free tutor) and revision sheets/diagrams; optional lock (Mac/Windows kiosk).
- Groups: who is working now, who is where series by series, end-to-end encrypted help on an exercise, shared session timer, planned sessions.
- Sync: optional, end-to-end encrypted across iPhone, Mac and Windows (account via Apple, Google or email); iCloud between Apple devices.

## Capabilities and Constraints

- Platforms: iPhone (public TestFlight beta), Mac (notarized DMG, macOS 14+, auto-update via `mac/latest.json`), Windows (EXE installer and MSI) — all free.
- Downloads live on the GitHub release of the site repo (`releases/latest`, one release holding Mac and Windows files). `mac/latest.json` must stay at that path and format.
- Language: French first; a short English summary is kept. `privacy.html` and `terms.html` must keep working (linked from the apps and the App Store).
- Not affiliated with EPFL; must say so.
- Open: the public TestFlight URL (to be provided by Hugo).

## Brand Commitments

Name « StudyTrack ». App icon `icon.png` / `logo-120.png`. Voice: direct, short, tutoiement, no marketing superlatives in the apps. Contact studytrack@hczr.ch.

## Evidence on Hand

- iPhone screenshots in `img/` (today, course, timer, agenda; 506×1100) — dated (older UI). Fresh captures can be made from the apps' debug capture flags.
- No testimonials, user counts, press or reviews exist: never invent any.

## Product Principles

1. Honest numbers: hours that mean something, no gamified inflation.
2. The school's own sources, read for you; the student never re-types their semester.
3. Private by default: data on the device, sync and groups end-to-end encrypted, no ads, no trackers.
4. One app on every device the student uses.

## Accessibility & Inclusion

Respect `prefers-reduced-motion` (the 3D must degrade to a still), keyboard-reachable downloads, readable contrast in light and dark.
