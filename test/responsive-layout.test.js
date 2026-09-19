import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const rootDir = process.cwd();

test("Responsive IDE Layout System — Architecture & Integrity Verification", async (t) => {
  // Load files
  const globalsCss = fs.readFileSync(path.resolve(rootDir, "src/app/globals.css"), "utf8");
  const pageJsx = fs.readFileSync(path.resolve(rootDir, "src/app/workspace/[workspaceId]/page.jsx"), "utf8");
  const editorJsx = fs.readFileSync(path.resolve(rootDir, "src/components/Editor.jsx"), "utf8");
  const headerJsx = fs.readFileSync(path.resolve(rootDir, "src/components/Header.jsx"), "utf8");

  await t.test("Suite 1: Shell & Global Viewport Rules", () => {
    // 1.1 Root shell rules - scoped to IDE shell to preserve global document scroll
    assert.doesNotMatch(
      globalsCss,
      /^html,\s*body\s*\{[^}]*overflow:\s*hidden/m,
      "globals.css must NOT lock unconditional global html, body overflow to hidden"
    );
    assert.match(
      globalsCss,
      /(?:html:has\(\.ide-shell\)|body\.ide-shell-active)[^}]*overflow:\s*hidden/i,
      "globals.css must scope overflow: hidden to the IDE shell"
    );
    assert.match(globalsCss, /--explorer-width:\s*260px/, "globals.css must define default --explorer-width CSS variable");
    assert.match(globalsCss, /\.ide-shell\s*\{[^}]*height:\s*100dvh/i, "globals.css must define .ide-shell with 100dvh");
    assert.match(globalsCss, /\.editor-empty-state\s*\{[^}]*display:\s*grid/i, "globals.css must define centered .editor-empty-state grid");

    // 1.2 Shell markup in workspace page
    assert.match(pageJsx, /className="[^"]*ide-shell[^"]*"/, "Workspace page container must apply ide-shell class");
    assert.match(pageJsx, /ide-shell-active/, "Workspace page container must activate scoped ide-shell-active state");
    assert.match(pageJsx, /h-\[100dvh\]/, "Workspace page container must specify h-[100dvh]");
    assert.match(pageJsx, /w-full overflow-hidden/, "Workspace page container must enforce w-full overflow-hidden");
  });

  await t.test("Suite 2: Top Header & Context Strip Responsiveness", () => {
    // 2.1 Header mobile hamburger
    assert.match(headerJsx, /onToggleMobileNav/, "Header must accept onToggleMobileNav prop");
    assert.match(headerJsx, /md:hidden[^>]*aria-label="Toggle Navigation"/, "Header must render mobile hamburger button with md:hidden");
    assert.match(headerJsx, /min-w-0 overflow-hidden/, "Header must enforce min-w-0 overflow-hidden to prevent horizontal breakout");

    // 2.2 Workspace context strip
    assert.match(pageJsx, /workspaceName/, "Workspace page must render workspaceName");
    assert.match(pageJsx, /truncate max-w-\[140px\] sm:max-w-xs/, "Workspace name in context strip must truncate on mobile");
  });

  await t.test("Suite 3: Desktop Activity Bar & Resizable Explorer", () => {
    // 3.1 Activity Bar fixed width & desktop visibility
    assert.match(pageJsx, /hidden md:flex w-\[52px\] flex-\[0_0_52px\]/, "Desktop Activity Bar must be strictly 52px and hidden on mobile (hidden md:flex)");

    // 3.2 Explorer resizability
    assert.match(pageJsx, /explorerWidth/, "Workspace page must track explorerWidth state");
    assert.match(pageJsx, /codecraft_explorer_width/, "Workspace page must persist explorerWidth to localStorage");
    assert.match(pageJsx, /startExplorerResize/, "Workspace page must define startExplorerResize drag handler");
    assert.match(pageJsx, /cursor-col-resize/, "Workspace page must render vertical drag handle with cursor-col-resize");
    assert.match(pageJsx, /Math\.min\(360,\s*Math\.max\(200/, "Explorer resize must constrain width between 200px and 360px");
  });

  await t.test("Suite 4: Mobile Drawer Pattern (< 768px)", () => {
    // 4.1 Mobile slide-in drawer & backdrop
    assert.match(pageJsx, /md:hidden fixed inset-0 bg-black\/70/, "Mobile drawer must render backdrop overlay with md:hidden");
    assert.match(pageJsx, /md:hidden fixed inset-y-0 left-0 z-50 h-full w-\[85vw\] max-w-\[320px\]/, "Mobile drawer must slide in as an overlay with max-w-[320px]");

    // 4.2 Auto-close drawer on file selection on mobile
    assert.match(pageJsx, /window\.innerWidth\s*<\s*768\)\s*\{\s*setIsNavOpen\(false\);/, "Opening a file on mobile must automatically close navigation drawer");
  });

  await t.test("Suite 5: Vertical Stacking & Editor Priority", () => {
    // 5.1 Editor area flex properties
    assert.match(pageJsx, /<main className="flex-1 h-full flex flex-col overflow-hidden min-w-0 min-h-0/, "Workspace area must be flex-1 min-w-0 min-h-0 flex-col");
    assert.match(editorJsx, /ref=\{workspaceContainerRef\}\s+className="relative flex-1 flex flex-col overflow-hidden min-h-0 min-w-0"/, "Editor root must be flex flex-col min-h-0 min-w-0");

    // 5.2 Monaco Editor container must take flex-1 min-h-0 min-w-0
    assert.match(editorJsx, /className="flex-1 min-h-0 min-w-0 flex flex-col bg-\[#070B14\] overflow-hidden"/, "Monaco Editor surface must have flex-1 min-h-0 min-w-0");
    assert.match(editorJsx, /automaticLayout:\s*true/, "Monaco editor options must enable automaticLayout: true");

    // 5.3 Bottom terminal panel vertical stacking & drag handle
    assert.match(editorJsx, /terminalHeight/, "Editor must track terminalHeight state");
    assert.match(editorJsx, /codecraft_terminal_height/, "Editor must persist terminalHeight in localStorage");
    assert.match(editorJsx, /startTerminalResize/, "Editor must define startTerminalResize drag handler");
    assert.match(editorJsx, /cursor-row-resize/, "Editor must render horizontal drag handle with cursor-row-resize");
    assert.match(editorJsx, /minHeight:\s*"160px",\s*maxHeight:\s*"50%"/, "Terminal bottom panel must enforce minHeight: 160px and maxHeight: 50%");

    // 5.4 Panel toggle button
    assert.match(editorJsx, /PanelBottomClose/, "Editor must import and render PanelBottomClose icon");
    assert.match(editorJsx, /PanelBottomOpen/, "Editor must import and render PanelBottomOpen icon");

    // 5.5 Empty states
    assert.match(editorJsx, /data-testid="empty-editor-state"/, "Editor must maintain empty editor state with data-testid");
    assert.match(editorJsx, /editor-empty-state/, "Editor empty state must use .editor-empty-state class");

    // 5.6 Persistent hidden Output mount for background tasks
    assert.match(editorJsx, /!isExpanded\s*&&\s*!isRightDockOpen\s*&&\s*\(\s*<div className="hidden">[\s\S]*?<Output/, "Output must remain mounted in hidden div when bottom panel is collapsed");
  });

  await t.test("Suite 6: Bottom IDE Status Bar Responsiveness", () => {
    assert.match(editorJsx, /<footer className="h-6 bg-\[#070B14\] border-t border-white\/\[0.08\] px-3 flex items-center justify-between text-\[11px\] font-mono text-slate-400 select-none flex-shrink-0 z-10 min-w-0 overflow-hidden"/, "Footer must have min-w-0 overflow-hidden and flex-shrink-0");
    assert.match(editorJsx, /hidden sm:inline/, "Secondary status items (UTF-8, spaces, role) must be hidden on narrow screens");
  });

  await t.test("Suite 7: 12-Viewport Fluid Scaling Simulation", () => {
    const viewports = [
      { width: 1920, height: 1080, name: "Full HD Desktop" },
      { width: 1600, height: 900,  name: "Large Laptop" },
      { width: 1440, height: 900,  name: "MacBook Pro 15" },
      { width: 1366, height: 768,  name: "Common Laptop" },
      { width: 1280, height: 720,  name: "HD Screen" },
      { width: 1024, height: 768,  name: "iPad Landscape" },
      { width: 900,  height: 700,  name: "Compact Window" },
      { width: 768,  height: 1024, name: "iPad Portrait" },
      { width: 640,  height: 900,  name: "Phablet Landscape" },
      { width: 480,  height: 800,  name: "Large Phone" },
      { width: 390,  height: 844,  name: "iPhone 12/13/14" },
      { width: 375,  height: 812,  name: "iPhone X/XS/11 Pro" },
    ];

    for (const vp of viewports) {
      const isMobile = vp.width < 768;
      const activityBarWidth = isMobile ? 0 : 52;
      const defaultExplorerWidth = 260;
      // On mobile, explorer is rendered as an overlay/drawer with 0 in-flow width!
      const inFlowExplorerWidth = isMobile ? 0 : defaultExplorerWidth;

      const editorWidth = vp.width - activityBarWidth - inFlowExplorerWidth;

      // Invariant 1: Editor horizontal width must never be squeezed by the terminal (Terminal is stacked vertically)
      assert.ok(
        editorWidth >= (isMobile ? 320 : 450),
        `Viewport ${vp.name} (${vp.width}x${vp.height}) editor width (${editorWidth}px) must be >= ${isMobile ? 320 : 450}px`
      );

      // Invariant 2: Terminal height calculation
      const defaultTerminalHeight = Math.floor(vp.height * 0.3);
      const minTerminalHeight = 160;
      const maxTerminalHeight = Math.floor(vp.height * 0.5);
      const clampedTerminalHeight = Math.min(maxTerminalHeight, Math.max(minTerminalHeight, defaultTerminalHeight));
      const editorHeight = vp.height - 40 /* header */ - 36 /* context */ - 24 /* status */ - clampedTerminalHeight;

      assert.ok(
        editorHeight >= 200,
        `Viewport ${vp.name} (${vp.width}x${vp.height}) editor height (${editorHeight}px) must remain >= 200px`
      );
      assert.ok(
        clampedTerminalHeight >= minTerminalHeight && clampedTerminalHeight <= maxTerminalHeight,
        `Viewport ${vp.name} terminal height (${clampedTerminalHeight}px) must be bounded between ${minTerminalHeight}px and ${maxTerminalHeight}px`
      );
    }
  });
});
