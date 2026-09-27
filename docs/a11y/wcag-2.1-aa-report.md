# WCAG 2.1 Level A and AA audit

Automated axe result: **PASS** on the public site (no violation rules in the states below). The project gate `pnpm a11y:web` uses the same rule tags on the public routes.

Conformance: **not claimed**. 2 confirmed issues below are a WCAG 2.1 AA failure that axe left as incomplete or that sits outside the public sitemap. Fix these before calling the site conformant.

This report is the record for later fixes. It does not change the site.

## How this was run

- Date: 2026-09-27T09:32:05.642Z
- Commit: `155621d430b55cccc654fc1906990d2f141f174a`
- Base URL: http://127.0.0.1:4321
- Server: astro preview (production build)
- Engine: axe-core 4.13.0 via Playwright Chromium
- Rule tags: wcag2a, wcag2aa, wcag21a, wcag21aa
- Public routes, each in two consent states (banner open, banner dismissed), at 1280×800 and 320×640.
- Home, Family, and Demo also scanned with the Accessibility panel open (banner dismissed, desktop).
- Design explorations under `/designs/*` are listed separately and do not decide pass or fail.

The project gate is `pnpm a11y:web` (`apps/web/scripts/a11y-check.mjs`). It covers the same public routes and consent states at the browser default viewport, and exits non-zero when axe reports a violation. This report is wider: it adds the 320px viewport and the open Accessibility panel, and it keeps incomplete checks.

## Result summary

| Scope | Runs | Runs with violations | Violation instances | Incomplete checks |
| --- | ---: | ---: | ---: | ---: |
| public | 43 | 0 | 0 | 14 |
| design | 5 | 1 | 3 | 1 |

## Confirmed issues to fix later

### Primary button links inside prose use the link color for their label

`.prose a` sets `color` to the primary blue and outranks `.btn-primary`, which only sets the label to the near-white background token. On those links the label and the button fill are the same blue (`rgb(68, 61, 255)`), so the words disappear. That is WCAG 2.1 SC 1.4.3, Level AA. Axe filed it as incomplete ("1:1 contrast") instead of a violation, which is why `pnpm a11y:web` still exits 0. Give button labels a selector that beats `.prose a` (for example `.prose a.btn`).

| Page | Element | Measured |
| --- | --- | --- |
| `/how-it-works` | a.btn btn-primary “Get started” | rgb(68, 61, 255) on rgb(68, 61, 255), 1.00:1, 15px / 600 |
| `/404` | a.btn btn-primary “Back to Anchor” | rgb(68, 61, 255) on rgb(68, 61, 255), 1.00:1, 15px / 600 |

### Ink design index numbers are below 4.5:1

On `/designs/ink`, `.ink-action-index` uses `opacity: 0.55`, which leaves the numbers at about 4.41:1 on white. WCAG 2.1 SC 1.4.3 needs 4.5:1 for text this small. This page is a design study, not linked from the sitemap, so it does not fail the public gate. Drop the opacity, or use a color that already meets 4.5:1.

| Page | Element | Measured |
| --- | --- | --- |
| `/designs/ink` | <span class="ink-action-index" aria-hidden="true">01</span> | Fix any of the following: Element has insufficient color contrast of 4.41 (foreground color: #787878, background color: #ffffff, font size: 9.0pt (12px), font weight: normal). Expected contrast ratio of 4.5:1 |
| `/designs/ink` | <span class="ink-action-index" aria-hidden="true">02</span> | Fix any of the following: Element has insufficient color contrast of 4.41 (foreground color: #787878, background color: #ffffff, font size: 9.0pt (12px), font weight: normal). Expected contrast ratio of 4.5:1 |
| `/designs/ink` | <span class="ink-action-index" aria-hidden="true">03</span> | Fix any of the following: Element has insufficient color contrast of 4.41 (foreground color: #787878, background color: #ffffff, font size: 9.0pt (12px), font weight: normal). Expected contrast ratio of 4.5:1 |

## Needs a closer look

### At 320px the consent banner covers page controls

On a 320×640 viewport the fixed cookie banner covers at least half of these controls until it is dismissed. The banner fill is 96% opaque with a backdrop blur, so axe also leaves the banner text contrast as incomplete. Check that covered controls can still be reached (scroll or dismiss), and that the banner label still meets 4.5:1 on whatever sits behind it.

| Page | Element | Measured |
| --- | --- | --- |
| `/` | consent banner | covers at least half of: How it works |
| `/app` | consent banner | covers at least half of: Family group; Nikos, in private |
| `/family` | consent banner | covers at least half of: Sign in |
| `/sitemap` | consent banner | covers at least half of: Terms; Cookies; Sitemap |

## Public site violations

No WCAG 2.1 A or AA violations on the public routes in the states above.

## Incomplete checks (axe could not decide)

Axe could not fully evaluate these. The 1:1 button rows are the confirmed 1.4.3 failure above. Banner rows stay open because the banner background is translucent, so axe will not pick a single color.

### `color-contrast` (serious)

Elements must meet minimum color contrast ratio thresholds

- WCAG: 1.4.3
- What axe reported: Ensure the contrast between foreground and background colors meets WCAG 2 AA minimum contrast ratio thresholds
- Instances: 22 across 14 runs
- Rule: https://dequeuniversity.com/rules/axe/4.13/color-contrast?application=axeAPI

| Page | State | Viewport | Target |
| --- | --- | --- | --- |
| `/how-it-works` | consent-open | desktop | `[".btn-primary.btn[href$=\"family\"]"]` |
| `/how-it-works` | consent-dismissed | desktop | `[".btn-primary"]` |
| `/how-it-works` | consent-open | mobile-320 | `[".btn-primary.btn[href$=\"family\"]"]` |
| `/how-it-works` | consent-dismissed | mobile-320 | `[".btn-primary"]` |
| `/app` | consent-open | desktop | `["#consent-title"]` |
| `/app` | consent-open | desktop | `["#consent-body"]` |
| `/app` | consent-open | desktop | `["#consent-body > a[href$=\"privacy\"]"]` |
| `/app` | consent-open | desktop | `["#consent-body > a[href$=\"cookies\"]"]` |
| `/app` | consent-open | mobile-320 | `["#consent-title"]` |
| `/app` | consent-open | mobile-320 | `["#consent-body"]` |
| `/app` | consent-open | mobile-320 | `["#consent-body > a[href$=\"privacy\"]"]` |
| `/app` | consent-open | mobile-320 | `["#consent-body > a[href$=\"cookies\"]"]` |
| `/family` | consent-open | mobile-320 | `["#consent-body"]` |
| `/family` | consent-open | mobile-320 | `["#consent-body > a[href$=\"privacy\"]"]` |
| `/family` | consent-open | mobile-320 | `["#consent-body > a[href$=\"cookies\"]"]` |
| `/my-data` | consent-open | mobile-320 | `["#consent-body"]` |
| `/cookies` | consent-open | mobile-320 | `["#consent-body"]` |
| `/sitemap` | consent-open | mobile-320 | `["#consent-body"]` |
| `/404` | consent-open | desktop | `[".btn-primary.btn[href=\"/\"]"]` |
| `/404` | consent-dismissed | desktop | `[".btn-primary"]` |
| `/404` | consent-open | mobile-320 | `[".btn-primary.btn[href=\"/\"]"]` |
| `/404` | consent-dismissed | mobile-320 | `[".btn-primary"]` |

Example:

```
Fix any of the following:
  Element has a 1:1 contrast ratio with the background
```

```html
<a class="btn btn-primary" href="/family">Get started</a>
```

## Design explorations (not in the public sitemap)

Pages under `/designs/*` are alternate visual studies. They are not linked from the sitemap and do not decide this audit.

### `color-contrast` (serious)

Elements must meet minimum color contrast ratio thresholds

- WCAG: 1.4.3
- What axe reported: Ensure the contrast between foreground and background colors meets WCAG 2 AA minimum contrast ratio thresholds
- Instances: 3 across 1 runs
- Rule: https://dequeuniversity.com/rules/axe/4.13/color-contrast?application=axeAPI

| Page | State | Viewport | Target |
| --- | --- | --- | --- |
| `/designs/ink` | consent-dismissed | desktop | `[".ink-action[href$=\"app\"] > .ink-action-index[aria-hidden=\"true\"]"]` |
| `/designs/ink` | consent-dismissed | desktop | `[".ink-action[href$=\"how-it-works\"] > .ink-action-index[aria-hidden=\"true\"]"]` |
| `/designs/ink` | consent-dismissed | desktop | `[".ink-action[href$=\"family\"] > .ink-action-index[aria-hidden=\"true\"]"]` |

Example:

```
Fix any of the following:
  Element has insufficient color contrast of 4.41 (foreground color: #787878, background color: #ffffff, font size: 9.0pt (12px), font weight: normal). Expected contrast ratio of 4.5:1
```

```html
<span class="ink-action-index" aria-hidden="true">01</span>
```

## What this audit does not prove

axe-core covers a large share of WCAG 2.1 A and AA, and it misses criteria that need a person or a running assistive technology. Before a conformance claim, still check:

- Keyboard: every control is reachable, visible focus is obvious, and there is no keyboard trap (2.1.1, 2.1.2, 2.4.7).
- Focus order matches the visual order, including the consent banner and the Accessibility panel (2.4.3).
- Name, role, and value of custom widgets with a screen reader (4.1.2).
- Reflow at 320px CSS width and text spacing at 200% zoom (1.4.10, 1.4.12). The 320px scan only catches what axe can see.
- Meaningful sequence, sensory characteristics, and reading order of the demo chat (1.3.2, 1.3.3).
- Audio and video alternatives if a real voice note plays (1.2.x).
- Timing, motion, and seizure risk in the demo (2.2.x, 2.3.1).
- Error identification and labels once registration is submitted with bad data (3.3.1, 3.3.2).
- Third-party Telegram and messenger login windows, which the site already calls out as outside its control.

## Suggested fix order

- **1.4.3 Contrast (Minimum)** Primary button links inside prose use the link color for their label
- **1.4.10 Reflow, 1.4.3 Contrast** At 320px the consent banner covers page controls
- **1.4.3 Contrast (Minimum)** Ink design index numbers are below 4.5:1

