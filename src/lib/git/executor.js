import { execFile } from "node:child_process";
import { GitError, GitErrorCodes } from "./errors.js";

/**
 * Safely executes a Git CLI command with an explicit argument array.
 * Strictly avoids shell invocation (shell: false) to prevent command injection.
 *
 * @param {string} repoDir - The repository directory path (working directory)
 * @param {string[]} args - Array of command arguments (e.g. ['status', '--porcelain'])
 * @param {object} [options={}]
 * @param {boolean} [options.ignoreExitCode=false] - If true, non-zero exits will not throw immediately
 * @returns {Promise<{ stdout: string, stderr: string, exitCode: number }>}
 */
export function runGit(repoDir, args, options = {}) {
  return new Promise((resolve, reject) => {
    // Defend against accidental string concatenation
    if (!Array.isArray(args) || args.some((arg) => typeof arg !== "string")) {
      return reject(
        new GitError(
          GitErrorCodes.GIT_OPERATION_FAILED,
          "Git arguments must be an array of strings",
          500
        )
      );
    }

    const safeEnv = {
      ...process.env,
      LC_ALL: "C",
      GIT_TERMINAL_PROMPT: "0",
      GIT_CONFIG_NOSYSTEM: "1",
    };

    const execOptions = {
      cwd: repoDir,
      env: safeEnv,
      maxBuffer: 20 * 1024 * 1024, // 20 MB buffer
      windowsHide: true,
      shell: false,
    };

    execFile("git", args, execOptions, (err, stdout, stderr) => {
      const out = stdout ? stdout.toString() : "";
      const errOut = stderr ? stderr.toString() : "";
      const exitCode = err ? err.code || 1 : 0;

      if (err && !options.ignoreExitCode) {
        const errorMsg = (errOut || out || err.message).trim();

        // Standardized mapping of Git CLI error output to GitErrorCodes
        if (errorMsg.includes("not a git repository")) {
          return reject(
            new GitError(
              GitErrorCodes.REPOSITORY_NOT_INITIALIZED,
              "Git repository is not initialized for this workspace",
              404
            )
          );
        }

        if (errorMsg.includes("already exists")) {
          return reject(
            new GitError(
              GitErrorCodes.BRANCH_ALREADY_EXISTS,
              "A branch or reference with that name already exists",
              409
            )
          );
        }

        if (
          errorMsg.includes("Your local changes to the following files would be overwritten") ||
          errorMsg.includes("commit your changes or stash them before you merge")
        ) {
          return reject(
            new GitError(
              GitErrorCodes.WORKTREE_DIRTY,
              "Working tree has uncommitted changes that would be overwritten",
              409
            )
          );
        }

        if (errorMsg.includes("pathspec") && errorMsg.includes("did not match any file(s) known to git")) {
          return reject(
            new GitError(
              GitErrorCodes.FILE_NOT_FOUND,
              "The specified file was not found in the repository",
              404
            )
          );
        }

        return reject(
          new GitError(
            GitErrorCodes.GIT_OPERATION_FAILED,
            `Git command failed: ${errorMsg}`,
            500,
            { command: args[0], exitCode }
          )
        );
      }

      resolve({ stdout: out, stderr: errOut, exitCode });
    });
  });
}
