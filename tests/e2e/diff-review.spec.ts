import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve as resolvePath, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';
import { test, expect } from './harness/browser.js';
import { startDaemon, type DaemonHandle } from './harness/daemon.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE = resolvePath(__dirname, 'fixtures', 'simple-text-response.jsonl');

const SEED_SESSION_ID = '22222222-3333-4444-5555-666666666666';
const SEED_BRANCH = 'outpost/22222222';

function seedJsonl(id: string, cwd: string): string {
  return JSON.stringify({
    type: 'summary',
    sessionId: id,
    cwd,
    timestamp: new Date(0).toISOString(),
    summary: 'seeded diff-review session',
  }) + '\n';
}

function numbered(n: number, edit: Record<number, string> = {}): string {
  return Array.from({ length: n }, (_, i) => edit[i + 1] ?? `line ${i + 1}`).join('\n') + '\n';
}

const seededTest = test.extend<{ seedRepo: string; wtPath: string; daemon: DaemonHandle }>({
  seedRepo: async ({}, use) => {
    const repo = mkdtempSync(join(tmpdir(), 'outpost-e2e-diffreview-'));
    execFileSync('git', ['init', '-q', '-b', 'main', repo]);
    execFileSync('git', ['-C', repo, 'config', 'user.email', 'test@example']);
    execFileSync('git', ['-C', repo, 'config', 'user.name', 'Test']);
    writeFileSync(join(repo, 'a.txt'), 'one\ntwo\nthree\n');
    mkdirSync(join(repo, 'src', 'lib'), { recursive: true });
    writeFileSync(join(repo, 'src', 'lib', 'long.txt'), numbered(60));
    writeFileSync(join(repo, 'src', 'lib', 'other.txt'), 'before\n');
    execFileSync('git', ['-C', repo, 'add', '-A']);
    execFileSync('git', ['-C', repo, 'commit', '-q', '-m', 'init']);
    await use(repo);
  },
  // Stash the worktree path so the test body can reach it from the fixture chain.
  wtPath: async ({ seedRepo }, use) => {
    await use(join(seedRepo, '.outpost-e2e-diffwt'));
  },
  daemon: async ({ seedRepo, wtPath }, use) => {
    // Build a worktree on a fresh branch, then commit a real change on it so the
    // branch-vs-main diff has something to render.
    execFileSync('git', ['-C', seedRepo, 'worktree', 'add', '-b', SEED_BRANCH, wtPath, 'main']);
    writeFileSync(join(wtPath, 'a.txt'), 'one\nTWO\nthree\n');
    // Two edits 45 lines apart give long.txt two hunks with a 38-line gap between them.
    writeFileSync(join(wtPath, 'src', 'lib', 'long.txt'), numbered(60, { 5: 'FIVE', 50: 'FIFTY' }));
    writeFileSync(join(wtPath, 'src', 'lib', 'other.txt'), 'after\n');
    execFileSync('git', ['-C', wtPath, 'add', '-A']);
    execFileSync('git', ['-C', wtPath, '-c', 'user.email=test@example', '-c', 'user.name=Test',
      'commit', '-q', '-m', 'change']);

    const handle = await startDaemon({
      fixturePath: FIXTURE,
      initialProjects: [
        { cwd: wtPath, sessions: [{ id: SEED_SESSION_ID, jsonl: seedJsonl(SEED_SESSION_ID, wtPath) }] },
      ],
      initialWorktrees: [
        { sessionId: SEED_SESSION_ID, projectCwd: seedRepo, worktreePath: wtPath, branch: SEED_BRANCH, baseBranch: 'main' },
      ],
    });
    await use(handle);
    await handle.stop();
  },
});

async function openDiffOverlay(page: Page): Promise<void> {
  // Redesigned shell: no per-project accordion — navigate to the Sessions
  // surface, then open the seeded session from its card.
  await page.locator('.o-sidebar-item[data-surface="sessions"]').click();
  await page.locator(`.sess-card[data-session-id="${SEED_SESSION_ID}"]`).click();
  await expect(page.locator('.sv-composer')).toBeVisible({ timeout: 10_000 });

  // Desktop hides the toolbar's `.sv-git-btn` (mobile-only — see session-view.css)
  // and folds "open diff" into the header's ⋯ menu instead, alongside Archive.
  await page.locator('.sv-header-menu-btn').click();
  await expect(page.locator('.sv-header-menu-item[data-action="open-diff"]')).toBeVisible();
  await page.locator('.sv-header-menu-item[data-action="open-diff"]').click();
  await expect(page.locator('.dr-overlay')).toBeVisible();
}

seededTest('user can leave an inline comment on the branch diff and submit a bundled review', async ({ outpostPage }) => {
  await openDiffOverlay(outpostPage);

  await expect(outpostPage.locator('#dr-files-list .dr-file-row')).toHaveCount(3);
  await expect(outpostPage.locator('#dr-files-list .dr-file-row[data-file="a.txt"] .dr-file-name')).toHaveText('a.txt');

  // Click the `+TWO` added line and leave a comment.
  await outpostPage.locator('#dr-viewport .dr-row.dr-add', { hasText: 'TWO' }).first().click();
  const ta = outpostPage.locator('#dr-viewport .dr-comment-form textarea');
  await expect(ta).toBeVisible();
  await ta.fill('Should this be lowercase?');
  await outpostPage.locator('#dr-viewport .dr-comment-form button[type="submit"]').click();

  // A chip should now exist; the primary CTA folds to "Submit review · N".
  await expect(outpostPage.locator('#dr-viewport .dr-comment-card')).toHaveCount(1);
  await expect(outpostPage.locator('#dr-primary-btn')).toHaveText('Submit review · 1');

  // Submit.
  await outpostPage.locator('#dr-primary-btn').click();
  await expect(outpostPage.locator('.dr-overlay')).toBeHidden();

  // The bundled user message lands in the transcript as a structured Review tile
  // (not a plain text bubble — that was the pre-fix bug: diff-overlay's message
  // never matched message-html.js's marker check).
  const tile = outpostPage.locator('.sv-transcript-inner .diff-review-msg');
  await expect(tile).toHaveCount(1);
  await expect(tile.locator('.dr-cite-file')).toHaveText('a.txt');
  await expect(tile.locator('.dr-cite-line')).toHaveText('L2');
  await expect(tile.locator('.dr-note')).toHaveText('Should this be lowercase?');
});

seededTest('rail groups files by directory, gaps expand in place, and a comment can span a range', async ({ outpostPage }) => {
  await openDiffOverlay(outpostPage);
  const rail = outpostPage.locator('#dr-files-list');
  const dir = rail.locator('.dr-dir-row[data-dir="src/lib"]');
  await expect(dir.locator('.dr-dir-name')).toHaveText('src/lib/');
  await expect(rail.locator('.dr-file-row[data-file="src/lib/long.txt"] .dr-file-name')).toHaveText('long.txt');
  await dir.click();
  await expect(rail.locator('.dr-file-row')).toHaveCount(1);
  await rail.locator('.dr-dir-row[data-dir="src/lib"]').click();
  await expect(rail.locator('.dr-file-row')).toHaveCount(3);

  const card = outpostPage.locator('.dr-file-card[data-file="src/lib/long.txt"]');
  const midGap = card.locator('.dr-gap[data-gap="mid"]');
  await expect(midGap.locator('.dr-gap-hdr')).toHaveText('@@ -47,7 +47,7 @@');
  await expect(midGap.locator('.dr-gap-count')).toHaveText('38 hidden lines');
  const secondHunkRow = await card.locator('.dr-row[data-side="new"][data-line="50"]').elementHandle();
  await midGap.locator('.dr-gap-btn[data-expand="down"]').click();
  await expect(midGap.locator('.dr-gap-count')).toHaveText('18 hidden lines');
  await expect(card.locator('.dr-expanded .dr-row[data-side="new"]')).toHaveCount(20);
  // The 20 revealed rows joined the first hunk, whose @@ line rides in the leading gap bar.
  await expect(card.locator('.dr-gap[data-gap="lead"] .dr-gap-hdr')).toHaveText('@@ -2,27 +2,27 @@');
  // The last 18 hidden lines close the gap, so the second hunk merges into the first.
  await midGap.locator('.dr-gap-btn[data-expand="up"]').click();
  await expect(midGap).toHaveCount(0);
  await expect(card.locator('.dr-gap[data-gap="lead"] .dr-gap-hdr')).toHaveText('@@ -2,52 +2,52 @@');
  // Closing the leading gap has no hunk above to merge into, so the header must survive as a plain one.
  await card.locator('.dr-gap[data-gap="lead"] .dr-gap-btn[data-expand="all"]').click();
  await expect(card.locator('.dr-gap')).toHaveCount(1);
  await expect(card.locator('.dr-hunk-hdr').first()).toHaveText('@@ -1,53 +1,53 @@');
  // The expand inserted rows next to the bar; nothing else in the viewport was re-rendered.
  expect(await secondHunkRow!.evaluate((el) => el.isConnected)).toBe(true);

  const five = card.locator('.dr-row.dr-add', { hasText: 'FIVE' });
  const line7 = card.locator('.dr-row[data-side="new"][data-line="7"]');
  const form = card.locator('.dr-comment-form');
  await five.click();
  await line7.click({ modifiers: ['Shift'] });
  await expect(form.locator('.dr-comment-range')).toHaveText('Lines 5–7');
  // Escape backs out one level at a time: leave the textarea, then drop the draft, never the overlay.
  await outpostPage.keyboard.press('Escape');
  await outpostPage.keyboard.press('Escape');
  await expect(form).toHaveCount(0);
  await expect(outpostPage.locator('.dr-overlay')).toBeVisible();

  await five.hover();
  await outpostPage.keyboard.press('c');
  await outpostPage.keyboard.press('Escape');
  await line7.hover();
  await outpostPage.keyboard.press('Shift+C');
  await expect(form.locator('.dr-comment-range')).toHaveText('Lines 5–7');
  await form.locator('textarea').fill('Collapse these three lines.');
  await form.locator('button[type="submit"]').click();
  await expect(card.locator('.dr-comment-card .dr-comment-range')).toHaveText('Lines 5–7');

  await outpostPage.locator('#dr-primary-btn').click();
  const tile = outpostPage.locator('.sv-transcript-inner .diff-review-msg');
  await expect(tile.locator('.dr-cite-line')).toHaveText('L5–7');
  await expect(tile.locator('.dr-quote .dr-line')).toHaveCount(3);
});
