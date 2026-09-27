/**
 * WCAG 2.1 Level A + AA audit report for the public Anchor site.
 * Expects a running server at BASE_URL (default http://127.0.0.1:4321).
 *
 * Writes:
 *   docs/a11y/wcag-2.1-aa-report.md
 *   docs/a11y/wcag-2.1-aa-report.json
 *
 * Usage: node apps/web/scripts/a11y-report.mjs
 */
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const require = createRequire(import.meta.url);
const axe = require('axe-core');
const axeSource = axe.source;

const BASE = process.env.BASE_URL || 'http://127.0.0.1:4321';
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../../..');
const OUT_DIR = resolve(ROOT, 'docs/a11y');
const JSON_PATH = resolve(OUT_DIR, 'wcag-2.1-aa-report.json');
const MD_PATH = resolve(OUT_DIR, 'wcag-2.1-aa-report.md');

/** Public pages claimed by the sitemap. These decide pass/fail. */
const PUBLIC_ROUTES = [
  '/',
  '/how-it-works',
  '/app',
  '/family',
  '/my-data',
  '/privacy',
  '/terms',
  '/cookies',
  '/sitemap',
  '/404',
];

/** Design explorations. Recorded, not part of the conformance result. */
const DESIGN_ROUTES = ['/designs/slate', '/designs/linen', '/designs/ink', '/designs/quiet', '/designs/mist'];

const VIEWPORTS = [
  { name: 'desktop', width: 1280, height: 800 },
  { name: 'mobile-320', width: 320, height: 640 },
];

function gitSha() {
  try {
    return execSync('git rev-parse HEAD', { cwd: ROOT, encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}

function routeUrl(route) {
  if (route === '/404') return `${BASE}/this-page-does-not-exist-a11y`;
  return `${BASE}${route}`;
}

async function prepareStorage(page, mode) {
  await page.addInitScript((nextMode) => {
    try {
      localStorage.removeItem('anchor-a11y-prefs-v1');
      if (nextMode === 'consent-open') localStorage.removeItem('anchor-consent-v1');
      else localStorage.setItem('anchor-consent-v1', 'accepted');
    } catch {
      // Private mode or blocked storage.
    }
    // Dev-only overlay. It is not part of the shipped site.
    const style = document.createElement('style');
    style.textContent = 'astro-dev-toolbar{display:none!important;pointer-events:none!important}';
    document.documentElement.appendChild(style);
  }, mode);
}

async function openA11yPanel(page) {
  const toggle = page.locator('.a11y-widget-toggle');
  if (await toggle.count()) {
    await toggle.click();
    await page.waitForSelector('.a11y-widget-panel', { timeout: 3000 });
  }
}

async function prepare(page, mode) {
  await page.waitForSelector('main, body', { timeout: 10000 });
  await page.waitForTimeout(600);
  if (mode === 'consent-open') {
    await page.waitForSelector('.consent-banner', { timeout: 5000 });
  }
  if (mode === 'a11y-panel-open') {
    await openA11yPanel(page);
  }
}

async function runAxe(page) {
  await page.evaluate(axeSource);
  return page.evaluate(async (tags) => {
    const results = await globalThis.axe.run(document, {
      runOnly: { type: 'tag', values: tags },
      resultTypes: ['violations', 'incomplete'],
    });
    const slim = (items) =>
      items.map((v) => ({
        id: v.id,
        impact: v.impact,
        description: v.description,
        help: v.help,
        helpUrl: v.helpUrl,
        tags: v.tags.filter((t) => t.startsWith('wcag') || t === 'best-practice' || t.startsWith('section')),
        nodes: v.nodes.map((n) => ({
          impact: n.impact,
          target: n.target,
          html: (n.html || '').slice(0, 500),
          failureSummary: n.failureSummary || '',
        })),
      }));
    return {
      violations: slim(results.violations),
      incomplete: slim(results.incomplete),
      testEngine: results.testEngine,
    };
  }, TAGS);
}

function wcagRefs(tags) {
  const refs = [];
  for (const tag of tags) {
    const match = tag.match(/^wcag(\d)(\d)(\d+)$/);
    if (match) refs.push(`${match[1]}.${match[2]}.${match[3]}`);
  }
  return [...new Set(refs)];
}

async function scan({ browser, route, scope, mode, viewport }) {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
  });
  const page = await context.newPage();
  await prepareStorage(page, mode);
  const url = routeUrl(route);
  let status = 0;
  let error = null;
  let violations = [];
  let incomplete = [];
  let testEngine = null;
  try {
    const response = await page.goto(url, { waitUntil: 'load', timeout: 30000 });
    status = response?.status() ?? 0;
    if (!response || status >= 500) {
      error = `HTTP ${status || 'no response'}`;
    } else {
      await prepare(page, mode);
      const axeResult = await runAxe(page);
      violations = axeResult.violations;
      incomplete = axeResult.incomplete;
      testEngine = axeResult.testEngine;
    }
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }
  await context.close();
  return {
    route,
    url,
    scope,
    mode,
    viewport: viewport.name,
    status,
    error,
    violations,
    incomplete,
    testEngine,
  };
}

function countNodes(items) {
  return items.reduce((sum, item) => sum + item.nodes.length, 0);
}

function mdEscape(value) {
  return String(value).replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

function renderMarkdown(report) {
  const lines = [];
  const gateFails = report.runs.filter(
    (run) => run.scope === 'public' && (run.error || run.violations.length > 0),
  );
  const passed = gateFails.length === 0;
  const confirmed = report.followUps.filter((item) => item.severity === 'confirmed');

  lines.push('# WCAG 2.1 Level A and AA audit');
  lines.push('');
  lines.push(
    `Automated axe result: **${passed ? 'PASS' : 'FAIL'}** on the public site (${passed ? 'no violation rules' : `${gateFails.length} runs with violations`} in the states below). The project gate \`pnpm a11y:web\` uses the same rule tags on the public routes.`,
  );
  lines.push('');
  if (confirmed.length) {
    lines.push(
      `Conformance: **not claimed**. ${confirmed.length} confirmed issue${confirmed.length === 1 ? '' : 's'} below ${confirmed.length === 1 ? 'is' : 'are'} a WCAG 2.1 AA failure that axe left as incomplete or that sits outside the public sitemap. Fix these before calling the site conformant.`,
    );
  } else {
    lines.push('No extra contrast failures were measured beyond the axe result. Manual checks in the last section are still open.');
  }
  lines.push('');
  lines.push('This report is the record for later fixes. It does not change the site.');
  lines.push('');
  lines.push('## How this was run');
  lines.push('');
  lines.push(`- Date: ${report.generatedAt}`);
  lines.push(`- Commit: \`${report.commit}\``);
  lines.push(`- Base URL: ${report.baseUrl}`);
  lines.push(`- Server: ${report.server}`);
  lines.push(`- Engine: axe-core ${report.axeVersion} via Playwright Chromium`);
  lines.push(`- Rule tags: ${TAGS.join(', ')}`);
  lines.push('- Public routes, each in two consent states (banner open, banner dismissed), at 1280×800 and 320×640.');
  lines.push('- Home, Family, and Demo also scanned with the Accessibility panel open (banner dismissed, desktop).');
  lines.push('- Design explorations under `/designs/*` are listed separately and do not decide pass or fail.');
  lines.push('');
  lines.push('The project gate is `pnpm a11y:web` (`apps/web/scripts/a11y-check.mjs`). It covers the same public routes and consent states at the browser default viewport, and exits non-zero when axe reports a violation. This report is wider: it adds the 320px viewport and the open Accessibility panel, and it keeps incomplete checks.');
  lines.push('');
  lines.push('## Result summary');
  lines.push('');
  lines.push('| Scope | Runs | Runs with violations | Violation instances | Incomplete checks |');
  lines.push('| --- | ---: | ---: | ---: | ---: |');
  for (const scope of ['public', 'design']) {
    const runs = report.runs.filter((run) => run.scope === scope);
    const withV = runs.filter((run) => run.violations.length > 0 || run.error);
    const nodes = runs.reduce((sum, run) => sum + countNodes(run.violations), 0);
    const incomplete = runs.reduce((sum, run) => sum + run.incomplete.length, 0);
    lines.push(`| ${scope} | ${runs.length} | ${withV.length} | ${nodes} | ${incomplete} |`);
  }
  lines.push('');

  const grouped = groupViolations(report.runs.filter((run) => run.scope === 'public'));
  const reviews = report.followUps.filter((item) => item.severity !== 'confirmed');
  lines.push('## Confirmed issues to fix later');
  lines.push('');
  writeFindings(lines, confirmed);
  lines.push('## Needs a closer look');
  lines.push('');
  if (reviews.length === 0) {
    lines.push('None.');
    lines.push('');
  } else {
    writeFindings(lines, reviews);
  }

  lines.push('## Public site violations');
  lines.push('');
  if (grouped.length === 0 && gateFails.every((run) => !run.error)) {
    lines.push('No WCAG 2.1 A or AA violations on the public routes in the states above.');
    lines.push('');
  } else {
    if (gateFails.some((run) => run.error)) {
      lines.push('### Page errors');
      lines.push('');
      for (const run of gateFails.filter((run) => run.error)) {
        lines.push(`- \`${run.route}\` (${run.mode}, ${run.viewport}): ${run.error}`);
      }
      lines.push('');
    }
    renderGroups(lines, grouped);
  }

  lines.push('## Incomplete checks (axe could not decide)');
  lines.push('');
  lines.push(
    'Axe could not fully evaluate these. The 1:1 button rows are the confirmed 1.4.3 failure above. Banner rows stay open because the banner background is translucent, so axe will not pick a single color.',
  );
  lines.push('');
  const incompleteGroups = groupViolations(
    report.runs.filter((run) => run.scope === 'public'),
    'incomplete',
  );
  if (incompleteGroups.length === 0) {
    lines.push('None.');
    lines.push('');
  } else {
    renderGroups(lines, incompleteGroups);
  }

  const designGroups = groupViolations(report.runs.filter((run) => run.scope === 'design'));
  lines.push('## Design explorations (not in the public sitemap)');
  lines.push('');
  lines.push('Pages under `/designs/*` are alternate visual studies. They are not linked from the sitemap and do not decide this audit.');
  lines.push('');
  if (designGroups.length === 0) {
    lines.push('No WCAG 2.1 A or AA violations on the design pages (desktop, consent dismissed).');
    lines.push('');
  } else {
    renderGroups(lines, designGroups);
  }

  lines.push('## What this audit does not prove');
  lines.push('');
  lines.push('axe-core covers a large share of WCAG 2.1 A and AA, and it misses criteria that need a person or a running assistive technology. Before a conformance claim, still check:');
  lines.push('');
  lines.push('- Keyboard: every control is reachable, visible focus is obvious, and there is no keyboard trap (2.1.1, 2.1.2, 2.4.7).');
  lines.push('- Focus order matches the visual order, including the consent banner and the Accessibility panel (2.4.3).');
  lines.push('- Name, role, and value of custom widgets with a screen reader (4.1.2).');
  lines.push('- Reflow at 320px CSS width and text spacing at 200% zoom (1.4.10, 1.4.12). The 320px scan only catches what axe can see.');
  lines.push('- Meaningful sequence, sensory characteristics, and reading order of the demo chat (1.3.2, 1.3.3).');
  lines.push('- Audio and video alternatives if a real voice note plays (1.2.x).');
  lines.push('- Timing, motion, and seizure risk in the demo (2.2.x, 2.3.1).');
  lines.push('- Error identification and labels once registration is submitted with bad data (3.3.1, 3.3.2).');
  lines.push('- Third-party Telegram and messenger login windows, which the site already calls out as outside its control.');
  lines.push('');
  lines.push('## Suggested fix order');
  lines.push('');
  for (const item of report.followUps) {
    lines.push(`- **${item.criterion}** ${item.title}`);
  }
  if (grouped.length === 0 && report.followUps.length === 0) {
    lines.push('No automated violations to fix. Start with the incomplete checks and the manual list above.');
  } else if (grouped.length) {
    const order = [...grouped].sort((a, b) => impactRank(a.impact) - impactRank(b.impact) || b.instances - a.instances);
    for (const group of order) {
      const criteria = group.criteria.length ? ` WCAG ${group.criteria.join(', ')}.` : '';
      lines.push(
        `- **${group.impact || 'unknown'}** \`${group.id}\` (${group.instances} instances, ${group.runs} runs).${criteria} ${group.help} ${group.helpUrl}`,
      );
    }
  }
  lines.push('');
  return `${lines.join('\n')}\n`;
}

function parseRgb(value) {
  const match = String(value).match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function contrastRatio(a, b) {
  const lum = (channels) => {
    const s = channels.map((channel) => {
      const v = channel / 255;
      return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * s[0] + 0.7152 * s[1] + 0.0722 * s[2];
  };
  const lighter = Math.max(lum(a), lum(b));
  const darker = Math.min(lum(a), lum(b));
  return (lighter + 0.05) / (darker + 0.05);
}

async function measureFollowUps(browser, runs) {
  const items = [];
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  await page.addInitScript(() => {
    try {
      localStorage.setItem('anchor-consent-v1', 'accepted');
    } catch {
      // Ignore storage failures.
    }
  });

  const sameColor = [];
  const lowContrast = [];
  for (const route of PUBLIC_ROUTES) {
    await page.goto(routeUrl(route), { waitUntil: 'load' });
    await page.waitForTimeout(300);
    const buttons = await page.evaluate(() => {
      return [...document.querySelectorAll('a.btn, button.btn')].map((el) => {
        const cs = getComputedStyle(el);
        return {
          text: (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 80),
          tag: el.tagName.toLowerCase(),
          className: el.className,
          color: cs.color,
          background: cs.backgroundColor,
          fontSize: cs.fontSize,
          fontWeight: cs.fontWeight,
        };
      });
    });
    for (const button of buttons) {
      const fg = parseRgb(button.color);
      const bg = parseRgb(button.background);
      if (!fg || !bg) continue;
      const ratio = contrastRatio(fg, bg);
      const label = `${button.tag}.${button.className} “${button.text}”`;
      const measured = `${button.color} on ${button.background}, ${ratio.toFixed(2)}:1, ${button.fontSize} / ${button.fontWeight}`;
      if (ratio < 1.05) sameColor.push({ route, element: label, measured });
      else if (ratio < 4.5) lowContrast.push({ route, element: label, measured });
    }
  }
  await context.close();

  if (sameColor.length || lowContrast.length) {
    items.push({
      severity: 'confirmed',
      criterion: '1.4.3 Contrast (Minimum)',
      title: 'Primary button links inside prose use the link color for their label',
      detail:
        '`.prose a` sets `color` to the primary blue and outranks `.btn-primary`, which only sets the label to the near-white background token. On those links the label and the button fill are the same blue (`rgb(68, 61, 255)`), so the words disappear. That is WCAG 2.1 SC 1.4.3, Level AA. Axe filed it as incomplete ("1:1 contrast") instead of a violation, which is why `pnpm a11y:web` still exits 0. Give button labels a selector that beats `.prose a` (for example `.prose a.btn`).',
      rows: [...sameColor, ...lowContrast],
    });
  }

  const narrow = await browser.newContext({ viewport: { width: 320, height: 640 } });
  const narrowPage = await narrow.newPage();
  await narrowPage.addInitScript(() => {
    try {
      localStorage.removeItem('anchor-consent-v1');
    } catch {
      // Ignore storage failures.
    }
  });
  const overlaps = [];
  for (const route of PUBLIC_ROUTES) {
    await narrowPage.goto(routeUrl(route), { waitUntil: 'load' });
    try {
      await narrowPage.waitForSelector('.consent-banner', { timeout: 4000 });
    } catch {
      continue;
    }
    const hits = await narrowPage.evaluate(() => {
      const banner = document.querySelector('.consent-banner');
      if (!banner) return [];
      const br = banner.getBoundingClientRect();
      const found = [];
      for (const el of document.querySelectorAll('main a, main button, main input, main textarea, main select')) {
        const r = el.getBoundingClientRect();
        if (r.width < 8 || r.height < 8) continue;
        const overlap = Math.min(r.bottom, br.bottom) - Math.max(r.top, br.top);
        if (overlap / r.height < 0.5) continue;
        found.push((el.textContent || el.getAttribute('aria-label') || el.tagName).trim().replace(/\s+/g, ' ').slice(0, 60));
      }
      return [...new Set(found)].slice(0, 6);
    });
    if (hits.length) {
      overlaps.push({
        route,
        element: 'consent banner',
        measured: `covers at least half of: ${hits.join('; ')}`,
      });
    }
  }
  await narrow.close();

  if (overlaps.length) {
    items.push({
      severity: 'review',
      criterion: '1.4.10 Reflow, 1.4.3 Contrast',
      title: 'At 320px the consent banner covers page controls',
      detail:
        'On a 320×640 viewport the fixed cookie banner covers at least half of these controls until it is dismissed. The banner fill is 96% opaque with a backdrop blur, so axe also leaves the banner text contrast as incomplete. Check that covered controls can still be reached (scroll or dismiss), and that the banner label still meets 4.5:1 on whatever sits behind it.',
      rows: overlaps,
    });
  }

  const ink = runs.find((run) => run.route === '/designs/ink' && run.violations.some((item) => item.id === 'color-contrast'));
  if (ink) {
    const nodes = ink.violations.find((item) => item.id === 'color-contrast').nodes;
    items.push({
      severity: 'confirmed',
      criterion: '1.4.3 Contrast (Minimum)',
      title: 'Ink design index numbers are below 4.5:1',
      detail:
        'On `/designs/ink`, `.ink-action-index` uses `opacity: 0.55`, which leaves the numbers at about 4.41:1 on white. WCAG 2.1 SC 1.4.3 needs 4.5:1 for text this small. This page is a design study, not linked from the sitemap, so it does not fail the public gate. Drop the opacity, or use a color that already meets 4.5:1.',
      rows: nodes.map((node) => ({
        route: '/designs/ink',
        element: node.html.replace(/\s+/g, ' ').slice(0, 120),
        measured: node.failureSummary.replace(/\s+/g, ' ').trim(),
      })),
    });
  }

  return items;
}

function impactRank(impact) {
  return { critical: 0, serious: 1, moderate: 2, minor: 3 }[impact] ?? 4;
}

function groupViolations(runs, field = 'violations') {
  const map = new Map();
  for (const run of runs) {
    for (const item of run[field]) {
      const key = item.id;
      if (!map.has(key)) {
        map.set(key, {
          id: item.id,
          impact: item.impact,
          help: item.help,
          description: item.description,
          helpUrl: item.helpUrl,
          criteria: wcagRefs(item.tags),
          instances: 0,
          runs: 0,
          examples: [],
        });
      }
      const group = map.get(key);
      group.runs += 1;
      group.instances += item.nodes.length;
      if (impactRank(item.impact) < impactRank(group.impact)) group.impact = item.impact;
      for (const node of item.nodes) {
        if (group.examples.length >= 40) break;
        group.examples.push({
          route: run.route,
          mode: run.mode,
          viewport: run.viewport,
          target: node.target,
          html: node.html,
          failureSummary: node.failureSummary,
        });
      }
    }
  }
  return [...map.values()].sort((a, b) => impactRank(a.impact) - impactRank(b.impact) || b.instances - a.instances);
}

function writeFindings(lines, items) {
  if (items.length === 0) {
    lines.push('None.');
    lines.push('');
    return;
  }
  for (const item of items) {
    lines.push(`### ${item.title}`);
    lines.push('');
    lines.push(item.detail);
    lines.push('');
    if (item.rows?.length) {
      lines.push('| Page | Element | Measured |');
      lines.push('| --- | --- | --- |');
      for (const row of item.rows) {
        lines.push(`| \`${row.route}\` | ${mdEscape(row.element)} | ${mdEscape(row.measured)} |`);
      }
      lines.push('');
    }
  }
}

function renderGroups(lines, groups) {
  for (const group of groups) {
    const criteria = group.criteria.length ? group.criteria.join(', ') : 'see help URL';
    lines.push(`### \`${group.id}\` (${group.impact || 'unknown'})`);
    lines.push('');
    lines.push(`${group.help}`);
    lines.push('');
    lines.push(`- WCAG: ${criteria}`);
    lines.push(`- What axe reported: ${group.description}`);
    lines.push(`- Instances: ${group.instances} across ${group.runs} runs`);
    lines.push(`- Rule: ${group.helpUrl}`);
    lines.push('');
    lines.push('| Page | State | Viewport | Target |');
    lines.push('| --- | --- | --- | --- |');
    const seen = new Set();
    for (const example of group.examples) {
      const target = JSON.stringify(example.target);
      const rowKey = `${example.route}|${example.mode}|${example.viewport}|${target}`;
      if (seen.has(rowKey)) continue;
      seen.add(rowKey);
      lines.push(
        `| \`${example.route}\` | ${example.mode} | ${example.viewport} | \`${mdEscape(target)}\` |`,
      );
    }
    lines.push('');
    const sample = group.examples.find((example) => example.failureSummary || example.html);
    if (sample) {
      lines.push('Example:');
      lines.push('');
      if (sample.failureSummary) {
        lines.push('```');
        lines.push(sample.failureSummary.trim());
        lines.push('```');
        lines.push('');
      }
      if (sample.html) {
        lines.push('```html');
        lines.push(sample.html);
        lines.push('```');
        lines.push('');
      }
    }
  }
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const runs = [];

  const jobs = [];
  for (const route of PUBLIC_ROUTES) {
    for (const viewport of VIEWPORTS) {
      for (const mode of ['consent-open', 'consent-dismissed']) {
        jobs.push({ route, scope: 'public', mode, viewport });
      }
    }
  }
  for (const route of ['/', '/family', '/app']) {
    jobs.push({
      route,
      scope: 'public',
      mode: 'a11y-panel-open',
      viewport: VIEWPORTS[0],
    });
  }
  for (const route of DESIGN_ROUTES) {
    jobs.push({
      route,
      scope: 'design',
      mode: 'consent-dismissed',
      viewport: VIEWPORTS[0],
    });
  }

  let testEngine = null;
  for (const job of jobs) {
    const result = await scan({ browser, ...job });
    if (result.testEngine) testEngine = result.testEngine;
    const vCount = countNodes(result.violations);
    const flag = result.error ? `ERROR ${result.error}` : `${vCount} violation nodes, ${result.incomplete.length} incomplete rules`;
    console.log(`${result.scope} ${result.route} ${result.mode} ${result.viewport}: ${flag}`);
    runs.push(result);
  }

  const followUps = await measureFollowUps(browser, runs);

  await browser.close();

  const report = {
    generatedAt: new Date().toISOString(),
    commit: gitSha(),
    baseUrl: BASE,
    server: process.env.A11Y_SERVER || 'local',
    standard: 'WCAG 2.1 Level A and Level AA',
    tags: TAGS,
    axeVersion: axe.version || testEngine?.version || 'unknown',
    testEngine,
    runs,
    followUps,
  };

  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(JSON_PATH, `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(MD_PATH, renderMarkdown(report));

  const publicFails = runs.filter((run) => run.scope === 'public' && (run.error || run.violations.length > 0));
  console.log('');
  console.log(`Wrote ${MD_PATH}`);
  console.log(`Wrote ${JSON_PATH}`);
  console.log(publicFails.length ? `Public site: FAIL (${publicFails.length} runs)` : 'Public site: PASS');
  if (publicFails.length) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
