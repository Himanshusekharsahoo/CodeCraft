# CodeCraft — Phase 6: Git Version Control Engine Architecture

## 1. Executive Summary

Phase 6 introduces a native, workspace-isolated Git Version Control Engine to CodeCraft. Designed to operate alongside the real-time CRDT (Yjs) collaboration layer, the Git subsystem enables team versioning, branching, commit history, visual side-by-side Monaco diff inspection, two-way Firestore synchronization, local branch merging with conflict resolution, and strict role-based access control.

Importantly, **Git does not replace Yjs**. Yjs remains the authoritative real-time collaboration engine for live document keystrokes and cursors. Git serves as the persistent, explicit version checkpoint and branching engine for team code progression.

---

## 2. System Architecture & Topology

```
   ┌─────────────────────────────────────────────────────────────────────────────────┐
   │                         Client Browser (Next.js 15)                             │
   │                                                                                 │
   │  ┌──────────────────────────────┐              ┌─────────────────────────────┐  │
   │  │ NavPanel (File Explorer)     │              │ GitPanel (Source Control)   │  │
   │  │ - Tree rendering             │              │ - Branch Selector & Create  │  │
   │  │ - Add / Rename / Delete      │              │ - Staged / Changes Lists    │  │
   │  └──────────────────────────────┘              │ - Commit Box & Authoring    │  │
   │                                                │ - History Drawer & Diff Eye │  │
   │  ┌──────────────────────────────────────────┐  │ - Merge & Conflict Actions  │  │
   │  │ Monaco Editor & MonacoDiffViewer (Modal) │  └──────────────┬──────────────┘  │
   │  │ - Side-by-side original vs working copy  │                 │                 │
   │  └──────────────────────────────────────────┘                 │                 │
   └───────────────────────────────────────┬───────────────────────┼─────────────────┘
                                           │ Bearer Auth           │ REST API Calls
                                           ▼                       ▼
   ┌─────────────────────────────────────────────────────────────────────────────────┐
   │                      Next.js App Router API Route Handlers                      │
   │  /api/workspace/[workspaceId]/git/status, init, diff, stage, unstage, commit,   │
   │                     history, branches, checkout, merge, restore, resolve        │
   │                                       │                                         │
   │               ┌───────────────────────┴───────────────────────┐                 │
   │               ▼                                               ▼                 │
   │  ┌──────────────────────────────┐              ┌─────────────────────────────┐  │
   │  │ GitAuth Module               │              │ FirestoreSync Module        │  │
   │  │ - JWT & Test Token Parsing   │              │ - Firestore files -> Disk   │  │
   │  │ - Workspace Role Evaluation  │              │ - Branch / Restore -> Store │  │
   │  │ - RBAC (READ / MUTATE / ADM) │              └──────────────┬──────────────┘  │
   │  └────────────┬─────────────────┘                             │                 │
   │               │                                               │                 │
   │               ▼                                               ▼                 │
   │  ┌───────────────────────────────────────────────────────────────────────────┐  │
   │  │ GitService & GitSecurity Boundary Layer                                   │  │
   │  │ - Path Traversal & .git Internals Defense                                │  │
   │  │ - ChildProcess.execFile (No Shell Interpolation)                          │  │
   │  │ - Non-blocking Porcelain v1 Parsing                                       │  │
   │  └────────────────────────────────────┬──────────────────────────────────────┘  │
   └───────────────────────────────────────┼─────────────────────────────────────────┘
                                           │ execFile("git.exe", [args...])
                                           ▼
   ┌─────────────────────────────────────────────────────────────────────────────────┐
   │                     Host Filesystem Git Isolation Boundary                      │
   │  data/git/workspaces/{workspaceId}/                                             │
   │  ├── .git/                  (Strictly protected from direct read/write)         │
   │  ├── .gitignore             (Auto-configured with default exclusions)           │
   │  └── [workspace files...]   (Synchronized working tree, CRLF forced to LF)      │
   └─────────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Security Boundary & Defense-in-Depth

The Git engine interacts directly with the host filesystem and external binaries. Security is enforced through multiple immutable layers:

### 3.1 Strict Workspace Directory Bounding
- **Workspace ID Sanitization**: Only `^[a-zA-Z0-9_-]+$` is allowed. Path traversal identifiers like `../` or special control characters are immediately rejected with `400 INVALID_PATH`.
- **Root Storage Escape Defense**: All paths resolve inside `data/git/workspaces/{sanitizedWorkspaceId}`. If `path.resolve` does not start with `repoDir + path.sep`, a `403 REPOSITORY_ESCAPE_DETECTED` exception is thrown.

### 3.2 Safe Path & Internal Metadata Protection
- **Path Traversal Protection**: Any path containing `..`, leading slashes, drive letters (e.g. `C:`, `D:`), or double slashes is rejected.
- **Git Metadata Immunity**: All access attempts targeting `.git`, `.git/config`, `.git/HEAD`, or subdirectories named `.git` throw `403 GIT_INTERNALS_PROTECTED`.

### 3.3 Command Injection Elimination
- CodeCraft strictly uses Node's `child_process.execFile` with explicit argument arrays (`shell: false`).
- **No shell interpolation occurs**. Metacharacters like `;`, `&`, `|`, `` ` ``, `$()`, or `\n` in filenames, commit messages, or branch names are passed directly as distinct argv elements and never interpreted by `sh`, `cmd`, or `powershell`.

### 3.4 Branch & Ref Sanitization
- Branch names are validated against Git reference specifications:
  - Cannot start with `-` (prevents command line flag injection).
  - Cannot contain spaces, `..`, `@{`, `//`, `\`, `*`, `?`, `[`, or end in `.lock` or `.`.
  - Max length is strictly bounded at 100 characters.

---

## 4. Multi-User Authorization & RBAC Model

Git operations are protected at the API route layer by `src/lib/git/gitAuth.js`:

| Role | Permitted Actions | Blocked Actions (HTTP 403) |
| :--- | :--- | :--- |
| **Viewer** | `GET /status`, `GET /history`, `GET /diff`, `GET /branches`, `GET /commit/[hash]` | `POST /init`, `POST /stage`, `POST /unstage`, `POST /commit`, `POST /branches`, `POST /checkout`, `POST /merge`, `POST /restore`, `POST /resolve-conflict`, `DELETE /branches` |
| **Contributor** | Full read, stage, unstage, commit, create branch, switch branch, merge, restore, resolve conflicts | Administrative workspace settings |
| **Owner** | All Contributor actions + Force delete branch, workspace repository deletion | None |

Unauthenticated requests or expired tokens are rejected with `HTTP 401 UNAUTHORIZED`.

---

## 5. Two-Way Firestore Synchronization (`firestoreSync.js`)

Because CodeCraft stores real-time documents in Cloud Firestore (`workspaces/{workspaceId}/files` and `folders`), the Git engine provides robust two-way synchronization:

1. **Firestore to Working Tree (`syncFirestoreToWorkingTree`)**:
   - Executes automatically before status queries, staging, diffing, and commits.
   - Queries Firestore collections, reconstructs the folder hierarchy, and writes file contents to `data/git/workspaces/{workspaceId}/` with LF line endings (`core.autocrlf = false`).
   - Files deleted in Firestore are cleanly unlinked from the working tree.

2. **Working Tree to Firestore (`syncWorkingTreeToFirestore`)**:
   - Executes automatically after branch switch (`checkout`), file discard (`restore`), and merge completion.
   - Reads the checked-out working tree on disk and updates Firestore document records so that all collaborators in the workspace immediately see the files belonging to the newly active branch.

---

## 6. Frontend Source Control Integration

1. **Activity Bar Tabs**:
   - A mode switcher at the top of the sidebar allows instant toggling between **Files** (File Explorer) and **Git** (Source Control).
2. **Reactive Git Panel (`src/components/GitPanel.jsx`)**:
   - **Branch Control**: Dropdown selector to switch branches and modal to create new branches.
   - **Staged Changes**: Lists staged files with status badges (`A`, `M`, `D`, `R`), view diff button, and unstage buttons.
   - **Changes (Working Tree & Untracked)**: Lists changed files with stage (`+`), discard (`RotateCcw`), and diff buttons.
   - **Commit Box**: Textarea for commit message with single-click commit. Disabled for viewers.
   - **Merge & Conflict Center**: Provides a visual banner when merge conflicts occur with conflict files and "Abort Merge" safety action.
   - **History Viewer**: Commits list showing author, timestamp, commit hash, and message.
3. **Monaco Diff Viewer Modal (`src/components/MonacoDiffViewer.jsx`)**:
   - Side-by-side visual diff using Monaco's native `DiffEditor`.
   - Compares HEAD vs working tree or parent commit vs child commit.

---

## 7. Verification & Test Matrix

| Suite | Scope | Result | Details |
| :--- | :--- | :---: | :--- |
| **Git Engine Unit & Security** | `test/git-engine.test.js` | **26 / 26 PASS** | Path traversal, argument injection, repo init, status, staging, unstage, commit, history, diff, branching, restore, fast-forward merge, 3-way merge conflict detection & resolution, viewer RBAC guards. |
| **Playwright E2E Suite** | `e2e/git.spec.js` | **5 / 5 PASS** | Browser automation testing repo init, changes detection, staging, committing, history inspection, branch creation & switching, viewer read-only enforcement. |
| **Phase 5 Collaboration E2E** | `e2e/collaboration.spec.js` | **10 / 10 PASS** | Multi-file concurrent CRDT editing, presence awareness, offline IndexedDB sync, tab switching isolation. |
| **Security & AI Context** | `test/security-and-context.test.js` | **14 / 14 PASS** | Firestore comment security rules, XSS sanitization, AI context secret redaction. |
| **Collaboration Server** | `collaborationserver/test/` | **17 / 17 PASS** | CRDT room lifecycle, token authentication, origin verification, zero memory leaks. |
| **ESLint Audit** | `npm run lint` | **0 ERRORS** | Codebase-wide strict lint verification. |
| **Production Build** | `npm run build` | **EXIT CODE 0** | Production Next.js 15.1.6 compilation with all 14 Git API endpoints and UI bundles. |
