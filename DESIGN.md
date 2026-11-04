---
name: StudyTrack site
description: The semester laid out as the Rolex Learning Center slab, fourteen bays for fourteen weeks, in concrete, glass and one hot orange.
colors:
  ground: "#d9dad7"
  concrete: "#f5f4f0"
  ink: "#15171a"
  ink-2: "#464a50"
  ink-3: "#565b62"
  rule: "#c2c3be"
  glass: "#7fa3b8"
  glass-ink: "#2f5d78"
  late: "#ff5a1f"
  night-ground: "#0f1114"
  night-concrete: "#1a1d21"
  night-ink: "#eceae4"
  night-ink-2: "#b2b6bc"
  night-ink-3: "#8a9097"
  night-rule: "#30343a"
  night-glass: "#ffb76b"
  night-glass-ink: "#ffc58a"
typography:
  display:
    fontFamily: "Archivo, Helvetica Neue, Arial, sans-serif"
    fontSize: "clamp(3.1rem, 8.6vw, 6rem)"
    fontWeight: 750
    lineHeight: 0.92
    letterSpacing: "-0.04em"
    fontVariation: "'wdth' 112"
  headline:
    fontFamily: "Archivo, Helvetica Neue, Arial, sans-serif"
    fontSize: "clamp(2.2rem, 5vw, 4rem)"
    fontWeight: 700
    lineHeight: 0.98
    letterSpacing: "-0.035em"
    fontVariation: "'wdth' 112"
  title:
    fontFamily: "Archivo, Helvetica Neue, Arial, sans-serif"
    fontSize: "clamp(1.75rem, 3vw, 2.6rem)"
    fontWeight: 700
    lineHeight: 1.02
    letterSpacing: "-0.03em"
    fontVariation: "'wdth' 108"
  lede:
    fontFamily: "Archivo, Helvetica Neue, Arial, sans-serif"
    fontSize: "clamp(18px, 1.7vw, 21px)"
    fontWeight: 400
    lineHeight: 1.45
  body:
    fontFamily: "Archivo, Helvetica Neue, Arial, sans-serif"
    fontSize: "17px"
    fontWeight: 400
    lineHeight: 1.55
    fontVariation: "'wdth' 100"
  label:
    fontFamily: "Archivo, Helvetica Neue, Arial, sans-serif"
    fontSize: "11.5px"
    fontWeight: 600
    letterSpacing: "0.12em"
    fontVariation: "'wdth' 125"
rounded:
  none: "0"
  focus: "2px"
  icon: "7px"
  window: "10px"
  phone: "28px"
  phone-small: "20px"
spacing:
  gutter: "clamp(16px, 4.5vw, 64px)"
  panel: "clamp(24px, 3vw, 40px)"
  bay-gap: "clamp(24px, 5vw, 80px)"
  row: "10px"
components:
  button-platform:
    backgroundColor: "{colors.concrete}"
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
    padding: "12px 18px 12px 14px"
    width: "176px"
  button-platform-you:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.ground}"
    rounded: "{rounded.none}"
    padding: "12px 18px 12px 14px"
  button-outline:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
    padding: "13px 20px"
  button-outline-hover:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.concrete}"
  button-outline-you:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.concrete}"
  nav-link:
    textColor: "{colors.ink-2}"
    typography: "{typography.label}"
    rounded: "{rounded.none}"
    padding: "9px 12px"
  panel:
    backgroundColor: "{colors.concrete}"
    textColor: "{colors.ink-2}"
    rounded: "{rounded.none}"
    padding: "{spacing.panel}"
  plan-annotation:
    textColor: "{colors.ink-3}"
    typography: "{typography.label}"
---

#
> **Mise à jour, novembre 2026.** Ce qui suit décrit la première direction ; le site a évolué.
> La scène n'est plus une maquette : le campus vient de swissBUILDINGS3D et de la végétation 3D de
> swisstopo, le sol de SWISSIMAGE à 0,2 m par pixel (ordinateurs seulement). Le Rolex Learning
> Center garde sa vraie géométrie et sa coupe est dessinée dans le shader (rive, verre, dalle, vide
> sous les arches). L'accueil pose le titre dans le ciel, le texte des sections est blanc sur une
> ombre qui s'efface, sans panneau, et l'app se montre entière dans son appareil (iPhone, fenêtre
> Mac, fenêtre Windows). Les ordinateurs gardent la version complète ; les téléphones ont des arbres
> plus simples et pas de photo fine.

 Design System: StudyTrack site

## Overview

**Creative North Star: "The Slab at Ecublens"**

The site is a walk across the Rolex Learning Center: a white-grey concrete slab that undulates through fourteen bays, one per week of the semester. Its hills are the heavy weeks, its glass patios the deadlines, and the student's courses sit on the floor as small coloured objects. A full-bleed WebGL scene stays fixed behind everything and the camera docks at one bay per section as the page scrolls. The interface floating over it reads like an architect's drawing: square concrete panels, hairline dimension lines, expanded capitals for week numbers and spans.

Density is low and deliberate. Each section is one concrete panel and, at most, real app captures beside it; the scene does the rest. Colour lives almost entirely in the 3D world. The chrome is ink on concrete, and the one saturated UI decision is which platform button turns solid ink because it matches your device. In the evening (dark scheme) the same slab is lit from below at night: the glass patios and lawns glow amber and green from inside and the UI turns charcoal with warm-amber focus and selection.

Rejected: the app-landing default (a tilted phone on a gradient above a feature grid) and pill buttons.

**Key Characteristics:**
- A fixed full-bleed 3D slab behind all content; the UI floats over it on opaque concrete.
- Square corners on every UI surface; radii only on real device captures and the app icon.
- Archivo variable for everything, with the width axis carrying hierarchy: expanded (125) for plan labels, semi-expanded (108-112) for headings, normal (100) for reading.
- Hairline rules and dimension ticks in place of decoration.
- Colour belongs to the scene; the UI is ink, concrete and grey.

## Colors

A concrete-and-ink neutral system, one cool glass blue for interaction cues, and one hot orange kept for lateness in the scene only.

### Primary
- **Rolex Ink** (`ink`): headings, body emphasis, the filled "your platform" button, the active ruler week, the heavy top rule of the download columns. It is the only fill strong enough to mean "this one".

### Secondary
- **Léman Glass** (`glass`): the patio glass in the scene; in the UI, only text selection (mixed at 45%). Evening counterpart **Lantern Amber** (`night-glass`).
- **Deep Lake** (`glass-ink`): the focus ring (2px outline, 3px offset). Evening counterpart **Warm Lantern** (`night-glass-ink`).

### Tertiary
- **En Retard Orange** (`late`): late items on the slab floor. Declared as a CSS token but used by no UI rule in the shipped build; it exists for the scene.

### Neutral
- **Ground Grey** (`ground`): page background, header band (at 94%), ruler band, scene background and fog colour. Also the light `theme-color`.
- **Slab Concrete** (`concrete`): panels, platform buttons, and the opaque download, English and footer sections that cover the slab.
- **Graphite** (`ink-2`): running text inside panels, the lede, nav links.
- **Plan Grey** (`ink-3`): plan annotations, captions, version lines, fine print, dimension ticks. Holds about 4.9:1 on Ground Grey.
- **Hairline** (`rule`): dividers, the desk list rules, column separators, the header bottom border (at 70%).
- Evening neutrals (`night-ground`, `night-concrete`, `night-ink`, `night-ink-2`, `night-ink-3`, `night-rule`) map one to one onto the above under `prefers-color-scheme: dark`.

Scene materials (WebGL only, set in `applyTheme`): slab `#efeeea` / `#34383e` at night, bay joints `#c8c8c2` / `#4a4f56`, ground `#d3d4d0` / `#15181c`, patio lawn `#a9b79a` / `#33432f` glowing `#9fb37c`, glass emissive `#e8a35c` at night, sun `#fff6ea` by day and moonlight `#9db4d6` at night. Course objects use the app's demo course colours (`#5b4fb3`, `#2e7a8c`, `#2f7356`, `#a66a2c`).

### Named Rules
**The One Hot Orange Rule.** Orange (`late`) means "en retard" and nothing else. It appears on objects on the slab, never on buttons, links, headings or UI chrome.

**The Colour Stays On The Floor Rule.** Course colours exist only as small objects in the 3D scene and inside real app captures. The interface itself never takes a course hue.

**The Evening Inversion Rule.** Dark is not a dimmed day: it is the slab at night, lit from below. Glass turns amber, lawns glow, the sun becomes cool moonlight, and the UI's focus and selection follow the warm glass.

## Typography

**Display Font:** Archivo variable, width 62-125, weight 300-800 (with Helvetica Neue, Arial)
**Body Font:** Archivo (same family)

**Character:** One grotesque used across its width axis like a draughtsman uses lettering: tight, heavy, semi-expanded for statements; wide, small capitals for measurements; normal width for reading.

### Hierarchy
- **Display** (750, clamp(3.1rem, 8.6vw, 6rem), 0.92): the hero statement only, max 9ch, capped at 6rem.
- **Headline** (700, clamp(2.2rem, 5vw, 4rem), 0.98): the download section heading where the slab ends.
- **Title** (700, clamp(1.75rem, 3vw, 2.6rem), 1.02): one per bay panel. Platform names in the download columns use 26px, width 112, -0.02em.
- **Lede** (400, clamp(18px, 1.7vw, 21px), 1.45): one line under the display, max 27em, Graphite.
- **Body** (400, 17px, 1.55): panel text max 34em; secondary lines at 14.5-15px in Plan Grey.
- **Label** (600, 11.5px, 0.12em, uppercase, width 125): the plan voice; nav links, ruler, panel spans, figure captions, scene notes. Ruler numbers use 0.06em and tabular figures.

### Named Rules
**The Width Carries Rank Rule.** Hierarchy comes from the width axis as much as size: 125 for annotations, 108-112 for headings and the wordmark, 100 for text. Do not add a second family.

**The Plan Label Rule.** Expanded capitals annotate a measurement or a thing: a week number, a span of weeks, a caption under a capture, a nav destination. They sit below or beside what they measure, never as a tag above a heading.

## Layout

The page is a vertical walk. The hero fills 100svh with text in the left third over the whole slab. Each feature section is a bay of 118svh: a two-column grid with a 30rem panel and a flexible figure column, alternating sides (panel left, then right) so the camera can frame the slab on the opposite side. Gutter is `spacing.gutter` on both edges; bay gap `spacing.bay-gap`; bay padding 14svh. An 80svh empty "plan" section lets the camera rise above the slab before the download section.

The download section is opaque concrete, a three-column grid under a 1px ink top rule with hairline column separators; below 900px it stacks with hairline rows. Under 900px bays become single-column (22svh/18svh padding, 28px gap); under 560px the hero text drops to the bottom of the viewport, platform buttons stack full width, phone captures go two-up, the last nav link and the ruler are hidden.

The week ruler is a fixed HUD: 14 equal columns, max 560px, centred at the bottom on its own Ground Grey band, labelled « Semaine » to its left. It fades out (0.4s) when an opaque section covers the slab.

## Elevation & Depth

Real depth belongs to the 3D scene (directional sun with soft shadow maps, hemisphere fill, fog into the ground colour). The UI uses one soft ambient shadow so concrete panels and platform buttons read as slabs resting above the scene; everything else is flat with hairlines.

### Shadow Vocabulary
- **Resting slab** (`box-shadow: 0 12px 24px -14px rgba(28,30,34,0.34), 0 2px 6px -3px rgba(28,30,34,0.16)`; at night `0 12px 26px -12px rgba(0,0,0,0.7), 0 2px 6px -3px rgba(0,0,0,0.5)`): bay panels, platform buttons, phone and window captures (with a 1px Hairline ring at 60-70%).

### Named Rules
**The Slab Stops Here Rule.** Sections that end the walk (download, English, footer) are opaque concrete with a hairline top border and no shadow; the scene and ruler step back behind them.

## Shapes

Square-cornered concrete everywhere in the UI: panels, buttons, nav hover boxes, inline code chips. Radii appear only where the object is round in reality: the app icon (7px), Mac and Windows window captures (10px), iPhone captures (28px, 20px on small screens), and the 2px focus outline. Dimension lines are 1px rules with 7-9px end ticks.

## Components

### Buttons
Tactile concrete blocks you could pick up off the slab.
- **Shape:** square (0).
- **Platform button:** Slab Concrete, Rolex Ink text, min-width 176px, 24px line icon (inline SVG, 1.6 stroke; the Windows logo filled), name at 16px/700/width 110 over a 12px Plan Grey hint. Resting slab shadow, transparent 1px border.
- **Your platform:** detected by script; turns solid ink with ground-coloured text. Only one button is ever filled.
- **Hover / Active:** lifts 2px and shows a Plan Grey border (0.25s, `cubic-bezier(0.16, 1, 0.3, 1)`); presses to scale 0.98.
- **Outline button (download):** transparent with a 1px ink border, 13px 20px, weight 650; fills ink on hover; filled by default in the column for your platform.

### Cards / Containers
- **Bay panel:** Slab Concrete, square, resting slab shadow, `spacing.panel` padding, one title, Graphite paragraphs, optional quiet line, and a plan span at its foot.
- **Download column:** no container; separated by hairlines under a 1px ink rule.

### Navigation
Header is a plan cartouche: fixed, Ground Grey at 94% with a hairline bottom border; wordmark (icon + 17px/700/width 112) left, Label-style links right in Graphite. Hover darkens to ink and draws a Hairline box on a translucent concrete fill.

### Plan Annotation (signature)
A 1px Plan Grey rule with end ticks and an expanded-caps label below it, naming the weeks the panel covers (« Semaines 1 — 4 », « Semaine 7 · 12 h »). Same voice for the fixed week ruler (active week marked by a 5px ink bar and ink numeral) and captions under captures.

### Captures
Real app screenshots with demo data, never mockups: iPhone pairs with the second one lifted 56px (36px on mobile), Mac/Windows windows up to 860px. Each carries a Label caption naming device and « données d'exemple ».

## Do's and Don'ts

### Do:
- **Do** keep every UI surface square-cornered concrete (0 radius); reserve radii for device captures and the app icon.
- **Do** use the Label style (11.5px, 600, 0.12em, uppercase, width 125) for measurements, captions and nav, placed below or beside what it annotates.
- **Do** fill exactly one button with ink: the visitor's platform.
- **Do** let colour come from the scene and from real captures; the chrome stays ink, concrete and grey.
- **Do** give the evening theme its own lighting (amber glass, glowing lawns, moonlight) rather than darkening the day palette.
- **Do** keep the 3D a still frame under `prefers-reduced-motion` and keep the page readable with no WebGL.

### Don't:
- **Don't** use `late` orange for anything but lateness, and never in UI chrome.
- **Don't** put an expanded-caps label above a heading as a kicker or eyebrow.
- **Don't** use pill buttons, rounded cards, or a tilted phone on a gradient.
- **Don't** introduce a second typeface; vary Archivo's width and weight instead.
- **Don't** replace real app captures with mockups, illustrations or stock imagery.
