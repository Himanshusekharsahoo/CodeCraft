import fs from "node:fs";
import path from "node:path";
import { runGit } from "./executor.js";
import { GitError, GitErrorCodes } from "./errors.js";
import {
  getWorkspaceRepoDir,
  resolveSafePath,
  validateBranchName,
  validateCommitHash,
  validateCommitMessage,
  sanitizeAuthor,
} from "./security.js";

export class GitService {
  /**
   * Initializes a Git repository for a workspace.
   * Safe and idempotent: returns existing info if repository already exists.
   *
   * @param {string} workspaceId
   * @param {object} [options={}]
   * @param {string} [options.defaultBranch="main"]
   * @param {string} [options.initialCommitMessage]
   * @param {Array<{ path: string, content: string }>} [options.initialFiles]
   * @returns {Promise<{ initialized: boolean, alreadyExisted: boolean, defaultBranch: string, commitHash?: string }>}
   */
  static async initializeRepository(workspaceId, options = {}) {
    const repoDir = getWorkspaceRepoDir(workspaceId);
    const gitDir = path.join(repoDir, ".git");

    if (fs.existsSync(gitDir)) {
      const branches = await this.listBranches(workspaceId).catch(() => ({ currentBranch: "main", branches: [{ name: "main", isCurrent: true }] }));
      return {
        initialized: true,
        alreadyExisted: true,
        defaultBranch: branches.currentBranch || "main",
      };
    }

    fs.mkdirSync(repoDir, { recursive: true });

    const defaultBranch = options.defaultBranch || "main";
    validateBranchName(defaultBranch);

    // 1. Initialize repository with default branch
    await runGit(repoDir, ["init", "-b", defaultBranch]);

    // 2. Configure repository-local identity and safety settings
    await runGit(repoDir, ["config", "user.name", "CodeCraft"]);
    await runGit(repoDir, ["config", "user.email", "git@codecraft.local"]);
    await runGit(repoDir, ["config", "core.autocrlf", "false"]);
    await runGit(repoDir, ["config", "commit.gpgSign", "false"]);

    // 3. Populate default .gitignore
    const gitignorePath = path.join(repoDir, ".gitignore");
    if (!fs.existsSync(gitignorePath)) {
      const defaultIgnore = [
        ".DS_Store",
        "Thumbs.db",
        "*.log",
        "",
      ].join("\n");
      fs.writeFileSync(gitignorePath, defaultIgnore, "utf8");
    }

    // 4. If initialFiles provided, write them into the working tree
    if (Array.isArray(options.initialFiles) && options.initialFiles.length > 0) {
      for (const item of options.initialFiles) {
        if (!item?.path) continue;
        const { fullPath } = resolveSafePath(repoDir, item.path);
        fs.mkdirSync(path.dirname(fullPath), { recursive: true });
        fs.writeFileSync(fullPath, typeof item.content === "string" ? item.content : "", "utf8");
      }
    }

    // 5. Create initial commit if files exist or explicitly requested
    let commitHash = null;
    const workingTreeFiles = fs.readdirSync(repoDir).filter((f) => f !== ".git");
    if (workingTreeFiles.length > 0 || options.initialFiles) {
      await runGit(repoDir, ["add", "-A"]);
      const commitRes = await runGit(repoDir, [
        "commit",
        "-m",
        options.initialCommitMessage || "Initial workspace commit",
        "--author=CodeCraft <git@codecraft.local>",
      ], { ignoreExitCode: true });

      if (commitRes.exitCode === 0) {
        const hashRes = await runGit(repoDir, ["rev-parse", "HEAD"]).catch(() => ({ stdout: "" }));
        commitHash = hashRes.stdout.trim() || null;
      }
    }

    return {
      initialized: true,
      alreadyExisted: false,
      defaultBranch,
      commitHash,
    };
  }

  /**
   * Checks whether a Git repository exists for the specified workspace.
   *
   * @param {string} workspaceId
   * @returns {boolean}
   */
  static isRepositoryInitialized(workspaceId) {
    try {
      const repoDir = getWorkspaceRepoDir(workspaceId);
      return fs.existsSync(path.join(repoDir, ".git"));
    } catch {
      return false;
    }
  }

  /**
   * Asserts that a Git repository exists for the specified workspace.
   *
   * @param {string} workspaceId
   * @returns {string} repoDir
   */
  static assertRepo(workspaceId) {
    const repoDir = getWorkspaceRepoDir(workspaceId);
    if (!fs.existsSync(path.join(repoDir, ".git"))) {
      throw new GitError(
        GitErrorCodes.REPOSITORY_NOT_INITIALIZED,
        `Workspace '${workspaceId}' does not have an initialized Git repository`,
        404
      );
    }
    return repoDir;
  }

  /**
   * Retrieves full porcelain working tree status.
   *
   * @param {string} workspaceId
   * @returns {Promise<object>}
   */
  static async getStatus(workspaceId) {
    const repoDir = this.assertRepo(workspaceId);

    // Get branch and porcelain v1 output with untracked files
    const res = await runGit(repoDir, ["status", "--porcelain=v1", "-b", "-uall"]);
    const lines = res.stdout.split(/\r?\n/).filter(Boolean);

    let branch = "main";
    let ahead = 0;
    let behind = 0;
    const staged = [];
    const unstaged = [];
    const untracked = [];
    const conflicts = [];
    const conflictDetails = [];

    for (const line of lines) {
      if (line.startsWith("## ")) {
        // Parse branch line, e.g. "## main" or "## feature...origin/feature [ahead 1]"
        const branchInfo = line.slice(3).trim();
        const branchNameMatch = branchInfo.match(/^([^.\s]+)/);
        if (branchNameMatch) {
          branch = branchNameMatch[1];
        }
        const aheadMatch = branchInfo.match(/ahead (\d+)/);
        if (aheadMatch) ahead = parseInt(aheadMatch[1], 10);
        const behindMatch = branchInfo.match(/behind (\d+)/);
        if (behindMatch) behind = parseInt(behindMatch[1], 10);
        continue;
      }

      if (line.length < 4) continue;

      const indexStatus = line[0];
      const workTreeStatus = line[1];
      const rawPath = line.slice(3).trim();

      // Handle renamed format: "R  old.js -> new.js"
      let filePath = rawPath;
      let oldPath = null;
      if (rawPath.includes(" -> ")) {
        const parts = rawPath.split(" -> ");
        oldPath = parts[0];
        filePath = parts[1];
      }

      // Check for untracked files: '??'
      if (indexStatus === "?" && workTreeStatus === "?") {
        untracked.push(filePath);
        continue;
      }

      // Check for merge conflict codes
      const isConflict =
        indexStatus === "U" ||
        workTreeStatus === "U" ||
        (indexStatus === "A" && workTreeStatus === "A") ||
        (indexStatus === "D" && workTreeStatus === "D");

      if (isConflict) {
        conflicts.push(filePath);
        conflictDetails.push({
          path: filePath,
          status: "conflicted",
          rawCode: indexStatus + workTreeStatus,
        });
        continue;
      }

      // Check staged changes (index column)
      if (indexStatus !== " ") {
        staged.push({
          path: filePath,
          status: indexStatus,
          action: indexStatus === "A" ? "added" : indexStatus === "D" ? "deleted" : indexStatus === "R" ? "renamed" : "modified",
          oldPath,
        });
      }

      // Check unstaged changes (working tree column)
      if (workTreeStatus !== " ") {
        unstaged.push({
          path: filePath,
          status: workTreeStatus,
          action: workTreeStatus === "D" ? "deleted" : "modified",
        });
      }
    }

    const isClean = staged.length === 0 && unstaged.length === 0 && untracked.length === 0 && conflicts.length === 0;

    return {
      initialized: true,
      branch,
      ahead,
      behind,
      isClean,
      hasConflicts: conflicts.length > 0,
      staged,
      unstaged,
      untracked,
      conflicts,
      conflictDetails,
      totalChanges: staged.length + unstaged.length + untracked.length + conflicts.length,
    };
  }

  /**
   * Retrieves diff content for a specific file or the working tree.
   * Returns original and modified content suitable for Monaco DiffEditor.
   *
   * @param {string} workspaceId
   * @param {object} [options={}]
   * @returns {Promise<object>}
   */
  static async getDiff(workspaceId, options = {}) {
    const repoDir = this.assertRepo(workspaceId);
    const rawTarget = options.filePath || options.path || options.file || null;
    const targetFile = rawTarget ? resolveSafePath(repoDir, rawTarget).relativePath : null;

    let patch = "";
    let original = "";
    let modified = "";

    if (options.commitHash) {
      const commit = validateCommitHash(options.commitHash);
      const args = ["show", "--format=", commit];
      if (targetFile) args.push("--", targetFile);
      const res = await runGit(repoDir, args);
      patch = res.stdout;

      if (targetFile) {
        const parentRes = await runGit(repoDir, ["show", `${commit}~1:${targetFile}`], { ignoreExitCode: true });
        original = parentRes.exitCode === 0 ? parentRes.stdout : "";
        const commitRes = await runGit(repoDir, ["show", `${commit}:${targetFile}`], { ignoreExitCode: true });
        modified = commitRes.exitCode === 0 ? commitRes.stdout : "";
      }
    } else if (options.staged) {
      const args = ["diff", "--cached"];
      if (targetFile) args.push("--", targetFile);
      const res = await runGit(repoDir, args);
      patch = res.stdout;

      if (targetFile) {
        const headRes = await runGit(repoDir, ["show", `HEAD:${targetFile}`], { ignoreExitCode: true });
        original = headRes.exitCode === 0 ? headRes.stdout : "";
        const indexRes = await runGit(repoDir, ["show", `:${targetFile}`], { ignoreExitCode: true });
        modified = indexRes.exitCode === 0 ? indexRes.stdout : "";
      }
    } else {
      const args = ["diff"];
      if (targetFile) args.push("--", targetFile);
      const res = await runGit(repoDir, args);
      patch = res.stdout;

      if (targetFile) {
        const indexRes = await runGit(repoDir, ["show", `:${targetFile}`], { ignoreExitCode: true });
        original = indexRes.exitCode === 0 ? indexRes.stdout : "";
        if (!original) {
          const headRes = await runGit(repoDir, ["show", `HEAD:${targetFile}`], { ignoreExitCode: true });
          original = headRes.exitCode === 0 ? headRes.stdout : "";
        }
        const fullPath = path.resolve(repoDir, targetFile);
        if (fs.existsSync(fullPath)) {
          modified = fs.readFileSync(fullPath, "utf8");
        }
      }
    }

    return {
      filePath: targetFile,
      staged: Boolean(options.staged),
      commitHash: options.commitHash || null,
      diff: patch,
      patch,
      original,
      modified,
      includes(str) {
        return patch.includes(str);
      },
      toString() {
        return patch;
      },
    };
  }

  /**
   * Stages one or more files into the Git index.
   *
   * @param {string} workspaceId
   * @param {string[] | string} paths
   * @returns {Promise<object>} updated status
   */
  static async stageFiles(workspaceId, paths) {
    const repoDir = this.assertRepo(workspaceId);

    const isAll =
      paths === "*" ||
      paths === "." ||
      (Array.isArray(paths) && (paths.includes("*") || paths.includes(".")));

    if (isAll) {
      await runGit(repoDir, ["add", "-A"]);
    } else {
      const pathList = Array.isArray(paths) ? paths : [paths];
      if (pathList.length === 0) return this.getStatus(workspaceId);

      const safePaths = pathList.map((p) => resolveSafePath(repoDir, p).relativePath);
      await runGit(repoDir, ["add", "--", ...safePaths]);
    }

    return this.getStatus(workspaceId);
  }

  /**
   * Unstages one or more files from the Git index.
   *
   * @param {string} workspaceId
   * @param {string[] | string} paths
   * @returns {Promise<object>} updated status
   */
  static async unstageFiles(workspaceId, paths) {
    const repoDir = this.assertRepo(workspaceId);
    const hasHead = (await runGit(repoDir, ["rev-parse", "--verify", "HEAD"], { ignoreExitCode: true })).exitCode === 0;

    const isAll =
      paths === "*" ||
      paths === "." ||
      (Array.isArray(paths) && (paths.includes("*") || paths.includes(".")));

    if (isAll) {
      if (hasHead) {
        await runGit(repoDir, ["reset", "HEAD", "--"]);
      } else {
        await runGit(repoDir, ["rm", "--cached", "-r", "--", "."]);
      }
    } else {
      const pathList = Array.isArray(paths) ? paths : [paths];
      if (pathList.length === 0) return this.getStatus(workspaceId);

      const safePaths = pathList.map((p) => resolveSafePath(repoDir, p).relativePath);
      if (hasHead) {
        await runGit(repoDir, ["reset", "HEAD", "--", ...safePaths]);
      } else {
        await runGit(repoDir, ["rm", "--cached", "-r", "--", ...safePaths], { ignoreExitCode: true });
      }
    }

    return this.getStatus(workspaceId);
  }

  /**
   * Creates a Git commit from currently staged changes.
   *
   * @param {string} workspaceId
   * @param {object} params
   * @returns {Promise<object>}
   */
  static async createCommit(workspaceId, params) {
    const repoDir = this.assertRepo(workspaceId);
    const validMessage = validateCommitMessage(params?.message);
    const rawName = params?.author?.name || params?.authorName;
    const rawEmail = params?.author?.email || params?.authorEmail;
    const { name: authorName, email: authorEmail } = sanitizeAuthor(rawName, rawEmail);

    const status = await this.getStatus(workspaceId);
    if (status.staged.length === 0 && !status.hasConflicts) {
      throw new GitError(
        GitErrorCodes.INVALID_PATH,
        "Cannot commit: no staged changes exist. Stage changes before committing.",
        400
      );
    }

    const authorArg = `--author=${authorName} <${authorEmail}>`;
    await runGit(repoDir, ["commit", "-m", validMessage, authorArg]);

    const revRes = await runGit(repoDir, ["rev-parse", "HEAD"]);
    const commitHash = revRes.stdout.trim();
    const shortHash = commitHash.slice(0, 7);

    return {
      commitHash,
      hash: commitHash,
      shortHash,
      message: validMessage,
      branch: status.branch,
      author: { name: authorName, email: authorEmail },
      authorName,
      authorEmail,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Retrieves paginated commit history.
   *
   * @param {string} workspaceId
   * @param {object} [options={}]
   * @returns {Promise<{ commits: Array<object>, total: number, branch: string }>}
   */
  static async getHistory(workspaceId, options = {}) {
    const repoDir = this.assertRepo(workspaceId);
    const hasHead = (await runGit(repoDir, ["rev-parse", "--verify", "HEAD"], { ignoreExitCode: true })).exitCode === 0;

    if (!hasHead) {
      return { commits: [], total: 0, branch: "main" };
    }

    const limit = Math.min(Math.max(parseInt(options.limit || 30, 10), 1), 100);
    const offset = Math.max(parseInt(options.skip || options.offset || 0, 10), 0);
    const branch = options.branch ? validateBranchName(options.branch) : "HEAD";

    const countRes = await runGit(repoDir, ["rev-list", "--count", branch], { ignoreExitCode: true });
    const total = parseInt(countRes.stdout.trim() || "0", 10);

    const logFormat = "%H%x00%h%x00%an%x00%ae%x00%aI%x00%s";
    const logRes = await runGit(repoDir, [
      "log",
      `-n${limit}`,
      `--skip=${offset}`,
      `--pretty=format:${logFormat}`,
      branch,
    ]);

    const lines = logRes.stdout.split(/\r?\n/).filter(Boolean);
    const commits = lines.map((line) => {
      const [hash, shortHash, authorName, authorEmail, date, message] = line.split("\x00");
      return {
        hash,
        commitHash: hash,
        shortHash,
        author: { name: authorName, email: authorEmail },
        authorName,
        authorEmail,
        date,
        message,
      };
    });

    const status = await this.getStatus(workspaceId).catch(() => ({ branch: "main" }));

    return {
      commits,
      total,
      branch: status.branch,
    };
  }

  /**
   * Retrieves comprehensive commit details including stats, file list, and patch.
   *
   * @param {string} workspaceId
   * @param {string} commitHash
   * @returns {Promise<object>}
   */
  static async getCommitDetails(workspaceId, commitHash) {
    const repoDir = this.assertRepo(workspaceId);
    const validHash = validateCommitHash(commitHash);

    const format = "%H%x00%h%x00%an%x00%ae%x00%aI%x00%B";
    const showRes = await runGit(repoDir, ["show", "--format=" + format, "-s", validHash]);
    const [hash, shortHash, authorName, authorEmail, date, message] = showRes.stdout.split("\x00");

    const filesRes = await runGit(repoDir, ["diff-tree", "--no-commit-id", "--name-status", "-r", validHash]);
    const files = filesRes.stdout.split(/\r?\n/).filter(Boolean).map((line) => {
      const parts = line.split(/\s+/);
      return {
        status: parts[0],
        path: parts[1],
      };
    });

    const patchRes = await runGit(repoDir, ["show", "--format=", validHash]);

    return {
      hash,
      commitHash: hash,
      shortHash,
      author: { name: authorName, email: authorEmail },
      authorName,
      authorEmail,
      date,
      message: (message || "").trim(),
      files,
      diff: patchRes.stdout,
      patch: patchRes.stdout,
    };
  }

  /**
   * Lists all local branches and marks the current active branch.
   *
   * @param {string} workspaceId
   * @returns {Promise<{ currentBranch: string, branches: Array<{ name: string, isCurrent: boolean }> }>}
   */
  static async listBranches(workspaceId) {
    const repoDir = this.assertRepo(workspaceId);
    const res = await runGit(repoDir, ["branch", "--list"]);
    const lines = res.stdout.split(/\r?\n/).filter(Boolean);

    let currentBranch = "main";
    const branches = [];

    for (const line of lines) {
      const isCurrent = line.startsWith("*");
      const name = line.replace(/^[*\s]+/, "").trim();
      if (name) {
        if (isCurrent) currentBranch = name;
        branches.push({
          name,
          isCurrent,
        });
      }
    }

    return {
      currentBranch,
      branches,
    };
  }

  /**
   * Creates a new branch from current HEAD or start point.
   *
   * @param {string} workspaceId
   * @param {string} branchName
   * @param {string} [startPoint]
   * @returns {Promise<{ branchName: string, created: boolean }>}
   */
  static async createBranch(workspaceId, branchName, startPoint) {
    const repoDir = this.assertRepo(workspaceId);
    const validName = validateBranchName(branchName);

    const args = ["branch", validName];
    if (startPoint) {
      args.push(startPoint);
    }
    await runGit(repoDir, args);

    return {
      branchName: validName,
      created: true,
    };
  }

  /**
   * Switches the active branch. Guarded against uncommitted conflicts.
   *
   * @param {string} workspaceId
   * @param {string} branchName
   * @param {object} [options={}]
   * @returns {Promise<{ currentBranch: string, branchName: string, switched: boolean }>}
   */
  static async switchBranch(workspaceId, branchName, options = {}) {
    const repoDir = this.assertRepo(workspaceId);
    const validName = validateBranchName(branchName);

    const args = options.createNew ? ["checkout", "-b", validName] : ["checkout", validName];
    await runGit(repoDir, args);

    return {
      currentBranch: validName,
      branchName: validName,
      switched: true,
    };
  }

  /**
   * Deletes a local branch.
   *
   * @param {string} workspaceId
   * @param {string} branchName
   * @param {boolean} [force=false]
   * @returns {Promise<{ branchName: string, deleted: boolean }>}
   */
  static async deleteBranch(workspaceId, branchName, force = false) {
    const repoDir = this.assertRepo(workspaceId);
    const validName = validateBranchName(branchName);

    const { currentBranch } = await this.listBranches(workspaceId);
    if (validName === currentBranch) {
      throw new GitError(
        GitErrorCodes.CANNOT_DELETE_CURRENT_BRANCH,
        `Cannot delete the currently active branch '${validName}'. Switch to another branch first.`,
        400
      );
    }

    const flag = force ? "-D" : "-d";
    await runGit(repoDir, ["branch", flag, validName]);

    return {
      branchName: validName,
      deleted: true,
    };
  }

  /**
   * Merges a source branch into the current branch.
   * Detects clean fast-forward, 3-way merge, or merge conflicts without crashing.
   *
   * @param {string} workspaceId
   * @param {string} sourceBranch
   * @param {object} [options={}]
   * @returns {Promise<object>}
   */
  static async mergeBranch(workspaceId, sourceBranch, options = {}) {
    const repoDir = this.assertRepo(workspaceId);
    const validSource = validateBranchName(sourceBranch);

    const status = await this.getStatus(workspaceId);
    if (!status.isClean) {
      throw new GitError(
        GitErrorCodes.WORKTREE_DIRTY,
        "Cannot merge: working tree has uncommitted changes. Commit or stash them before merging.",
        409
      );
    }

    const args = ["merge"];
    if (options.noFf) args.push("--no-ff");
    args.push(validSource);

    const mergeRes = await runGit(repoDir, args, { ignoreExitCode: true });

    if (mergeRes.exitCode !== 0) {
      const afterStatus = await this.getStatus(workspaceId);
      if (afterStatus.hasConflicts) {
        return {
          status: "conflict",
          clean: false,
          conflicts: afterStatus.conflicts,
          conflictingFiles: afterStatus.conflicts,
          message: "Merge conflict detected in one or more files",
        };
      }

      throw new GitError(
        GitErrorCodes.GIT_OPERATION_FAILED,
        `Merge failed: ${mergeRes.stderr || mergeRes.stdout}`,
        500
      );
    }

    const headRes = await runGit(repoDir, ["rev-parse", "HEAD"]);
    return {
      status: "merged",
      clean: true,
      commitHash: headRes.stdout.trim(),
      message: `Successfully merged '${validSource}' into '${status.branch}'`,
    };
  }

  /**
   * Aborts an in-progress merge.
   *
   * @param {string} workspaceId
   * @returns {Promise<{ aborted: boolean }>}
   */
  static async abortMerge(workspaceId) {
    const repoDir = this.assertRepo(workspaceId);
    await runGit(repoDir, ["merge", "--abort"]);
    return { aborted: true };
  }

  /**
   * Restores a modified file from HEAD or a specific commit hash.
   *
   * @param {string} workspaceId
   * @param {string | object} filePathOrOptions
   * @param {object} [options={}]
   * @returns {Promise<{ path: string, restored: boolean }>}
   */
  static async restoreFile(workspaceId, filePathOrOptions, options = {}) {
    const repoDir = this.assertRepo(workspaceId);
    const rawPath = typeof filePathOrOptions === "string" ? filePathOrOptions : filePathOrOptions?.path || filePathOrOptions?.file;
    const opts = typeof filePathOrOptions === "object" ? filePathOrOptions : options;

    const { relativePath } = resolveSafePath(repoDir, rawPath);

    if (opts?.staged) {
      await runGit(repoDir, ["restore", "--staged", "--", relativePath], { ignoreExitCode: true })
        .catch(async () => {
          await runGit(repoDir, ["reset", "HEAD", "--", relativePath]);
        });
    } else if (opts?.source || opts?.commitHash) {
      const source = opts.source || opts.commitHash;
      await runGit(repoDir, ["checkout", source, "--", relativePath]);
    } else {
      await runGit(repoDir, ["checkout", "HEAD", "--", relativePath]);
    }

    return {
      path: relativePath,
      file: relativePath,
      restored: true,
    };
  }

  /**
   * Resolves a conflicted file with user-approved content and marks it staged.
   *
   * @param {string} workspaceId
   * @param {string | object} filePathOrOptions
   * @param {string | object} [contentOrOptions]
   * @returns {Promise<{ resolved: boolean, mergeCompleted: boolean, remainingConflicts: string[] }>}
   */
  static async resolveConflict(workspaceId, filePathOrOptions, contentOrOptions) {
    const repoDir = this.assertRepo(workspaceId);
    const rawPath = typeof filePathOrOptions === "string" ? filePathOrOptions : filePathOrOptions?.path || filePathOrOptions?.file;
    const content = typeof contentOrOptions === "string" ? contentOrOptions : contentOrOptions?.content || filePathOrOptions?.content;

    const { relativePath, fullPath } = resolveSafePath(repoDir, rawPath);

    if (typeof content !== "string") {
      throw new GitError(
        GitErrorCodes.INVALID_PATH,
        "Resolved file content must be a string",
        400
      );
    }

    // Write resolved content directly to working tree file
    fs.writeFileSync(fullPath, content, "utf8");

    // Stage the resolved file
    await runGit(repoDir, ["add", "--", relativePath]);

    // Check remaining conflicts
    const status = await this.getStatus(workspaceId);
    if (status.conflicts.length === 0) {
      return {
        resolved: true,
        mergeCompleted: false,
        remainingConflicts: [],
      };
    }

    return {
      resolved: true,
      mergeCompleted: false,
      remainingConflicts: status.conflicts,
    };
  }
}
