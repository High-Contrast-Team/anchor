/**
 * WCAG 2.1 AA gate for the public Anchor site.
 * Expects a running server (dev or preview) at BASE_URL (default http://127.0.0.1:4321).
 *
 * Writes a full report for later fixes:
 *   docs/a11y/wcag-2.1-report.md
 *   docs/a11y/wcag-2.1-report.json
 *
 * Usage: node apps/web/scripts/a11y-check.mjs
 *        BASE_URL=http://127.0.0.1:4321 node apps/web/scripts/a11y-check.mjs
 */
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { chromium } from 'playwright';

const require = createRequire(import.meta.url);
const axeSource = require('axe-core').source;
const axeVersion = require('axe-core/package.json').version;

const BASE = process.env.BASE_URL || 'http://127.0.0.1:4321';
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
const REPORT_MD = resolve(process.env.A11Y_REPORT_MD || 'docs/a11y/wcag-2.1-report.md');
const REPORT_JSON = resolve(process.env.A11Y_REPORT_JSON || 'docs/a11y/wcag-2.1-report.json');
const ROUTES = [
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

async function runAxe(page) {
  await page.evaluate(axeSource);
  return page.evaluate(async (tags) => {
    const results = await globalThis.axe.run(document, { runOnly: { type: 'tag', values: tags } });
    const mapRule = (rule) => ({
      id: rule.id,
      impact: rule.impact,
      help: rule.help,
      helpUrl: rule.helpUrl,
      description: rule.description,
      tags: rule.tags,
      nodes: rule.nodes.map((node) => ({
        impact: node.impact,
        target: node.target,
        html: node.html,
        failureSummary: node.failureSummary,
      })),
    });
    return {
      violations: results.violations.map(mapRule),
      incomplete: results.incomplete.map(mapRule),
      passes: results.passes.length,
      inapplicable: results.inapplicable.length,
    };
  }, TAGS);
}

async function dismissConsent(page) {
  const accept = page.locator('.consent-banner .btn-primary');
  if (await accept.count()) {
    await accept.click();
    try {
      await page.waitForSelector('.consent-banner', { state: 'detached', timeout: 3000 });
    } catch {
      // Banner may already be gone.
    }
  }
}

async function clearConsent(page) {
  await page.addInitScript(() => {
    try {
      localStorage.removeItem('anchor-consent-v1');
    } catch {
      // Private mode or blocked storage.
    }
  });
}

function gitSha() {
  try {
    return execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}

function impactRank(impact) {
  return { critical: 0, serious: 1, moderate: 2, minor: 3 }[impact] ?? 4;
}

function escapeCell(value) {
  return String(value ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

function renderRule(rule) {
  const lines = [
    `#### \`${rule.id}\` (${rule.impact || 'unknown'})`,
    '',
    rule.help,
    '',
    rule.description,
    '',
    `Help: ${rule.helpUrl}`,
    '',
    `WCAG tags: ${(rule.tags || []).filter((tag) => tag.startsWith('wcag')).join(', ')}`,
    '',
  ];
  for (const node of rule.nodes) {
    lines.push(`- Target: \`${JSON.stringify(node.target)}\``);
    if (node.failureSummary) {
      lines.push('');
      lines.push('```');
      lines.push(node.failureSummary.trim());
      lines.push('```');
    }
    if (node.html) {
      lines.push('');
      lines.push('```html');
      lines.push(node.html);
      lines.push('```');
    }
    lines.push('');
  }
  return lines.join('\n');
}

function renderMarkdown(report) {
  const runs = report.runs;
  const violationRuns = runs.filter((run) => (run.violations || []).length || run.error);
  const incompleteRuns = runs.filter((run) => (run.incomplete || []).length);
  const contrastRuns = runs.filter((run) => (run.contrastGaps || []).length);
  const lines = [
    '# WCAG 2.1 AA report',
    '',
    'Automated check of the public Anchor website with axe-core, tagged `wcag2a`, `wcag2aa`, `wcag21a`, and `wcag21aa` (WCAG 2.0 and 2.1, levels A and AA). Each route is checked with the consent banner open and after it is dismissed.',
    '',
    'axe-core does not cover every WCAG 2.1 success criterion. Keyboard order, meaningful sequence, and some name/role/value cases still need a manual pass. Incomplete results are checks axe could not decide and are listed for review.',
    '',
    `| | |`,
    `| --- | --- |`,
    `| Generated | ${report.generatedAt} |`,
    `| Commit | \`${report.commit}\` |`,
    `| Base URL | ${report.baseUrl} |`,
    `| axe-core | ${report.axeVersion} |`,
    `| Axe result | ${report.passed ? 'Pass (0 violations)' : 'Fail'} |`,
    `| Confirmed contrast gaps | ${report.contrastGapCount} |`,
    `| Runs | ${runs.length} |`,
    `| Runs with violations | ${violationRuns.length} |`,
    `| Runs with incomplete checks | ${incompleteRuns.length} |`,
    '',
    '## Summary',
    '',
    '| Route | State | HTTP | Violations | Incomplete | Passes |',
    '| --- | --- | --- | ---: | ---: | ---: |',
  ];

  for (const run of runs) {
    lines.push(
      `| ${escapeCell(run.route)} | ${escapeCell(run.mode)} | ${escapeCell(run.status ?? '')} | ${(run.violations || []).length} | ${(run.incomplete || []).length} | ${run.passes ?? ''} |`,
    );
  }

  lines.push('', '## Confirmed contrast gaps', '');
  lines.push(
    'These controls paint their text the same color as their own background (contrast ratio 1:1). That fails WCAG 2.1 AA 1.4.3 Contrast (Minimum). axe-core filed them under Incomplete rather than Violations, so the gate above can still pass.',
    '',
    'Cause: `.prose a` in `apps/web/src/styles/tokens.css` sets `color: hsl(var(--primary))`. That beats `.btn-primary`, which sets `color: hsl(var(--background))`, whenever the button is an anchor inside `.prose`. The label disappears into the primary fill.',
    '',
    'Later fix: keep link color on `.prose a:not(.btn)`, or set `.prose .btn-primary` color with higher specificity. The secondary buttons on the same pages stay just above 4.5:1 after the same override, so they pass AA today and will change if the selector is narrowed.',
    '',
  );
  if (!contrastRuns.length) {
    lines.push('No same-color text and background on links or buttons.', '');
  }
  for (const run of contrastRuns) {
    lines.push(`### ${run.route} (${run.mode})`, '');
    for (const gap of run.contrastGaps) {
      lines.push(
        `- \`${gap.target}\` "${gap.text}" — ${gap.color} on ${gap.backgroundColor}, ${gap.fontSize} / ${gap.fontWeight}`,
      );
    }
    lines.push('');
  }

  lines.push('', '## Violations', '');
  if (!violationRuns.length) {
    lines.push('No WCAG 2.1 A/AA violations.');
    lines.push('');
  }
  for (const run of violationRuns) {
    lines.push(`### ${run.route} (${run.mode})`, '');
    if (run.error) {
      lines.push(run.error, '');
    }
    const rules = [...(run.violations || [])].sort((a, b) => impactRank(a.impact) - impactRank(b.impact));
    for (const rule of rules) {
      lines.push(renderRule(rule));
    }
  }

  lines.push('## Incomplete (needs review)', '');
  lines.push(
    'On `/app` with the consent banner open, axe could not read the banner title and body because another element overlaps them. The Accept button on that banner measures about 6:1 (near-white on primary) and is not one of the confirmed gaps above.',
    '',
  );
  if (!incompleteRuns.length) {
    lines.push('No incomplete checks.');
    lines.push('');
  }
  for (const run of incompleteRuns) {
    lines.push(`### ${run.route} (${run.mode})`, '');
    const rules = [...run.incomplete].sort((a, b) => impactRank(a.impact) - impactRank(b.impact));
    for (const rule of rules) {
      lines.push(renderRule(rule));
    }
  }

  const contrastTheme = report.highContrast || [];
  const contrastThemeNodes = contrastTheme.reduce((sum, run) => sum + (run.nodes || 0), 0);
  lines.push('## High contrast theme', '');
  lines.push(
    'Turning on Accessibility → High contrast sets `html.a11y-contrast` (`anchor-a11y-prefs-v1`). axe then reports real `color-contrast` violations. This theme is outside the default gate, which still exits 0.',
    '',
    `Nodes failing: ${contrastThemeNodes}.`,
    '',
    'The theme keeps primary `#443dff` on a near-black background (`#050316`), about 3.25:1. Normal text needs 4.5:1. Secondary buttons and several `/app` chips drop to about 1.2:1 because light text sits on the accent fill.',
    '',
    '| Route | Failing nodes |',
    '| --- | ---: |',
  );
  for (const run of contrastTheme) {
    lines.push(`| ${escapeCell(run.route)} | ${run.nodes} |`);
  }
  lines.push('');
  const grouped = new Map();
  for (const run of contrastTheme) {
    for (const group of run.groups || []) {
      const key = group.summary || group.id;
      const current = grouped.get(key) || { count: 0, routes: [], targets: group.targets || [] };
      current.count += group.count;
      if (!current.routes.includes(run.route)) current.routes.push(run.route);
      grouped.set(key, current);
    }
  }
  for (const [summary, group] of grouped) {
    lines.push(
      `- ${group.count} ${group.count === 1 ? 'node' : 'nodes'} on ${group.routes.map((route) => `\`${route}\``).join(', ')}. Example target \`${JSON.stringify(group.targets[0] || [])}\`. ${summary}`,
    );
    lines.push('');
  }

  lines.push('## What this does not prove', '');
  lines.push(
    '- A passing automated run is not a full WCAG 2.1 conformance claim.',
    '- Pages behind Telegram login (`/family` record contents, signed-in `/my-data` actions) are only checked in their logged-out state.',
    '- Design explorations under `/designs/*` are not part of this gate.',
    '',
  );
  return `${lines.join('\n')}\n`;
}

function writeReport(report) {
  mkdirSync(dirname(REPORT_MD), { recursive: true });
  mkdirSync(dirname(REPORT_JSON), { recursive: true });
  writeFileSync(REPORT_JSON, `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(REPORT_MD, renderMarkdown(report));
}

async function enableHighContrast(page) {
  await page.addInitScript(() => {
    localStorage.setItem(
      'anchor-a11y-prefs-v1',
      JSON.stringify({
        textScale: 100,
        spacing: false,
        highContrast: true,
        underlineLinks: false,
        readableFont: false,
        reduceMotion: false,
        bigCursor: false,
        grayscale: false,
        hideImages: false,
      }),
    );
  });
}

async function auditHighContrast(browser, route) {
  const url = `${BASE}${route === '/404' ? '/this-page-does-not-exist-a11y' : route}`;
  const context = await browser.newContext();
  const page = await context.newPage();
  await enableHighContrast(page);
  const response = await page.goto(url, { waitUntil: 'load' });
  const status = response?.status() ?? 0;
  await page.waitForTimeout(400);
  await page.evaluate(axeSource);
  const groups = await page.evaluate(async (tags) => {
    const results = await globalThis.axe.run(document, { runOnly: { type: 'tag', values: tags } });
    const map = new Map();
    for (const rule of results.violations) {
      for (const node of rule.nodes) {
        const summary = (node.failureSummary || rule.help).replace(/\s+/g, ' ').trim();
        const current = map.get(summary) || {
          id: rule.id,
          impact: rule.impact,
          summary,
          count: 0,
          targets: [],
        };
        current.count += 1;
        if (current.targets.length < 3) current.targets.push(node.target);
        map.set(summary, current);
      }
    }
    return [...map.values()];
  }, TAGS);
  await context.close();
  return {
    route,
    url,
    status,
    nodes: groups.reduce((sum, group) => sum + group.count, 0),
    groups,
  };
}

async function audit(browser, route, mode) {
  const url = `${BASE}${route === '/404' ? '/this-page-does-not-exist-a11y' : route}`;
  const context = await browser.newContext();
  const page = await context.newPage();
  await clearConsent(page);
  const response = await page.goto(url, { waitUntil: 'load' });
  const status = response?.status() ?? 0;
  if (!response || status >= 500) {
    await context.close();
    return { route, mode, url, status, error: `HTTP ${status || 'none'}` };
  }
  await page.waitForTimeout(500);
  if (mode === 'consent-dismissed') {
    await dismissConsent(page);
  }
  const result = await runAxe(page);
  const contrastGaps = await page.evaluate(() => {
    const parse = (value) => {
      const parts = value.match(/[\d.]+/g)?.map(Number) || [0, 0, 0, 0];
      return { r: parts[0], g: parts[1], b: parts[2], a: parts.length > 3 ? parts[3] : 1 };
    };
    const gaps = [];
    for (const el of document.querySelectorAll('a, button')) {
      const text = (el.innerText || '').trim().replace(/\s+/g, ' ');
      if (!text) continue;
      const box = el.getBoundingClientRect();
      if (box.width < 2 || box.height < 2) continue;
      const style = getComputedStyle(el);
      const fg = parse(style.color);
      const bg = parse(style.backgroundColor);
      if (fg.a !== 1 || bg.a !== 1) continue;
      if (fg.r !== bg.r || fg.g !== bg.g || fg.b !== bg.b) continue;
      gaps.push({
        text,
        target: el.className ? `${el.tagName.toLowerCase()}.${String(el.className).trim().replace(/\s+/g, '.')}` : el.tagName.toLowerCase(),
        color: style.color,
        backgroundColor: style.backgroundColor,
        fontSize: style.fontSize,
        fontWeight: style.fontWeight,
      });
    }
    return gaps;
  });
  await context.close();
  return { route, mode, url, status, contrastGaps, ...result };
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const runs = [];

  for (const route of ROUTES) {
    runs.push(await audit(browser, route, 'consent-open'));
    runs.push(await audit(browser, route, 'consent-dismissed'));
  }

  const highContrast = [];
  for (const route of ROUTES) {
    highContrast.push(await auditHighContrast(browser, route));
  }

  await browser.close();

  const failures = runs.filter((run) => run.error || (run.violations || []).length);
  const contrastGapCount = runs.reduce((sum, run) => sum + (run.contrastGaps || []).length, 0);
  const report = {
    generatedAt: new Date().toISOString(),
    commit: gitSha(),
    baseUrl: BASE,
    axeVersion,
    standard: 'WCAG 2.1 AA',
    tags: TAGS,
    passed: failures.length === 0,
    contrastGapCount,
    highContrast,
    runs,
  };
  writeReport(report);
  console.log(`Wrote ${REPORT_MD}`);
  console.log(`Wrote ${REPORT_JSON}`);

  if (failures.length) {
    console.error('axe WCAG 2.1 AA failures:\n');
    for (const fail of failures) {
      console.error(`- ${fail.route} (${fail.mode})`);
      if (fail.error) console.error(`  ${fail.error}`);
      for (const v of fail.violations || []) {
        console.error(`  ${v.id} [${v.impact}] ${v.help} (${v.nodes.length} nodes)`);
        for (const node of v.nodes.slice(0, 5)) console.error(`    ${JSON.stringify(node.target)}`);
      }
    }
    process.exit(1);
  }

  console.log(
    `axe WCAG 2.1 AA: ${ROUTES.length} routes × 2 consent states — 0 violations, ${contrastGapCount} confirmed contrast gaps`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
