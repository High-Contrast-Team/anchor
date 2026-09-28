# WCAG 2.1 AA report

Audited: `de8afb8ed64f53645b7c9741acb40ba8e18e75b2` (2026-09-28)
Site: `apps/web` production build, `astro preview` at `http://127.0.0.1:4321`
Tool: axe-core 4.13.0 via Playwright Chromium, tags `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`
Machine-readable copy: `docs/a11y/wcag-2.1-report.json`

The push that triggered this audit only changed `docs/demo-runbook.md` and `docs/demo/script.html`. The public site is the same build as the previous audit. Latest commit that touched `apps/web` is `1e37212`.

## Result

`pnpm a11y:web` passes. Ten public routes, consent banner open and dismissed: **0 axe violations**.

The site still fails WCAG 2.1 Level AA in cases the gate does not fail. Axe files the worst default-theme contrast bugs as `incomplete`, and the gate ignores `incomplete`. High contrast, the scripted demo after a voice line, and a 390px-wide viewport are outside the gate.

| Check | Result |
| --- | --- |
| Gate: 10 routes × 2 consent states, default theme, 1280×720 | Pass, 0 violations |
| Same routes with High contrast on | Fail, 174 `color-contrast` nodes |
| `/how-it-works` “Get started” and `/404` “Back to Anchor” | Fail 1.4.3, ratio 1:1, filed as incomplete |
| `/app` after “Use a sample line” | Fail 1.4.3 (`.voice-tag`) and 2.1.1 (private chat log) |
| 320px width, no horizontal scroll | Pass on all 10 public routes |
| 390×844 with the consent banner open | Accessibility button covers the banner heading, body, and Privacy link |
| `/designs/linen`, `/designs/mist`, `/designs/slate` | Pass |
| `/designs/ink` | Fail 1.4.3 on three visible index numbers |
| `/designs/quiet` | Incomplete: gradient behind the wordmark |

## How to reproduce

```bash
pnpm build:web
pnpm exec astro preview --root apps/web --host 127.0.0.1 --port 4321
pnpm a11y:web
```

High contrast is `localStorage['anchor-a11y-prefs-v1']` with `highContrast: true` before load (the inline script in `BaseLayout.astro` adds `html.a11y-contrast`). The demo path on `/app` is: “Send the photo”, “Yes, I’ll take part”, “A little later — bring it back”, “Use a sample line”.

## Findings to fix

### 1. Primary buttons inside `.prose` are unreadable

- Criterion: 1.4.3 Contrast (Minimum). Serious.
- Where: `/how-it-works` “Get started” (`apps/web/src/pages/how-it-works.astro`), `/404` “Back to Anchor” (`apps/web/src/pages/404.astro`). Both consent states.
- Measured: `#443dff` on `#443dff`, 15px, weight 600, ratio 1:1. Need 4.5:1.
- Why the gate stays green: axe reports `color-contrast` as incomplete for a 1:1 ratio, and `apps/web/scripts/a11y-check.mjs` only exits on `violations`.
- Cause: `.prose a` in `apps/web/src/styles/tokens.css` sets `color: hsl(var(--primary))` and `font-weight: 600`. That beats `.btn-primary`, which sets light text on the primary fill.
- Fix: give `.prose a.btn` and `.prose a.btn-primary` a color and weight that win over `.prose a`, so primary buttons keep light text on the primary fill. Check the secondary button in the same paragraphs still has dark text on the accent fill.

### 2. High contrast fails 1.4.3 on every public route

- Criterion: 1.4.3 Contrast (Minimum). Serious.
- Where: all 10 public routes with `html.a11y-contrast`. 174 failing nodes (21, 15, 25, 16, 14, 19, 14, 14, 22, 14).
- Cause: `html.a11y-contrast` in `tokens.css` swaps background and text, then `html.a11y-contrast a` paints links in `--primary`. Accent surfaces stay light, so light text lands on light fills.

Pairs measured on the running page:

| Pair | Example | Ratio | Need |
| --- | --- | --- | --- |
| `#443dff` on `#050316` | Nav, footer, and in-page links at 15px | 3.26:1 | 4.5:1 |
| `#050316` on `#443dff` | Primary buttons, including “Start Remembering Together” and consent “Accept”, 15px bold | 3.26:1 | 4.5:1 |
| `#443dff` on `#443dff` | Focused “Skip to content”. Link color overrides `.slate-skip` | 1:1 | 4.5:1 |
| `#fbfbfe` on `#dddbff` | Consent “Essential only”, inactive text-size buttons, “Reset all” | 1.30:1 | 4.5:1 (3:1 for “Reset all”, which is 18.75px bold, and it still fails) |
| `#f3f2fe` on `#dddbff` | `/app` progress chips, panel headings, empty chat lines | 1.21:1 | 4.5:1 |
| `#084740` on `#050316` | `.anchor .who` after the demo has Anchor lines. Hard-coded in `MvpDemo.css` | 1.93:1 | 4.5:1 |

`.chat-meta h3` in this theme is `#443dff` on `#050316` at 20px bold (3.26:1). That clears the 3:1 large-text bar. Leave it unless the size drops below 18.67px bold.

Also, with the panel open, text scale Largest, and High contrast on `/`:

- Inactive “Default” / “Larger”: `#fbfbfe` on `#dddbff`, 17px bold, 1.30:1.
- Pressed “Largest”: `#050316` on `#443dff`, 17px bold, 3.26:1.

Fix direction, staying on the five brand tokens:

- Primary buttons and the skip link: light text (`--text`, about `#fbfbfe`) on primary (`#443dff`) is the inverse of the 6.06:1 body link, so it clears 4.5:1. Today they use the dark `--background` as the text color.
- Links on the dark page: `--primary` on the dark background is 3.26:1. Use the light text color and keep the underline.
- Secondary buttons, chips, panel headings, and empty lines: the accent fill stays light. Put dark text on it. `html.a11y-contrast a` must not repaint button labels.
- `.anchor .who` (`apps/web/src/components/MvpDemo.css`): replace the hard-coded `#084740` with a token that stays readable on both the light bubble and the dark high-contrast bubble.
- `.slate-step-num` on the home page is `aria-hidden` and short, so axe leaves it incomplete, but the same 3.26:1 purple-on-dark pair is still visible.

### 3. Phone width: the Accessibility button covers the consent banner

- Where: 390×844, consent banner open, home page. Confirmed by hit testing.
- Banner box: y 708, height 137. Button box: x 239, y 708, 139×44. `elementFromPoint` on the button hits the button, not the heading, the body, or the Privacy link.
- At 1280×720, 1280×800, 1280×900, and 768×900 the button clears the banner.
- Cause: `body.consent-open .a11y-widget` in `apps/web/src/components/AccessibilityWidget.css` lifts the widget by `5.75rem` (92px). The wrapped banner is about 137px tall.
- Axe on `/app` with the banner open also marks `#consent-title` and `#consent-body` incomplete (“partially obscured”). A hit test at 1280×720 on `/app` found both elements fully hittable, so treat that incomplete as unverified and fix the 390px cover, which is confirmed.
- Fix: when the banner is open, offset the widget by the banner’s height (the banner height, or a larger `bottom` that matches the wrapped banner). Re-check 390×844 with the banner open and closed.

### 4. Demo, after a sample voice line

Path: `/app`, consent dismissed, 1280×900. “Send the photo”, “Yes, I’ll take part”, “A little later — bring it back”, “Use a sample line”.

- 1.4.3, serious: `.voice-tag` “Voice note” is `#443dff` on `#cbc8ff`, 12.48px bold, 3.94:1. Need 4.5:1. Rule is `.voice-tag` in `apps/web/src/components/MvpDemo.css` (`color: var(--brand)`). Same failure with High contrast on, because the bubble fill does not flip. `.heart` on the accent fill is 4.66:1 and passes.
- 2.1.1 Keyboard, serious: the private `.chat-log` (`role="log"` in `MvpDemo.tsx`) fails `scrollable-region-focusable`. It scrolls and has no focusable content. Give each overflowing log `tabIndex={0}` and a name, or put a focusable control inside it.
- Incomplete only: check marks in `.mvp-rail-mark` are `aria-hidden` symbols. One Nikos name and line were reported obscured inside the scrolling log. Speaker names Sofia and Nikos pass contrast. Anchor’s name fails only in high contrast (finding 2).

### 5. Design studies (not in the gate)

- `/designs/ink`: `.ink-action-index` “01”, “02”, “03” are `#787878` on `#ffffff`, 12px, 4.41:1. Need 4.5:1. They are `aria-hidden` and still visible.
- `/designs/quiet`: axe could not score contrast because of a background gradient behind `h1.quiet-brand`. Needs a manual check.
- `/designs/linen`, `/designs/mist`, `/designs/slate`: 0 violations, 0 incomplete.

## Passed

- Document language, page titles, and the skip link are present.
- Default theme, banner open and dismissed: no axe violations on `/`, `/how-it-works`, `/app` (first paint), `/family`, `/my-data`, `/privacy`, `/terms`, `/cookies`, `/sitemap`, `/404`.
- 320px CSS width: `scrollWidth` equals `clientWidth` on those 10 routes (1.4.10 reflow, no horizontal scroll).
- Body link “My data” on `/how-it-works`: `#443dff` on `#fbfbfe`, 6.06:1.
- Home `h1` in the default theme: 19.72:1.

## Suggested order

1. Stop `.prose a` from restyling `.btn-primary`, and teach the gate to fail on incomplete `color-contrast` when the ratio is below 4.5:1.
2. Retune `html.a11y-contrast` for links, primary buttons, secondary buttons, the skip link, chips, and `.anchor .who`.
3. Lift the accessibility widget above the wrapped consent banner.
4. Fix `.voice-tag` and keyboard access to `.chat-log`.
5. Darken `.ink-action-index` and review the quiet gradient by eye.
