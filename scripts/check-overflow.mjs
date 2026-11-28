// Visits every main screen at several widths and reports any horizontal page overflow and its widest culprits.
import { chromium } from '@playwright/test';
const B = 'http://127.0.0.1:3100';
const paths = ['/?week=2026-06-15', '/tforce/today?date=2026-06-18', '/tforce/week/2026-06-15', '/exceptions', '/hovership/week/2026-06-15', '/extra-jobs', '/extra-jobs/new', '/payroll', '/payroll/hovership-2026-06-08', '/settlements', '/settings/rates', '/settings/rates?tab=drivers', '/settings/rates?tab=services', '/settings/team', '/settings/audit', '/week?week=2026-06-15'];
const widths = [360, 390, 768, 1024, 1280, 1440, 1920, 2560];
const b = await chromium.launch();
const problems = [];
for (const w of widths) {
  const ctx = await b.newContext({ viewport: { width: w, height: 900 }, isMobile: w < 800, hasTouch: w < 800 });
  const p = await ctx.newPage();
  await p.goto(B + '/auth/dev?role=owner&lang=es');
  for (const path of paths) {
    await p.goto(B + path);
    await p.locator('html[data-hydrated="true"]').waitFor();
    await p.waitForLoadState('networkidle');
    const r = await p.evaluate(() => {
      const vw = document.documentElement.clientWidth;
      const sw = document.documentElement.scrollWidth;
      const culprits = [];
      if (sw > vw + 1) {
        for (const el of document.querySelectorAll('body *')) {
          const rect = el.getBoundingClientRect();
          if (rect.right > vw + 1 && rect.width > 0) {
            let inScroller = false;
            for (let a = el; a; a = a.parentElement) { const cs = getComputedStyle(a); if (cs.position === 'fixed') { inScroller = true; break; } if (a !== el && (cs.overflowX === 'auto' || cs.overflowX === 'scroll' || cs.overflowX === 'hidden')) { inScroller = true; break; } }
            if (!inScroller) culprits.push(`${el.tagName.toLowerCase()}.${[...el.classList].join('.')} w=${Math.round(rect.width)} right=${Math.round(rect.right)}`);
          }
        }
      }
      return { vw, sw, culprits: culprits.slice(0, 6) };
    });
    if (r.sw > r.vw + 1) problems.push(`${w}px ${path}: page ${r.sw} > ${r.vw} :: ${r.culprits.join(' | ')}`);
  }
  await ctx.close();
}
console.log(problems.length ? problems.join('\n') : 'no horizontal overflow');
await b.close();
