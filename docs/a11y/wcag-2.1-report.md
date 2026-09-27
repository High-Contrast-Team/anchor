# WCAG 2.1 AA report

Audit of the public Anchor website. This file is the evidence for a later fix pass. No UI changes are included.

- Generated: 2026-09-27
- Audited commit: `99a6f2f7982b3ab1db04c2990702dedd0714e854`
- `apps/web` is unchanged from `155621d430b5` through this commit (the commits in between are API and demo-doc only)
- Standard: WCAG 2.1 Level A and Level AA
- Engine: axe-core 4.13.0 in Playwright Chromium (headless)
- Rule tags: `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`
- Page under test: `astro preview` of a production build at `http://127.0.0.1:4321`
- Gate command: `pnpm a11y:web` (`apps/web/scripts/a11y-check.mjs`)

## Result

The automated gate passes. The site does not yet meet WCAG 2.1 AA.

`pnpm a11y:web` printed `axe WCAG 2.1 AA: 10 routes × 2 consent states — 0 violations` and exited 0. That script only fails on axe `violations`. It ignores `incomplete`, and it does not enable high contrast, resize text, change the viewport, or walk the demo past first paint. The failures below are the ones to fix.

## Gate summary

Default theme. Playwright default viewport (1280×720) for the gate. A second pass at 1280×800 and at 390×844 matched the same violation and incomplete counts. Each route was loaded with the cookie banner open, then again after Accept.

| Route | Consent open | Consent dismissed |
| --- | --- | --- |
| `/` | 0 violations, 0 incomplete | 0 violations, 0 incomplete |
| `/how-it-works` | 0 violations, 1 incomplete | 0 violations, 1 incomplete |
| `/app` | 0 violations, 1 incomplete | 0 violations, 0 incomplete |
| `/family` | 0 violations, 0 incomplete | 0 violations, 0 incomplete |
| `/my-data` | 0 violations, 0 incomplete | 0 violations, 0 incomplete |
| `/privacy` | 0 violations, 0 incomplete | 0 violations, 0 incomplete |
| `/terms` | 0 violations, 0 incomplete | 0 violations, 0 incomplete |
| `/cookies` | 0 violations, 0 incomplete | 0 violations, 0 incomplete |
| `/sitemap` | 0 violations, 0 incomplete | 0 violations, 0 incomplete |
| `/404` | 0 violations, 1 incomplete | 0 violations, 1 incomplete |

The accessibility panel was also opened on `/` after consent was dismissed. axe reported 0 violations.

Design studies are not in the gate or the sitemap. They were still checked. See item 6.

## What to fix later

### 1. Primary links inside `.prose` are invisible (1.4.3)

Measured after dismissing consent. Computed style, not just axe.

| Page | Control | Foreground | Background | Size | Ratio | Needs |
| --- | --- | --- | --- | --- | --- | --- |
| `/how-it-works` | Get started | `#443dff` | `#443dff` | 15px, weight 600 | 1:1 | 4.5:1 |
| `/404` | Back to Anchor | `#443dff` | `#443dff` | 15px, weight 600 | 1:1 | 4.5:1 |

`.prose a` in `apps/web/src/styles/tokens.css` sets `color: hsl(var(--primary))` and `font-weight: 600`. That selector beats `.btn-primary`, so the label is the same color as the button fill. The intended pair, light text on primary, is about 6:1. Markup:

- `apps/web/src/pages/how-it-works.astro` (`a.btn.btn-primary` inside `article.prose`)
- `apps/web/src/pages/404.astro` (same pattern)

The secondary link on those pages ("Try the scripted demo", "Open the demo") is also painted by `.prose a`, so it is primary on accent (`#443dff` on `#dddbff`) instead of the dark text the button rule asks for. That pair still clears 4.5:1 (measured 4.66:1). Fix both so button colors win.

Axe files the 1:1 buttons as **incomplete** ("Element has a 1:1 contrast ratio with the background"), which is why the gate stays green. Home uses `a.slate-btn.slate-btn-primary` outside `.prose`, and that control passes.

Later fix: stop the prose link rule from painting buttons. For example `.prose a:not(.btn)`, or an explicit `.prose a.btn-primary { color: hsl(var(--background)); }` (and the secondary equivalent) so the button color wins.

### 2. High contrast fails 1.4.3 on every public route

`html.a11y-contrast` was turned on through `localStorage` key `anchor-a11y-prefs-v1`, consent was already accepted, viewport 1280×720, text scale 100%. axe reported **174** `color-contrast` nodes and no other rule failures.

| Route | Failing nodes |
| --- | --- |
| `/` | 21 |
| `/how-it-works` | 15 |
| `/app` | 25 |
| `/family` | 16 |
| `/my-data` | 14 |
| `/privacy` | 19 |
| `/terms` | 14 |
| `/cookies` | 14 |
| `/sitemap` | 22 |
| `/404` | 14 |

| Ratio | Colors | Where |
| --- | --- | --- |
| 3.25:1 | `#443dff` on `#050316` | Nav and footer links. `html.a11y-contrast a` paints primary onto the dark page. 15px text needs 4.5:1. The skip link uses the same override: its fill stays primary and its label becomes primary, so "Skip to content" is 1:1 when it is focused. |
| 3.25:1 | `#050316` on `#443dff` | Primary buttons, including home "Start Remembering Together", `/how-it-works` "Get started", `/family` "Create an account", `/my-data` "Sign in with email". |
| 1.21:1 | `#f3f2fe` on `#dddbff` | `/app` progress chips ("Kept in her words", "He agrees himself", "It comes back", and the rest of that list). Text is a translucent light color over the accent fill. |
| 1.30:1 | `#fbfbfe` on `#dddbff` | Secondary buttons whose label uses `--text`, which this mode turns light while `--accent` stays light. Seen on `/family` "Sign in" and on the consent banner "Essential only". |

The rules are the `html.a11y-contrast` block in `apps/web/src/styles/tokens.css`. In that mode `--background` becomes the dark page and `--text` becomes the light ink, while `--primary` stays `#443dff` and `--accent` stays `#dddbff`. Primary on that dark background is only 3.25:1. Body copy in this mode still passes (lede text blended over the dark page is about 11.8:1).

With high contrast, text scale 150%, and the accessibility panel open, the scale buttons use the same failing pairs:

| Button | State | Colors | Size | Ratio | Needs |
| --- | --- | --- | --- | --- | --- |
| Default, Larger | not pressed | `#fbfbfe` on `#dddbff` | 17px, weight 700 | 1.30:1 | 4.5:1 |
| Largest | pressed | `#050316` on `#443dff` | 17px, weight 700 | 3.25:1 | 4.5:1 |

### 3. `/app` after a voice reply (1.4.3 and 2.1.1)

Path: "Send the photo", then "Yes, I'll take part", then "A little later, bring it back", then "Use a sample line". Consent already accepted. Viewport 1280×720.

- `.voice-tag` ("Voice note") is `#443dff` on `#cbc8ff`, 12.48px, weight 700, **3.94:1**. It needs 4.5:1. Style: `.voice-tag` uses `color: var(--brand)` in `apps/web/src/components/MvpDemo.css`. The bubble behind it is a translucent primary.
- The private `.chat-log` fails `scrollable-region-focusable` (WCAG 2.1.1 Keyboard). It is a scrollable `role="log"` without a tabindex, so a keyboard user cannot move into it to scroll. Markup: the private chat log in `apps/web/src/components/MvpDemo.tsx`.

### 4. Phone width, consent banner still open

At 390×844, `body` has `consent-open`, and `.a11y-widget-toggle` covers the right side of the banner on `/`. Hiding the widget and hit-testing that rectangle finds the "Cookies & privacy" heading (`#consent-title`), the consent sentence (`#consent-body`), and the Privacy link (`a[href="/privacy"]`). The banner is about 136px tall. `body.consent-open .a11y-widget` in `apps/web/src/components/AccessibilityWidget.css` only lifts the control by `5.75rem` (92px). At 1280×900 the toggle clears the banner (toggle bottom 808, banner top 833, gap about 25px).

On `/app` with the banner open at desktop width, axe could not compute contrast for `#consent-body` and its links ("partially obscured"). Treat that desktop incomplete result as unconfirmed. The 390px overlap is the one to fix.

### 5. 320px reflow

After consent was dismissed, `scrollWidth - clientWidth` was 0 on all 10 public routes at 320×640. No horizontal overflow in that check.

### 6. Design studies (outside the gate)

| Page | Result |
| --- | --- |
| `/designs/ink` | Fail 1.4.3. `.ink-action-index` is `#787878` on `#ffffff`, 12px, **4.41:1** (needs 4.5:1) on 01, 02, and 03. Cause: `opacity: 0.55` in `apps/web/src/components/designs/ink/ink.css`. The spans are `aria-hidden="true"` and the digits are still visible. |
| `/designs/linen`, `/designs/slate`, `/designs/mist` | 0 violations |
| `/designs/quiet` | axe incomplete because the background is a gradient. This is a measurement limit, not a confirmed failure. |

## Checks that passed

- Default theme, axe WCAG 2.1 A and AA, 10 public routes, consent open and dismissed, desktop and 390px: 0 violations.
- Accessibility panel open on `/` in the default theme: 0 violations.
- 320px width: no horizontal overflow on those 10 routes.
- Default-theme secondary "Try the scripted demo" button: primary on accent, 4.66:1.
- High-contrast body and lede text: about 11.8:1 over the dark page.

## Suggested order

1. Let button colors beat `.prose a`, so "Get started" and "Back to Anchor" use the light label on the primary fill.
2. Retune `html.a11y-contrast` so links, primary buttons, secondary buttons, chips, and the text-size controls each clear 4.5:1. Keep the skip link label distinct from its primary fill.
3. Darken `.voice-tag`, and make the private chat log keyboard-scrollable.
4. Lift `.a11y-widget` above the wrapped consent banner at phone width.
5. If `/designs/ink` is ever linked from the public site, raise `.ink-action-index` above 4.5:1.

## Gate gap to close with the fixes

`apps/web/scripts/a11y-check.mjs` exits 0 whenever `violations` is empty. The invisible prose buttons are only in `incomplete`, so CI will stay green until that script also fails on `color-contrast` incomplete results, or the contrast bug is fixed and a high-contrast pass is added to the gate.
