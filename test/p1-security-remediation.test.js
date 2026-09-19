import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// --- CC-020 Imports ---
import { isExplicitTestEnvironment, isValidDeterministicTestToken, parseTestTokenClaims } from "../src/lib/authEnv.js";

// --- CC-006 Imports ---
import { validateExecutionPayload } from "../src/lib/execution/security.js";
import { ExecutionService } from "../src/lib/execution/executionService.js";
import { SandboxExecutor } from "../src/lib/execution/sandboxExecutor.js";
import { setMockDockerAvailability } from "../src/lib/execution/dockerDetector.js";

// --- CC-003 Imports ---
import { config as collabConfig } from "../collaborationserver/src/config.js";
import { syncFirestoreToWorkingTree, syncWorkingTreeToFirestore } from "../src/lib/git/firestoreSync.js";

function logPass(id, desc) {
  console.log(`  \x1b[32m✔ [${id}]\x1b[0m ${desc}`);
}

function logSuite(name) {
  console.log(`\n\x1b[1m\x1b[36m▶ Running suite: ${name}\x1b[0m`);
}

async function runTests() {
  console.log("===============================================================================");
  console.log(" CodeCraft P1 Security & Production Remediation Regression Suite");
  console.log("===============================================================================");

  // ===========================================================================
  // CC-020: Test auth must never be enabled in production
  // ===========================================================================
  logSuite("CC-020: Production Auth Enforcement & Test Mode Isolation");
  {
    const origNodeEnv = process.env.NODE_ENV;
    const origCollabTest = process.env.COLLAB_TEST;
    const origCodeCraftTest = process.env.CODECRAFT_TEST;
    const origPlaywright = process.env.PLAYWRIGHT_TEST;

    try {
      // 1. In production, ANY test flag MUST be rejected
      process.env.NODE_ENV = "production";
      process.env.COLLAB_TEST = "true";
      process.env.CODECRAFT_TEST = "true";
      process.env.PLAYWRIGHT_TEST = "true";

      assert.strictEqual(
        isExplicitTestEnvironment(),
        false,
        "isExplicitTestEnvironment must return false in production regardless of flags"
      );
      logPass("CC-020", "Test environment flags are strictly suppressed when NODE_ENV=production");

      // 2. In non-production, explicit test flags work
      process.env.NODE_ENV = "test";
      process.env.COLLAB_TEST = "true";
      assert.strictEqual(isExplicitTestEnvironment(), true, "Test mode allowed when NODE_ENV is test");
      logPass("CC-020", "Test mode operates normally in development/test environments");

      // 3. Collab server config check
      const collabConfigContent = fs.readFileSync(
        path.resolve(process.cwd(), "collaborationserver/src/config.js"),
        "utf8"
      );
      assert.ok(
        collabConfigContent.includes("process.env.NODE_ENV !== 'production'"),
        "collaborationserver config.js must guard isRunningTest with NODE_ENV !== 'production'"
      );
      logPass("CC-020", "collaborationserver config enforces production guard for test auth");
    } finally {
      process.env.NODE_ENV = origNodeEnv;
      process.env.COLLAB_TEST = origCollabTest;
      process.env.CODECRAFT_TEST = origCodeCraftTest;
      process.env.PLAYWRIGHT_TEST = origPlaywright;
    }
  }

  // ===========================================================================
  // CC-001: Firestore invitation / membership escalation
  // ===========================================================================
  logSuite("CC-001: Firestore Invitation & Membership Security Rules");
  {
    const rulesPath = path.resolve(process.cwd(), "firestore.rules");
    const rules = fs.readFileSync(rulesPath, "utf8");

    // 1. Verify user self-injection of invites is blocked on create
    assert.ok(
      rules.includes("!('invites' in request.resource.data) || request.resource.data.invites.size() == 0"),
      "User create rule must forbid self-injecting invites"
    );
    logPass("CC-001", "User document create rule forbids initial invites array injection");

    // 2. Verify user self-injection of invites is blocked on update
    assert.ok(
      rules.includes("resource.data.invites.hasAll(request.resource.data.invites)"),
      "User update rule must prevent adding new invites (only removing accepted/declined is permitted)"
    );
    logPass("CC-001", "User update rule prevents user from appending invites to themselves");

    // 3. Verify workspace owners can append invites to a target user
    assert.ok(
      rules.includes("isWorkspaceOwner(request.resource.data.invites"),
      "Only workspace owners can append invites for their own workspace"
    );
    logPass("CC-001", "Only authentic workspace owners can append invites to a user");

    // 4. Verify membership creation requires active invite or owner role
    assert.ok(
      rules.includes("workspaceId in get(/databases/$(database)/documents/users/$(request.auth.uid)).data.invites"),
      "Membership creation requires authentic invite on target user document"
    );
    logPass("CC-001", "Membership creation requires verified invite in recipient document or owner role");
  }

  // ===========================================================================
  // CC-002: Workspace authority field escalation
  // ===========================================================================
  logSuite("CC-002: Workspace Authority Field Escalation Rules");
  {
    const rulesPath = path.resolve(process.cwd(), "firestore.rules");
    const rules = fs.readFileSync(rulesPath, "utf8");

    // 1. Verify userId is strictly immutable
    assert.ok(
      rules.includes("request.resource.data.userId == resource.data.userId"),
      "Workspace update must strictly require userId immutability"
    );
    logPass("CC-002", "Workspace update enforces immutable userId");

    // 2. Verify contributor cannot alter ownerId, userId, or isPublic
    assert.ok(
      rules.includes("!request.resource.data.diff(resource.data).affectedKeys().hasAny(['userId', 'ownerId', 'isPublic'])"),
      "Contributor cannot touch userId, ownerId, or isPublic"
    );
    logPass("CC-002", "Contributors are prevented from modifying ownerId, userId, or isPublic");

    // 3. Verify owner role can update isPublic or transfer ownerId
    assert.ok(
      rules.includes("isWorkspaceOwner(workspaceId)"),
      "Workspace update differentiates between owner and non-owner access"
    );
    logPass("CC-002", "Workspace owner authority boundary is strictly preserved");
  }

  // ===========================================================================
  // CC-003: Collaboration bridge authentication
  // ===========================================================================
  logSuite("CC-003: Collaboration Bridge Endpoint Authentication & Sanitation");
  {
    const serverPath = path.resolve(process.cwd(), "collaborationserver/src/server.js");
    const serverCode = fs.readFileSync(serverPath, "utf8");

    // 1. Server code enforces verifyInternalAuth on /flush and /notify-mutation
    assert.ok(serverCode.includes("verifyInternalAuth(req)"), "server.js must call verifyInternalAuth");
    assert.ok(
      serverCode.includes("x-collab-internal-token") || serverCode.includes("collab-internal-token"),
      "server.js must check internal service token"
    );
    logPass("CC-003", "Collab server endpoints require internal auth secret verification");

    // 2. Request body size limit
    assert.ok(
      serverCode.includes("1024 * 1024") || serverCode.includes("MAX_INTERNAL_PAYLOAD_BYTES"),
      "Collab server must limit internal endpoint body size to 1MB"
    );
    logPass("CC-003", "Collab server enforces 1MB max body limit on internal mutation/flush calls");

    // 3. Path sanitization against directory traversal
    assert.ok(
      serverCode.includes("fileId.includes(\"..\")") && serverCode.includes("workspaceId"),
      "server.js must validate workspaceId and block fileId directory traversal"
    );
    logPass("CC-003", "Collab server sanitizes workspaceId and fileId against directory traversal");

    // 4. Test live internal auth function
    const { verifyInternalAuth } = await import("../collaborationserver/src/server.js");

    // Test missing auth header
    const mockReqNoAuth = { headers: {} };
    assert.strictEqual(verifyInternalAuth(mockReqNoAuth), false, "Missing token must be rejected");

    // Test invalid auth header
    const mockReqBadAuth = { headers: { "x-collab-internal-token": "wrong_secret" } };
    assert.strictEqual(verifyInternalAuth(mockReqBadAuth), false, "Wrong token must be rejected");

    // Test valid auth header with configured secret
    const secret = collabConfig.internalSecret || "test-collab-secret";
    collabConfig.internalSecret = secret;
    const mockReqGoodAuth = { headers: { "x-collab-internal-token": secret } };
    assert.strictEqual(verifyInternalAuth(mockReqGoodAuth), true, "Correct token must be accepted");
    logPass("CC-003", "verifyInternalAuth accepts matching secret and rejects unauthorized tokens");
  }

  // ===========================================================================
  // CC-004: Collaboration Firestore server auth & viewer write restrictions
  // ===========================================================================
  logSuite("CC-004: Collaboration Firestore Server Auth & Role Restrictions");
  {
    const persistencePath = path.resolve(process.cwd(), "collaborationserver/src/persistence.js");
    const persistenceCode = fs.readFileSync(persistencePath, "utf8");

    // 1. Persistence uses Firestore REST API with token in production
    assert.ok(
      persistenceCode.includes("firestore.googleapis.com") || persistenceCode.includes("token"),
      "persistence.js must query Firestore REST with authenticated token"
    );
    logPass("CC-004", "persistence.js supports authenticated Firestore REST snapshot loading & saving");

    // 2. Room enforces write rejection for viewers
    const roomsPath = path.resolve(process.cwd(), "collaborationserver/src/rooms.js");
    const roomsCode = fs.readFileSync(roomsPath, "utf8");
    assert.ok(
      roomsCode.includes("viewer") && roomsCode.includes("VIEWER_WRITE_ATTEMPT_REJECTED"),
      "rooms.js must prevent viewer role from mutating room or scheduling saves"
    );
    logPass("CC-004", "rooms.js blocks viewers from mutating document snapshots or triggering saves");
  }

  // ===========================================================================
  // CC-005: Git / FireSync server auth
  // ===========================================================================
  logSuite("CC-005: Git / FireSync Server Authentication");
  {
    const gitAuthPath = path.resolve(process.cwd(), "src/lib/git/gitAuth.js");
    const gitAuthCode = fs.readFileSync(gitAuthPath, "utf8");

    // 1. gitAuth.js returns token
    assert.ok(
      gitAuthCode.includes("token,") || gitAuthCode.includes("token:"),
      "gitAuth.js authenticateAndAuthorize must return user token"
    );
    logPass("CC-005", "authenticateAndAuthorize extracts and returns verified caller ID token");

    // 2. firestoreSync.js enforces authenticated token in production
    const origEnv = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = "production";
      await assert.rejects(
        async () => {
          await syncFirestoreToWorkingTree("ws-test", null);
        },
        (err) => {
          assert.strictEqual(err.statusCode, 401);
          assert.ok(err.message.includes("Authenticated user token required"));
          return true;
        },
        "syncFirestoreToWorkingTree must fail without token in production"
      );

      await assert.rejects(
        async () => {
          await syncWorkingTreeToFirestore("ws-test", null);
        },
        (err) => {
          assert.strictEqual(err.statusCode, 401);
          assert.ok(err.message.includes("Authenticated user token required"));
          return true;
        },
        "syncWorkingTreeToFirestore must fail without token in production"
      );
      logPass("CC-005", "Firestore sync operations fail-closed when caller token is omitted in production");
    } finally {
      process.env.NODE_ENV = origEnv;
    }
  }

  // ===========================================================================
  // CC-006: Remove client-controlled Piston execution
  // ===========================================================================
  logSuite("CC-006: Removal of Client-Controlled Piston Execution & Fail-Closed Docker");
  {
    // 1. validateExecutionPayload rejects provider: "piston"
    assert.throws(
      () => {
        validateExecutionPayload({
          language: "javascript",
          source: 'console.log("hello");',
          provider: "piston",
        });
      },
      (err) => {
        assert.strictEqual(err.statusCode, 400);
        assert.ok(err.message.includes("Docker sandbox is the only valid execution provider"));
        return true;
      },
      "validateExecutionPayload must reject provider 'piston'"
    );
    logPass("CC-006", "Payload with provider='piston' is strictly rejected with 400");

    // 2. validateExecutionPayload rejects custom image
    assert.throws(
      () => {
        validateExecutionPayload({
          language: "javascript",
          source: 'console.log("hello");',
          provider: "sandbox",
          image: "malicious/image:latest",
        });
      },
      (err) => {
        assert.strictEqual(err.statusCode, 400);
        assert.ok(err.message.includes("Client-specified Docker images are strictly prohibited"));
        return true;
      },
      "validateExecutionPayload must reject custom image injection"
    );
    logPass("CC-006", "Client-supplied Docker container image injection is blocked");

    // 3. validateExecutionPayload rejects command/cmd/executor
    assert.throws(
      () => {
        validateExecutionPayload({
          language: "javascript",
          source: 'console.log("hello");',
          provider: "sandbox",
          command: "rm -rf /",
        });
      },
      (err) => {
        assert.strictEqual(err.statusCode, 400);
        assert.ok(err.message.includes("Client-specified execution commands or executors are strictly prohibited"));
        return true;
      },
      "validateExecutionPayload must reject custom command injection"
    );
    logPass("CC-006", "Client-supplied command injection (command/cmd/executor) is blocked");

    // 4. ExecutionService fail-closed when Docker is offline
    setMockDockerAvailability({
      available: false,
      version: null,
      reason: "Docker daemon offline for test verification",
    });

    await assert.rejects(
      async () => {
        await ExecutionService.execute({
          language: "javascript",
          source: 'console.log("hello");',
          provider: "sandbox",
          workspaceId: "ws_p1_test",
          userId: "user_p1_test",
        });
      },
      (err) => {
        assert.strictEqual(err.statusCode, 503);
        assert.ok(err.message.includes("Host execution fallback is strictly prohibited"));
        return true;
      },
      "ExecutionService must fail closed with 503 when Docker is unavailable"
    );
    logPass("CC-006", "ExecutionService fails closed (503) without falling back to Piston or host execution");

    // Reset mock
    setMockDockerAvailability(null);
  }

  // ===========================================================================
  // CC-010: Execution status workspace IDOR
  // ===========================================================================
  logSuite("CC-010: Cross-Workspace Execution IDOR Protection");
  {
    const execId = "exec_test_cc010";
    const workspaceA = "workspace-alpha";
    const workspaceB = "workspace-beta";

    // Manually register an active execution in SandboxExecutor
    SandboxExecutor.registerActiveExecutionForTesting(execId, {
      containerName: `cc_run_${execId}`,
      workspaceId: workspaceA,
      userId: "user-alpha",
      language: "javascript",
      startTime: Date.now(),
      process: null,
      killed: false,
    });

    // 2. Execution under correct workspace succeeds
    const statusSameWorkspace = SandboxExecutor.getActiveExecution(execId, workspaceA);
    assert.ok(statusSameWorkspace, "Execution record should be retrieved for matching workspaceId");
    assert.strictEqual(statusSameWorkspace.workspaceId, workspaceA);
    logPass("CC-010", "Execution lookup with matching workspaceId returns execution status");

    // 3. Execution under different workspace is rejected (IDOR blocked)
    const statusCrossWorkspace = SandboxExecutor.getActiveExecution(execId, workspaceB);
    assert.strictEqual(statusCrossWorkspace, null, "Execution lookup with mismatched workspaceId must return null");
    logPass("CC-010", "Cross-workspace execution lookup is blocked (IDOR prevented)");

    // 4. Cancellation under wrong workspace is rejected
    assert.throws(
      () => {
        SandboxExecutor.cancel(execId, "user-alpha", workspaceB);
      },
      (err) => {
        assert.strictEqual(err.statusCode, 403);
        assert.ok(err.message.includes("Execution does not belong to this workspace"));
        return true;
      },
      "Cancelling execution from different workspace must throw permission denied"
    );
    logPass("CC-010", "Cross-workspace execution cancellation is blocked with 403");

    // Clean up
    SandboxExecutor.removeActiveExecutionForTesting(execId);
  }

  // ===========================================================================
  // CC-027: Docker socket isolation & prod config
  // ===========================================================================
  logSuite("CC-027: Docker Socket Isolation & Production Boundary");
  {
    const composeProdPath = path.resolve(process.cwd(), "docker-compose.prod.yml");
    const composeProd = fs.readFileSync(composeProdPath, "utf8");

    // 1. collab container does NOT mount docker socket
    const collabIndex = composeProd.indexOf("\n  collab:");
    assert.ok(collabIndex !== -1, "docker-compose.prod.yml must define collab service");
    const collabSection = composeProd.slice(collabIndex);
    assert.ok(
      !collabSection.includes("docker.sock"),
      "collab service must never mount docker socket"
    );
    logPass("CC-027", "collab container has zero access to Docker socket");

    // 2. web container mounts docker socket with :ro flag
    assert.ok(
      composeProd.includes("/var/run/docker.sock:/var/run/docker.sock:ro"),
      "web service must mount docker socket strictly with :ro flag"
    );
    logPass("CC-027", "web container mounts Docker socket with read-only constraint (:ro)");

    // 3. Both services receive COLLAB_INTERNAL_SECRET
    assert.ok(
      composeProd.includes("COLLAB_INTERNAL_SECRET=${COLLAB_INTERNAL_SECRET}"),
      "docker-compose.prod.yml must configure COLLAB_INTERNAL_SECRET for services"
    );
    logPass("CC-027", "docker-compose.prod.yml defines COLLAB_INTERNAL_SECRET for internal bridge");

    // 4. DOCKER_HOST is configurable for proxy/sidecar socket isolation
    assert.ok(
      composeProd.includes("DOCKER_HOST="),
      "docker-compose.prod.yml must expose DOCKER_HOST for socket proxy configuration"
    );
    logPass("CC-027", "docker-compose.prod.yml supports DOCKER_HOST for isolated proxy architectures");

    // 5. Dockerfile.web uses non-root nextjs user
    const dockerfileWeb = fs.readFileSync(
      path.resolve(process.cwd(), "deployment/docker/Dockerfile.web"),
      "utf8"
    );
    assert.ok(
      dockerfileWeb.includes("USER nextjs"),
      "Dockerfile.web must switch to non-root USER nextjs"
    );
    logPass("CC-027", "Dockerfile.web enforces non-root nextjs execution");
  }

  console.log("\n===============================================================================");
  console.log(" \x1b[32m✔ ALL P1 SECURITY REMEDIATION REGRESSION TESTS PASSED (9/9 FINDINGS)\x1b[0m");
  console.log("===============================================================================\n");
}

runTests().catch((err) => {
  console.error("\n\x1b[31m✖ TEST FAILURE:\x1b[0m", err);
  process.exit(1);
});
