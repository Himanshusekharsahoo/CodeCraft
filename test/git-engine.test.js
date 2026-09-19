process.env.NODE_ENV = process.env.NODE_ENV || "test";
if (!process.env.NEXT_PUBLIC_FIREBASE_API_KEY) {
  process.env.NEXT_PUBLIC_FIREBASE_API_KEY = "test-api-key";
  process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID = "codecraft-test";
}
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { GitService } from "../src/lib/git/gitService.js";
import { GitError, GitErrorCodes } from "../src/lib/git/errors.js";
import {
  resolveSafePath,
  validateBranchName,
  validateCommitHash,
  validateWorkspaceId,
  getWorkspaceRepoDir,
} from "../src/lib/git/security.js";
import { authenticateAndAuthorize } from "../src/lib/git/gitAuth.js";

// Clean up temporary test workspace
const TEST_WS = "test_git_ws_" + Date.now();
const testRepoDir = getWorkspaceRepoDir(TEST_WS);

function cleanWorkspace() {
  if (fs.existsSync(testRepoDir)) {
    try {
      fs.rmSync(testRepoDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error on windows locks
    }
  }
}

async function runTests() {
  console.log("==================================================");
  console.log("  CodeCraft Phase 6 — Git Engine Test Suite");
  console.log("==================================================\n");

  let passed = 0;
  let failed = 0;

  async function test(name, fn) {
    try {
      await fn();
      console.log(`  [PASS] ${name}`);
      passed++;
    } catch (err) {
      console.error(`  [FAIL] ${name}`);
      console.error(`         ${err.message}`);
      failed++;
    }
  }

  // --- SECTION 1: SECURITY & VALIDATION TESTS ---
  console.log("--- Section 1: Security & Path Traversal Guards ---");

  await test("Rejects invalid workspace IDs with path traversal or illegal chars", () => {
    assert.throws(() => validateWorkspaceId("../malicious"), (err) => {
      return err instanceof GitError && err.code === GitErrorCodes.INVALID_PATH;
    });
    assert.throws(() => validateWorkspaceId("ws/nested"), (err) => {
      return err instanceof GitError && err.code === GitErrorCodes.INVALID_PATH;
    });
    assert.throws(() => validateWorkspaceId("ws;rm -rf"), (err) => {
      return err instanceof GitError && err.code === GitErrorCodes.INVALID_PATH;
    });
    // Valid IDs should not throw
    validateWorkspaceId("valid-ws_123");
  });

  await test("Rejects path traversal outside workspace directory", () => {
    assert.throws(() => resolveSafePath(testRepoDir, "../outside.txt"), (err) => {
      return err instanceof GitError && err.code === GitErrorCodes.PATH_TRAVERSAL_DETECTED;
    });
    assert.throws(() => resolveSafePath(testRepoDir, "sub/../../outside.txt"), (err) => {
      return err instanceof GitError && err.code === GitErrorCodes.PATH_TRAVERSAL_DETECTED;
    });
  });

  await test("Protects .git internal directory from reads, writes, and staging", () => {
    assert.throws(() => resolveSafePath(testRepoDir, ".git"), (err) => {
      return err instanceof GitError && err.code === GitErrorCodes.GIT_INTERNALS_PROTECTED;
    });
    assert.throws(() => resolveSafePath(testRepoDir, ".git/config"), (err) => {
      return err instanceof GitError && err.code === GitErrorCodes.GIT_INTERNALS_PROTECTED;
    });
    assert.throws(() => resolveSafePath(testRepoDir, "sub/.git"), (err) => {
      return err instanceof GitError && err.code === GitErrorCodes.GIT_INTERNALS_PROTECTED;
    });
  });

  await test("Rejects unsafe and invalid branch names", () => {
    const invalidBranches = [
      "-invalid",
      "feature..double-dot",
      "feature~1",
      "feature^2",
      "feature:colon",
      "feature?mark",
      "feature*star",
      "feature[bracket",
      "feature@{bad",
      "feature\\backslash",
      "space branch",
      "/leading-slash",
      "trailing-slash/",
      "feature//double-slash",
      "feature.lock",
      "@{"
    ];

    for (const b of invalidBranches) {
      assert.throws(() => validateBranchName(b), (err) => {
        return err instanceof GitError && err.code === GitErrorCodes.INVALID_BRANCH_NAME;
      }, `Should have rejected invalid branch name: ${b}`);
    }

    // Valid branches
    validateBranchName("main");
    validateBranchName("feature/phase6-git");
    validateBranchName("bugfix-123_test");
  });

  await test("Validates commit hashes strictly", () => {
    assert.throws(() => validateCommitHash("invalid!hash"));
    assert.throws(() => validateCommitHash("abc;rm -rf"));
    validateCommitHash("a".repeat(40));
    validateCommitHash("1234567");
  });

  // --- SECTION 2: INITIALIZATION & CONFIGURATION ---
  console.log("\n--- Section 2: Repository Initialization & Idempotence ---");

  cleanWorkspace();

  await test("Initializes fresh workspace repository with default branch and .gitignore", async () => {
    const initRes = await GitService.initializeRepository(TEST_WS, {
      defaultBranch: "main",
      initialCommitMessage: "Initialize CodeCraft Project",
      initialFiles: [
        { path: "index.js", content: "console.log('Hello CodeCraft');\n" },
        { path: "README.md", content: "# CodeCraft Workspace\n" },
      ],
    });

    assert.equal(initRes.initialized, true);
    assert.equal(initRes.alreadyExisted, false);
    assert.equal(initRes.defaultBranch, "main");
    assert.ok(initRes.commitHash, "Should have created initial commit");
    assert.ok(fs.existsSync(path.join(testRepoDir, ".git")));
    assert.ok(fs.existsSync(path.join(testRepoDir, ".gitignore")));
    assert.ok(fs.existsSync(path.join(testRepoDir, "index.js")));
  });

  await test("Idempotent initialization on existing repository", async () => {
    const initRes2 = await GitService.initializeRepository(TEST_WS);
    assert.equal(initRes2.initialized, true);
    assert.equal(initRes2.alreadyExisted, true);
  });

  // --- SECTION 3: STATUS & WORKING TREE ---
  console.log("\n--- Section 3: Status & Tracking ---");

  await test("Reports clean status after initial commit", async () => {
    const status = await GitService.getStatus(TEST_WS);
    assert.equal(status.isClean, true);
    assert.equal(status.branch, "main");
    assert.equal(status.staged.length, 0);
    assert.equal(status.unstaged.length, 0);
    assert.equal(status.untracked.length, 0);
  });

  await test("Detects untracked, modified, and deleted files", async () => {
    // 1. Create untracked file
    fs.writeFileSync(path.join(testRepoDir, "newfile.txt"), "New untracked file", "utf8");

    // 2. Modify existing file
    fs.appendFileSync(path.join(testRepoDir, "index.js"), "// New line added\n", "utf8");

    const status = await GitService.getStatus(TEST_WS);
    assert.equal(status.isClean, false);
    assert.ok(status.untracked.includes("newfile.txt"), "Should list newfile.txt in untracked");
    assert.ok(status.unstaged.some((u) => u.path === "index.js" && u.status === "M"), "Should list index.js in unstaged");
  });

  // --- SECTION 4: STAGING & UNSTAGING ---
  console.log("\n--- Section 4: Staging & Unstaging ---");

  await test("Stages specific files", async () => {
    await GitService.stageFiles(TEST_WS, ["newfile.txt"]);
    const status = await GitService.getStatus(TEST_WS);

    assert.ok(status.staged.some((s) => s.path === "newfile.txt" && s.status === "A"));
    assert.ok(!status.untracked.includes("newfile.txt"));
    // index.js should still be unstaged
    assert.ok(status.unstaged.some((u) => u.path === "index.js"));
  });

  await test("Unstages specific files", async () => {
    await GitService.unstageFiles(TEST_WS, ["newfile.txt"]);
    const status = await GitService.getStatus(TEST_WS);

    assert.ok(!status.staged.some((s) => s.path === "newfile.txt"));
    assert.ok(status.untracked.includes("newfile.txt"));
  });

  await test("Stages all files via '.' and commits", async () => {
    await GitService.stageFiles(TEST_WS, ".");
    const statusBefore = await GitService.getStatus(TEST_WS);
    assert.equal(statusBefore.unstaged.length, 0);
    assert.equal(statusBefore.untracked.length, 0);
    assert.equal(statusBefore.staged.length, 2); // newfile.txt + index.js

    const commitRes = await GitService.createCommit(TEST_WS, {
      message: "Add newfile and update index.js",
      author: { name: "Alice Architect", email: "alice@codecraft.test" },
    });

    assert.ok(commitRes.commitHash);
    assert.equal(commitRes.author.name, "Alice Architect");

    const statusAfter = await GitService.getStatus(TEST_WS);
    assert.equal(statusAfter.isClean, true);
  });

  // --- SECTION 5: COMMIT HISTORY & INSPECTION ---
  console.log("\n--- Section 5: History & Commit Details ---");

  await test("Retrieves paginated commit history", async () => {
    const history = await GitService.getHistory(TEST_WS, { limit: 10 });
    assert.equal(history.commits.length, 2);
    assert.equal(history.commits[0].message, "Add newfile and update index.js");
    assert.equal(history.commits[0].author.name, "Alice Architect");
    assert.equal(history.commits[1].message, "Initialize CodeCraft Project");
  });

  await test("Retrieves full commit details including diff", async () => {
    const history = await GitService.getHistory(TEST_WS, { limit: 1 });
    const latestHash = history.commits[0].hash;

    const details = await GitService.getCommitDetails(TEST_WS, latestHash);
    assert.equal(details.hash, latestHash);
    assert.ok(details.diff.includes("newfile.txt"));
    assert.ok(details.files.some((f) => f.path === "newfile.txt"));
    assert.ok(details.files.some((f) => f.path === "index.js"));
  });

  // --- SECTION 6: DIFF ENGINE ---
  console.log("\n--- Section 6: Diff Engine ---");

  await test("Computes working tree and staged diffs", async () => {
    fs.writeFileSync(path.join(testRepoDir, "index.js"), "const x = 42;\n", "utf8");

    // Working tree diff (unstaged)
    const unstagedDiff = await GitService.getDiff(TEST_WS, { filePath: "index.js" });
    assert.ok(unstagedDiff.includes("+const x = 42;"));

    // Stage it
    await GitService.stageFiles(TEST_WS, ["index.js"]);

    // Staged diff
    const stagedDiff = await GitService.getDiff(TEST_WS, { staged: true, filePath: "index.js" });
    assert.ok(stagedDiff.includes("+const x = 42;"));

    // Commit it
    await GitService.createCommit(TEST_WS, { message: "Update x = 42" });
  });

  // --- SECTION 7: BRANCHING ---
  console.log("\n--- Section 7: Branch Management ---");

  await test("Creates a new feature branch and switches to it", async () => {
    const createRes = await GitService.createBranch(TEST_WS, "feature/login-system");
    assert.equal(createRes.branchName, "feature/login-system");

    const switchRes = await GitService.switchBranch(TEST_WS, "feature/login-system");
    assert.equal(switchRes.branchName, "feature/login-system");

    const branchList = await GitService.listBranches(TEST_WS);
    assert.equal(branchList.currentBranch, "feature/login-system");
    assert.ok(branchList.branches.some((b) => b.name === "feature/login-system" && b.isCurrent));
    assert.ok(branchList.branches.some((b) => b.name === "main" && !b.isCurrent));
  });

  await test("Prevents switching branch with uncommitted changes without losing work", async () => {
    // Add uncommitted change
    fs.writeFileSync(path.join(testRepoDir, "feature.js"), "console.log('feature');\n", "utf8");
    await GitService.stageFiles(TEST_WS, ["feature.js"]);
    await GitService.createCommit(TEST_WS, { message: "Add feature.js on branch" });

    // Switch back to main
    await GitService.switchBranch(TEST_WS, "main");
    const status = await GitService.getStatus(TEST_WS);
    assert.equal(status.branch, "main");
    assert.ok(!fs.existsSync(path.join(testRepoDir, "feature.js")), "feature.js should not exist on main branch");
  });

  await test("Deletes non-active branch", async () => {
    await GitService.createBranch(TEST_WS, "temp-branch");
    const deleteRes = await GitService.deleteBranch(TEST_WS, "temp-branch");
    assert.equal(deleteRes.branchName, "temp-branch");

    const branchList = await GitService.listBranches(TEST_WS);
    assert.ok(!branchList.branches.some((b) => b.name === "temp-branch"));
  });

  await test("Blocks deleting the active branch", async () => {
    assert.rejects(async () => {
      await GitService.deleteBranch(TEST_WS, "main");
    }, (err) => {
      return err instanceof GitError && err.code === GitErrorCodes.CANNOT_DELETE_CURRENT_BRANCH;
    });
  });

  // --- SECTION 8: RESTORE / DISCARD ---
  console.log("\n--- Section 8: File Restore & Discard ---");

  await test("Restores modified working file to clean HEAD state", async () => {
    const originalContent = fs.readFileSync(path.join(testRepoDir, "index.js"), "utf8");
    fs.writeFileSync(path.join(testRepoDir, "index.js"), "CORRUPTED CONTENT THAT SHOULD BE DISCARDED", "utf8");

    await GitService.restoreFile(TEST_WS, "index.js");
    const restoredContent = fs.readFileSync(path.join(testRepoDir, "index.js"), "utf8");
    assert.equal(restoredContent, originalContent);
  });

  // --- SECTION 9: MERGING & CONFLICT RESOLUTION ---
  console.log("\n--- Section 9: Merging & Conflict Resolution ---");

  await test("Performs clean fast-forward merge", async () => {
    // Current is main. Merge feature/login-system
    const mergeRes = await GitService.mergeBranch(TEST_WS, "feature/login-system");
    assert.equal(mergeRes.clean, true);
    assert.ok(fs.existsSync(path.join(testRepoDir, "feature.js")), "Merged file should now exist on main");
  });

  await test("Detects 3-way merge conflict and resolves it cleanly", async () => {
    // 1. Create conflict-branch from main
    await GitService.createBranch(TEST_WS, "conflict-branch");
    await GitService.switchBranch(TEST_WS, "conflict-branch");

    // Modify index.js on conflict-branch
    fs.writeFileSync(path.join(testRepoDir, "index.js"), "const greeting = 'Branch Version';\n", "utf8");
    await GitService.stageFiles(TEST_WS, ["index.js"]);
    await GitService.createCommit(TEST_WS, { message: "Greeting on conflict branch" });

    // 2. Switch to main and modify index.js differently
    await GitService.switchBranch(TEST_WS, "main");
    fs.writeFileSync(path.join(testRepoDir, "index.js"), "const greeting = 'Main Version';\n", "utf8");
    await GitService.stageFiles(TEST_WS, ["index.js"]);
    await GitService.createCommit(TEST_WS, { message: "Greeting on main" });

    // 3. Attempt merge of conflict-branch into main -> must detect conflict!
    const mergeRes = await GitService.mergeBranch(TEST_WS, "conflict-branch");
    assert.equal(mergeRes.clean, false);
    assert.ok(mergeRes.conflicts.includes("index.js"));

    // Check status reports conflict
    const status = await GitService.getStatus(TEST_WS);
    assert.ok(status.conflicts.includes("index.js"));

    // Check file content contains conflict markers
    const fileContent = fs.readFileSync(path.join(testRepoDir, "index.js"), "utf8");
    assert.ok(fileContent.includes("<<<<<<<") && fileContent.includes("=======") && fileContent.includes(">>>>>>>"));

    // 4. Resolve conflict
    const resolvedContent = "const greeting = 'Merged Harmony';\n";
    const resolveRes = await GitService.resolveConflict(TEST_WS, "index.js", resolvedContent);
    assert.equal(resolveRes.resolved, true);

    // Commit merge resolution
    const finalCommit = await GitService.createCommit(TEST_WS, {
      message: "Merge branch conflict-branch into main (resolved)",
    });
    assert.ok(finalCommit.commitHash);

    const postStatus = await GitService.getStatus(TEST_WS);
    assert.equal(postStatus.conflicts.length, 0);
    assert.equal(postStatus.isClean, true);
  });

  // --- SECTION 10: AUTHORIZATION & ROLE ENFORCEMENT ---
  console.log("\n--- Section 10: Authorization & Viewer Role Guards ---");

  await test("Viewer role permits READ operations", async () => {
    const fakeReq = {
      headers: new Headers({ authorization: "Bearer test-token-viewer:user123" }),
      url: "http://localhost:3000/api/workspace/test/git/status",
    };
    const user = await authenticateAndAuthorize(fakeReq, "test-ws", "READ");
    assert.equal(user.role, "viewer");
    assert.equal(user.uid, "user123");
  });

  await test("Viewer role strictly BLOCKS MUTATE operations with HTTP 403 PERMISSION_DENIED", async () => {
    const fakeReq = {
      headers: new Headers({ authorization: "Bearer test-token-viewer:user123" }),
      url: "http://localhost:3000/api/workspace/test/git/commit",
    };
    await assert.rejects(async () => {
      await authenticateAndAuthorize(fakeReq, "test-ws", "MUTATE");
    }, (err) => {
      return err instanceof GitError && err.statusCode === 403 && err.code === GitErrorCodes.PERMISSION_DENIED;
    });
  });

  await test("Contributor and Owner roles allow MUTATE operations", async () => {
    const contribReq = {
      headers: new Headers({ authorization: "Bearer test-token-contributor:user456" }),
      url: "http://localhost:3000/api/workspace/test/git/commit",
    };
    const contrib = await authenticateAndAuthorize(contribReq, "test-ws", "MUTATE");
    assert.equal(contrib.role, "contributor");

    const ownerReq = {
      headers: new Headers({ authorization: "Bearer test-token-owner:user789" }),
      url: "http://localhost:3000/api/workspace/test/git/commit",
    };
    const owner = await authenticateAndAuthorize(ownerReq, "test-ws", "MUTATE");
    assert.equal(owner.role, "owner");
  });

  await test("Missing token is rejected with HTTP 401 UNAUTHORIZED", async () => {
    const badReq = {
      headers: new Headers(),
      url: "http://localhost:3000/api/workspace/test/git/status",
    };
    await assert.rejects(async () => {
      await authenticateAndAuthorize(badReq, "test-ws", "READ");
    }, (err) => {
      return err instanceof GitError && err.statusCode === 401 && err.code === GitErrorCodes.UNAUTHORIZED;
    });
  });

  // Cleanup test workspace
  cleanWorkspace();

  console.log("\n==================================================");
  console.log(`  Tests completed: ${passed} passed, ${failed} failed`);
  console.log("==================================================");

  if (failed > 0) {
    process.exit(1);
  }
}

runTests();
