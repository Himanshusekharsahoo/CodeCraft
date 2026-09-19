const { test, expect } = require('@playwright/test');

// Helper to wait for Monaco editor initialization
async function waitForEditor(page) {
  await page.waitForFunction(() => {
    return typeof window !== 'undefined' && window.__codecraftEditor && window.__codecraftEditor.getModel();
  }, { timeout: 25000 });
}

test.describe('CodeCraft Phase 7: Secure Code Execution & Docker Sandbox E2E Suite', () => {
  const wsId = 'e2e-exec-ws-' + Date.now();

  // TEST 1: JavaScript Execution via Sandbox
  test('1. JavaScript Execution — Runs JS code and renders formatted output & success badge', async ({ page }) => {
    await page.route(`**/api/workspace/${wsId}/execute`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          executionId: 'exec_js_test_1',
          status: 'SUCCESS',
          result: {
            executionId: 'exec_js_test_1',
            status: 'SUCCESS',
            stdout: 'Hello CodeCraft Sandbox\nResult: 42\n',
            stderr: '',
            exitCode: 0,
            durationMs: 48,
            timedOut: false,
            outputTruncated: false,
          },
        }),
      });
    });

    await page.goto(`/e2e-test?user=alice&role=contributor&ws=${wsId}&file=file-1`);
    await waitForEditor(page);

    const runBtn = page.locator('[data-testid="run-code-button"]');
    await expect(runBtn).toBeVisible({ timeout: 15000 });
    await runBtn.click();

    // Verify Success badge
    const badge = page.locator('[data-testid="output-status-badge"]');
    await expect(badge).toBeVisible({ timeout: 10000 });
    await expect(badge).toContainText('Success');
    await expect(badge).toContainText('48ms');

    // Verify terminal output container
    const outputContainer = page.locator('[data-testid="output-container"]');
    await expect(outputContainer).toContainText('Hello CodeCraft Sandbox');
    await expect(outputContainer).toContainText('Result: 42');
  });

  // TEST 2: Python Execution
  test('2. Python Execution — Executes Python script and displays stdout in terminal panel', async ({ page }) => {
    await page.route(`**/api/workspace/${wsId}/execute`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          executionId: 'exec_py_test_1',
          status: 'SUCCESS',
          result: {
            executionId: 'exec_py_test_1',
            status: 'SUCCESS',
            stdout: 'Python 3.11 Execution Completed\nSum: 100\n',
            stderr: '',
            exitCode: 0,
            durationMs: 95,
            timedOut: false,
            outputTruncated: false,
          },
        }),
      });
    });

    await page.goto(`/e2e-test?user=alice&role=contributor&ws=${wsId}&file=file-1`);
    await waitForEditor(page);

    await page.locator('[data-testid="run-code-button"]').click();

    const outputContainer = page.locator('[data-testid="output-container"]');
    await expect(outputContainer).toContainText('Python 3.11 Execution Completed');
    await expect(outputContainer).toContainText('Sum: 100');
  });

  // TEST 3: Compilation Failure Handling
  test('3. Compilation Failure — Formats and highlights compilation syntax errors', async ({ page }) => {
    await page.route(`**/api/workspace/${wsId}/execute`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          executionId: 'exec_cmp_err_1',
          status: 'COMPILEERROR',
          result: {
            executionId: 'exec_cmp_err_1',
            status: 'COMPILEERROR',
            stdout: '',
            stderr: 'main.cpp:5:3: error: expected ";" before "return"\n',
            exitCode: 1,
            durationMs: 120,
            timedOut: false,
            outputTruncated: false,
          },
        }),
      });
    });

    await page.goto(`/e2e-test?user=alice&role=contributor&ws=${wsId}&file=file-1`);
    await waitForEditor(page);

    await page.locator('[data-testid="run-code-button"]').click();

    const badge = page.locator('[data-testid="output-status-badge"]');
    await expect(badge).toBeVisible({ timeout: 10000 });
    await expect(badge).toContainText('COMPILEERROR');

    const outputContainer = page.locator('[data-testid="output-container"]');
    await expect(outputContainer).toContainText('expected ";" before "return"');
  });

  // TEST 4: Runtime Failure Handling
  test('4. Runtime Failure — Traps exceptions and displays nonzero exit code', async ({ page }) => {
    await page.route(`**/api/workspace/${wsId}/execute`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          executionId: 'exec_rt_err_1',
          status: 'RUNTIMEERROR',
          result: {
            executionId: 'exec_rt_err_1',
            status: 'RUNTIMEERROR',
            stdout: '',
            stderr: 'ZeroDivisionError: division by zero\n',
            exitCode: 1,
            durationMs: 40,
            timedOut: false,
            outputTruncated: false,
          },
        }),
      });
    });

    await page.goto(`/e2e-test?user=alice&role=contributor&ws=${wsId}&file=file-1`);
    await waitForEditor(page);

    await page.locator('[data-testid="run-code-button"]').click();

    const badge = page.locator('[data-testid="output-status-badge"]');
    await expect(badge).toBeVisible({ timeout: 10000 });
    await expect(badge).toContainText('RUNTIMEERROR');

    const outputContainer = page.locator('[data-testid="output-container"]');
    await expect(outputContainer).toContainText('ZeroDivisionError: division by zero');
  });

  // TEST 5: Timeout Enforcement Display
  test('5. Timeout Enforcement — Renders distinct Timeout badge when execution exceeds quota', async ({ page }) => {
    await page.route(`**/api/workspace/${wsId}/execute`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          executionId: 'exec_timeout_1',
          status: 'TIMEOUT',
          result: {
            executionId: 'exec_timeout_1',
            status: 'TIMEOUT',
            stdout: '',
            stderr: 'Execution timed out after 8000ms\n',
            exitCode: 124,
            durationMs: 8005,
            timedOut: true,
            outputTruncated: false,
          },
        }),
      });
    });

    await page.goto(`/e2e-test?user=alice&role=contributor&ws=${wsId}&file=file-1`);
    await waitForEditor(page);

    await page.locator('[data-testid="run-code-button"]').click();

    const badge = page.locator('[data-testid="output-status-badge"]');
    await expect(badge).toBeVisible({ timeout: 10000 });
    await expect(badge).toContainText('Timeout');
  });

  // TEST 6: Output Limit Enforcement Display
  test('6. Output Limit — Renders OUTPUTLIMIT badge when stream exceeds 1MB', async ({ page }) => {
    await page.route(`**/api/workspace/${wsId}/execute`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          executionId: 'exec_outlim_1',
          status: 'OUTPUTLIMIT',
          result: {
            executionId: 'exec_outlim_1',
            status: 'OUTPUTLIMIT',
            stdout: '[output truncated at 1MB limit]...',
            stderr: 'Warning: output stream exceeded quota\n',
            exitCode: 0,
            durationMs: 310,
            timedOut: false,
            outputTruncated: true,
          },
        }),
      });
    });

    await page.goto(`/e2e-test?user=alice&role=contributor&ws=${wsId}&file=file-1`);
    await waitForEditor(page);

    await page.locator('[data-testid="run-code-button"]').click();

    const badge = page.locator('[data-testid="output-status-badge"]');
    await expect(badge).toBeVisible({ timeout: 10000 });
    await expect(badge).toContainText('OUTPUTLIMIT');
  });

  // TEST 7: Authentication Enforcement on API
  test('7. Authentication — Server blocks unauthenticated execution with HTTP 401', async ({ request }) => {
    const res = await request.post(`/api/workspace/${wsId}/execute`, {
      data: {
        language: 'javascript',
        sourceCode: 'console.log("unauthenticated attempt")',
      },
    });

    expect(res.status()).toBe(401);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.code).toBe('UNAUTHORIZED');
  });

  // TEST 8: Authorization Enforcement on UI and API
  test('8. Authorization — Read-only Viewer role cannot execute code in UI or API', async ({ page, request }) => {
    // 1. UI Check: Viewer button is disabled
    await page.goto(`/e2e-test?user=charlie&role=viewer&ws=${wsId}&file=file-1`);
    await waitForEditor(page);

    const runBtn = page.locator('[data-testid="run-code-button"]');
    await expect(runBtn).toBeVisible({ timeout: 15000 });
    await expect(runBtn).toBeDisabled();
    await expect(runBtn).toContainText('Execution Disabled (Viewer)');

    // 2. API Check: Viewer token rejected with 403 PERMISSION_DENIED
    const res = await request.post(`/api/workspace/${wsId}/execute`, {
      headers: {
        Authorization: 'Bearer test-token-viewer:charlie',
      },
      data: {
        language: 'javascript',
        sourceCode: 'console.log("viewer bypass attempt")',
      },
    });

    expect(res.status()).toBe(403);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.code).toBe('PERMISSION_DENIED');
  });

  // TEST 9: Workspace Isolation on API
  test('9. Workspace Isolation — Execution requests validate workspace context strictly', async ({ request }) => {
    const res = await request.post(`/api/workspace/../ws-illegal/execute`, {
      headers: {
        Authorization: 'Bearer test-token-contributor:alice',
      },
      data: {
        language: 'javascript',
        sourceCode: 'console.log("traversal")',
      },
    });

    expect([400, 404]).toContain(res.status());
  });

  // TEST 10: Latest Editor State Sent on Execution
  test('10. Latest Editor State — Clicking Run dispatches current edited text, not stale initial content', async ({ page }) => {
    let capturedSource = '';
    await page.route(`**/api/workspace/${wsId}/execute`, async (route) => {
      const json = route.request().postDataJSON();
      capturedSource = json.sourceCode || json.source;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          executionId: 'exec_latest_1',
          status: 'SUCCESS',
          result: {
            executionId: 'exec_latest_1',
            status: 'SUCCESS',
            stdout: 'OK\n',
            stderr: '',
            exitCode: 0,
            durationMs: 25,
          },
        }),
      });
    });

    await page.goto(`/e2e-test?user=alice&role=contributor&ws=${wsId}&file=file-1`);
    await waitForEditor(page);

    // Edit content in Monaco
    await page.evaluate(() => {
      if (window.__codecraftEditor) {
        window.__codecraftEditor.setValue('const liveUpdate = 9999;\nconsole.log(liveUpdate);');
      }
    });

    // Click Run
    await page.locator('[data-testid="run-code-button"]').click();

    // Verify the captured source matches the modified content
    expect(capturedSource).toContain('const liveUpdate = 9999;');
    expect(capturedSource).toContain('console.log(liveUpdate);');
  });

  // TEST 11: Cancellation Workflow
  test('11. Cancellation — Stop Execution triggers cancellation and updates UI', async ({ page }) => {
    await page.route(`**/api/workspace/${wsId}/execute/exec_cancel_target/cancel`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          cancelled: true,
          executionId: 'exec_cancel_target',
          status: 'CANCELLED',
        }),
      });
    });

    await page.route(`**/api/workspace/${wsId}/execute`, async (route) => {
      await new Promise((r) => setTimeout(r, 2000));
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          executionId: 'exec_cancel_target',
          status: 'CANCELLED',
          result: {
            executionId: 'exec_cancel_target',
            status: 'CANCELLED',
            stdout: '',
            stderr: '',
            exitCode: 130,
            durationMs: 1500,
          },
        }),
      });
    });

    await page.goto(`/e2e-test?user=alice&role=contributor&ws=${wsId}&file=file-1`);
    await waitForEditor(page);

    await page.locator('[data-testid="run-code-button"]').click();

    const cancelBtn = page.locator('[data-testid="cancel-execution-button"]');
    await expect(cancelBtn).toBeVisible({ timeout: 5000 });
    await cancelBtn.click();

    const outputContainer = page.locator('[data-testid="output-container"]');
    await expect(outputContainer).toContainText('[Execution terminated by user]');
  });

  // TEST 12: Real Sandbox Offline State (Fail-Closed)
  test('12. Fail-Closed Defense — Real server returns 503 and UI displays Sandbox Offline when Docker is unavailable', async ({ page }) => {
    await page.goto(`/e2e-test?user=alice&role=contributor&ws=${wsId}&file=file-1`);
    await waitForEditor(page);

    await page.locator('[data-testid="run-code-button"]').click();

    const badge = page.locator('[data-testid="output-status-badge"]');
    await expect(badge).toBeVisible({ timeout: 15000 });
    await expect(badge).toContainText('Sandbox Offline');

    const outputContainer = page.locator('[data-testid="output-container"]');
    await expect(outputContainer).toContainText('Host execution fallback is strictly prohibited');
  });

  // TEST 13: Stdin Input Drawer & Clear Terminal
  test('13. UI Controls — Toggles stdin input drawer and clears output terminal', async ({ page }) => {
    await page.goto(`/e2e-test?user=alice&role=contributor&ws=${wsId}&file=file-1`);
    await waitForEditor(page);

    const stdinToggle = page.locator('button[title="Toggle standard input (stdin)"]');
    await expect(stdinToggle).toBeVisible();
    await stdinToggle.click();

    const stdinInput = page.locator('[data-testid="stdin-input"]');
    await expect(stdinInput).toBeVisible();
    await stdinInput.fill('user input test data');

    const clearBtn = page.locator('[data-testid="clear-output-button"]');
    await expect(clearBtn).toBeVisible();
    await clearBtn.click();

    const outputContainer = page.locator('[data-testid="output-container"]');
    await expect(outputContainer).toContainText('Click "Run Code" to execute in Docker sandbox');
  });
});
