# BracketLab Mobile Audit Report

## Summary
- Total issues found: 42
- Critical (blocks usability): 6
- Major (looks bad but functional): 19
- Minor (polish): 17

---

## 1. Top Nav Bar

### Current State
- **Two nav systems coexist in the CSS.** The legacy `.og-top-nav` system (lines 8173-8188, z-index 100 on mobile) and the newer `.top-nav-bar` system (lines 14207-14260, z-index 140 on mobile). The redesign `.top-nav-bar` is appended at the end of the CSS file (line 14203+) and overrides earlier styles via cascade.
- **Height:** The legacy nav is `calc(48px + env(safe-area-inset-top))`. The redesign nav uses `padding: calc(env(safe-area-inset-top, 0px) + 10px) 14px 10px`, producing an effective height of ~58px (based on padding + content). The mobile shell (`eg-mobile-shell`) adds `padding-top: calc(58px + env(safe-area-inset-top, 0px))` (line 14614) to push content below it.
- **Background:** `#0e0c09` (near-black dark brown), with `border-bottom: 1px solid rgba(171, 138, 69, 0.15)` and `backdrop-filter: blur(10px)`.
- **Positioning:** `position: fixed; top: 0; left: 0; right: 0` on mobile (line 14591).
- **Logo:** Uses an SVG/image element via `.top-nav-bar__logo` at 24x24px (line 14242). The wordmark is rendered via `.top-nav-bar__wordmark` using `font-family: var(--font-serif)`, `font-style: italic`, `font-size: 1.2rem` on mobile (line 14609), amber color (`var(--text-amber)`).
- **BETA badge:** Visible on the legacy nav at 8px font (line 8243), `font-weight: 700`, amber border. Positioned via `align-self: flex-start; margin-top: 2px`.
- **Hamburger menu:** `.top-nav-bar__menu-btn` at `font-size: 24px` (line 14306). Opens `.top-nav-bar__mobile-menu` dropdown at z-index 160 (line 14323).
- **Desktop links** (`.top-nav-bar__links`) are hidden on mobile via `display: none` (line 14600). Mobile shows `.top-nav-bar__mobile` instead (line 14604).
- **Z-index:** 140 on mobile (`.top-nav-bar`, line 14597). The legacy `.og-top-nav` is z-index 100 (line 8187).

### Issues Found
- Issue 1.1: **Two competing nav bar systems produce conflicting z-index and height values.** The legacy `.og-top-nav` (48px + safe-area, z-index 100) and the redesign `.top-nav-bar` (58px effective, z-index 140) both have mobile rules. If both nav bars render in the DOM simultaneously, the z-index 140 `.top-nav-bar` wins, but the legacy `.eg-mobile-shell` padding-top may use the wrong offset (48px vs 58px depending on which block cascades last). The redesign block at line 14614 overrides to 58px, but earlier at line 8297 it's set to 48px. — Severity: **Major** — CSS: `.og-top-nav` (line 8173), `.top-nav-bar` (line 14591), `.eg-mobile-shell` (lines 8294, 14613)

- Issue 1.2: **Logo is only 24x24px** which may be too small for comfortable visual identification on mobile, especially on higher-DPI devices. The legacy nav uses a 28x28px logo (line 8225). — Severity: **Minor** — CSS: `.top-nav-bar__logo` (line 14242), `.nav-logo-icon` (line 8223)

- Issue 1.3: **No gap defined between the bottom of the nav bar and the top of the toolbar.** The nav bar ends at its border-bottom, and the toolbar immediately follows. The `margin: 0` (line 14621) and `border: none` (line 14623) on the toolbar in the redesign means there's zero visual separation — the toolbar background `#0e0c09` blends with the nav background `#0e0c09`. — Severity: **Minor** — CSS: `.toolbar` (line 14617), `.top-nav-bar` (line 14590)

---

## 2. Toolbar

### Current State
- **The toolbar is shared between mobile and desktop** — the same JSX `{toolbar}` renders in both branches (App.tsx lines 3163-3377). On mobile it's wrapped in `<div className="mobile-toolbar-wrapper">`.
- **Two CSS definitions exist for the mobile toolbar:**
  1. **Legacy (line 8304):** `display: flex; align-items: center; gap: 8px; flex-wrap: nowrap; padding: 8px 14px; overflow-x: auto; overflow-y: hidden; background: #0e0c09` — a single-row horizontally scrolling toolbar.
  2. **Redesign (line 14617):** `flex-direction: column; align-items: stretch; gap: 8px; padding: 10px 14px; border-radius: 0; background: #0e0c09` — a multi-row stacked toolbar.
- **Button sizes:**
  - Legacy: `height: 34px; padding: 0 14px; font-size: 12px; border-radius: 100px` (line 8341)
  - Redesign: `height: 32px; padding: 5px 8px; font-size: 11px; border-radius: 8px` (line 14644)
- **The redesign block overrides the legacy block** due to CSS cascade (it appears later in the file at line 14617 vs line 8304).
- **Toolbar buttons visible on mobile** (from App.tsx): Undo, Simulate (split-button dropdown), Reset (dropdown), First Four (conditional), Groups, Futures toggle, Odds mode toggle (%/US), Submit Bracket, Overflow menu (...). The Chaos pill is hidden via `display: none` on `.toolbar .chaos-pill` (line 9645) and moved into the overflow menu.
- **Toolbar wraps to multiple rows** in the redesign: `.toolbar-group { width: 100%; flex-wrap: wrap }` (line 14629-14631) with two groups (left and right) each on their own line.
- **Sticky behavior:** The toolbar is NOT sticky or fixed — it scrolls with content. Only the mobile-toolbar-wrapper has `position: relative` (line 8324).
- **The fade gradient** (`mobile-toolbar-wrapper::after`) is disabled in the redesign via `display: none` (line 14667).

### Issues Found
- Issue 2.1: **Two competing toolbar CSS definitions.** The legacy (line 8304) defines a horizontal scrolling single-row toolbar with `flex-wrap: nowrap; overflow-x: auto`. The redesign (line 14617) overrides to `flex-direction: column; flex-wrap: wrap`. The legacy button ordering via `order:` properties (lines 8369-8411) targets classes like `.toolbar-btn--undo`, `.toolbar-btn--reset` etc., but these may conflict with the redesign's column layout. — Severity: **Major** — CSS: `.toolbar` (lines 8304, 14617)

- Issue 2.2: **Toolbar takes up excessive vertical space.** In the redesign, the toolbar uses `flex-direction: column` with two groups that `flex-wrap: wrap`. With 8+ buttons at 32px height + 8px gaps wrapping across ~2 rows per group, the toolbar could consume ~160-180px of vertical space. Combined with the 58px nav bar, this means ~220+ pixels of fixed chrome before any bracket content appears. On a 667px iPhone SE viewport, that's 33% of the screen. — Severity: **Critical** — CSS: `.toolbar` (line 14617), `.toolbar-group` (line 14629)

- Issue 2.3: **Touch target sizes are borderline.** The redesign toolbar buttons are `height: 32px` (line 14647). Apple HIG recommends 44px minimum touch targets. At 32px, these are below the recommended minimum. The legacy definition at 34px (line 8345) is also below 44px. — Severity: **Major** — CSS: `.toolbar .eg-btn, .toolbar .eg-chip, .toolbar .eg-mini-btn` (lines 8341, 14644)

- Issue 2.4: **No gap between toolbar and region tabs.** The toolbar has `margin-bottom: 0` (implicit from `margin: 0` at line 14621), and the region tabs follow immediately. — Severity: **Minor** — CSS: `.toolbar` (line 14617), `.mobile-region-tabs` (line 8413)

- Issue 2.5: **Submit Bracket button is visible in the toolbar on mobile.** With the toolbar already overloaded, having the Submit Bracket button alongside Undo, Simulate, Reset, First Four, Groups, Futures, Odds toggle, and Overflow creates visual clutter. — Severity: **Major** — CSS/Component: App.tsx toolbar JSX (lines 3163-3377)

---

## 3. Region Tabs (EAST, WEST, MIDWEST, SOUTH, FF+)

### Current State
- **Component:** `MobileRegionTabs` (App.tsx lines 5089-5114). Renders 5 tabs: East, West, Midwest, South, FF+.
- **CSS (line 8413):** `display: flex; position: sticky; top: calc(48px + env(safe-area-inset-top, 0px)); z-index: 60; background: #0e0c09; backdrop-filter: blur(8px); border-bottom: 1px solid rgba(255, 255, 255, 0.07); padding: 0 16px; overflow-x: auto; scrollbar-width: none`.
- **Redesign override (line 14699):** `top: calc(58px + env(safe-area-inset-top, 0px))` — the sticky position accounts for the taller 58px nav bar.
- **Tab styling (line 8432):** `flex-shrink: 0; padding: 11px 20px; font-family: var(--font-mono); font-size: 11px; letter-spacing: 0.14em; text-transform: uppercase; border-bottom: 2px solid transparent`.
- **Active tab (line 8447):** `color: var(--amber); border-bottom-color: var(--amber)`.
- **Tab bar height:** Approximately 36-38px (11px font + 22px vertical padding + 2px border).
- **All tabs visible** without horizontal scrolling on most phone widths (5 tabs at ~75px each = ~375px, fitting an iPhone SE width).

### Issues Found
- Issue 3.1: **Conflicting sticky `top` values.** The legacy CSS sets `.mobile-region-tabs { top: calc(48px + env(safe-area-inset-top, 0px)) }` (line 8416). The redesign overrides to `top: calc(58px + env(safe-area-inset-top, 0px))` (line 14699). Since the redesign overrides via cascade, the 58px value wins. But if the legacy `.og-top-nav` (48px) renders instead of the redesign `.top-nav-bar` (58px), the region tabs would have a 10px gap below the nav bar. — Severity: **Major** — CSS: `.mobile-region-tabs` (lines 8416, 14699)

- Issue 3.2: **The region tabs stick below the nav bar but NOT below the toolbar.** The sticky `top` is set to the nav bar height (~58px), meaning the tabs stick immediately below the nav, not below the toolbar. When the user scrolls, the toolbar scrolls away, and the region tabs jump up to stick below the nav bar. This creates a visual discontinuity — the toolbar disappears and the tabs shift position. — Severity: **Minor** — CSS: `.mobile-region-tabs` (line 14699)

- Issue 3.3: **Tab font size is 11px** which is on the small side for touch-friendly labels, though with the letter-spacing (0.14em) it remains legible. — Severity: **Minor** — CSS: `.mobile-region-tab` (line 8436)

---

## 4. Round Pills (FF, R64, R32, S16, E8)

### Current State
- **Component:** `MobileRoundNav` (App.tsx lines 5164-5201). For regional sections, renders: FF, R64, R32, S16, E8. For the FF+ section, renders: F4, CHAMP, WIN.
- **CSS (line 8452):** `.mobile-round-nav { display: flex; gap: 8px; padding: 14px 16px 10px; overflow-x: auto; scrollbar-width: none }`.
- **Pill styling (line 8464):** `height: 30px; padding: 0 14px; border-radius: 100px; font-family: var(--font-mono); font-size: 11px; font-weight: 700; letter-spacing: 0.1em; border: 1px solid rgba(255, 255, 255, 0.1); background: none; color: var(--text-tertiary)`.
- **Active pill (line 8482):** `background: rgba(184, 125, 24, 0.15); border-color: rgba(184, 125, 24, 0.45); color: var(--amber)`.
- **Status variants:**
  - Interactive (line 8488): slightly brighter border/text
  - Probabilistic (line 8493): dashed amber border, muted amber text
  - Complete (line 8499): solid amber border, amber text
- **Delta badges** (line 8509): 16x16px circle badges showing count of changed games after a pick.
- **Checkmarks** for completed rounds (line 8504): 9px font, amber color.
- **Gap between region tabs and round pills:** The round nav has `padding: 14px 16px 10px`, so there's 14px top padding below the region tabs.

### Issues Found
- Issue 4.1: **Round pills at 30px height are below the 44px touch target minimum.** While the pills have adequate horizontal padding (14px), the 30px height makes them harder to tap accurately on mobile. — Severity: **Major** — CSS: `.mobile-round-pill` (line 8464)

- Issue 4.2: **Pill labels FF, R64, R32, S16, E8 use abbreviated text** that may be unclear to casual users. There's no tooltip or long-press explanation of what these abbreviations mean. — Severity: **Minor** — Component: App.tsx `MobileRoundNav` (line 5252)

---

## 5. Live Odds Strip

### Current State
- **Position:** `position: fixed; bottom: 56px; left: 0; right: 0` (line 8998). It sits directly above the mobile tab bar (which is at `bottom: 0`).
- **Height:** 56px (line 9002).
- **Z-index:** 85 (line 9010). Below the mobile tab bar (z-index 90) but above main content.
- **Background:** `rgba(20, 17, 10, 0.97)` with `backdrop-filter: blur(10px)` and `border-top: 1px solid rgba(184, 125, 24, 0.18)`.
- **Content:** Shows a "Title" label, 5 team chips with abbreviation + odds, and an "All ->" expand button (App.tsx `LiveOddsStrip` component, line 5693).
- **Hidden when:** Bracket Wrapped overlay is open (line 14198: `body:has(.bw-overlay) .live-odds-strip { display: none !important }`).
- **Bottom padding accounting:** Both `.mobile-bracket-scroll` and `.mobile-futures-view` include `padding-bottom: calc(56px + 56px + 24px + env(safe-area-inset-bottom, 0))` = 136px + safe area, accounting for tab bar (56px) + live odds strip (56px) + 24px spacing.

### Issues Found
- Issue 5.1: **The live odds strip consumes 56px of valuable viewport real estate.** Combined with the 56px tab bar, that's 112px of fixed bottom chrome. On a 667px iPhone SE, this leaves only 555px for content (minus the ~58px nav + ~36px region tabs + ~54px round pills = ~407px usable content area). — Severity: **Major** — CSS: `.live-odds-strip` (line 8997)

- Issue 5.2: **No smooth scroll animation.** The strip uses static chip layout on mobile (non-looping, overflow-x scroll at line 9028) vs an infinite-loop marquee on desktop. The mobile version is functional but doesn't auto-scroll, requiring manual horizontal swiping. — Severity: **Minor** — CSS: `.live-odds-strip-chips` (line 9024)

---

## 6. First Four View (Play-in Games)

### Current State
- **Display method:** First Four games are displayed in TWO ways:
  1. **First Four Modal** (`FirstFourModal`, App.tsx lines 4437-4499): A full-screen bottom-sheet modal shared between mobile and desktop. On mobile, the modal slides up from the bottom with `border-radius: 20px 20px 0 0; max-height: 90vh` (CSS line 1015-1016).
  2. **Inline in mobile bracket:** When the user selects the "FF" round pill within a region tab, the First Four games for that region are shown as `MobileMatchupCard` components within `MobileRegionView`.
- **Modal layout on mobile (line 1014-1042):**
  - `.ff-game-matchup` switches to `flex-direction: column; gap: 6px; padding-left: 0; padding-top: 26px` — teams stack vertically instead of side-by-side.
  - `.matchup-stats-icon--ff` repositioned to `left: 50%; top: 4px; transform: translateX(-50%)` — centered above the matchup.
  - `.ff-vs` gets `margin: -2px 0`.
- **Each play-in game card** (`ff-game-card`): `padding: 14px 16px; flex-direction: column; gap: 10px`. Each team button (`ff-team-btn`): `flex: 1; padding: 12px 14px; border-radius: 8px; min-width: 0`.
- **Team elements:** Seed (10px mono), Logo (22x22px), Name (14px serif bold), Percentage (13px mono bold), Check mark (13px).
- **"Pick for me" button** is rendered in the modal footer as `ff-modal-done`.
- **Info (i) button:** The matchup stats icon (`matchup-stats-icon--ff`) is positioned absolutely at top-center of each game card on mobile.

### Issues Found
- Issue 6.1: **Team buttons stack vertically on mobile** (`flex-direction: column` on `.ff-game-matchup`). This means each play-in game card is quite tall — roughly 26px (padding-top for stats icon) + 56px (team A button) + 6px (gap) + 10px (vs text) + 56px (team B button) + 10px (gap) + footer = ~180-200px per game. With 4 play-in games, the modal content is ~800px, requiring significant scrolling even at `max-height: 90vh`. — Severity: **Major** — CSS: `.ff-game-matchup` (line 1018)

- Issue 6.2: **Team name truncation.** `.ff-team-name` has `white-space: nowrap; overflow: hidden; text-overflow: ellipsis` (line 943-946). On narrow mobile screens, longer team names like "North Carolina State" will be truncated. — Severity: **Minor** — CSS: `.ff-team-name` (line 939)

---

## 7. Bracket Game Cards (R64, R32, S16, E8)

### Current State
- **Mobile uses custom card component** `MobileMatchupCard` (App.tsx lines 5564-5680), NOT the desktop `eg-game-card`. This is a completely separate mobile-first card design.
- **Card wrapper (line 8602):** `.m-card { background: var(--bg-surface); border: 1px solid rgba(255, 255, 255, 0.07); border-radius: 10px; margin: 0 16px 12px; overflow: hidden }`.
- **Card margin:** 16px left/right, 12px bottom between cards.
- **Team row (line 8626):** `.m-team { padding: 15px 28px 15px 14px; min-height: 56px }` — good 56px touch target height.
- **Team elements within a row:**
  - Seed: `.m-seed` — 11px mono, 18px width, right-aligned (line 8652)
  - Logo: `.m-logo` — 24x24px (line 8661)
  - Name: `.m-name` — 16px serif bold, `text-overflow: ellipsis` (line 8668)
  - Odds: `.m-odds` — 16px mono bold (line 8712)
  - Probability: `.m-prob` — 10px mono tertiary (line 8706)
- **VS divider (line 8723):** `.m-vs` — 9px mono, 3px vertical padding, bordered top and bottom.
- **Picked state:** `.m-card--picked` gets amber border (line 8611). Winner row: `.m-team--winner` gets amber background (line 8644). Loser row: `.m-team--loser` gets `opacity: 0.36` (line 8648).
- **Card footer (line 8733):** `.m-card-footer { padding: 8px 14px; min-height: 36px }` — contains winner label (11px mono amber) and undo button (11px mono, underlined).
- **Edit odds button:** `.m-edit-prob-btn` (line 8759) — 11px mono amber, shown when a game is unpicked.
- **Matchup stats icon:** `.matchup-stats-icon--mobile` positioned at `top: 8px; right: 8px` (line 8615).
- **Total card height estimate:** ~56px (team A) + ~18px (vs divider) + ~56px (team B) + ~36px (footer) = ~166px per game card, plus 12px margin between cards.

### Issues Found
- Issue 7.1: **Right padding on team rows is 28px** (`padding: 15px 28px 15px 14px`, line 8631) — this is asymmetric with the 14px left padding and may cause the odds/percentage to feel pushed too far left when the matchup stats icon isn't present. The 28px accounts for the stats icon at `top: 8px; right: 8px`, but creates dead space when the icon isn't shown. — Severity: **Minor** — CSS: `.m-team` (line 8626)

- Issue 7.2: **Team name truncation with `text-overflow: ellipsis`** (line 8675). At 16px font size with seed, logo, and odds all competing for horizontal space, longer team names will truncate on screens narrower than ~375px. — Severity: **Minor** — CSS: `.m-name` (line 8668)

- Issue 7.3: **Undo button in card footer is small and hard to tap.** The `.m-undo-btn` (line 8748) has `padding: 0` with 11px font size. This is a very small touch target. — Severity: **Major** — CSS: `.m-undo-btn` (line 8748)

- Issue 7.4: **Contrast between picked and unpicked cards.** The picked card border is `rgba(184, 125, 24, 0.18)` (line 8612) vs unpicked `rgba(255, 255, 255, 0.07)` (line 8605). Both are very subtle borders against the dark background, making it hard to distinguish at a glance which cards have been picked. — Severity: **Major** — CSS: `.m-card` (line 8602), `.m-card--picked` (line 8611)

---

## 8. Finals Section (F4, Championship)

### Current State
- **Component:** `MobileFinalFourView` (App.tsx lines 5345-5476).
- **Gating:** If not all Elite 8s are complete, shows a locked state with message and region progress dots.
- **Locked state CSS (line 8940):** `.m-ff-locked { padding: 48px 24px; text-align: center }`. Region dots: `.m-ff-region-dot { width: 36px; height: 36px; border-radius: 50% }`.
- **Round navigation:** F4 / CHAMP / WIN tabs via `MobileRoundNav`.
- **F4 round:** Shows 2 semifinal games as `MobileMatchupCard` components (same card design as regional rounds).
- **CHAMP round:** If winner exists, shows `MobileChampionshipCelebrationCard` (App.tsx lines 5521-5562) with confetti canvas, trophy emoji, champion name at 22px, badge, seed, and runner-up. If no winner, shows regular `MobileMatchupCard`.
- **WIN round:** Shows `MobileChampionCard` (App.tsx lines 5497-5519) — a simple display with champion logo and 22px name.
- **Championship celebration card styling (line 10915):** On mobile: `padding: 24px 16px 16px; margin: 0 16px`. Logo: `64x64px`. Team name: `font-size: 20px`.
- **Desktop finals CSS (line 4698):** `.ff-championship-section` stacks vertically with `flex-direction: column`, championship container gets `order: -1; width: 100%`, logos shrink to 64x64 (champ) and 40x40 (semifinal).

### Issues Found
- Issue 8.1: **The FF+ tab hosts both Final Four and Finals content** but uses round pills (F4, CHAMP, WIN) for navigation. The "WIN" tab is somewhat confusing as a label — it just shows the champion after they've been picked. A user might expect to interact with it. — Severity: **Minor** — Component: App.tsx `MobileFinalFourView` (line 5382)

- Issue 8.2: **Championship celebration card logos are hardcoded to 64x64px on mobile** (CSS line 10925), which may feel small for a celebration moment — this is the same size as the regular semifinal logos. A larger champion logo (e.g., 80-96px) would better convey the significance. — Severity: **Minor** — CSS: `.championship-card--celebration .championship-logo` (line 10925)

- Issue 8.3: **The locked state padding is 48px top/bottom** (line 8941), which uses significant vertical space for what is essentially a status message. Combined with the 24px gap and 36px dots, the locked state takes up ~200px+. — Severity: **Minor** — CSS: `.m-ff-locked` (line 8940)

---

## 9. Futures Tab
**SKIPPED** — per audit instructions, the Futures tab is working correctly and must not be modified.

---

## 10. Bottom Tab Bar (BRACKET, FUTURES, CONF., RANKS, LEADERS)

### Current State
- **Component:** `MobileTabBar` (App.tsx lines 5116-5162).
- **5 tabs rendered:** Bracket, Futures, Conf., Ranks, Leaders (the "predictor" MobileTab type exists in the type definition but is not rendered in the tab bar).
- **CSS (line 9088):** `.mobile-tab-bar { position: fixed; bottom: 0; left: 0; right: 0; height: 56px; background: rgba(14, 12, 9, 0.97); backdrop-filter: blur(12px); border-top: 1px solid rgba(255, 255, 255, 0.08); display: flex; z-index: 90; padding-bottom: env(safe-area-inset-bottom, 0) }`.
- **Individual tab (line 9102):** `.mobile-tab { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 3px }`.
- **Icons:** 18px emoji/unicode characters (line 9113).
- **Labels (line 9119):** `font-size: 10px; letter-spacing: 0.1em; text-transform: uppercase`. However, a later override at line 12713 sets `.mobile-tab-label { font-size: 0.6rem }` (9.6px).
- **Active tab:** Icon and label turn amber (`var(--amber)`) per line 9128.
- **Safe area:** `padding-bottom: env(safe-area-inset-bottom, 0)` (line 9099) for the home indicator on notched iPhones. The 56px height does NOT include the safe area — safe area is added via padding.
- **Hidden when:** Bracket Wrapped overlay is open (line 14197).

### Issues Found
- Issue 10.1: **Two `font-size` definitions for `.mobile-tab-label`.** Line 9121 sets `font-size: 10px` and line 12713 overrides to `font-size: 0.6rem` (9.6px). The override at 12713 is inside a `max-width: 767px` media query in the conferences section. Since it appears later in the CSS, the 0.6rem value wins. This makes the labels very small (under 10px). — Severity: **Minor** — CSS: `.mobile-tab-label` (lines 9119, 12713)

- Issue 10.2: **Tab bar height is 56px** but with `padding-bottom: env(safe-area-inset-bottom, 0)` the visual touch area of each tab is still 56px, which meets the 44px minimum touch target. However, combined with the 56px live odds strip above it, the total fixed bottom chrome is 112px before safe area. — Severity: **Minor** — CSS: `.mobile-tab-bar` (line 9088)

- Issue 10.3: **No visible gap between the tab bar and viewport bottom** — the tab bar sits at `bottom: 0` with safe area as internal padding. This is correct behavior for iOS devices. On Android devices without a home indicator, there's no issue. — Severity: **None** (working as designed)

- Issue 10.4: **Content may be hidden behind the bottom fixed elements.** The padding-bottom values on `.mobile-bracket-scroll` and `.mobile-futures-view` account for `56px + 56px + 24px + env(safe-area-inset-bottom)` = 136px + safe area. But if the live odds strip is conditionally hidden (e.g., the user hasn't simulated yet), there may be 56px of unnecessary bottom padding creating a dead zone. — Severity: **Minor** — CSS: `.mobile-bracket-scroll` (line 8300), `.mobile-futures-view` (line 9083)

---

## 11. Scrolling Behavior

### Current State
- **Fixed elements on scroll:**
  - Top nav bar: `position: fixed; top: 0; z-index: 140` (always visible)
  - Region tabs: `position: sticky; top: 58px; z-index: 60` (sticks below nav)
  - Live odds strip: `position: fixed; bottom: 56px; z-index: 85` (always visible at bottom)
  - Mobile tab bar: `position: fixed; bottom: 0; z-index: 90` (always visible at bottom)
- **Scrolling elements:**
  - Toolbar: scrolls away with content (not sticky/fixed)
  - Round pills: scroll with content (not sticky)
  - Game cards: scroll within `.mobile-bracket-scroll`
- **Overflow control:** `.eg-app, .eg-page-shell, main` all have `overflow-x: hidden` (line 8170) to prevent horizontal scroll.
- **Scroll position preservation:** The mobile section and round state are managed via React state (`mobileSection`, `mobileRound`). When switching region tabs, the scroll position is NOT explicitly preserved or restored — it depends on whether React re-renders the same DOM subtree or mounts a new one. Since `MobileRegionView` likely unmounts/remounts when the section changes, scroll position resets to top.

### Issues Found
- Issue 11.1: **Content can get hidden behind the fixed nav bar.** The sticky region tabs are at `top: 58px` (matching the nav height), but the toolbar sits between the nav and the tabs and scrolls away. When the user scrolls, there's a brief moment where content passes between the disappearing toolbar and the appearing sticky tabs, which can feel jerky. — Severity: **Minor** — CSS: `.mobile-region-tabs` (line 14699)

- Issue 11.2: **Round pills are NOT sticky.** They scroll away with content, meaning after scrolling past a few game cards, the user loses sight of which round they're viewing. They must scroll back up to switch rounds. — Severity: **Major** — CSS: `.mobile-round-nav` (line 8452) — no `position: sticky` rule

- Issue 11.3: **Scroll position resets when switching tabs/regions.** This is expected behavior but can be disorienting for users who switch between regions to compare picks. — Severity: **Minor** — Component: App.tsx state management

- Issue 11.4: **Total fixed chrome on mobile is ~222px minimum** — nav (58px) + region tabs when stuck (38px) + live odds strip (56px) + tab bar (56px) + safe area. On a 667px iPhone SE, this leaves ~445px for scrollable content, which is barely enough for 2.5 game cards. — Severity: **Critical** — Multiple CSS elements

---

## 12. Typography on Mobile

### Current State
- **Font families used:**
  - UI text: `"Space Grotesk", sans-serif` (body default, line 23)
  - Display/headings: `"Instrument Serif", serif` (header h1, game card team names)
  - Mono: Referenced via `var(--font-mono)` throughout (toolbar labels, stats, navigation)
- **Key font sizes on mobile:**
  - Nav wordmark: 1.2rem (~19px) serif (line 14609)
  - Nav wordmark (legacy): 13px mono (line 8234)
  - Tab labels: 10px mono, overridden to 0.6rem/9.6px (lines 9121, 12713)
  - Region tab labels: 11px mono (line 8436)
  - Round pill labels: 11px mono bold (line 8470)
  - Team names in cards: 16px serif bold (line 8670)
  - Team odds: 16px mono bold (line 8714)
  - Team probability: 10px mono (line 8708)
  - Seed numbers: 11px mono (line 8654)
  - Card footer (winner label/undo): 11px mono (lines 8744, 8752)
  - VS divider: 9px mono (line 8725)
  - BETA badge: 8px mono (line 8243)
  - Live odds team abbrev: 10px mono (line 9054)
  - Live odds values: 11px mono (line 9065)
  - Cascade nudge headline: 11px mono (line 8564)
  - Walkthrough tooltip: Not specified inline (controlled by CSS class)

### Issues Found
- Issue 12.1: **Bottom tab bar labels at 0.6rem (9.6px) are below the 11px readability threshold** for mobile. This makes "BRACKET", "FUTURES", "CONF.", "RANKS", "LEADERS" hard to read, especially for users with less-than-perfect vision. — Severity: **Major** — CSS: `.mobile-tab-label` (line 12713)

- Issue 12.2: **BETA badge at 8px** (line 8243) is extremely small and barely readable on mobile. — Severity: **Minor** — CSS: `.nav-beta` (line 8241)

- Issue 12.3: **VS divider text at 9px** (line 8725) is very small. While it's a decorative element, it adds to the feeling of cramped typography. — Severity: **Minor** — CSS: `.m-vs` (line 8723)

- Issue 12.4: **Font family inconsistency between two nav systems.** The legacy nav uses `var(--font-mono)` for the product title at 13px (line 8233), while the redesign uses `var(--font-serif)` italic at 1.2rem (line 14609). Depending on which nav renders, the brand identity is inconsistent. — Severity: **Major** — CSS: `.nav-product-title` (line 8231), `.top-nav-bar__wordmark` (line 14248)

---

## 13. Spacing and Padding Throughout

### Current State
- **Left/right content padding:**
  - App shell: `padding: 0` on mobile (line 8160), with `padding-left: 0 !important; padding-right: 0 !important` (line 8167)
  - Game cards: `margin: 0 16px 12px` (line 8607) — 16px side margins
  - Toolbar: `padding: 8px 14px` (legacy, line 8309) / `padding: 10px 14px` (redesign, line 14622) — 14px side padding
  - Region tabs: `padding: 0 16px` (line 8421) — 16px side padding
  - Round pills: `padding: 14px 16px 10px` (line 8455) — 16px side padding
  - Cascade nudge: `margin: 4px 16px 8px` (line 8528) — 16px side margins
  - Mobile futures view: `padding: 16px` (line 9083) — 16px all sides
  - Chaos pill mobile: `margin: 8px 16px 4px; width: calc(100% - 32px)` (line 9665) — 16px side margins

### Issues Found
- Issue 13.1: **Mostly consistent 16px side padding** for content areas (game cards, region tabs, round pills, futures view). The toolbar is the exception at 14px. This 2px discrepancy creates a subtle misalignment between the toolbar edge and the content below it. — Severity: **Minor** — CSS: `.toolbar` (line 14622 — 14px padding) vs content areas (16px)

- Issue 13.2: **12px gap between game cards** (via `margin-bottom: 12px` on `.m-card`, line 8607) is adequate but creates a lot of vertical scrolling when there are 8 R64 games at ~166px each = ~1,400px of card content. — Severity: **Minor** — CSS: `.m-card` (line 8607)

- Issue 13.3: **14px padding between round pills and first game card** (round nav has `padding-bottom: 10px` at line 8455, then game cards have no top margin). The effective gap is ~10-12px which is acceptable. — Severity: **None** (adequate)

---

## 14. Modals and Overlays on Mobile

### Current State
- **Auth Modal, My Brackets Modal, Promo CTA (line 10579):** On mobile, these are `width: 92vw; max-width: 92vw; padding: 24px 20px; max-height: 85vh; overflow-y: auto`.
- **First Four Modal (line 1014):** Bottom sheet style with `border-radius: 20px 20px 0 0; max-height: 90vh`. Modal overlay has `padding: 0; align-items: flex-end`.
- **Reset Modal (line 9174):** Uses `.reset-modal-overlay` at z-index 2000 with centered positioning (no mobile-specific override found — uses the same layout as desktop).
- **Probability Popup (line 9133):** On mobile, forced to center screen: `position: fixed !important; left: 50% !important; top: 50% !important; transform: translate(-50%, -50%) !important; width: min(88vw, 320px)`.
- **Matchup Stats Popup (line 5509):** At `max-width: 1100px` it gets width adjustments, but no specific `max-width: 767px` override found for mobile phones.
- **Rank Trend Modal (line 12695):** Mobile gets `padding: 10px 8px 8px` with reduced heading size.
- **Completion Overlay (line 9407):** Full-screen overlay at z-index 1100 with confetti particles. No mobile-specific CSS override — same on all viewports.
- **Bracket Wrapped Overlay (line 13160):** Full-screen at z-index 10000. On mobile: card frame is `100vw x 100dvh; border-radius: 0` (line 13192). Nav arrows shrink to 30x30px (line 13252). Progress bar moves to top (line 14164).
- **All modals can be dismissed** via close buttons and/or backdrop clicks.

### Issues Found
- Issue 14.1: **Auth and My Brackets modals at 92vw width** (line 10579) leave only 4% margin on each side (~7.5px on a 375px screen). This feels very edge-to-edge with minimal breathing room. — Severity: **Minor** — CSS: `.auth-modal, .my-brackets-modal` (line 10579)

- Issue 14.2: **Reset modal has no mobile-specific CSS override.** It uses the desktop centered layout, which should work but may not be optimized for mobile (e.g., button sizes, padding). — Severity: **Minor** — CSS: `.reset-modal-overlay` (line 9174)

- Issue 14.3: **Matchup stats popup has no phone-specific mobile override.** The `max-width: 1100px` breakpoint (line 5509) adjusts sizing but doesn't address phones < 500px. On a 375px screen, the popup may overflow or be awkwardly positioned. — Severity: **Major** — CSS: `.matchup-stats-popup` (line 5509)

- Issue 14.4: **Close buttons on modals use the shared `.auth-modal-close` class** which relies on CSS sizing. No explicit `min-width/min-height: 44px` touch target enforcement found for close buttons. — Severity: **Minor** — CSS: general modal close buttons

---

## 15. Completion Celebration + Wrapped

### Current State
- **Completion celebration** (`BracketCompletionCelebration`, App.tsx lines 4577-4639): Full-screen overlay with confetti particles, trophy emoji, "Your bracket is set" heading, champion name, chaos label, and three action buttons (Submit Bracket, See Wrapped/View Share Card, Keep editing).
- **Rendering:** Identical on mobile and desktop — it's a fullscreen overlay. No mobile-specific CSS adjustments found beyond the championship card celebration override at line 10915.
- **Wrapped flow** (`BracketWrapped`, BracketWrapped.tsx):
  - Mobile detection: `window.innerWidth < 768` (one-time check at line 50, NOT reactive).
  - On mobile: Card frame is `100vw x 100dvh` with no border-radius (CSS line 13192). Card inner uses natural CSS sizing (no inline transform/scale).
  - Navigation: Tap left 30% to go back, right 70% to go forward (BracketWrapped.tsx lines 128-139).
  - Close button: `.bw-close` at z-index 10001.
  - Progress bar: `.bw-progress-bar` at `top: 8px; max-width: 100%` on mobile (line 14164).
  - Nav arrows: 30x30px on mobile (line 13252), positioned at `left: 6px` and `right: 6px`.
  - Tab bar and live odds strip are hidden when wrapped is open (line 14196-14200).
- **Wrapped card** (`BracketWrappedCard`): Fixed aspect ratio card for image export. No mobile-specific rendering. Ghost logo widths are hardcoded inline.

### Issues Found
- Issue 15.1: **`isMobile` in BracketWrapped.tsx is NOT reactive** (line 50: `const isMobile = typeof window !== "undefined" && window.innerWidth < 768`). If a user rotates their device from portrait to landscape while the wrapped flow is open, the `isMobile` value becomes stale. The `useEffect` for `scale` does handle resize, but the inline style conditional on line 189 uses the stale const. — Severity: **Minor** — Component: BracketWrapped.tsx line 50

- Issue 15.2: **Completion celebration overlay has no mobile-specific spacing adjustments.** The celebration content (trophy, heading, buttons) uses the same layout on all screens. The three buttons may stack awkwardly on narrow screens or have insufficient spacing. — Severity: **Minor** — CSS: `.completion-overlay` (line 9407) — no mobile override

- Issue 15.3: **Nav arrows in wrapped flow are only 30x30px on mobile** (line 13253), below the 44px touch target. However, users primarily navigate by tapping left/right zones of the card, making the arrows secondary controls. — Severity: **Minor** — CSS: `.bw-nav-arrow` (line 13252)

---

## 16. Overall Visual Impression

### Top 10 Most Visually Jarring Issues (Ranked by Severity)

1. **CRITICAL: Toolbar vertical space consumption.** The redesign toolbar with `flex-direction: column` and wrapping groups can take 160-180px of vertical space. Combined with the 58px nav bar, users see ~220px+ of chrome before any bracket content. This is the single biggest mobile UX problem. — CSS: `.toolbar` (line 14617), `.toolbar-group` (line 14629)

2. **CRITICAL: Total fixed chrome eats 222px+ of viewport.** Nav (58px) + sticky region tabs (38px) + live odds strip (56px) + tab bar (56px) + safe area = 222px+ of persistent UI on a 667px screen, leaving barely 2.5 game cards visible. The toolbar (when visible before scrolling) adds another 160px. — Multiple CSS elements

3. **CRITICAL: Two competing nav bar CSS systems.** Legacy `.og-top-nav` (48px, z-index 100) and redesign `.top-nav-bar` (58px, z-index 140) coexist. This creates conflicting height calculations for content offset (48px vs 58px), conflicting sticky positions for region tabs, and potential z-index conflicts. — CSS: lines 8173, 14591

4. **CRITICAL: Two competing toolbar CSS systems.** Legacy (horizontal scroll, single row) and redesign (vertical column, wrapping) both exist in the CSS. The cascade resolves to the redesign, but the legacy ordering rules (`order: 1-11`) may still apply, creating unexpected button arrangements. — CSS: lines 8304, 14617

5. **CRITICAL: Round pills are not sticky.** After scrolling past 2-3 game cards, users lose visibility of which round they're on and must scroll back up to switch rounds. This is a fundamental navigation problem. — CSS: `.mobile-round-nav` (line 8452)

6. **CRITICAL: Matchup stats popup has no phone viewport override.** On phones < 500px wide, the popup may overflow, overlap with fixed elements, or be poorly positioned. — CSS: `.matchup-stats-popup` (line 5509)

7. **MAJOR: Toolbar buttons below 44px touch target.** At 32px height (redesign) or 34px (legacy), these buttons are significantly below Apple's 44px recommendation. Fast-moving users will mis-tap. — CSS: toolbar button rules

8. **MAJOR: Undo button in game card footer has zero padding.** The `.m-undo-btn` with `padding: 0` at 11px font makes it an extremely small and hard-to-tap touch target. — CSS: `.m-undo-btn` (line 8748)

9. **MAJOR: Bottom tab labels at 9.6px are too small.** The `font-size: 0.6rem` override (line 12713) makes "BRACKET", "FUTURES", "CONF.", "RANKS", "LEADERS" hard to read. — CSS: `.mobile-tab-label` (line 12713)

10. **MAJOR: Picked vs unpicked card contrast is too subtle.** Both states use very low-alpha borders (`0.07` vs `0.18`) against the dark background. Users can't quickly scan to see which games they've picked. — CSS: `.m-card` (line 8602), `.m-card--picked` (line 8611)

### Additional Observations
- The mobile bracket view works well as a "one region, one round at a time" pattern. The `MobileMatchupCard` component is well-designed with appropriate team name sizing, logo placement, and odds display.
- The live odds strip + tab bar double-bottom pattern (112px fixed bottom) is unusually heavy for a mobile app and competes with the primary bracket content for attention.
- The `DesktopFirstModal` (App.tsx line 4316) warns mobile users that the app is optimized for desktop, which sets a suboptimal first impression.
- Font family usage is inconsistent between the two nav systems (mono vs serif italic), which breaks brand consistency depending on which nav renders.
- The safe area inset handling is thorough — both top (notch) and bottom (home indicator) are accounted for in all fixed elements.
- The mobile bracket architecture (React state-driven region/round navigation, custom card components, auto-advance after picks) is solid. The issues are primarily in CSS spacing, chrome density, and the legacy/redesign conflict.
