---
name: Bridgecast
description: Operator console for live event slides; a flat, docked editor window around one Program output.
colors:
  light-bg: '#f5f6f9'
  light-panel: '#ffffff'
  light-raised: '#f3f4f8'
  light-raised-hi: '#e8eaf1'
  light-line: '#e6e8ee'
  light-line-hi: '#d3d6df'
  light-edge: '#6b7084'
  light-text: '#1a1c24'
  light-text-2: '#4a4e5c'
  light-text-3: '#626776'
  dark-bg: '#13141b'
  dark-panel: '#1c1d27'
  dark-raised: '#272936'
  dark-raised-hi: '#323546'
  dark-line: '#2c2e3d'
  dark-line-hi: '#404459'
  dark-edge: '#8e94ab'
  dark-text: '#e4e6ee'
  dark-text-2: '#adb2c2'
  dark-text-3: '#8a8fa6'
  accent-orange: '#e5600e'
  accent-orange-fill: '#c84f0c'
  accent-orange-ink: '#9a4208'
  accent-violet: '#5b4bd6'
  accent-violet-ink: '#5342c9'
  accent-blue: '#2160d4'
  accent-rose: '#9a4586'
  accent-sand: '#85652a'
  dark-accent-orange: '#f26f1c'
  dark-accent-violet: '#a99cff'
  dark-accent-blue: '#82b2ff'
  dark-accent-rose: '#e3a3d2'
  dark-accent-sand: '#dcc283'
  letterbox: '#000000'
  tag-frozen-light: '#1c55bd'
  tag-frozen-dark: '#98c0ff'
  tag-kv-light: '#5342c9'
  tag-kv-dark: '#a99cff'
typography:
  body:
    fontFamily: 'Geist, Segoe UI Variable Text, Segoe UI, system-ui, sans-serif'
    fontSize: '14px'
    fontWeight: 400
    lineHeight: 1.5
    fontFeature: 'tnum'
  title:
    fontFamily: 'Geist, Segoe UI Variable Text, Segoe UI, system-ui, sans-serif'
    fontSize: '16px'
    fontWeight: 600
    letterSpacing: '-0.015em'
  control:
    fontFamily: 'Geist, Segoe UI Variable Text, Segoe UI, system-ui, sans-serif'
    fontSize: '14px'
    fontWeight: 600
  caption:
    fontFamily: 'Geist, Segoe UI Variable Text, Segoe UI, system-ui, sans-serif'
    fontSize: '12px'
    fontWeight: 500
  notes:
    fontFamily: 'Geist, Segoe UI Variable Text, Segoe UI, system-ui, sans-serif'
    fontSize: '16px'
    fontWeight: 400
    lineHeight: 1.5
  numeral:
    fontFamily: 'Cascadia Mono, Consolas, monospace'
    fontSize: '14px'
    fontWeight: 600
  label-mono:
    fontFamily: 'Cascadia Mono, Consolas, monospace'
    fontSize: '12px'
    fontWeight: 500
    lineHeight: 1
  tag:
    fontFamily: 'Geist, Segoe UI Variable Text, Segoe UI, system-ui, sans-serif'
    fontSize: '12px'
    fontWeight: 700
    lineHeight: 1
    letterSpacing: '0.04em'
rounded:
  sm: '3px'
  r: '4px'
  lg: '6px'
  round: '999px'
spacing:
  xs: '4px'
  sm: '8px'
  md: '12px'
  lg: '16px'
  pad: '20px'
  xl: '24px'
components:
  button:
    backgroundColor: '{colors.light-raised}'
    textColor: '{colors.light-text}'
    rounded: '{rounded.r}'
    padding: '0 16px'
    height: '40px'
  button-sm:
    padding: '0 12px'
    height: '32px'
  transport-hold:
    backgroundColor: '{colors.light-raised}'
    textColor: '{colors.light-text}'
    typography: '{typography.control}'
    rounded: '{rounded.r}'
    padding: '0 12px'
    height: '32px'
  transport-hold-pressed:
    backgroundColor: '{colors.accent-orange}'
    textColor: '{colors.accent-orange-ink}'
    rounded: '{rounded.r}'
  tag-on-air:
    backgroundColor: '{colors.accent-orange}'
    textColor: '#ffffff'
    typography: '{typography.tag}'
    rounded: '{rounded.sm}'
    padding: '0 8px'
    height: '24px'
  tag-sm:
    typography: '{typography.tag}'
    rounded: '{rounded.sm}'
    padding: '0 8px'
    height: '20px'
  tag-next:
    textColor: '{colors.accent-orange-ink}'
    typography: '{typography.tag}'
    rounded: '{rounded.sm}'
    padding: '0 8px'
    height: '20px'
  segmented:
    backgroundColor: '{colors.light-raised}'
    textColor: '{colors.light-text-2}'
    rounded: '{rounded.r}'
    height: '40px'
  segmented-checked:
    backgroundColor: '{colors.light-panel}'
    textColor: '{colors.accent-orange-ink}'
  switch:
    backgroundColor: '{colors.light-raised-hi}'
    rounded: '{rounded.round}'
    width: '42px'
    height: '24px'
  switch-on:
    backgroundColor: '{colors.accent-orange}'
  deck-row:
    textColor: '{colors.light-text}'
    rounded: '{rounded.r}'
    padding: '8px 12px'
  deck-row-current:
    backgroundColor: '{colors.light-raised-hi}'
  dialog:
    backgroundColor: '{colors.light-panel}'
    rounded: '{rounded.lg}'
    width: '560px'
---

# Design System: Bridgecast

## Overview

**Creative North Star: "The Docked Editor"**

Bridgecast looks like a video editor's workspace, not like a slide app and not like a floating card UI. One window is divided into docked panels by 1px rules: a 52px header bar, a Decks panel on the left, the Program column in the middle, a tabbed panel on the right. The Program column is built like an editor's canvas: the monitor, one slim transport bar directly under it, and the slide strip as a timeline under that. Nothing floats except the Settings dialog, menus and the first-run tour.

The reference is the Rimo video-editor screens (decided 2026-10-30, mockup iterated 2026-10-31 in `mockups/operator-redesign/index.html`): white panels on a cool soft-grey ground, hairline dividers, small radii, underlined tabs, a properties-style right panel.

**Source of truth (2026-11-06).** `Bridgecast.pen` is the visual source of truth: its variables, its component library and its Design System, Console, Home, Dialog and Prepare frames. This file describes the .pen in words. Where the app differs from the .pen, the app is changed, not the .pen.

The accent (soft orange by default, five presets and a custom colour chosen in Settings) marks what is on air or next: the LIVE and NEXT tags, the monitor ring, the live slide ring, the switch that is on. FROZEN, BLACK and KV each have their own fixed colour, so the states read apart at a glance; the icon and the word say the state too. Selected and pressed controls follow the accent too, as in the .pen: a pressed hold button is an accent-tinted fill with an accent border and ink, a selected tab or segment has accent-ink text and an accent bar or ring. Only the current deck row, the selected event tab and the header Home button are neutral (Raised High). There is no separate red or amber. What separates states is shape and words: a filled tag means on air, an outlined tag means Next, a pressed hold button is tinted and outlined.

Type is Geist for words and the system monospace (Cascadia Mono, then Consolas) for every number, count, key cap and slide number. Both themes ship; the default follows the OS.

**Key Characteristics:**

- Flat docked panels, 1px rules, no cards, no shadows on panels.
- Small radii: 3, 4 and 6px. Round only for switches, sliders and swatches.
- Tag colours: the accent marks LIVE and NEXT; FROZEN is blue, BLACK ink, KV violet. Fill = on air, outline = Next or held.
- One scale for everything: radius 3/4/6, control heights 32/40/52, bar heights 48 and 56 (rows of chrome, not controls), panel inset 20, gaps 4/8/12/16/24, type 12/14/16.
- Words in Geist, numbers in mono, tabular figures on.
- The Program monitor and slide letterboxes stay black in both themes.

## Colors

Cool, near-neutral greys (a faint blue cast is allowed) with one user-chosen accent. Light is a soft grey ground with white panels; dark is a near-black ground with slightly lifted panels. All values are CSS variables on `:root[data-theme]` and `:root[data-accent]` in `tokens.css`; component rules never use literal values.

### Neutral

- **Ground** (`--bg`): the Program column background, the Home page, the space behind the monitor. Light `#f5f6f9`, dark `#13141b`.
- **Panel** (`--panel`): header, Decks, right panel, transport bar, strip, dialog, menus. Light `#ffffff`, dark `#1c1d27`.
- **Raised / Raised High** (`--raised`, `--raised-hi`): button and segmented rest fill; hover fill; selected tab and event tab.
- **Line / Line High** (`--line`, `--line-hi`): 1px structure. Line divides panels and sections. Line High is the border of buttons, the seam inside the transport bar, and the ring of resting thumbnails.
- **Control Edge** (`--edge`): the border of an input at hover and the switch track outline; meets 4:1 on Ground, Panel, Raised and Raised High in both themes (light changed from #7b8091 on 2026-11-06).
- **Ink 1-3** (`--text`, `--text-2`, `--text-3`): primary text, secondary text, and tertiary labels, counts and hints.
- **Focus** (`--focus`): equals Ink; the 2px focus outline.
- **Letterbox** (`--letterbox`, `#000` in both themes): behind every slide image and the Program monitor.

**Dark palette pinned (2026-11-06, "Tuning B", user-approved).** Tuning A (2026-11-05) lifted the dark neutrals to cut glare but left ground, panel and raised too close together, so the console read flat. Tuning B keeps the lifted text and widens the tonal steps with a slightly bluer cast: `--bg #13141b`, `--panel #1c1d27`, `--raised #272936`, `--raised-hi #323546`, `--line #2c2e3d`, `--line-hi #404459`, `--edge #8e94ab`, `--text #e4e6ee`, `--text-2 #adb2c2`, `--text-3 #8a8fa6` (text-3 is 5.2:1 on panel, 4.5:1 on raised). `PANEL.dark` in `appearance.ts` must equal `--panel`. Do not restore or retune dark neutrals inside an unrelated task; ask first. Tuning A values (`#16171c`, `#1d1e25`, `#26272f`, ...) and the older `#0e0f12`, `#17181d`, `#ecedf2` are obsolete.

### Accent (the state colour)

Five presets, exactly these ids: `orange` (default, a soft orange), `violet`, `blue`, `rose`, `sand`, plus `custom`: a native colour picker (the sixth cell in the swatch grid). For `custom` the app derives the four variables from the picked colour per theme: `--accent` is darkened (light) or lightened (dark) until it has 3:1 against the panel, `--accent-ink` until it has 4.5:1, and `--accent-fill` with `--on-accent` is white text on a darkened fill, or dark text when the colour is light (relative luminance above 0.45). Very dark or very light picks therefore show as a lighter or darker accent than the swatch. Each has a light and a dark value set: `--accent` (rings, bars, tints), `--accent-fill` (the surface that carries text or a knob: filled tags, the switch track, the primary button; equal to `--accent` except when the accent is too light for 4.5:1 text, as in light-theme orange where it is `#c84f0c` with white text), `--accent-ink` (accent as text), `--on-accent` (text on `--accent-fill`), plus two derived tints, `--accent-soft` (13%) and `--accent-soft-hi` (22%). The legacy names `--tally`, `--tally-ink` and `--on-tally` are aliases of the accent so state rules read the same. `--next-ring` is the accent at 45%.

### Named Rules

**The Tag Colour Rule.** LIVE and NEXT use the accent. FROZEN, BLACK and KV use their own fixed colours (`--tag-frozen`, `--text`, `--tag-kv`), which do not follow the accent preset. Selected and pressed controls use the accent as soft fill, ring, bar and ink (never the solid on-air fill); the current deck row, the selected event tab and the Home button stay Raised High. Errors and warnings are ink, weight and an icon, not a hue.

**The Fill Means On Air Rule.** A filled accent tag or a solid 2px accent ring means the audience sees it. An outlined tag or a 45% ring means Next. A pressed hold button is an accent-soft fill with an accent border, so it reads as held, not as on air. State is never colour alone: the word, the icon and the shape say it too.

Note: the Next ring (45% accent mix, `--next-ring`) is below 3:1 against the panel by design. The outlined NEXT tag with its word carries the identity; the ring is redundant reinforcement.

**The Cool Neutral Rule.** Greys may carry a faint cool cast, never a strong hue. The only saturated colours on screen besides slide content are the accent and the two fixed tag colours (FROZEN blue, KV violet), and they appear only on tags and tag icons.

## Typography

**Body Font:** Geist (variable 100-900, bundled woff2), falling back to Segoe UI Variable Text, Segoe UI, system-ui.
**Mono Font:** Cascadia Mono, then Consolas.

### Hierarchy

- **Title** (600, 16px, -0.015em): the brand, panel heads (Decks, Program), section heads, dialog title, event card names, notes.
- **Notes** (400, 16px, 1.5): speaker notes, large enough to read at a distance.
- **Body / Control** (400-600, 14px): everything else, including buttons, tabs, rows, switches and deck names (500).
- **Caption** (500, 12px): field labels, counts, hints, legends, chip text.
- **Numeral** (mono 600, 14px): the slide position `03 / 12`, Up next position.
- **Label Mono** (mono 500, 12px): key caps, counts, slide numbers on thumbnails (600), the `1920 × 1080` line.
- **Tag** (700, 12px, 0.04em, uppercase words): LIVE, FROZEN, BLACK, KV, STANDBY, NEXT.

Sizes in use: 12, 14, 16 (and 24 only for a large position if one is reintroduced). Weights: 400 (reading), 500 (names, labels, controls), 600 (titles, chips, buttons that act), 700 (tags only). Line heights: 1.5 for reading text (notes, hints, body), 1.3 for single-line list rows, 1 for tags and key caps.

### Named Rules

**The Numbers Are Mono Rule.** Every count, position, resolution, key cap and slide number is mono; every sentence is Geist.

## Layout

A fixed desktop console, minimum window 1024 x 640px. Under 1180px the side columns shrink to 256 (Decks) and 288 (right panel).

- **Header bar** (52px, panel, bottom rule): brand, Home, open-event tabs and New on the left. Before the Off air button sit five output chips (since 2026-11-19, user-approved mockup; not yet mirrored in Bridgecast.pen): HDMI, OMT, NDI, a Sound icon (slashed when muted) and the canvas size in mono (`1920×1080`, no "(default)"). Each is a 32px chip (Raised on hover, Raised High with a Line High border while open, accent-ink while its output is on) that opens a 372px popover under it with that output's settings: HDMI (switch, Target display), OMT and NDI (switch, status, Source name, and a "Shared by OMT and NDI" box with Frame rate and Send content only), Sound (device, Sound to, Master volume, Mute all), Canvas (presets, Match HDMI display, Custom). One popover at a time; Esc or a click outside closes it, and while it is open it owns the keyboard (`data-no-shortcuts`). Under 1600px the OMT and NDI chips show the short word. When the tabs run out of room an overflow menu lists every open event and marks the live one; the on-air tab is sticky, so it stays in view at either edge of the tab list; theme switch (Light, Dark) and the Settings gear on the right. Only the event tabs shrink.
- **Main** (three columns, no gaps): Decks 288px, Program fluid, right panel 352px, divided by 1px rules (256 and 288 under 1180px window width). These are the defaults: both side columns can be dragged by their splitter and the width is remembered.
- **Decks panel:** head 56px (title, count, add menu), deck list, and a footer block: the Key visual upload well (since 2026-11-17, at the user's request: a dashed drop target. Empty: round icon badge, title, "drag and drop or click to browse" hint, accepted formats and a `Select image` button, all centred; the whole well is clickable and takes a dropped image. With a KV: a 96px preview beside the title with `Replace` and `Remove`. The footer is capped at 290px with no KV set, 220px with one. Not yet mirrored in Bridgecast.pen), then Add files and Web page side by side. The import format (image or vector) is not in the footer; it lives in Settings, between Appearance and Sound. Section and deck buttons sit in the right panel as a 2-column grid; the Prev deck key cap reads `⇧D`, like Prev section. Slide, PDF and video decks show a 64x36 preview of their first slide; web pages and importing decks keep an icon tile. The add menu (Add files, Add web page, Add section) is a menu, not a dialog. Add web page opens a small dialog first (web address, optional Name, Cancel / Add web page); adding it opens the Prepare window, built like a small browser (up to 1120 x 780px): a bar with Back, Forward, Reload, the address field and Open; a framed live preview of the page that fills the window and can be used (sign in, move to the right slide, press play); a footer with a status line and the Name. Enter in the address field loads the preview and never adds the deck. The preview is a page, not app chrome, so it keeps its own white page colours in both themes; the new web deck joins the same per-event list as slide decks and shows a Loading, then Ready chip (see Deck rows).
- **Program column**, top to bottom:
  1. Title row, 56px, centred: the state tag, then the deck name in ink with "/ Program" in Ink 3 after it (16px, name 600). No separate "Program" heading.
  2. The monitor, 16:9, centred in the free height, black, 4px radius (`--r`), with a 1px ring that becomes a 2px accent ring when anything is on air.
  3. Meta line, 40px: canvas size, transition, one sentence about what the audience sees.
  4. Transport bar, 56px, panel, top rule: Prev, position, a Next chevron icon button (32px, accent-ink, no label; the user chose the minimal icon), a seam, Freeze and KV, a second seam, Black alone, and a sound icon pushed to the right. Black sits apart so it is not hit by mistake. Turning Black on shows a 4-second toast above the bar ("Black on air. The audience sees black." with an Undo button and the B key cap). The toast is 44px tall with a 4px radius, 12px gap and 12/8px side padding, and its Undo button is 28px (Raised fill, 1px Line High border, 12px at 600).
  5. Strip (timeline), 176px: a row of thumbnails with a 48px bar under it.
- **Right panel:** underlined tabs Controls and Info (52px, `--h-lg`) on top. Up next (or Preview while frozen, not collapsible) sits under the tab bar and shows on every tab. Controls is the tab open by default and holds Transition and Deck settings as collapsible sections (48px heads, 20px inset). Transition and Deck settings start open. A closed head shows its current value in Ink 3 ("Cut"), so the section can be found without opening it. An open head stays pinned at the top of the scroll area. Info holds Notes. Output settings are not here since 2026-11-19: they live in the header output chips (see Header bar).
- **Home view** replaces the console body: filter chips, a search field, three actions, the event list as grid or list.

The panel inset is 20px everywhere. The monitor is sized from the free height, so the 16:9 frame never scrolls.

## Elevation & Depth

Flat. Structure comes from tonal steps (ground, panel, raised) and 1px rules, not shadows. Resting cards on the Home page and the search field use a 1px ring (`--shadow-1`, a 0 0 0 1px Line). Selected items on a panel (segmented choice, selected filter) use a 1px Line High ring (`--shadow-0`). Exactly one real shadow exists, `--pop-shadow`, for the Settings dialog, floating menus and the first-run tour.

## Shapes

Three radii: `--r-sm` 3px (key caps, thumbnails, tags, chips, mosaic tiles), `--r` 4px (buttons, tabs, segmented, deck rows, the monitor, event tabs, inputs), `--r-lg` 6px (Home cards, the search field, dialogs, menus). `--r-round` (999px) only for switch tracks and knobs, slider tracks and thumbs, progress bars and colour swatches. There are no pills for navigation or tags. Inside the segmented control the inner segments use 3px (`--r-sm`). There are no other radius tokens.

Borders are 1px for structure and control edges, 1.5px for outlined tags, 2px for state rings and focus. Rings on slides are overlays (`::after`) so the slide box stays exactly 16:9.

## Components

### Component sizes

One place for every size, from the .pen's Design System frame. Heights come from the scale (32, 40, 52, plus the 48 and 56 bars, which are not tokens yet); radius from the radius scale.

| Component       | Height   | Padding | Radius      | Type          | Notes                                                                       |
| --------------- | -------- | ------- | ----------- | ------------- | --------------------------------------------------------------------------- |
| Button          | 40       | 0 16    | 4           | 14 / 500-600  | Icon 16, gap 8. Dialog primary uses the accent fill.                        |
| Button small    | 32       | 0 12    | 4           | 14 / 600      | Panel and row actions.                                                      |
| Hold button     | 32       | 0 12    | 4           | 14 / 600      | 1px Edge border. Pressed is accent-tinted and outlined. Key cap inside.     |
| Icon button     | 32 × 32  | 0       | 4           | -             | Icon 16, transparent, hover Raised. Tooltip and aria-label.                 |
| Segmented       | 40       | 3       | 4 (inner 3) | 14 / 500      | Segments 32 high.                                                           |
| Switch          | 24       | -       | round       | 12 / 600      | Track 42 × 24, knob 16. The word On or Off to its left.                     |
| Input           | 40       | 0 12    | 4           | 14 / 400      | Border goes to Edge on hover. The search field is 6 radius.                 |
| Tag             | 20       | 0 8     | 3           | 12 / 700      | Icon 14 plus the word. 24 high on Home and for STANDBY in the Program head. |
| Chip            | 24       | 0 8     | 3           | 12 / 600      | Ready, Loading, Error, HOLD. Icon 12.                                       |
| Key cap         | 20       | 2 6     | 3           | 12 mono       | 1px Line High border.                                                       |
| Event tab       | 32       | 0 12    | 4           | 14 / 500      | Home list tabs are 40 high.                                                 |
| Underlined tab  | 52       | 0       | 0           | 14 / 500-600  | Full width, selected has a 2px accent bar.                                  |
| Section head    | 48       | 0 20    | 0           | 16 / 600      | Pinned while open; shows its value when closed.                             |
| Deck row        | 52       | 8 12    | 4           | 14 / 500 + 12 | Tile 64 × 36 (3 radius); two text lines.                                    |
| Slide thumbnail | 140 × 79 | 0       | 3           | 12 mono       | 16:9. Live ring 2px accent; Next ring 45% accent.                           |
| Menu item       | 32       | 0 8     | 4           | 14 / 500      | Menu padding 4, min width 230, 6 radius, pop shadow.                        |
| Dialog          | auto     | 20      | 6           | -             | 560 wide (Settings), head 56, scrim 45%.                                    |
| Event card      | auto     | 12      | 6           | 16 / 600      | 280 minimum width, 16:9 preview, 1px ring.                                  |
| Slider          | 20       | 0       | round       | 14 mono       | Track 4, thumb 16.                                                          |

### Buttons

- **Default:** Raised fill, 1px Line High border, 4px radius, 40px tall, 16px padding, 14px at 500-600; icons 16px with an 8px gap. **Small:** 32px, 12px padding.
- **Hover:** Raised High fill. **Focus:** 2px Focus outline at 1px offset (inset by 2px on tabs, segments, menu items and header buttons so it is not clipped). The ring is hidden after a mouse click and returns on Tab, or on arrow, Home and End keys inside a tablist, radiogroup or menu. It is not cleared by arrows elsewhere because clickers send arrows during a show.
- **Dialog primary** uses the accent fill (`--accent-fill`, `--on-accent`).
- **Icon button:** 32px square, transparent, hover Raised.
- **Danger:** Text fill with Ground ink, for a destructive confirm (Delete deck). Never the accent.
- **Alert:** A fixed red fill with white ink for ending the show (Off air, and its confirm). It is the same red in both themes and never follows the user's accent.

### Transport bar

A single slim row, never two. Left to right: Prev chevron, `03 / 12` in mono, Next chevron (accent ink), a 1px seam, then Freeze, KV and Black as hold buttons, a flexible gap, a sound icon.

- **Hold button:** 32px, Raised fill, 1px Control Edge border (4:1; the state controls and text inputs use Edge, labelled secondary buttons keep Line High), 4px radius, ink label at 600, icon in Ink 2, key cap (mono 12px, 1px Line High border).
- **Hover:** Raised High, border goes to Control Edge. **Active (mouse down):** Line High fill.
- **Pressed (the hold is on):** accent-soft fill (13%, 22% on hover), 1px accent border, accent-ink text and icon, key cap outlined in the accent. No dot.
- **Disabled:** transparent, 1px solid Line border, Ink 3 text. Disabled buttons are solid, including `aria-disabled` ones such as Resume web. A dashed border only marks something still in progress (the opening pill); other dashes are drag-over and drop outlines and the disabled address field in the Prepare window. Freeze is disabled in STANDBY.
- Responsive tiers follow the Program column width, not the window: key caps hide under 640px, and under 520px the row goes tight (smaller gaps and padding).
- Next is the chevron plus the Space key; the Up next panel says in words what it does.

### Tags

A tag is a small rectangle, never a dot. Radius 3px. Two forms of the state tags (LIVE, FROZEN, BLACK, KV). Icon-only (the icon alone, `title` and `aria-label` with the word) in exactly three places: the Program head (a bare icon, 18px, no box, in the state's own colour: accent-ink for LIVE, `--tag-frozen`, Text for BLACK, `--tag-kv`), the strip thumbnails (20px tag, 3px side padding so it is square) and the on-air event tab (a bare icon, no box, same colours). Everywhere else the tag carries its word, icon plus word, 8px side padding, in two heights: 24px on Home (the on-air banner and event cards) and 20px (`sm`) in deck rows, Up next and the strip. NEXT and STANDBY always keep their word.

- **LIVE:** accent fill, On-accent icon, 14px. **BLACK:** Text fill, Panel icon. **KV:** `--tag-kv` fill, `--on-tag-kv` icon. **FROZEN:** outline in `--tag-frozen` (1.5px ring, transparent fill, icon in the same colour), so held reads differently from on air. Icons: Broadcast, Snowflake, EyeSlash, Image. The Home status line adds the word in text next to the icon ("Live: Opening Keynote, slide 3").
- **NEXT:** transparent, 1.5px accent ring, accent-ink word, arrow icon.
- **STANDBY:** 1px Line High ring, Ink 2 word.
- Tags show in the Program head, the live deck row (replacing its count), the live event card on Home and on the on-air thumbnail (top right).

### Segmented control and tabs

- **Segmented:** 40px including 3px padding and a 1px Line border, Raised fill; segments 32px, 4px radius (3px inner). Checked: Panel fill, accent-ink text at 600, a 1px Line High ring. The Home grid/list toggle is a 60×32 Segmented with two 28px cells; the checked cell is Panel with a Line High ring and an accent-ink icon.
- **Underlined tabs** (right panel Controls, Info): 52px, full width, no fill; the selected tab has accent-ink text, and one 2px accent bar under the tabs glides to it. Hover changes colour only.
- **Event tabs and Home list tabs:** 32px (Home 40px) rectangles at 4px radius; selected = Raised High (event tab) or Panel with a Line High ring (Home).

### Switch

42×24px track, round, Raised High with a Control Edge ring; knob 16px, Ink 2. On: accent track, On-accent knob moved 18px (0.15s). The word On or Off always sits to its left.

### Deck rows

Rows are 4px-radius items with 8px 12px padding in a list inset 8px, so the text lines up with the 20px panel inset. Two rows of text: the name on its own row (500, truncated), then the sub line (`Slide 3 of 12`, `12 slides`, `Web page`) in Ink 3 with the chips and tags. Slide, PDF and video decks use a 64×36 tile (3px radius) with the first slide; web pages and importing decks use a 40px icon tile (file, globe, film or upload). The row is 52px tall. The current row is `--raised-hi` with a Text icon; a live row also shows the LIVE tag (or FROZEN, BLACK, KV) in place of the count. A web deck shows a Ready chip (24px, accent-soft fill, accent-ink check and word, no border); on air it shows its state tag instead and the Ready chip hides, while Loading, Error and HOLD chips always stay beside the tag (HOLD is never hidden). Loading is a 1px Line High outline with a spinner; Error and HOLD are 1px Text outlines with a warning triangle and pause bars. Chip icons are 12px. Importing shows a 4px round progress bar.

### Strip (timeline)

Thumbnails on top, a bar underneath, after Canva's page strip.

- **Thumbnail:** fixed 140px wide, 16:9, 3px radius, 8px gap, a 1px Line High overlay ring, the slide number bottom-left in a dark chip (mono 12px, 600).
- **LIVE / FROZEN:** 2px accent ring and the tag top-right. **NEXT:** 2px ring at 45% accent and the outlined NEXT tag. **Operator position (off air):** 1.5px Ink 2 ring, no tag.
- **Bar** (48px, top rule): deck name (600), slide count, a legend (ring swatches that match the real rings: solid "Live on Program", pale "Next"); the thumbnail row fades out at its right edge to show it scrolls. There is no zoom control; the thumbnail size is fixed.

### Right panel sections

- **Up next:** a 16:9 card with a 2px accent ring and 4px radius, the NEXT tag, the slide title and the position (`4 / 12` in accent-ink mono), then one sentence saying what Next does. While frozen the head says "Preview" and the card shows the operator's slide. Not collapsible.
- **Notes, Transition, Deck settings, Output, Network:** 48px head (16px, 600) with a chevron, 20px inset body, 16px gap between fields, 1px rule between sections. Rows are 40px with the label on the left, the value or control on the right.
- Display mode and Transition use the segmented control; Sound and Master volume use the round slider with a mono value: a 4px track, and a 16px accent thumb with a 2px Panel ring.

### Settings dialog

Opened by the gear in the header. A centred 560px dialog, Panel fill, 1px Line High border, 6px radius, `--pop-shadow`, over a 45% dark scrim (`--scrim`, `#0e0f12` at 45% in both themes). Head 56px with a close button. Sections in code order: Appearance (Theme Auto, Light, Dark; Accent as a 3×2 grid of swatches with names and a check, the selected one with a 1px accent border; Reduce motion), Import (the format imported PowerPoint files are saved as: LibreOffice .odp or As imported), Sound and About (version, and "Show the tour again"). There is no "This computer" section; earlier mockups proposed General (open last event, confirm closing, default transition) and This computer (default canvas, source name, data folder), but none of that is built, and the canvas and network live in the right panel's Output tab. The Canvas dialog is centred like Settings. Closes with the close button, a click on the scrim, or Escape; focus returns to the gear.

### First-run tour

Opens once, when the library has no events and the tour is not done on this machine (localStorage `app-tour`). Three cards first, in a 560px dialog over the 70% scrim: Welcome to Bridgecast, Built for running the show, Ready when you are (Next, Get started). Then three spotlights on real controls: New event on Home, Add files in the Decks panel, the Add web page dialog. A spotlight draws a 2px Text ring on its control (never the accent); the tip is a 320px Panel card with a Skip button and nothing else: there is no Next. A spotlight waits for the operator to click the highlighted control (New event, then Add files); the last one, the Add web page dialog, rings the Web page button until the dialog opens and finishes the tour when the dialog is closed again. Skip ends the whole tour. Tab is not trapped on a spotlight, so the highlighted control can be reached by keyboard. Without its control on screen a tip waits at the bottom right and never covers the controls it points at. The tour owns the keyboard while it is open: Space, arrows, F, B, K and N do nothing to the Program, and Escape or Skip ends it. An install that already has events is marked done without showing it. Settings > About > Show the tour again replays it.

### Home

A page on the Ground colour, top to bottom: (0) A centred hero always on top, with or without events (2026-11-06, as in the .pen First run and On air frames): the kicker "Welcome to" in mono 12px caps at Ink 3, then the lockup with a 56px mark and a 64px Geist 600 wordmark (the only display-size type in the app), in a 224px block with the content centred (32px padding, 10px between kicker and lockup) and no gap before the next block, as in the .pen. It is the page `h1` when the list is empty; with events the page keeps a single, visually hidden `h1` and the hero title is a plain paragraph. The getting-started guide has three modes: full checklist (no events, always shown), a compact one-row guide (events exist and a step is open) and off (hidden by the user or every step done; "Show the guide again" returns it). Events come first. (1) the on-air banner when something is on the output: Panel fill, 1px accent ring, 6px radius, 64px tall, the state tag, the deck and slide at 16px 600 with the event name under it at 12px, and a primary Back to console button on the right. (2) A toolbar row: search field (40px, grows), then New event (primary). Importing and Add web page live in the console (Decks panel), not on Home. (3) A tab row with a 1px rule: Recent / All events / Archive as underlined tabs (selected = accent-ink and a 2px accent bar), and on the right a Filter menu button (All events, On air, With web pages, No decks yet; pressed = Text border) and the grid/list toggle. (4) Event cards (grid `auto-fill`, 280px minimum, page width capped at 1440px): 16:9 first-slide preview with a 1px ring, a count or globe badge in its corner, name (truncated, the tag stays) and counts. The on-air event is always first in the list, with a 1px accent ring and the LIVE tag. Empty and no-match states say what is wrong and offer Clear search and filter and New event. Home pauses Space, F, B and K and says so in a footnote; the page has its own keys, shown as key caps on the buttons: N New event, I Import slides, W Add web page, Esc Back to console, / search. The tabs are Recent, All and Archive.

### Icons

Phosphor, regular weight, filled glyphs in `currentColor` (the `@phosphor-icons/react` package; the mockup inlines the same paths), at 12px (chips), 14px (tags), 16px (buttons, rows), 18px (the Program head state icon) and 20px (cards, tiles). State icons: Broadcast (LIVE), Snowflake (FROZEN), EyeSlash (BLACK), Image (KV). Icon-only controls (chevrons, gear, sound, close) carry an `aria-label`.

### Motion

Existing: switch knob 0.15s, section chevron 0.18s, event card ring 0.18s. Feedback only, no entrances on panels or lists; transform and opacity only, ease-out `--ease-out` (`cubic-bezier(.16,1,.3,1)`), no bounce:

- Going live: the monitor ring and the strip ring change over 0.18s; the LIVE tag fades in (0.18s).
- Right panel tab underline glides between tabs in 0.18s; the Segmented thumb (the chosen segment's fill and ring) glides in 0.15s.
- Press: buttons and hold buttons scale to 0.98 over 80ms; hold button fill changes over 120ms; deck rows change background over 120ms.
- Hover and focus: colour only. Focus rings appear at once, never faded.
- Menus scale from 0.98 to 1 with opacity over 0.15s; the Settings dialog scrim fades and the dialog rises 8px over 0.18s; toasts rise 12px over 0.18s. Close animations are not built (instant close).
- Strip thumbnail on-air ring changes over 0.15s.
- Travel and scale are off under the app's Reduce motion setting (`data-reduce-motion`) and under `prefers-reduced-motion`; colour and state changes stay. `prefers-reduced-motion: reduce` removes all button transitions.

The slide change contract (hidden until decoded, cut or fade, never a black frame) is unchanged: Cut 50ms, Fade 250ms, never under reduced motion.

## Do's and Don'ts

### Do:

- **Do** use the accent for every on-air or next mark and for nothing else; selected and pressed states use the accent softly (tint, ring, bar, ink), never the solid on-air fill.
- **Do** say state with an icon, a shape and an accessible name as well as colour.
- **Do** keep to the one scale: radius 3/4/6, heights 32/40/52 (bars 48 and 56), inset 20, gaps 4/8/12/16/24, type 12/14/16.
- **Do** read every colour from the `tokens.css` variables so both themes and every accent and any custom colour stay correct.
- **Do** keep the monitor, letterboxes and standby card black in both themes.
- **Do** keep the transport bar to one row under the monitor.
- **Do** respond to the Program column's width (container queries), not the window, when hiding key caps.

### Don't:

- **Don't** use a red tally or an amber Next. New state colours go into the Tags section, not into ad hoc rules.
- **Don't** put a dot beside a status word; use a tag with an icon.
- **Don't** float panels, add card shadows, or round navigation into pills.
- **Don't** introduce a fourth radius or a new control height.
- **Don't** use a weight between the listed ones, 700 outside tags, italics, a third family or text under 12px. Don't put Ink 3 text on Raised High for anything needed during a show. Sentence case everywhere; only state tags are uppercase.
- **Don't** put the operator's Fade under `prefers-reduced-motion`.
- **Don't** show a slide before its image is decoded.
- **Don't** invent a logo; the app icon is still the stock Electron icon.

## Brand

The Bridgecast mark, colour, type and voice rules live in `docs/brand/README.md` and `docs/brand/voice.md`. Logo files are in `resources/brand/`.

`--brand-signal` (`#f26f1c`) is the logo dot and stays separate from the accent. It never follows the accent preset or a custom colour.
