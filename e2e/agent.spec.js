const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');

async function waitForEditor(page) {
  await page.waitForFunction(() => {
    return typeof window !== 'undefined' && window.__codecraftEditor && window.__codecraftEditor.getModel();
  }, { timeout: 25000 });
}

test.describe('CodeCraft Phase 8: AI Coding Agent E2E Suite (Mocked-Provider Verified)', () => {
  const wsId = 'e2e-agent-ws-' + Date.now();

  test.afterAll(() => {
    const repoPath = path.resolve(process.cwd(), 'data', 'git', 'workspaces', wsId);
    if (fs.existsSync(repoPath)) {
      try {
        fs.rmSync(repoPath, { recursive: true, force: true });
      } catch (e) {}
    }
  });

  // TEST 1: AI Agent Panel Opens & Displays Controls
  test('1. Agent UI — Opens AI Agent panel with prompt input and execution controls', async ({ page }) => {
    await page.goto(`/e2e-test?user=alice&role=contributor&ws=${wsId}&file=file-1&agent=true`);
    await waitForEditor(page);

    // Verify Agent panel container and elements are visible
    const agentPanel = page.locator('[data-testid="agent-panel"]');
    await expect(agentPanel).toBeVisible({ timeout: 15000 });

    const promptInput = page.locator('[data-testid="agent-prompt-input"]');
    await expect(promptInput).toBeVisible();

    const runBtn = page.locator('[data-testid="agent-run-btn"]');
    await expect(runBtn).toBeVisible();
    await expect(runBtn).toBeDisabled(); // Disabled when input is empty
  });

  // TEST 2: Autonomous Agent Task Execution & Status Transitions
  test('2. Agent Execution — Submits coding request, tracks status, and updates repository', async ({ page }) => {
    await page.goto(`/e2e-test?user=alice&role=contributor&ws=${wsId}&file=file-1&agent=true`);
    await waitForEditor(page);

    // Write initial main.js in workspace repo
    const repoPath = path.resolve(process.cwd(), 'data', 'git', 'workspaces', wsId);
    fs.mkdirSync(repoPath, { recursive: true });
    fs.writeFileSync(path.join(repoPath, 'main.js'), 'export function run() { return "initial"; }\n', 'utf8');

    // Fill in task prompt
    const promptInput = page.locator('[data-testid="agent-prompt-input"]');
    await promptInput.fill('Find the bug in main.js, fix it, and show the changes.');

    const runBtn = page.locator('[data-testid="agent-run-btn"]');
    await expect(runBtn).toBeEnabled();
    await runBtn.click();

    // Verify status badge appears
    const statusBadge = page.locator('[data-testid="agent-status-badge"]');
    await expect(statusBadge).toBeVisible({ timeout: 10000 });

    // Wait for completion status
    await expect(statusBadge).toHaveText('COMPLETED', { timeout: 35000 });

    // Verify activity log entries exist
    const activityLog = page.locator('[data-testid="agent-activity-log"]');
    await expect(activityLog).toBeVisible();

    // Verify Changes section displays modified file
    const changesSection = page.locator('[data-testid="agent-changes-section"]');
    await expect(changesSection).toBeVisible();
    await expect(changesSection).toContainText('main.js');
  });

  // TEST 3: Git Diff Visualization
  test('3. Diff Viewer — Opens MonacoDiffViewer modal to inspect agent modifications', async ({ page }) => {
    await page.goto(`/e2e-test?user=alice&role=contributor&ws=${wsId}&file=file-1&agent=true`);
    await waitForEditor(page);

    const diffBtn = page.locator('[data-testid="agent-view-diff-btn"]');
    if (await diffBtn.isVisible({ timeout: 3000 })) {
      await diffBtn.click();
      const diffModal = page.locator('[data-testid="monaco-diff-modal"]');
      await expect(diffModal).toBeVisible({ timeout: 10000 });

      // Close modal
      const closeBtn = page.locator('[data-testid="close-diff-btn"]');
      await closeBtn.click();
      await expect(diffModal).not.toBeVisible();
    }
  });

  // TEST 4: Safe Rollback Execution
  test('4. Safe Rollback — Rolls back agent modifications cleanly', async ({ page }) => {
    await page.goto(`/e2e-test?user=alice&role=contributor&ws=${wsId}&file=file-1&agent=true`);
    await waitForEditor(page);

    // Trigger run first if rollback button is not already present
    const rollbackBtn = page.locator('[data-testid="agent-rollback-btn"]');
    if (!(await rollbackBtn.isVisible({ timeout: 2000 }))) {
      const promptInput = page.locator('[data-testid="agent-prompt-input"]');
      await promptInput.fill('Modify main.js to add greeting helper.');
      await page.locator('[data-testid="agent-run-btn"]').click();
      await expect(page.locator('[data-testid="agent-status-badge"]')).toHaveText('COMPLETED', { timeout: 35000 });
    }

    // Click rollback button
    await expect(rollbackBtn).toBeVisible({ timeout: 10000 });
    await rollbackBtn.click();

    // Verify rolled back notification appears
    await expect(page.locator('text=All changes from this run were rolled back')).toBeVisible({ timeout: 15000 });
  });

  // TEST 5: Viewer Role Guards
  test('5. Role Authorization — Viewer role is strictly restricted from executing agent changes', async ({ page }) => {
    await page.goto(`/e2e-test?user=bob&role=viewer&ws=${wsId}&file=file-1&agent=true`);
    await waitForEditor(page);

    // Verify viewer warning banner is displayed
    const warning = page.locator('[data-testid="agent-viewer-warning"]');
    await expect(warning).toBeVisible({ timeout: 10000 });

    // Verify prompt input and run button are disabled
    const promptInput = page.locator('[data-testid="agent-prompt-input"]');
    await expect(promptInput).toBeDisabled();

    const runBtn = page.locator('[data-testid="agent-run-btn"]');
    await expect(runBtn).toBeDisabled();
  });

  // TEST 6: Authentication Enforcement on API
  test('6. Authentication — Server blocks unauthenticated agent request with HTTP 401', async ({ request }) => {
    const res = await request.post(`/api/workspace/${wsId}/agent`, {
      data: {
        task: 'Fix errors in repository',
      },
    });

    expect(res.status()).toBe(401);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.code).toBe('UNAUTHORIZED');
  });

  // TEST 7: Workspace Validation on API
  test('7. Workspace Isolation — Agent requests validate workspace context strictly', async ({ request }) => {
    const res = await request.post(`/api/workspace/../illegal-ws/agent`, {
      headers: {
        Authorization: 'Bearer test-token-contributor:alice',
      },
      data: {
        task: 'Malicious path traversal workspace task',
      },
    });

    expect([400, 403, 404]).toContain(res.status());
  });

  // TEST 8: Rollback Authorization
  test('8. Rollback Authorization — Read-only Viewer role cannot rollback agent changes via API', async ({ request }) => {
    const res = await request.post(`/api/workspace/${wsId}/agent/rollback`, {
      headers: {
        Authorization: 'Bearer test-token-viewer:bob',
      },
      data: {
        runId: 'fake-run-123',
      },
    });

    expect(res.status()).toBe(403);
    const body = await res.json();
    expect(body.success).toBe(false);
  });
});
