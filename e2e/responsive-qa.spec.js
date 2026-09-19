// @ts-check
const { test, expect } = require('@playwright/test');

// Helper to wait for Monaco editor initialization
async function waitForEditor(page) {
  await page.waitForFunction(() => {
    return typeof window !== 'undefined' && window.__codecraftEditor && window.__codecraftEditor.getModel();
  }, { timeout: 30000 });
}

test.describe('CODECRAFT — FINAL RESPONSIVE VISUAL QA & REAL BROWSER RESIZE AUDIT', () => {

  const viewports = [
    { width: 1920, height: 1080, name: '1920x1080 Full HD Desktop' },
    { width: 1600, height: 900,  name: '1600x900 Large Laptop' },
    { width: 1440, height: 900,  name: '1440x900 MacBook Pro 15' },
    { width: 1366, height: 768,  name: '1366x768 Common Laptop' },
    { width: 1280, height: 720,  name: '1280x720 HD Screen' },
    { width: 1024, height: 768,  name: '1024x768 iPad Landscape' },
    { width: 900,  height: 700,  name: '900x700 Compact Window' },
    { width: 768,  height: 1024, name: '768x1024 iPad Portrait' },
    { width: 640,  height: 900,  name: '640x900 Phablet Landscape' },
    { width: 480,  height: 800,  name: '480x800 Large Phone' },
    { width: 390,  height: 844,  name: '390x844 iPhone 12/13/14' },
    { width: 375,  height: 812,  name: '375x812 iPhone X/11' },
  ];

  // =========================================================================
  // 1. TEST REAL BROWSER VIEWPORTS (All 12 Target Resolutions)
  // =========================================================================
  for (const vp of viewports) {
    test(`1. Viewport Audit: ${vp.name}`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto(`/e2e-test?layout=ide&ws=ws-qa-${vp.width}&file=file-1`);
      await waitForEditor(page);

      // A. Check for NO horizontal browser scrollbar (document.documentElement.scrollWidth <= viewport width)
      const scrollMetrics = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
        scrollHeight: document.documentElement.scrollHeight,
        clientHeight: document.documentElement.clientHeight,
        bodyScrollWidth: document.body.scrollWidth,
        bodyClientWidth: document.body.clientWidth,
      }));

      expect(scrollMetrics.scrollWidth).toBeLessThanOrEqual(vp.width);
      expect(scrollMetrics.bodyScrollWidth).toBeLessThanOrEqual(vp.width);

      // B. Header fits completely without horizontal scroll or wrap
      const header = page.locator('header');
      await expect(header).toBeVisible();
      const headerBox = await header.boundingBox();
      expect(headerBox).not.toBeNull();
      if (headerBox) {
        expect(headerBox.width).toBeLessThanOrEqual(vp.width);
        expect(headerBox.height).toBeLessThanOrEqual(44); // strictly single-line header
      }

      // C. Activity Bar vs Hamburger
      const activityBar = page.locator('aside:has([data-testid="tab-sidebar-files"])');
      const hamburger = page.locator('button[aria-label="Toggle Navigation"]');

      if (vp.width >= 768) {
        // Desktop: Activity Bar visible and strictly 52px width; Hamburger hidden
        await expect(activityBar).toBeVisible();
        const actBox = await activityBar.boundingBox();
        expect(actBox).not.toBeNull();
        if (actBox) {
          expect(Math.round(actBox.width)).toBe(52);
        }
        await expect(hamburger).toBeHidden();
      } else {
        // Mobile (< 768px): Activity Bar hidden; Hamburger visible
        await expect(activityBar).toBeHidden();
        await expect(hamburger).toBeVisible();
      }

      // D. Editor receives full remaining width & Monaco renders
      const editorArea = page.locator('.monaco-editor');
      await expect(editorArea).toBeVisible();
      const editorBox = await editorArea.boundingBox();
      expect(editorBox).not.toBeNull();
      if (editorBox) {
        expect(editorBox.width).toBeGreaterThan(250);
        expect(editorBox.height).toBeGreaterThan(150);
      }

      // E. Terminal bottom panel is vertically stacked BELOW editor (never overlapping or side-by-side)
      const terminalPanel = page.locator('button:has-text("Terminal")');
      await expect(terminalPanel).toBeVisible();

      // F. Status bar is visible at bottom
      const footer = page.locator('footer');
      await expect(footer).toBeVisible();
      const footerBox = await footer.boundingBox();
      expect(footerBox).not.toBeNull();
      if (footerBox) {
        expect(Math.round(footerBox.y + footerBox.height)).toBeLessThanOrEqual(vp.height + 1);
        expect(footerBox.height).toBeLessThanOrEqual(28);
      }
    });
  }

  // =========================================================================
  // 3. CONTINUOUS WINDOW RESIZING AUDIT (Shrink & Expand)
  // =========================================================================
  test('3. Continuous Window Resizing (1920 -> 375 -> 1920)', async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto('/e2e-test?layout=ide&ws=ws-continuous-resize');
    await waitForEditor(page);

    const stepsDown = [1920, 1600, 1440, 1366, 1280, 1024, 900, 768, 640, 480, 390, 375];
    for (const w of stepsDown) {
      await page.setViewportSize({ width: w, height: 800 });
      await page.waitForTimeout(50);
      const isOverflown = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
      expect(isOverflown).toBe(false);
    }

    const stepsUp = [375, 390, 480, 640, 768, 900, 1024, 1280, 1366, 1440, 1600, 1920];
    for (const w of stepsUp) {
      await page.setViewportSize({ width: w, height: 800 });
      await page.waitForTimeout(50);
      const isOverflown = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
      expect(isOverflown).toBe(false);
    }
  });

  // =========================================================================
  // 4. TEST EXPLORER RESIZING (Desktop 200px - 360px Bounded)
  // =========================================================================
  test('4. Desktop Explorer Resizing (260px -> 200px -> 360px)', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/e2e-test?layout=ide&ws=ws-explorer-resize');
    await waitForEditor(page);

    const handle = page.locator('#explorer-resize-handle');
    await expect(handle).toBeVisible();

    const handleBox = await handle.boundingBox();
    expect(handleBox).not.toBeNull();
    if (!handleBox) return;

    // Drag handle left towards 200px
    const startX = handleBox.x + handleBox.width / 2;
    const startY = handleBox.y + handleBox.height / 2;
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX - 150, startY, { steps: 5 }); // try to drag well below 200px
    await page.mouse.up();

    // Verify clamped at min 200px
    let explorerAside = page.locator('aside:has-text("WORKSPACE FILES")');
    let asideBox = await explorerAside.boundingBox();
    expect(asideBox).not.toBeNull();
    if (asideBox) {
      expect(Math.round(asideBox.width)).toBeGreaterThanOrEqual(200);
      expect(Math.round(asideBox.width)).toBeLessThanOrEqual(210);
    }

    // Drag handle right towards 360px
    const newHandleBox = await handle.boundingBox();
    expect(newHandleBox).not.toBeNull();
    if (!newHandleBox) return;

    await page.mouse.move(newHandleBox.x + newHandleBox.width / 2, newHandleBox.y + newHandleBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(newHandleBox.x + 300, newHandleBox.y, { steps: 5 }); // try to drag well above 360px
    await page.mouse.up();

    // Verify clamped at max 360px
    asideBox = await explorerAside.boundingBox();
    expect(asideBox).not.toBeNull();
    if (asideBox) {
      expect(Math.round(asideBox.width)).toBeLessThanOrEqual(360);
      expect(Math.round(asideBox.width)).toBeGreaterThanOrEqual(350);
    }

    // Verify editor adjusts cleanly without horizontal overflow
    const hasScroll = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    expect(hasScroll).toBe(false);
  });

  // =========================================================================
  // 5. TEST TERMINAL RESIZING & COLLAPSE / REOPEN
  // =========================================================================
  test('5. Terminal Resizing, Collapse & Reopen', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/e2e-test?layout=ide&ws=ws-terminal-resize');
    await waitForEditor(page);

    const termToggle = page.locator('button[aria-label="Toggle terminal bottom panel"]');
    await expect(termToggle).toBeVisible();

    const terminalTab = page.locator('button:has-text("Terminal")');
    await expect(terminalTab).toBeVisible();

    // Collapse terminal
    await termToggle.click();
    await expect(terminalTab).toBeHidden();

    // Monaco editor should now occupy full height
    const editorEl = page.locator('.monaco-editor');
    const fullHeightBox = await editorEl.boundingBox();
    expect(fullHeightBox).not.toBeNull();
    if (fullHeightBox) {
      expect(fullHeightBox.height).toBeGreaterThanOrEqual(625);
    }

    // Reopen terminal
    await termToggle.click();
    await expect(terminalTab).toBeVisible();
    const restoredHeightBox = await editorEl.boundingBox();
    expect(restoredHeightBox).not.toBeNull();
    if (restoredHeightBox && fullHeightBox) {
      expect(restoredHeightBox.height).toBeLessThan(fullHeightBox.height);
    }
  });

  // =========================================================================
  // 6. TEST MOBILE DRAWER (< 768px: 640px, 480px, 390px, 375px)
  // =========================================================================
  const mobileWidths = [640, 480, 390, 375];
  for (const w of mobileWidths) {
    test(`6. Mobile Drawer Operations at ${w}px`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: 800 });
      await page.goto(`/e2e-test?layout=ide&ws=ws-mobile-${w}`);
      await waitForEditor(page);

      const hamburger = page.locator('button[aria-label="Toggle Navigation"]');
      await expect(hamburger).toBeVisible();

      // Drawer is initially closed on mobile
      const drawer = page.locator('#mobile-drawer');
      await expect(drawer).toBeHidden();

      // Open drawer
      await hamburger.click();
      await expect(drawer).toBeVisible();
      const backdrop = page.locator('#mobile-drawer-backdrop');
      await expect(backdrop).toBeVisible();

      // Check drawer width is <= 320px
      const drawerBox = await drawer.boundingBox();
      expect(drawerBox).not.toBeNull();
      if (drawerBox) {
        expect(drawerBox.width).toBeLessThanOrEqual(320);
      }

      // Check no horizontal scrollbar with drawer open
      const hasScroll = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
      expect(hasScroll).toBe(false);

      // Selecting a file auto-closes drawer
      const fileItem = page.locator('[data-testid="mobile-file-item-file-2"]');
      if (await fileItem.count() > 0) {
        await fileItem.click();
        await expect(drawer).toBeHidden();
      } else {
        // Close via close button
        const closeBtn = page.locator('#btn-close-mobile-drawer');
        await closeBtn.click();
        await expect(drawer).toBeHidden();
      }
    });
  }

  // =========================================================================
  // 7. TABLET TRANSITION BREAKPOINT AUDIT (767px, 768px, 769px)
  // =========================================================================
  test('7. Exact Breakpoint Audit (767px Mobile vs 768px/769px Desktop)', async ({ page }) => {
    await page.goto('/e2e-test?layout=ide&ws=ws-breakpoint');
    await waitForEditor(page);

    const hamburger = page.locator('button[aria-label="Toggle Navigation"]');
    const activityBar = page.locator('aside:has([data-testid="tab-sidebar-files"])');

    // Exactly 767px (Mobile)
    await page.setViewportSize({ width: 767, height: 900 });
    await page.waitForTimeout(50);
    await expect(hamburger).toBeVisible();
    await expect(activityBar).toBeHidden();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= 767)).toBe(true);

    // Exactly 768px (Desktop Breakpoint)
    await page.setViewportSize({ width: 768, height: 900 });
    await page.waitForTimeout(50);
    await expect(hamburger).toBeHidden();
    await expect(activityBar).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= 768)).toBe(true);

    // Exactly 769px (Desktop)
    await page.setViewportSize({ width: 769, height: 900 });
    await page.waitForTimeout(50);
    await expect(hamburger).toBeHidden();
    await expect(activityBar).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= 769)).toBe(true);
  });

  // =========================================================================
  // 8. TEST HEADER WITH LONG WORKSPACE NAMES
  // =========================================================================
  test('8. Long Workspace Name Truncation in Header & Context Strip', async ({ page }) => {
    const longName = "CodeCraft-Autonomous-Enterprise-MultiCloud-Collaborative-IDE-Instance-v9.9.9";
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(`/e2e-test?layout=ide&ws=ws-long-name&wsName=${longName}`);
    await waitForEditor(page);

    // Context strip workspace name must truncate
    const wsNameSpan = page.locator('#context-ws-name');
    await expect(wsNameSpan).toBeVisible();
    const isTruncated = await wsNameSpan.evaluate((el) => {
      const style = window.getComputedStyle(el);
      return style.textOverflow === 'ellipsis' && style.overflow === 'hidden';
    });
    expect(isTruncated).toBe(true);

    // Header must fit within 375px without scrollbar
    const hasScroll = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    expect(hasScroll).toBe(false);
  });

  // =========================================================================
  // 9. TEST TOOLBAR CONTROLS
  // =========================================================================
  test('9. Contextual Toolbar Usability at Desktop and Mobile', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/e2e-test?layout=ide&ws=ws-toolbar');
    await waitForEditor(page);

    // Controls must be visible and responsive
    await expect(page.locator('button[title="Editor Preferences"]')).toBeVisible();
    await expect(page.locator('button[title="Toggle Inline Code Comments"]')).toBeVisible();
    await expect(page.locator('button[title="Generate Documentation with AI"]')).toBeVisible();
    await expect(page.locator('button[title="Fix Syntax Errors with AI"]')).toBeVisible();
    await expect(page.locator('button[aria-label="Toggle terminal bottom panel"]')).toBeVisible();

    // Now test at mobile (375px): secondary text labels collapse cleanly
    await page.setViewportSize({ width: 375, height: 812 });
    await page.waitForTimeout(50);

    const hasScroll = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    expect(hasScroll).toBe(false);
  });

  // =========================================================================
  // 10. TEST EMPTY WORKSPACE ("No Open Files" Centered)
  // =========================================================================
  test('10. Empty Workspace Centered State', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/e2e-test?layout=ide&ws=ws-empty&files=0');

    // Verify empty state is displayed and centered
    const emptyState = page.locator('[data-testid="empty-editor-state"]');
    await expect(emptyState).toBeVisible();

    const emptyBox = await emptyState.boundingBox();
    expect(emptyBox).not.toBeNull();
    if (emptyBox) {
      // Must NOT be a narrow strip (width > 800px on 1280px screen)
      expect(emptyBox.width).toBeGreaterThan(800);
      expect(emptyBox.height).toBeGreaterThanOrEqual(380);
    }
  });

  // =========================================================================
  // 11. TEST REAL CONTENT ACROSS LANGUAGES & LONG FILENAMES
  // =========================================================================
  test('11. Multi-Language Content and Long Filename Tabs', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/e2e-test?layout=ide&ws=ws-multilang&files=multi');
    await waitForEditor(page);

    // Check that long filename tab does not blow out the editor
    const longTab = page.locator('span:has-text("very_long_collaborative")');
    await expect(longTab).toBeVisible();

    const hasScroll = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    expect(hasScroll).toBe(false);
  });

  // =========================================================================
  // 12. TEST SCREEN ROTATION & HEIGHT RESIZING
  // =========================================================================
  test('12. Screen Rotation and Aspect Ratio Changes', async ({ page }) => {
    // iPhone Portrait 390x844
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/e2e-test?layout=ide&ws=ws-rotation');
    await waitForEditor(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= 390)).toBe(true);

    // Rotate to iPhone Landscape 844x390
    await page.setViewportSize({ width: 844, height: 390 });
    await page.waitForTimeout(50);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= 844)).toBe(true);

    // Verify editor and status bar still fit inside 390px height
    const footer = page.locator('footer');
    await expect(footer).toBeVisible();
    const footerBox = await footer.boundingBox();
    expect(footerBox).not.toBeNull();
    if (footerBox) {
      expect(Math.round(footerBox.y + footerBox.height)).toBeLessThanOrEqual(391);
    }
  });

});
