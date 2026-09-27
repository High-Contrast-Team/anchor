# WCAG 2.1 AA report

Saved for a later fix pass. This run did not change the site.

| | |
| --- | --- |
| Date | 2026-09-27 |
| Commit | `8cdd0be65cd35179eacad7244cc28ee878242c01` |
| Site | Local production build (`astro build` + `astro preview` at `http://127.0.0.1:4321`) |
| Tool | axe-core 4.13.0 via Playwright Chromium |
| Rule set | `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa` (WCAG 2.1 Level A and Level AA) |
| Viewports | 1280×800 and 390×844 |
| Extra checks | Tab order and focus outline on the home page; horizontal overflow at 320px |

## Verdict

The public site does **not** fully pass WCAG 2.1 AA.

`pnpm a11y:web` (`apps/web/scripts/a11y-check.mjs`) exited 0: 10 public routes × 2 consent states, 0 axe **violations**. That gate is incomplete for this bug. axe filed the invisible buttons as **incomplete** (it treats a 1:1 contrast ratio as “could not determine”), so the gate stays green while the text is the same color as the button.

| Area | axe violations | Confirmed WCAG 2.1 AA failures |
| --- | --- | --- |
| Public pages (sitemap + 404), consent open and dismissed, accessibility panel open on `/` | 0 | 1 (Success Criterion 1.4.3, two buttons) |
| Design explorations under `/designs/*` | 1 page (`/designs/ink`) | 1 (Success Criterion 1.4.3) |

## Confirmed failures

### 1. Primary buttons inside `.prose` have invisible text

**Criterion:** 1.4.3 Contrast (Minimum), Level AA. Normal text needs 4.5:1. These buttons measure 1:1.

**Where:**

- `/how-it-works`: “Get started” (`a.btn.btn-primary[href="/family"]`)
- `/404` (requested as `/this-page-does-not-exist-a11y`): “Back to Anchor” (`a.btn.btn-primary[href="/"]`)

**Measured** (desktop, consent dismissed):

- Color `rgb(68, 61, 255)`
- Background `rgb(68, 61, 255)`
- Font size 15px, weight 600

A pixel sample of the “Get started” button is almost entirely `rgb(68, 61, 255)`. The label is not readable.

**Cause:** In `apps/web/src/styles/tokens.css`, `.prose a` (one class + one element) sets `color: hsl(var(--primary))` and `font-weight: 600`. That beats `.btn-primary` (one class), which sets `color: hsl(var(--background))` on `background: hsl(var(--primary))`.

The same override hits the secondary buttons on those two pages (“Try the scripted demo”, “Open the demo”). Their text becomes primary purple `rgb(68, 61, 255)` on accent `rgb(221, 219, 255)`, about 4.7:1, so they still clear 4.5:1. They are the wrong intended color (`hsl(var(--text))` on accent) and the wrong weight (600 instead of 700). Fix them in the same change.

**Suggested fix:** Stop `.prose a` from restyling buttons. For example, limit the link color to anchors that are not buttons:

```css
.prose a:not(.btn):not(.slate-btn) {
  color: hsl(var(--primary));
  font-weight: 600;
}
```

Keep the existing `.btn-primary` / `.btn-secondary` color rules. After the change, re-measure both buttons. Primary text should be `hsl(var(--background))` on `hsl(var(--primary))`.

**Why the gate missed it:** axe `color-contrast` result type `incomplete`, message “Element has a 1:1 contrast ratio with the background”, on both viewports and both consent states. `apps/web/scripts/a11y-check.mjs` only fails the build on `violations`.

### 2. `/designs/ink` step numbers sit just under 4.5:1

**Criterion:** 1.4.3 Contrast (Minimum), Level AA.

**Where:** `/designs/ink`, desktop and mobile. Three nodes:

- `.ink-action[href$="app"] > .ink-action-index`
- `.ink-action[href$="how-it-works"] > .ink-action-index`
- `.ink-action[href$="family"] > .ink-action-index`

Visible text “01”, “02”, “03”. They are `aria-hidden="true"`, which removes them from the accessibility tree and does not exempt visible text from 1.4.3.

**Measured:** foreground `#787878`, background `#ffffff`, 12px, normal weight, ratio **4.41:1** (need 4.5:1). Impact: serious.

**Cause:** `apps/web/src/components/designs/ink/ink.css` sets `.ink-action-index { opacity: 0.55 }` on near-black ink over white paper.

**Suggested fix:** Replace the opacity with a solid color that reaches at least 4.5:1 on `#ffffff` (around `#767676` or darker). These pages are not in the sitemap and are not in `a11y-check.mjs` `ROUTES`, so `pnpm a11y:web` does not scan them. They are still built and reachable.

## Needs a human look

axe `incomplete` items that this run did **not** confirm as failures:

| Item | Where | What axe said | Follow-up |
| --- | --- | --- | --- |
| Consent copy | `/app` desktop, consent open (`#consent-title`, `#consent-body`, the Privacy and Cookies links) | Background could not be determined because the element is partially obscured | Spot-check at 1280×800. Sampled points on the heading hit the heading itself, so this may be an overlap false alarm from the fixed banner. |
| Consent body | Mobile, consent open, on `/`, `/how-it-works`, `/app`, `/family`, `/my-data` | Background could not be determined because the element overlaps other elements | The banner is `position: fixed` at the bottom. Confirm its own text still clears 4.5:1, and that the last focused control can scroll clear of the banner. |
| Quiet exploration | `/designs/quiet` | Background is a gradient, so contrast was not computed | Check `h1.quiet-brand`, `.quiet-line`, `.quiet-support`, and the three links (“Try the demo”, “How it works”, “Get started”) against the gradient, including the lightest band behind each line. |

## What passed

Public routes, both viewports, consent banner open and dismissed:

`/`, `/how-it-works`, `/app`, `/family`, `/my-data`, `/privacy`, `/terms`, `/cookies`, `/sitemap`, and the 404 page.

Also scanned: accessibility panel open on `/` (both viewports). Design pages `/designs/linen`, `/designs/mist`, `/designs/quiet`, `/designs/slate` had no axe violations. `/designs/ink` is the exception above.

axe rules that passed on at least one public page include `button-name`, `bypass` (skip link), `color-contrast` (aside from the incomplete 1:1 buttons), `document-title`, `html-has-lang`, `html-lang-valid`, `image-alt`, `label`, `link-name`, `list` / `listitem`, `meta-viewport`, and the ARIA validity rules in this tag set.

Document checks on public pages (desktop, consent dismissed):

- `lang="en"` on `<html>`
- One `h1` per page, heading levels do not skip
- Skip link to `#main`, and a `<main>` landmark
- Home tab order starts at “Skip to content”, then the wordmark, primary nav, and in-page links
- Focused links show a 2px solid outline `rgb(68, 61, 255)`
- At 320px wide, public pages did not grow `scrollWidth` past the viewport (`/`, `/how-it-works`, `/app`, `/family`, `/my-data`, `/privacy`, `/terms`, `/cookies`, `/sitemap`)

404 responses are HTTP 404 with a rendered page. That is expected.

## Not covered by this run

A clean axe result is not a conformance claim. Still untested:

- Full keyboard path through the demo (`/app`), registration, and family record, including focus return when the accessibility panel closes
- Screen reader announcements and live regions
- Reflow at 400% zoom (1.4.4 / 1.4.10) beyond the 320px overflow check
- Text spacing overrides (1.4.12) with the accessibility widget’s “Larger spacing” and with user styles
- Target size (2.5.5 is AAA; 2.5.8 is WCAG 2.2, so it is out of this 2.1 AA set)
- Third-party Telegram and messenger windows (called out in the site footer as outside Anchor’s UI)

## Re-run

```bash
pnpm exec astro build --root apps/web
pnpm exec astro preview --root apps/web --host 127.0.0.1 --port 4321
pnpm a11y:web
```

`pnpm a11y:web` will stay green until the prose button bug is either fixed or the gate starts failing axe `incomplete` results whose summary is a 1:1 contrast ratio. After the CSS fix, confirm `/how-it-works` and `/404` with a computed-style check: primary button color must differ from its background, at or above 4.5:1.
