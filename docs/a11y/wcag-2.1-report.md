# WCAG 2.1 AA report

Automated check of the public Anchor website with axe-core, using the same routes, rule tags, and consent states as `apps/web/scripts/a11y-check.mjs` (`pnpm a11y:web`).

- Generated: 2026-09-27T09:50:10.718Z
- Audited commit: `155621d430b5`
- Triggering main commit: `1022c289a30d` (API-only; `apps/web` is unchanged from the audited commit)
- Standard: WCAG 2.1 Level A and Level AA
- axe-core: 4.13.0
- Rule tags: wcag2a, wcag2aa, wcag21a, wcag21aa
- Base URL: http://127.0.0.1:4322 (astro preview of the production build)
- Viewport: Playwright default 1280×720
- Gate result: **PASS** (10 routes × 2 consent states)

Snapshot for a later fix pass. The pass/fail gate is `pnpm a11y:web` (`apps/web/scripts/a11y-check.mjs`). This document is the evidence from a production preview, including checks the gate does not run.

## Gate summary

| Route | Consent open | Consent dismissed |
| --- | --- | --- |
| / | pass (0 incomplete) | pass (0 incomplete) |
| /how-it-works | pass (1 incomplete) | pass (1 incomplete) |
| /app | pass (1 incomplete) | pass (0 incomplete) |
| /family | pass (0 incomplete) | pass (0 incomplete) |
| /my-data | pass (0 incomplete) | pass (0 incomplete) |
| /privacy | pass (0 incomplete) | pass (0 incomplete) |
| /terms | pass (0 incomplete) | pass (0 incomplete) |
| /cookies | pass (0 incomplete) | pass (0 incomplete) |
| /sitemap | pass (0 incomplete) | pass (0 incomplete) |
| /404 | pass (1 incomplete) | pass (1 incomplete) |

The CI gate routes have zero axe violations at WCAG 2.1 A and AA. `pnpm a11y:web` against this same preview also printed `0 violations`. The gate ignores axe `incomplete` results, and it does not turn on high contrast, resize the viewport, or walk the demo past first paint. The items below are the failures to fix later.

## What to fix later

### 1. Primary buttons inside `.prose` are 1:1 (WCAG 1.4.3)

Measured after dismissing consent:

| Page | Control | Foreground | Background | Size | Ratio |
| --- | --- | --- | --- | --- | --- |
| `/how-it-works` | Get started | `#443dff` | `#443dff` | 15px, weight 600 | 1:1 |
| `/404` | Back to Anchor | `#443dff` | `#443dff` | 15px, weight 600 | 1:1 |

`.prose a` in `apps/web/src/styles/tokens.css` sets the text to primary and `font-weight: 600`. That beats `.btn-primary`, so the label matches the button fill. Axe files this as incomplete, which is why the gate stays green. `/` has no `a.btn-primary`.

Later fix: limit the prose link color with `.prose a:not(.btn)`, or set `.prose .btn-primary { color: hsl(var(--background)); }` so it wins.

### 2. High contrast fails 1.4.3 on every public route

`html.a11y-contrast` was applied from saved accessibility prefs, then consent was dismissed. Axe, with the same WCAG 2.1 A and AA tags, reported **174** `color-contrast` nodes.

| Ratio | Colors | Examples |
| --- | --- | --- |
| 3.25:1 | `#443dff` on `#050316` | Nav and footer links. `html.a11y-contrast a` paints primary onto the dark background. 15px text needs 4.5:1. |
| 3.25:1 | `#050316` on `#443dff` | Primary buttons, including home "Start Remembering Together", `/how-it-works` "Get started", `/family` "Create an account", `/my-data` "Sign in with email". |
| 1.21:1 | `#f3f2fe` on `#dddbff` | `/app` chips: "Kept in her words", "He agrees himself", "It comes back". |
| 1.29:1 | `#fbfbfe` on `#dddbff` | `/family` "Sign in". |

The rules live in the `html.a11y-contrast` block in `apps/web/src/styles/tokens.css`.

With high contrast and 150% text, and the accessibility panel open, the scale buttons use the same failing pairs. Inactive "Default" and "Larger" are `#fbfbfe` on `#dddbff`. Pressed "Largest" is `#050316` on `#443dff`. Those buttons are `700` at `0.85rem`, so they still need 4.5:1. Axe reported 16 contrast nodes on that home state.

### 3. `/app` after "Use a sample line" (1.4.3 and 2.1.1)

Path exercised: "Send the photo", then "Yes, I'll take part", then "bring it back", then "Use a sample line".

- `.voice-tag` ("Voice note") is `#443dff` on `#cbc8ff`, 12.48px bold, **3.94:1**. It needs 4.5:1. Style: `apps/web/src/components/MvpDemo.css`.
- The private `.chat-log` fails `scrollable-region-focusable`. It has `overflow: auto` and no `tabindex`, so a keyboard user cannot scroll it. Markup: `apps/web/src/components/MvpDemo.tsx`.

### 4. Phone width, consent banner open

At 390×844 the accessibility toggle overlaps the consent heading and body on `/` and `/app`. The toggle sits at the right of the wrapped banner, so the right side of "Cookies & privacy" is covered. `body.consent-open .a11y-widget` only lifts the control by `5.75rem` in `apps/web/src/components/AccessibilityWidget.css`. At 1280×720 the toggle clears the banner. On `/app` at 1280, axe still could not compute banner contrast (incomplete). Sampling the heading showed the text itself is hittable, so treat that desktop incomplete as a manual check, not a confirmed cover.

### 5. `/designs/ink` (outside the gate)

`.ink-action-index` uses `opacity: 0.55` in `apps/web/src/components/designs/ink/ink.css`. Axe measures `#787878` on `#ffffff`, 12px, **4.41:1** (needs 4.5:1) on indexes 01, 02, and 03, in both consent states. The spans are `aria-hidden`, and the digits are still visible. Linen, slate, and mist have no violations. Quiet is incomplete because the background is a gradient, not a confirmed fail.

### 6. 320px reflow

No horizontal overflow on the 10 public routes. `scrollWidth` stayed within 1px of `clientWidth` after consent was dismissed.

## Gate findings

### /how-it-works (consent-open)

- URL: http://127.0.0.1:4322/how-it-works
- HTTP: 200
- Title: How it works · Anchor
- Rules passed: 22
- Rules inapplicable: 40
- Violations: 0
- Incomplete: 1

No violations.

Incomplete (axe could not decide; review by hand):

#### `color-contrast` (serious)

Elements must meet minimum color contrast ratio thresholds

- Description: Ensure the contrast between foreground and background colors meets WCAG 2 AA minimum contrast ratio thresholds
- WCAG tags: wcag2aa, wcag143
- Help: https://dequeuniversity.com/rules/axe/4.13/color-contrast?application=axeAPI
- Nodes: 1

1. Target: `[".btn-primary.btn[href$=\"family\"]"]`

   Failure summary:

   ```
   Fix any of the following:
     Element has a 1:1 contrast ratio with the background
   ```

   HTML:

   ```html
   <a class="btn btn-primary" href="/family">Get started</a>
   ```

### /how-it-works (consent-dismissed)

- URL: http://127.0.0.1:4322/how-it-works
- HTTP: 200
- Title: How it works · Anchor
- Rules passed: 19
- Rules inapplicable: 43
- Violations: 0
- Incomplete: 1

No violations.

Incomplete (axe could not decide; review by hand):

#### `color-contrast` (serious)

Elements must meet minimum color contrast ratio thresholds

- Description: Ensure the contrast between foreground and background colors meets WCAG 2 AA minimum contrast ratio thresholds
- WCAG tags: wcag2aa, wcag143
- Help: https://dequeuniversity.com/rules/axe/4.13/color-contrast?application=axeAPI
- Nodes: 1

1. Target: `[".btn-primary"]`

   Failure summary:

   ```
   Fix any of the following:
     Element has a 1:1 contrast ratio with the background
   ```

   HTML:

   ```html
   <a class="btn btn-primary" href="/family">Get started</a>
   ```

### /app (consent-open)

- URL: http://127.0.0.1:4322/app
- HTTP: 200
- Title: Demo · Anchor
- Rules passed: 24
- Rules inapplicable: 38
- Violations: 0
- Incomplete: 1

No violations.

Incomplete (axe could not decide; review by hand):

#### `color-contrast` (serious)

Elements must meet minimum color contrast ratio thresholds

- Description: Ensure the contrast between foreground and background colors meets WCAG 2 AA minimum contrast ratio thresholds
- WCAG tags: wcag2aa, wcag143
- Help: https://dequeuniversity.com/rules/axe/4.13/color-contrast?application=axeAPI
- Nodes: 2

1. Target: `["#consent-title"]`

   Failure summary:

   ```
   Fix any of the following:
     Element's background color could not be determined because it's partially obscured by another element
   ```

   HTML:

   ```html
   <h2 id="consent-title">Cookies &amp; privacy</h2>
   ```

2. Target: `["#consent-body"]`

   Failure summary:

   ```
   Fix any of the following:
     Element's background color could not be determined because it's partially obscured by another element
   ```

   HTML:

   ```html
   <p id="consent-body">Essential storage only by default. See <a href="/privacy">Privacy</a> and<!-- --> <a href="/cookies">Cookies</a>.</p>
   ```

### /404 (consent-open)

- URL: http://127.0.0.1:4322/this-page-does-not-exist-a11y
- HTTP: 404
- Title: Page not found · Anchor
- Rules passed: 21
- Rules inapplicable: 41
- Violations: 0
- Incomplete: 1

No violations.

Incomplete (axe could not decide; review by hand):

#### `color-contrast` (serious)

Elements must meet minimum color contrast ratio thresholds

- Description: Ensure the contrast between foreground and background colors meets WCAG 2 AA minimum contrast ratio thresholds
- WCAG tags: wcag2aa, wcag143
- Help: https://dequeuniversity.com/rules/axe/4.13/color-contrast?application=axeAPI
- Nodes: 1

1. Target: `[".btn-primary.btn[href=\"/\"]"]`

   Failure summary:

   ```
   Fix any of the following:
     Element has a 1:1 contrast ratio with the background
   ```

   HTML:

   ```html
   <a class="btn btn-primary" href="/">Back to Anchor</a>
   ```

### /404 (consent-dismissed)

- URL: http://127.0.0.1:4322/this-page-does-not-exist-a11y
- HTTP: 404
- Title: Page not found · Anchor
- Rules passed: 17
- Rules inapplicable: 45
- Violations: 0
- Incomplete: 1

No violations.

Incomplete (axe could not decide; review by hand):

#### `color-contrast` (serious)

Elements must meet minimum color contrast ratio thresholds

- Description: Ensure the contrast between foreground and background colors meets WCAG 2 AA minimum contrast ratio thresholds
- WCAG tags: wcag2aa, wcag143
- Help: https://dequeuniversity.com/rules/axe/4.13/color-contrast?application=axeAPI
- Nodes: 1

1. Target: `[".btn-primary"]`

   Failure summary:

   ```
   Fix any of the following:
     Element has a 1:1 contrast ratio with the background
   ```

   HTML:

   ```html
   <a class="btn btn-primary" href="/">Back to Anchor</a>
   ```

## Design explorations (not in the CI gate)

### /designs/linen (consent-open)

- URL: http://127.0.0.1:4322/designs/linen
- HTTP: 200
- Title: Anchor — Linen
- Rules passed: 14
- Rules inapplicable: 48
- Violations: 0
- Incomplete: 0

No violations.

### /designs/linen (consent-dismissed)

- URL: http://127.0.0.1:4322/designs/linen
- HTTP: 200
- Title: Anchor — Linen
- Rules passed: 14
- Rules inapplicable: 48
- Violations: 0
- Incomplete: 0

No violations.

### /designs/ink (consent-open)

- URL: http://127.0.0.1:4322/designs/ink
- HTTP: 200
- Title: Anchor — Ink
- Rules passed: 19
- Rules inapplicable: 43
- Violations: 1
- Incomplete: 0

#### `color-contrast` (serious)

Elements must meet minimum color contrast ratio thresholds

- Description: Ensure the contrast between foreground and background colors meets WCAG 2 AA minimum contrast ratio thresholds
- WCAG tags: wcag2aa, wcag143
- Help: https://dequeuniversity.com/rules/axe/4.13/color-contrast?application=axeAPI
- Nodes: 3

1. Target: `[".ink-action[href$=\"app\"] > .ink-action-index[aria-hidden=\"true\"]"]`

   Failure summary:

   ```
   Fix any of the following:
     Element has insufficient color contrast of 4.41 (foreground color: #787878, background color: #ffffff, font size: 9.0pt (12px), font weight: normal). Expected contrast ratio of 4.5:1
   ```

   HTML:

   ```html
   <span class="ink-action-index" aria-hidden="true">01</span>
   ```

2. Target: `[".ink-action[href$=\"how-it-works\"] > .ink-action-index[aria-hidden=\"true\"]"]`

   Failure summary:

   ```
   Fix any of the following:
     Element has insufficient color contrast of 4.41 (foreground color: #787878, background color: #ffffff, font size: 9.0pt (12px), font weight: normal). Expected contrast ratio of 4.5:1
   ```

   HTML:

   ```html
   <span class="ink-action-index" aria-hidden="true">02</span>
   ```

3. Target: `[".ink-action[href$=\"family\"] > .ink-action-index[aria-hidden=\"true\"]"]`

   Failure summary:

   ```
   Fix any of the following:
     Element has insufficient color contrast of 4.41 (foreground color: #787878, background color: #ffffff, font size: 9.0pt (12px), font weight: normal). Expected contrast ratio of 4.5:1
   ```

   HTML:

   ```html
   <span class="ink-action-index" aria-hidden="true">03</span>
   ```

### /designs/ink (consent-dismissed)

- URL: http://127.0.0.1:4322/designs/ink
- HTTP: 200
- Title: Anchor — Ink
- Rules passed: 19
- Rules inapplicable: 43
- Violations: 1
- Incomplete: 0

#### `color-contrast` (serious)

Elements must meet minimum color contrast ratio thresholds

- Description: Ensure the contrast between foreground and background colors meets WCAG 2 AA minimum contrast ratio thresholds
- WCAG tags: wcag2aa, wcag143
- Help: https://dequeuniversity.com/rules/axe/4.13/color-contrast?application=axeAPI
- Nodes: 3

1. Target: `[".ink-action[href$=\"app\"] > .ink-action-index[aria-hidden=\"true\"]"]`

   Failure summary:

   ```
   Fix any of the following:
     Element has insufficient color contrast of 4.41 (foreground color: #787878, background color: #ffffff, font size: 9.0pt (12px), font weight: normal). Expected contrast ratio of 4.5:1
   ```

   HTML:

   ```html
   <span class="ink-action-index" aria-hidden="true">01</span>
   ```

2. Target: `[".ink-action[href$=\"how-it-works\"] > .ink-action-index[aria-hidden=\"true\"]"]`

   Failure summary:

   ```
   Fix any of the following:
     Element has insufficient color contrast of 4.41 (foreground color: #787878, background color: #ffffff, font size: 9.0pt (12px), font weight: normal). Expected contrast ratio of 4.5:1
   ```

   HTML:

   ```html
   <span class="ink-action-index" aria-hidden="true">02</span>
   ```

3. Target: `[".ink-action[href$=\"family\"] > .ink-action-index[aria-hidden=\"true\"]"]`

   Failure summary:

   ```
   Fix any of the following:
     Element has insufficient color contrast of 4.41 (foreground color: #787878, background color: #ffffff, font size: 9.0pt (12px), font weight: normal). Expected contrast ratio of 4.5:1
   ```

   HTML:

   ```html
   <span class="ink-action-index" aria-hidden="true">03</span>
   ```

### /designs/quiet (consent-open)

- URL: http://127.0.0.1:4322/designs/quiet
- HTTP: 200
- Title: Anchor — Quiet
- Rules passed: 10
- Rules inapplicable: 51
- Violations: 0
- Incomplete: 1

No violations.

Incomplete (axe could not decide; review by hand):

#### `color-contrast` (serious)

Elements must meet minimum color contrast ratio thresholds

- Description: Ensure the contrast between foreground and background colors meets WCAG 2 AA minimum contrast ratio thresholds
- WCAG tags: wcag2aa, wcag143
- Help: https://dequeuniversity.com/rules/axe/4.13/color-contrast?application=axeAPI
- Nodes: 6

1. Target: `["h1"]`

   Failure summary:

   ```
   Fix any of the following:
     Element's background color could not be determined due to a background gradient
   ```

   HTML:

   ```html
   <h1 class="quiet-brand">Anchor</h1>
   ```

2. Target: `[".quiet-line"]`

   Failure summary:

   ```
   Fix any of the following:
     Element's background color could not be determined due to a background gradient
   ```

   HTML:

   ```html
   <p class="quiet-line">Family memories, returning in the group chat.</p>
   ```

3. Target: `[".quiet-support"]`

   Failure summary:

   ```
   Fix any of the following:
     Element's background color could not be determined due to a background gradient
   ```

   HTML:

   ```html
   <p class="quiet-support">Spaced retrieval for Athina — gentle cues at the right time, without a new app to learn.</p>
   ```

4. Target: `["a[href$=\"app\"]"]`

   Failure summary:

   ```
   Fix any of the following:
     Element's background color could not be determined due to a background gradient
   ```

   HTML:

   ```html
   <a href="/app">Try the demo</a>
   ```

5. Target: `["a[href$=\"how-it-works\"]"]`

   Failure summary:

   ```
   Fix any of the following:
     Element's background color could not be determined due to a background gradient
   ```

   HTML:

   ```html
   <a href="/how-it-works">How it works</a>
   ```

6. Target: `["a[href$=\"family\"]"]`

   Failure summary:

   ```
   Fix any of the following:
     Element's background color could not be determined due to a background gradient
   ```

   HTML:

   ```html
   <a href="/family">Get started</a>
   ```

### /designs/quiet (consent-dismissed)

- URL: http://127.0.0.1:4322/designs/quiet
- HTTP: 200
- Title: Anchor — Quiet
- Rules passed: 10
- Rules inapplicable: 51
- Violations: 0
- Incomplete: 1

No violations.

Incomplete (axe could not decide; review by hand):

#### `color-contrast` (serious)

Elements must meet minimum color contrast ratio thresholds

- Description: Ensure the contrast between foreground and background colors meets WCAG 2 AA minimum contrast ratio thresholds
- WCAG tags: wcag2aa, wcag143
- Help: https://dequeuniversity.com/rules/axe/4.13/color-contrast?application=axeAPI
- Nodes: 6

1. Target: `["h1"]`

   Failure summary:

   ```
   Fix any of the following:
     Element's background color could not be determined due to a background gradient
   ```

   HTML:

   ```html
   <h1 class="quiet-brand">Anchor</h1>
   ```

2. Target: `[".quiet-line"]`

   Failure summary:

   ```
   Fix any of the following:
     Element's background color could not be determined due to a background gradient
   ```

   HTML:

   ```html
   <p class="quiet-line">Family memories, returning in the group chat.</p>
   ```

3. Target: `[".quiet-support"]`

   Failure summary:

   ```
   Fix any of the following:
     Element's background color could not be determined due to a background gradient
   ```

   HTML:

   ```html
   <p class="quiet-support">Spaced retrieval for Athina — gentle cues at the right time, without a new app to learn.</p>
   ```

4. Target: `["a[href$=\"app\"]"]`

   Failure summary:

   ```
   Fix any of the following:
     Element's background color could not be determined due to a background gradient
   ```

   HTML:

   ```html
   <a href="/app">Try the demo</a>
   ```

5. Target: `["a[href$=\"how-it-works\"]"]`

   Failure summary:

   ```
   Fix any of the following:
     Element's background color could not be determined due to a background gradient
   ```

   HTML:

   ```html
   <a href="/how-it-works">How it works</a>
   ```

6. Target: `["a[href$=\"family\"]"]`

   Failure summary:

   ```
   Fix any of the following:
     Element's background color could not be determined due to a background gradient
   ```

   HTML:

   ```html
   <a href="/family">Get started</a>
   ```

### /designs/slate (consent-open)

- URL: http://127.0.0.1:4322/designs/slate
- HTTP: 200
- Title: Anchor · Slate
- Rules passed: 15
- Rules inapplicable: 47
- Violations: 0
- Incomplete: 0

No violations.

### /designs/slate (consent-dismissed)

- URL: http://127.0.0.1:4322/designs/slate
- HTTP: 200
- Title: Anchor · Slate
- Rules passed: 15
- Rules inapplicable: 47
- Violations: 0
- Incomplete: 0

No violations.

### /designs/mist (consent-open)

- URL: http://127.0.0.1:4322/designs/mist
- HTTP: 200
- Title: Anchor — Mist
- Rules passed: 13
- Rules inapplicable: 49
- Violations: 0
- Incomplete: 0

No violations.

### /designs/mist (consent-dismissed)

- URL: http://127.0.0.1:4322/designs/mist
- HTTP: 200
- Title: Anchor — Mist
- Rules passed: 13
- Rules inapplicable: 49
- Violations: 0
- Incomplete: 0

No violations.

## Accessibility widget open (not in the CI gate)

### / (widget-open-consent-dismissed)

- URL: http://127.0.0.1:4322/
- HTTP: 200
- Title: Anchor · Keeping memories alive for the whole family
- Rules passed: 27
- Rules inapplicable: 35
- Violations: 0
- Incomplete: 0

No violations.

## Later-fix index

The work list is [What to fix later](#what-to-fix-later). Axe violations inside the default-theme gate: none. Axe violations outside that gate:

- `color-contrast` (serious) on `/designs/ink`, both consent states, 3 nodes each. https://dequeuniversity.com/rules/axe/4.13/color-contrast?application=axeAPI

High contrast, the demo sample-line path, and the 390px consent overlap are real WCAG failures that this default-theme axe pass does not count. Their node samples are in `docs/a11y/wcag-2.1-report.json` under `followUps`.

## Notes

- Consent is cleared before each page load. "Consent open" keeps the banner. "Consent dismissed" clicks `.consent-banner .btn-primary`.
- `/404` is loaded as `/this-page-does-not-exist-a11y`, matching the CI script.
- axe incomplete results are not failures. They are listed so a later pass can check them by hand.
- Design pages and the open accessibility panel are extra coverage. They do not change the gate result.
- Extra-scope checks with violations: 2.
