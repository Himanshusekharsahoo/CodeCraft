const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');

// Helper to wait for Monaco editor initialization
async function waitForEditor(page) {
  await page.waitForFunction(() => {
    return typeof window !== 'undefined' && window.__codecraftEditor && window.__codecraftEditor.getModel();
  }, { timeout: 25000 });
}

test.describe('CodeCraft Phase 6: Git Version Control Engine E2E Suite', () => {
  const wsId = 'e2e-git-ws-' + Date.now();

  test.afterAll(() => {
    // Clean up test workspace repo dir
    const repoPath = path.resolve(process.cwd(), 'data', 'git', 'workspaces', wsId);
    if (fs.existsSync(repoPath)) {
      try {
        fs.rmSync(repoPath, { recursive: true, force: true });
      } catch (e) {
        // ignore Windows file locks
      }
    }
  });

  // TEST 1: Uninitialized State & Initialize Repository
  test('1. Repository Lifecycle — Initializes repository and shows main branch', async ({ page }) => {
    await page.goto(`/e2e-test?user=alice&role=contributor&ws=${wsId}&file=file-1&git=true`);
    await waitForEditor(page);

    // Should display Initialize button when uninitialized
    const initBtn = page.locator('[data-testid="git-init-btn"]');
    await expect(initBtn).toBeVisible({ timeout: 15000 });
    await initBtn.click();

    // After initialization, branch select should show main
    const branchSelect = page.locator('[data-testid="branch-select"]');
    await expect(branchSelect).toBeVisible({ timeout: 15000 });
    await expect(branchSelect).toHaveValue('main');
  });

  // TEST 2: Changes Detection, Staging, and Commit
  test('2. Staging & Commits — Detects file changes, stages files, and creates commit', async ({ page }) => {
    await page.goto(`/e2e-test?user=alice&role=contributor&ws=${wsId}&file=file-1&git=true`);
    await waitForEditor(page);

    // Wait for branch-select to be ready
    await expect(page.locator('[data-testid="branch-select"]')).toBeVisible({ timeout: 15000 });

    // Write a test change directly to workspace working tree on disk
    const repoPath = path.resolve(process.cwd(), 'data', 'git', 'workspaces', wsId);
    fs.mkdirSync(repoPath, { recursive: true });
    fs.writeFileSync(path.join(repoPath, 'feature.js'), 'export const greeting = "Hello CodeCraft";\n', 'utf8');

    // Click refresh in Git Panel
    await page.locator('[data-testid="git-refresh-btn"]').click();

    // Verify feature.js appears in Changes list
    const changeItem = page.locator('[data-testid="change-item-feature.js"]');
    await expect(changeItem).toBeVisible({ timeout: 10000 });

    // Click stage button (+) for feature.js
    const stageBtn = page.locator('[data-testid="stage-file-feature.js"]');
    await stageBtn.click();

    // Verify feature.js moved to Staged Changes
    const stagedItem = page.locator('[data-testid="staged-item-feature.js"]');
    await expect(stagedItem).toBeVisible({ timeout: 10000 });

    // Fill in commit message
    const commitInput = page.locator('[data-testid="commit-message-input"]');
    await commitInput.fill('Add feature.js greeting module');

    // Click commit button
    const commitBtn = page.locator('[data-testid="commit-btn"]');
    await expect(commitBtn).toBeEnabled();
    await commitBtn.click();

    // Staged item should disappear, status becomes clean
    await expect(stagedItem).not.toBeVisible({ timeout: 10000 });
    await expect(page.locator('text=Working tree clean')).toBeVisible({ timeout: 10000 });
  });

  // TEST 3: Commit History Inspection
  test('3. Commit History — Displays committed history with hashes and metadata', async ({ page }) => {
    await page.goto(`/e2e-test?user=alice&role=contributor&ws=${wsId}&file=file-1&git=true`);
    await waitForEditor(page);

    // Wait for branch-select to be ready
    await expect(page.locator('[data-testid="branch-select"]')).toBeVisible({ timeout: 15000 });

    // Click History tab
    await page.locator('[data-testid="tab-history"]').click();

    // Verify commit entry exists
    await expect(page.locator('text=Add feature.js greeting module')).toBeVisible({ timeout: 10000 });
  });

  // TEST 4: Branch Management (Create & Switch)
  test('4. Branch Management — Creates new branch and switches active branch', async ({ page }) => {
    await page.goto(`/e2e-test?user=alice&role=contributor&ws=${wsId}&file=file-1&git=true`);
    await waitForEditor(page);

    // Wait for branch-select to be ready
    await expect(page.locator('[data-testid="branch-select"]')).toBeVisible({ timeout: 15000 });

    // Click "New" branch button
    await page.locator('[data-testid="new-branch-btn"]').click();

    // Fill branch name
    const branchInput = page.locator('[data-testid="branch-name-input"]');
    await expect(branchInput).toBeVisible();
    await branchInput.fill('feature-e2e-branch');

    // Click Create
    await page.locator('[data-testid="confirm-create-branch"]').click();

    // Switch to new branch using branch select
    const branchSelect = page.locator('[data-testid="branch-select"]');
    await branchSelect.selectOption('feature-e2e-branch');

    // Verify branch select now has value feature-e2e-branch
    await expect(branchSelect).toHaveValue('feature-e2e-branch', { timeout: 10000 });
  });

  // TEST 5: Viewer Role Read-Only Enforcement
  test('5. Role Authorization — Viewer role is strictly restricted to read-only', async ({ page }) => {
    await page.goto(`/e2e-test?user=charlie&role=viewer&ws=${wsId}&file=file-1&git=true`);
    await waitForEditor(page);

    // Verify Read-Only badge is displayed
    await expect(page.locator('[data-testid="git-panel"]').getByText('Read-Only', { exact: true })).toBeVisible({ timeout: 10000 });

    // Branch select should be disabled for viewers
    const branchSelect = page.locator('[data-testid="branch-select"]');
    await expect(branchSelect).toBeVisible({ timeout: 15000 });
    await expect(branchSelect).toBeDisabled();

    // Commit button and input should NOT be available
    await expect(page.locator('[data-testid="commit-message-input"]')).not.toBeVisible();
    await expect(page.locator('[data-testid="commit-btn"]')).not.toBeVisible();
    await expect(page.locator('[data-testid="new-branch-btn"]')).not.toBeVisible();
  });
});
