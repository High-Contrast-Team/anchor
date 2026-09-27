# WCAG 2.1 AA report

Saved for later fixes. This audit does not change the site.

| | |
|---|---|
| Date | 2026-09-27 |
| Commit | `59edf2ba611bb0e6f288db693a5dd17c29c70f22` |
| Build | `astro preview` of the production build at `http://localhost:4322` |
| Engine | axe-core 4.13.0 in Playwright Chromium |
| Tags | `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa` |
| Raw results | `docs/a11y/wcag-2.1-report.json` |

An earlier report is still open on https://github.com/High-Contrast-Team/anchor/pull/86 (audited `39c5deb`). `apps/web` source has not changed since that commit. This run confirms the same failures on current `main`.

## Result

`pnpm a11y:web` **passes**. Ten public routes, consent banner open and dismissed: **0 axe violations**.

That gate is not a full WCAG 2.1 AA pass. It ignores axe `incomplete` results, the high contrast theme, design studies, and the `/app` demo after the first screen. Those checks found confirmed failures below.

## How to reproduce

```bash
pnpm exec astro build --root apps/web
pnpm exec astro preview --root apps/web --host localhost --port 4322
BASE_URL=http://localhost:4322 pnpm a11y:web
```

Use `localhost`, not `127.0.0.1`. On this environment the dev server only accepts IPv6 localhost.

The gate script is `apps/web/scripts/a11y-check.mjs`. It exits 0 when `violations` is empty.

## Confirmed failures

### 1. Primary buttons inside `.prose` are 1:1 (1.4.3)

Axe marks these `incomplete`, so the gate stays green. Computed styles show a real failure: text and fill are both `rgb(68, 61, 255)` (`#443dff`). Ratio **1:1**. Needs **4.5:1**.

| Route | Control | Selector |
|---|---|---|
| `/how-it-works` | Get started | `a.btn.btn-primary` |
| `/404` | Back to Anchor | `a.btn.btn-primary` |

Cause: `.prose a` in `apps/web/src/styles/tokens.css` sets `color: hsl(var(--primary))` and beats `.btn-primary` (specificity 0,1,1 vs 0,1,0). Hover restores contrast because `.btn-primary:hover` wins and sets the light text color again.

Secondary buttons in the same prose blocks pass at **4.66:1** (`#443dff` on `#dddbff`).

Fix: give button links a color rule that beats `.prose a`, for example `.prose a.btn`. Keep the primary fill and the light label color from `.btn-primary`.

### 2. High contrast fails 1.4.3 on every public route (174 nodes)

Turn on `html.a11y-contrast` (Accessibility widget, or `localStorage` key `anchor-a11y-prefs-v1` with `highContrast: true`). Consent dismissed. All 10 public routes fail `color-contrast`.

The theme in `apps/web/src/styles/tokens.css` swaps page background and text, then paints links and primary buttons with `--primary` (`#443dff`).

| Ratio | Foreground | Background | Nodes | What |
|---|---|---|---|---|
| 3.25:1 | `#443dff` | `#050316` | 130 | Nav, footer, and body links. Normal 15px. Needs 4.5:1. |
| 3.25:1 | `#443dff` | `#050316` | 4 | Homepage text links, 15px bold. |
| 3.25:1 | `#443dff` | `#050316` | 16 | In-page links at 18px. Still under the large-text cutoff. |
| 3.25:1 | `#443dff` | `#050316` | 2 | Homepage `.slate-link` at 18px bold. |
| 3.25:1 | `#443dff` | `#050316` | 3 | `mailto:` links at 20px. |
| 3.25:1 | `#443dff` | `#050316` | 1 | `/app` heading `#memory-heading`. |
| 3.25:1 | `#050316` | `#443dff` | 5 | Primary buttons, including homepage "Start Remembering Together". Text uses `--background`, which is the dark page color in this theme. |
| 3.25:1 | `#050316` | `#443dff` | 2 | The same 1:1 prose buttons, now dark-on-purple. |
| 1.21:1 | `#f3f2fe` | `#dddbff` | 10 | `/app` chips, panel headings, empty chat lines. |
| 1.29:1 | `#fbfbfe` | `#dddbff` | 1 | `/family` "Sign in" (`.btn-secondary`). |

Incomplete (axe could not fully decide; ratios are still under 4.5:1, and several nodes are `aria-hidden`):

- Homepage `.slate-step-num` 1, 2, 3 at 3.25:1.
- `/family` step numbers: current step 3.25:1 (`#050316` on `#443dff`); steps 2 and 3 at 1.21:1 (`#f3f2fe` on `#dddbff`).

Fix direction in `html.a11y-contrast`:

- Link color must clear 4.5:1 on `#050316`. `#443dff` does not. The light text token (`#FBFBFE`) does.
- Primary button labels must not use `--background` while that token is the dark page color. Use the light text token on a fill that clears 4.5:1.
- Secondary buttons, chips, and panel headings on `/app` and `/family` stay on the light accent `#dddbff` with near-white text. Use the dark text token on that fill.

### 3. High contrast plus largest text, widget open (1.4.3)

Homepage, `textScale: 150`, `highContrast: true`, Accessibility panel open. Extra failures on top of the link failures above:

| Control | Ratio | Colors |
|---|---|---|
| Default, Larger (`aria-pressed=false`) | 1.29:1 | `#fbfbfe` on `#dddbff` |
| Largest (`aria-pressed=true`) | 3.26:1 | `#050316` on `#443dff` |

Selectors: `.a11y-widget-scale button` in `apps/web/src/components/AccessibilityWidget.css`.

### 4. `/app` after "Use a sample line"

Path: Send the photo, Yes I'll take part, A little later, bring it back, Use a sample line. Default theme.

| Rule | Criterion | Target | Detail |
|---|---|---|---|
| `color-contrast` | 1.4.3 | `.voice-tag` | **3.94:1**, `#443dff` on `#cbc8ff`, 12.5px bold. Needs 4.5:1. Style in `apps/web/src/components/MvpDemo.css`. |
| `scrollable-region-focusable` | 2.1.1 Keyboard | private `.chat-log` | The private log is a scrollable `role="log"` with no tabindex and no focusable child. Keyboard users cannot scroll it. |

Axe also left `.mvp-rail-mark` and a couple of chat name/text nodes `incomplete` because it could not resolve a background. Those are not confirmed failures.

### 5. Phone: accessibility control covers the consent heading

Viewport 390 by 844, consent banner open, homepage.

`body.consent-open .a11y-widget` lifts the control by `5.75rem` (`apps/web/src/components/AccessibilityWidget.css`). The wrapped banner is taller than that offset. Measured boxes intersect:

- `.a11y-widget-toggle` at y 708, height 44
- `#consent-title` ("Cookies & privacy") at y 716.5, height 24

The heading is partly covered. Raise the widget by the real banner height, or reserve space in `.consent-banner`.

### 6. Design study `/designs/ink` (1.4.3)

Not part of the public gate. Three nodes, `.ink-action-index`, **4.41:1** (`#787878` on `#ffffff`). They are `aria-hidden`, and they are still visible text. Needs 4.5:1. Darken the index color slightly.

`/designs/linen`, `/designs/mist`, and `/designs/slate`: 0 violations.

`/designs/quiet`: axe `incomplete` on the heading, line, and links because the page background is a gradient, so axe would not assign a ratio. Declared colors are `#1a1917` on `#f2efe8`. Treat this as unchecked, not as a failure.

## What passed

- Official gate: 10 routes, consent open and consent dismissed, 0 violations. Routes: `/`, `/how-it-works`, `/app`, `/family`, `/my-data`, `/privacy`, `/terms`, `/cookies`, `/sitemap`, unknown path for `/404`.
- Default theme, consent dismissed: 0 violations. The only axe findings are the two incomplete 1:1 buttons in section 1.
- Reflow at 320px wide: no horizontal overflow on those 10 routes (`scrollWidth` equals `clientWidth`).

## Not covered

Signed-in family and my-data flows that need the API and Telegram login were not exercised past the logged-out screens. Keyboard focus order, focus traps, and screen reader announcements were not walked by hand, except the scrollable-region failure axe reported on `/app`.
