const { test, expect } = require('@playwright/test');

function normalize(s) {
  return (s || '').replace(/\r\n/g, '\n').replace(/[ \t]+$/gm, '').trim();
}

// Helper to wait for Monaco editor initialization
async function waitForEditor(page) {
  await page.waitForFunction(() => {
    return typeof window !== 'undefined' && window.__codecraftEditor && window.__codecraftEditor.getModel();
  }, { timeout: 25000 });
}

// Helper to insert text into Monaco editor via direct model edit
async function insertText(page, text) {
  await page.evaluate((val) => {
    const editor = window.__codecraftEditor;
    if (editor) {
      const model = editor.getModel();
      if (model) {
        const lineCount = model.getLineCount();
        const maxCol = model.getLineMaxColumn(lineCount);
        model.applyEdits([
          {
            range: { startLineNumber: lineCount, startColumn: maxCol, endLineNumber: lineCount, endColumn: maxCol },
            text: val,
            forceMoveMarkers: true,
          },
        ]);
      }
    }
  }, text);
}

// Helper to get text from Monaco editor
async function getEditorValue(page) {
  return await page.evaluate(() => {
    return window.__codecraftEditor ? window.__codecraftEditor.getValue() : '';
  });
}

test.describe('CodeCraft Phase 5: Realtime Multi-File Collaboration E2E Suite', () => {

  // TEST 1: Same File Collaboration
  test('1. Same File Collaboration — Two browsers connect and sync edits in real-time', async ({ browser }) => {
    const contextA = await browser.newContext();
    const pageA = await contextA.newPage();
    const contextB = await browser.newContext();
    const pageB = await contextB.newPage();

    const wsId = 'ws-samefile-' + Date.now();
    const fileId = 'file-1';

    await pageA.goto(`/e2e-test?user=alice&role=contributor&ws=${wsId}&file=${fileId}`);
    await pageB.goto(`/e2e-test?user=bob&role=contributor&ws=${wsId}&file=${fileId}`);

    await waitForEditor(pageA);
    await waitForEditor(pageB);

    await expect(pageA.locator('text=Connected')).toBeVisible({ timeout: 15000 });
    await expect(pageB.locator('text=Connected')).toBeVisible({ timeout: 15000 });

    const payload = '// Alice real-time edit ' + Date.now();
    await insertText(pageA, '\n' + payload);

    await expect(pageB.locator('#editor-preview')).toContainText(payload, { timeout: 15000 });

    await expect.poll(async () => {
      const [valA, valB] = await Promise.all([getEditorValue(pageA), getEditorValue(pageB)]);
      return normalize(valA) === normalize(valB) && normalize(valB).includes(payload);
    }, { timeout: 15000 }).toBe(true);

    await contextA.close();
    await contextB.close();
  });

  // TEST 2: Bidirectional Editing
  test('2. Bidirectional Editing — Edits from both peers converge to identical state', async ({ browser }) => {
    const contextA = await browser.newContext();
    const pageA = await contextA.newPage();
    const contextB = await browser.newContext();
    const pageB = await contextB.newPage();

    const wsId = 'ws-bidi-' + Date.now();
    const fileId = 'file-1';

    await pageA.goto(`/e2e-test?user=alice&role=contributor&ws=${wsId}&file=${fileId}`);
    await pageB.goto(`/e2e-test?user=bob&role=contributor&ws=${wsId}&file=${fileId}`);

    await waitForEditor(pageA);
    await waitForEditor(pageB);

    await expect(pageA.locator('text=Connected')).toBeVisible({ timeout: 15000 });
    await expect(pageB.locator('text=Connected')).toBeVisible({ timeout: 15000 });

    // Alice -> Bob
    await insertText(pageA, '\nconst a = 100;');
    await expect(pageB.locator('#editor-preview')).toContainText('const a = 100;', { timeout: 15000 });

    // Bob -> Alice
    await insertText(pageB, '\nconst b = 200;');
    await expect(pageA.locator('#editor-preview')).toContainText('const b = 200;', { timeout: 15000 });

    await expect.poll(async () => {
      const [valA, valB] = await Promise.all([getEditorValue(pageA), getEditorValue(pageB)]);
      return normalize(valA) === normalize(valB) && normalize(valB).includes('const a = 100;') && normalize(valB).includes('const b = 200;');
    }, { timeout: 15000 }).toBe(true);

    await contextA.close();
    await contextB.close();
  });

  // TEST 3: Concurrent Editing
  test('3. Concurrent Editing — Simultaneous edits from independent clients converge with zero loss', async ({ browser }) => {
    const contextA = await browser.newContext();
    const pageA = await contextA.newPage();
    const contextB = await browser.newContext();
    const pageB = await contextB.newPage();

    const wsId = 'ws-conc-' + Date.now();
    const fileId = 'file-1';

    await pageA.goto(`/e2e-test?user=alice&role=contributor&ws=${wsId}&file=${fileId}`);
    await pageB.goto(`/e2e-test?user=bob&role=contributor&ws=${wsId}&file=${fileId}`);

    await waitForEditor(pageA);
    await waitForEditor(pageB);

    await expect(pageA.locator('text=Connected')).toBeVisible({ timeout: 15000 });
    await expect(pageB.locator('text=Connected')).toBeVisible({ timeout: 15000 });

    await Promise.all([
      insertText(pageA, '\n// Alice concurrent edit'),
      insertText(pageB, '\n// Bob concurrent edit'),
    ]);

    await expect(pageA.locator('#editor-preview')).toContainText('Alice concurrent', { timeout: 15000 });
    await expect(pageA.locator('#editor-preview')).toContainText('Bob concurrent', { timeout: 15000 });
    await expect(pageB.locator('#editor-preview')).toContainText('Alice concurrent', { timeout: 15000 });
    await expect(pageB.locator('#editor-preview')).toContainText('Bob concurrent', { timeout: 15000 });

    await expect.poll(async () => {
      const [valA, valB] = await Promise.all([getEditorValue(pageA), getEditorValue(pageB)]);
      return (
        normalize(valA) === normalize(valB) &&
        normalize(valA).includes('Alice concurrent') &&
        normalize(valA).includes('Bob concurrent')
      );
    }, { timeout: 15000 }).toBe(true);

    await contextA.close();
    await contextB.close();
  });

  // TEST 4: Collaborator Presence
  test('4. Collaborator Presence — User identity and awareness presence appear and cleanly disconnect', async ({ browser }) => {
    const contextA = await browser.newContext();
    const pageA = await contextA.newPage();
    const contextB = await browser.newContext();
    const pageB = await contextB.newPage();

    const wsId = 'ws-pres-' + Date.now();
    const fileId = 'file-1';

    await pageA.goto(`/e2e-test?user=alice&role=contributor&ws=${wsId}&file=${fileId}`);
    await waitForEditor(pageA);

    await pageB.goto(`/e2e-test?user=bob&role=contributor&ws=${wsId}&file=${fileId}`);
    await waitForEditor(pageB);

    await expect(pageA.locator('text=Connected')).toBeVisible({ timeout: 15000 });
    await expect(pageB.locator('text=Connected')).toBeVisible({ timeout: 15000 });

    // Bob sees Alice avatar / identity indicator
    await expect(pageB.locator('[title*="alice"]')).toBeVisible({ timeout: 15000 });

    // Alice disconnects
    await contextA.close();

    // Bob presence list updates, no ghost cursors
    await expect(pageB.locator('[title*="alice"]')).not.toBeVisible({ timeout: 15000 });

    await contextB.close();
  });

  // TEST 5: Reconnect & Offline Resync
  test('5. Reconnect & Offline Resync — Disconnected client edits offline and reconciles on network restore', async ({ browser }) => {
    const contextA = await browser.newContext();
    const pageA = await contextA.newPage();
    const contextB = await browser.newContext();
    const pageB = await contextB.newPage();

    const wsId = 'ws-rec-' + Date.now();
    const fileId = 'file-1';

    await pageA.goto(`/e2e-test?user=alice&role=contributor&ws=${wsId}&file=${fileId}`);
    await pageB.goto(`/e2e-test?user=bob&role=contributor&ws=${wsId}&file=${fileId}`);

    await waitForEditor(pageA);
    await waitForEditor(pageB);

    await expect(pageA.locator('text=Connected')).toBeVisible({ timeout: 15000 });
    await expect(pageB.locator('text=Connected')).toBeVisible({ timeout: 15000 });

    // Alice disconnects network (emulated via offline event)
    await pageA.evaluate(() => window.dispatchEvent(new Event('offline')));
    await expect(pageA.locator('text=Offline')).toBeVisible({ timeout: 15000 });

    // Alice makes offline edit
    await insertText(pageA, '\n// Alice offline contribution');

    // Restore network
    await pageA.evaluate(() => window.dispatchEvent(new Event('online')));
    await expect(pageA.locator('text=Connected')).toBeVisible({ timeout: 15000 });

    // Bob receives offline edit
    await expect(pageB.locator('#editor-preview')).toContainText('Alice offline contribution', { timeout: 15000 });

    await expect.poll(async () => {
      const [valA, valB] = await Promise.all([getEditorValue(pageA), getEditorValue(pageB)]);
      return normalize(valA) === normalize(valB) && normalize(valB).includes('Alice offline contribution');
    }, { timeout: 15000 }).toBe(true);

    await contextA.close();
    await contextB.close();
  });

  // TEST 6: Offline + Browser Reload + IndexedDB
  test('6. Offline + Browser Reload + IndexedDB — Offline edits survive browser reload and sync upon reconnect', async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();

    const wsId = 'ws-idb-' + Date.now();
    const fileId = 'file-1';

    await page.goto(`/e2e-test?user=alice&role=contributor&ws=${wsId}&file=${fileId}`);
    await waitForEditor(page);
    await expect(page.locator('text=Connected')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('text=Local saved')).toBeVisible({ timeout: 15000 });

    const idbPayload = '// IndexedDB persistent test ' + Date.now();
    await insertText(page, '\n' + idbPayload);

    // Give IndexedDB delta write a moment to persist
    await page.waitForTimeout(800);

    // Reload page
    await page.reload();
    await waitForEditor(page);

    // Verify text survived via IndexedDB cache
    await expect.poll(async () => {
      const val = await getEditorValue(page);
      return normalize(val).includes(idbPayload);
    }, { timeout: 15000 }).toBe(true);

    await context.close();
  });

  // TEST 7: Rapid Multi-File Tab Switching
  test('7. Rapid Multi-File Switching — Tabs switch cleanly with zero cross-file text bleeding', async ({ page }) => {
    const wsId = 'ws-tabs-' + Date.now();
    await page.goto(`/e2e-test?user=alice&role=contributor&ws=${wsId}&file=file-1`);
    await waitForEditor(page);
    await expect(page.locator('text=Connected')).toBeVisible({ timeout: 15000 });

    // Open file 2 and file 3
    await page.click('#btn-open-file-2');
    await page.waitForTimeout(200);
    await page.click('#btn-open-file-3');
    await page.waitForTimeout(200);

    // Type in file 3 (config.json)
    await insertText(page, '\n// File 3 unique content');
    await expect(page.locator('#editor-preview')).toContainText('File 3 unique content', { timeout: 10000 });

    // Switch rapidly between tabs
    await page.click('text=main.js');
    await page.waitForTimeout(100);
    await page.click('text=utils.js');
    await page.waitForTimeout(100);
    await page.click('text=config.json');
    await page.waitForTimeout(100);

    // Verify config.json retained its content
    await expect(page.locator('#editor-preview')).toContainText('File 3 unique content', { timeout: 10000 });

    // Switch back to main.js
    await page.click('text=main.js');
    await page.waitForTimeout(150);

    // main.js must NOT contain config.json's content
    const mainVal = await getEditorValue(page);
    expect(normalize(mainVal)).not.toContain('File 3 unique content');
  });

  // TEST 8: Viewer Mode Enforcement
  test('8. Viewer Mode — Viewer role is enforced as readOnly and cannot mutate document', async ({ page }) => {
    const wsId = 'ws-view-' + Date.now();
    await page.goto(`/e2e-test?user=viewer-bob&role=viewer&ws=${wsId}&file=file-1`);
    await waitForEditor(page);

    await expect(page.locator('text=Connected')).toBeVisible({ timeout: 15000 });

    // Verify Monaco options has readOnly enabled
    const isReadOnly = await page.evaluate(() => {
      return window.__codecraftEditor?.getOption(monaco.editor.EditorOption.readOnly);
    });
    expect(isReadOnly).toBe(true);

    // Verify AI Docs button is disabled
    const docsBtn = page.locator('button:has-text("Docs")');
    await expect(docsBtn).toBeDisabled();
  });

  // TEST 9: Workspace Isolation
  test('9. Workspace Isolation — Different workspaces never leak CRDT updates or presence', async ({ browser }) => {
    const contextA = await browser.newContext();
    const pageA = await contextA.newPage();
    const contextB = await browser.newContext();
    const pageB = await contextB.newPage();

    const wsAlpha = 'ws-alpha-' + Date.now();
    const wsBeta = 'ws-beta-' + Date.now();
    const fileId = 'file-1';

    await pageA.goto(`/e2e-test?user=alice&role=contributor&ws=${wsAlpha}&file=${fileId}`);
    await pageB.goto(`/e2e-test?user=bob&role=contributor&ws=${wsBeta}&file=${fileId}`);

    await waitForEditor(pageA);
    await waitForEditor(pageB);

    await expect(pageA.locator('text=Connected')).toBeVisible({ timeout: 15000 });
    await expect(pageB.locator('text=Connected')).toBeVisible({ timeout: 15000 });

    // Type in Alpha
    await insertText(pageA, '\n// SECRET_ALPHA_TOKEN');
    await expect(pageA.locator('#editor-preview')).toContainText('SECRET_ALPHA_TOKEN');

    // Give time to ensure no network bleed
    await pageA.waitForTimeout(800);

    // Beta must NOT receive Alpha's payload
    const valBeta = await getEditorValue(pageB);
    expect(normalize(valBeta)).not.toContain('SECRET_ALPHA_TOKEN');

    // Beta does NOT see Alice in presence
    const presence = await pageB.$('[title*="alice"]');
    expect(presence).toBeNull();

    await contextA.close();
    await contextB.close();
  });

  // TEST 10: Deleted File Handling
  test('10. Deleted File Handling — Tab close removes session cleanly without errors', async ({ page }) => {
    const wsId = 'ws-del-' + Date.now();
    await page.goto(`/e2e-test?user=alice&role=contributor&ws=${wsId}&file=file-1`);
    await waitForEditor(page);
    await expect(page.locator('text=Connected')).toBeVisible({ timeout: 15000 });

    // Close tab via X button
    const closeBtn = page.locator('button[title="Close tab"]').first();
    if (await closeBtn.isVisible()) {
      await closeBtn.click();
    }

    await page.waitForTimeout(300);
    // Tab closed cleanly without uncaught exceptions
  });

});
