# WCAG 2.1 AA report

Automated check of the public Anchor website with axe-core, tagged `wcag2a`, `wcag2aa`, `wcag21a`, and `wcag21aa` (WCAG 2.0 and 2.1, levels A and AA). Each route is checked with the consent banner open and after it is dismissed.

axe-core does not cover every WCAG 2.1 success criterion. Keyboard order, meaningful sequence, and some name/role/value cases still need a manual pass. Incomplete results are checks axe could not decide and are listed for review.

| | |
| --- | --- |
| Generated | 2026-09-27T08:46:16.316Z |
| Commit | `d9c4813` |
| Base URL | http://localhost:4321 |
| axe-core | 4.13.0 |
| Axe result | Pass (0 violations) |
| Confirmed contrast gaps | 4 |
| Runs | 20 |
| Runs with violations | 0 |
| Runs with incomplete checks | 5 |

## Summary

| Route | State | HTTP | Violations | Incomplete | Passes |
| --- | --- | --- | ---: | ---: | ---: |
| / | consent-open | 200 | 0 | 0 | 25 |
| / | consent-dismissed | 200 | 0 | 0 | 22 |
| /how-it-works | consent-open | 200 | 0 | 1 | 22 |
| /how-it-works | consent-dismissed | 200 | 0 | 1 | 19 |
| /app | consent-open | 200 | 0 | 1 | 25 |
| /app | consent-dismissed | 200 | 0 | 0 | 24 |
| /family | consent-open | 200 | 0 | 0 | 25 |
| /family | consent-dismissed | 200 | 0 | 0 | 21 |
| /my-data | consent-open | 200 | 0 | 0 | 23 |
| /my-data | consent-dismissed | 200 | 0 | 0 | 19 |
| /privacy | consent-open | 200 | 0 | 0 | 24 |
| /privacy | consent-dismissed | 200 | 0 | 0 | 21 |
| /terms | consent-open | 200 | 0 | 0 | 24 |
| /terms | consent-dismissed | 200 | 0 | 0 | 21 |
| /cookies | consent-open | 200 | 0 | 0 | 22 |
| /cookies | consent-dismissed | 200 | 0 | 0 | 19 |
| /sitemap | consent-open | 200 | 0 | 0 | 24 |
| /sitemap | consent-dismissed | 200 | 0 | 0 | 20 |
| /404 | consent-open | 404 | 0 | 1 | 22 |
| /404 | consent-dismissed | 404 | 0 | 1 | 18 |

## Confirmed contrast gaps

These controls paint their text the same color as their own background (contrast ratio 1:1). That fails WCAG 2.1 AA 1.4.3 Contrast (Minimum). axe-core filed them under Incomplete rather than Violations, so the gate above can still pass.

Cause: `.prose a` in `apps/web/src/styles/tokens.css` sets `color: hsl(var(--primary))`. That beats `.btn-primary`, which sets `color: hsl(var(--background))`, whenever the button is an anchor inside `.prose`. The label disappears into the primary fill.

Later fix: keep link color on `.prose a:not(.btn)`, or set `.prose .btn-primary` color with higher specificity. The secondary buttons on the same pages stay just above 4.5:1 after the same override, so they pass AA today and will change if the selector is narrowed.

### /how-it-works (consent-open)

- `a.btn.btn-primary` "Get started" — rgb(68, 61, 255) on rgb(68, 61, 255), 15px / 600

### /how-it-works (consent-dismissed)

- `a.btn.btn-primary` "Get started" — rgb(68, 61, 255) on rgb(68, 61, 255), 15px / 600

### /404 (consent-open)

- `a.btn.btn-primary` "Back to Anchor" — rgb(68, 61, 255) on rgb(68, 61, 255), 15px / 600

### /404 (consent-dismissed)

- `a.btn.btn-primary` "Back to Anchor" — rgb(68, 61, 255) on rgb(68, 61, 255), 15px / 600


## Violations

No WCAG 2.1 A/AA violations.

## Incomplete (needs review)

On `/app` with the consent banner open, axe could not read the banner title and body because another element overlaps them. The Accept button on that banner measures about 6:1 (near-white on primary) and is not one of the confirmed gaps above.

### /how-it-works (consent-open)

#### `color-contrast` (serious)

Elements must meet minimum color contrast ratio thresholds

Ensure the contrast between foreground and background colors meets WCAG 2 AA minimum contrast ratio thresholds

Help: https://dequeuniversity.com/rules/axe/4.13/color-contrast?application=axeAPI

WCAG tags: wcag2aa, wcag143

- Target: `[".btn-primary.btn[href$=\"family\"]"]`

```
Fix any of the following:
  Element has a 1:1 contrast ratio with the background
```

```html
<a class="btn btn-primary" href="/family">Get started</a>
```

### /how-it-works (consent-dismissed)

#### `color-contrast` (serious)

Elements must meet minimum color contrast ratio thresholds

Ensure the contrast between foreground and background colors meets WCAG 2 AA minimum contrast ratio thresholds

Help: https://dequeuniversity.com/rules/axe/4.13/color-contrast?application=axeAPI

WCAG tags: wcag2aa, wcag143

- Target: `[".btn-primary"]`

```
Fix any of the following:
  Element has a 1:1 contrast ratio with the background
```

```html
<a class="btn btn-primary" href="/family">Get started</a>
```

### /app (consent-open)

#### `color-contrast` (serious)

Elements must meet minimum color contrast ratio thresholds

Ensure the contrast between foreground and background colors meets WCAG 2 AA minimum contrast ratio thresholds

Help: https://dequeuniversity.com/rules/axe/4.13/color-contrast?application=axeAPI

WCAG tags: wcag2aa, wcag143

- Target: `["#consent-title"]`

```
Fix any of the following:
  Element's background color could not be determined because it's partially obscured by another element
```

```html
<h2 id="consent-title">Cookies &amp; privacy</h2>
```

- Target: `["#consent-body"]`

```
Fix any of the following:
  Element's background color could not be determined because it's partially obscured by another element
```

```html
<p id="consent-body">Essential storage only by default. See <a href="/privacy">Privacy</a> and<!-- --> <a href="/cookies">Cookies</a>.</p>
```

### /404 (consent-open)

#### `color-contrast` (serious)

Elements must meet minimum color contrast ratio thresholds

Ensure the contrast between foreground and background colors meets WCAG 2 AA minimum contrast ratio thresholds

Help: https://dequeuniversity.com/rules/axe/4.13/color-contrast?application=axeAPI

WCAG tags: wcag2aa, wcag143

- Target: `[".btn-primary.btn[href=\"/\"]"]`

```
Fix any of the following:
  Element has a 1:1 contrast ratio with the background
```

```html
<a class="btn btn-primary" href="/">Back to Anchor</a>
```

### /404 (consent-dismissed)

#### `color-contrast` (serious)

Elements must meet minimum color contrast ratio thresholds

Ensure the contrast between foreground and background colors meets WCAG 2 AA minimum contrast ratio thresholds

Help: https://dequeuniversity.com/rules/axe/4.13/color-contrast?application=axeAPI

WCAG tags: wcag2aa, wcag143

- Target: `[".btn-primary"]`

```
Fix any of the following:
  Element has a 1:1 contrast ratio with the background
```

```html
<a class="btn btn-primary" href="/">Back to Anchor</a>
```

## High contrast theme

Turning on Accessibility → High contrast sets `html.a11y-contrast` (`anchor-a11y-prefs-v1`). axe then reports real `color-contrast` violations. This theme is outside the default gate, which still exits 0.

Nodes failing: 214.

The theme keeps primary `#443dff` on a near-black background (`#050316`), about 3.25:1. Normal text needs 4.5:1. Secondary buttons and several `/app` chips drop to about 1.2:1 because light text sits on the accent fill.

| Route | Failing nodes |
| --- | ---: |
| / | 25 |
| /how-it-works | 19 |
| /app | 29 |
| /family | 20 |
| /my-data | 18 |
| /privacy | 23 |
| /terms | 18 |
| /cookies | 18 |
| /sitemap | 26 |
| /404 | 18 |

- 150 nodes on `/`, `/how-it-works`, `/app`, `/family`, `/my-data`, `/privacy`, `/terms`, `/cookies`, `/sitemap`, `/404`. Example target `[".slate-nav > a[href$=\"how-it-works\"]"]`. Fix any of the following: Element has insufficient color contrast of 3.25 (foreground color: #443dff, background color: #050316, font size: 11.3pt (15px), font weight: normal). Expected contrast ratio of 4.5:1

- 15 nodes on `/`, `/how-it-works`, `/app`, `/family`, `/my-data`, `/privacy`, `/terms`, `/cookies`, `/sitemap`, `/404`. Example target `[".slate-hero-inner > .slate-actions > .slate-btn.slate-btn-primary[href$=\"family\"]"]`. Fix any of the following: Element has insufficient color contrast of 3.25 (foreground color: #050316, background color: #443dff, font size: 11.3pt (15px), font weight: bold). Expected contrast ratio of 4.5:1

- 4 nodes on `/`. Example target `[".slate-hero-inner > .slate-actions > .slate-text-link[href$=\"app\"]"]`. Fix any of the following: Element has insufficient color contrast of 3.25 (foreground color: #443dff, background color: #050316, font size: 11.3pt (15px), font weight: bold). Expected contrast ratio of 4.5:1

- 2 nodes on `/`. Example target `[".slate-link[href$=\"my-data\"]"]`. Fix any of the following: Element has insufficient color contrast of 3.25 (foreground color: #443dff, background color: #050316, font size: 13.5pt (18px), font weight: bold). Expected contrast ratio of 4.5:1

- 11 nodes on `/`, `/how-it-works`, `/app`, `/family`, `/my-data`, `/privacy`, `/terms`, `/cookies`, `/sitemap`, `/404`. Example target `[".btn-secondary"]`. Fix any of the following: Element has insufficient color contrast of 1.29 (foreground color: #fbfbfe, background color: #dddbff, font size: 11.3pt (15px), font weight: bold). Expected contrast ratio of 4.5:1

- 16 nodes on `/how-it-works`, `/family`, `/privacy`, `/sitemap`. Example target `["p:nth-child(12) > a[href$=\"my-data\"]"]`. Fix any of the following: Element has insufficient color contrast of 3.25 (foreground color: #443dff, background color: #050316, font size: 13.5pt (18px), font weight: normal). Expected contrast ratio of 4.5:1

- 2 nodes on `/how-it-works`, `/404`. Example target `[".btn-primary.btn[href$=\"family\"]"]`. Fix any of the following: Element has insufficient color contrast of 3.25 (foreground color: #050316, background color: #443dff, font size: 11.3pt (15px), font weight: normal). Expected contrast ratio of 4.5:1

- 6 nodes on `/app`. Example target `["li:nth-child(1) > span"]`. Fix any of the following: Element has insufficient color contrast of 1.21 (foreground color: #f3f2fe, background color: #dddbff, font size: 10.2pt (13.6px), font weight: normal). Expected contrast ratio of 4.5:1

- 2 nodes on `/app`. Example target `["#group-heading"]`. Fix any of the following: Element has insufficient color contrast of 1.21 (foreground color: #f3f2fe, background color: #dddbff, font size: 9.6pt (12.8px), font weight: bold). Expected contrast ratio of 4.5:1

- 2 nodes on `/app`. Example target `["#_r4R_0H1_ > .chat-log[role=\"log\"][aria-relevant=\"additions\"] > .empty"]`. Fix any of the following: Element has insufficient color contrast of 1.21 (foreground color: #f3f2fe, background color: #dddbff, font size: 11.4pt (15.2px), font weight: normal). Expected contrast ratio of 4.5:1

- 1 node on `/app`. Example target `["#memory-heading"]`. Fix any of the following: Element has insufficient color contrast of 3.25 (foreground color: #443dff, background color: #050316, font size: 13.8pt (18.4px), font weight: bold). Expected contrast ratio of 4.5:1

- 3 nodes on `/privacy`, `/terms`, `/cookies`. Example target `[".lede > a[href$=\"mailto:privacy@anchor.com\"]"]`. Fix any of the following: Element has insufficient color contrast of 3.25 (foreground color: #443dff, background color: #050316, font size: 15.0pt (20px), font weight: normal). Expected contrast ratio of 4.5:1

## What this does not prove

- A passing automated run is not a full WCAG 2.1 conformance claim.
- Pages behind Telegram login (`/family` record contents, signed-in `/my-data` actions) are only checked in their logged-out state.
- Design explorations under `/designs/*` are not part of this gate.

