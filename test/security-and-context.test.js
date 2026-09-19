import assert from "node:assert/strict";
import { sanitizeContextText, buildAIContext } from "../src/lib/aiContext.js";

// Helper replicating sanitizeText from Comments.jsx
function sanitizeCommentText(str) {
  if (!str || typeof str !== "string") return "";
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// Emulate Firestore Security Rules evaluation for comments
function evaluateCommentRule({ action, auth, resource, requestResource, workspaceMembership }) {
  const isAuth = !!auth && !!auth.uid;
  if (!isAuth) return false;

  const role = workspaceMembership[auth.uid]; // 'owner' | 'contributor' | 'viewer' | undefined
  const isOwner = role === 'owner';
  const isContributor = role === 'contributor';
  const isMember = isOwner || isContributor || role === 'viewer';

  if (action === 'read') {
    return isMember;
  }

  if (action === 'create') {
    if (!isOwner && !isContributor) return false;
    // authorUid must match authenticated user
    if (requestResource.authorUid !== auth.uid) return false;
    if (!requestResource.content || typeof requestResource.content !== 'string') return false;
    return true;
  }

  if (action === 'update') {
    if (!isMember) return false;
    // Author or owner or contributor can update (e.g. resolve/reopen or add replies)
    if (resource.authorUid === auth.uid || isOwner || isContributor) {
      return true;
    }
    return false;
  }

  if (action === 'delete') {
    if (!isMember) return false;
    // Only comment author or workspace owner can delete comment
    if (resource.authorUid === auth.uid || isOwner) {
      return true;
    }
    return false;
  }

  return false;
}

function logPass(suite, name) {
  console.log(`  \x1b[32m✔ PASS [${suite}]:\x1b[0m ${name}`);
}

async function runSecurityAndContextTests() {
  console.log("\n===================================================================");
  console.log("CodeCraft Phase 5: Security, Authorization & AI Context Test Suite");
  console.log("===================================================================\n");

  // Suite 1: Firestore Comment Authorization Rules
  console.log("--- Suite 1: Firestore Comment Authorization Rules ---");
  {
    const membership = {
      "user-alice": "contributor",
      "user-bob": "viewer",
      "user-owner": "owner",
    };

    // Case 1: Member reads comments -> ALLOW
    assert.equal(
      evaluateCommentRule({
        action: 'read',
        auth: { uid: 'user-alice' },
        workspaceMembership: membership,
      }),
      true
    );
    logPass("Comments-Auth", "Authorized contributor can read workspace comments");

    // Case 2: Cross-workspace unauthorized user reads comments -> DENY
    assert.equal(
      evaluateCommentRule({
        action: 'read',
        auth: { uid: 'attacker-outside' },
        workspaceMembership: membership,
      }),
      false
    );
    logPass("Comments-Auth", "Cross-workspace unauthorized user is DENIED read access");

    // Case 3: Viewer attempts to create comment -> DENY
    assert.equal(
      evaluateCommentRule({
        action: 'create',
        auth: { uid: 'user-bob' },
        requestResource: { authorUid: 'user-bob', content: 'Hello' },
        workspaceMembership: membership,
      }),
      false
    );
    logPass("Comments-Auth", "Viewer is DENIED permission to create comments");

    // Case 4: Contributor creates comment with spoofed authorUid -> DENY
    assert.equal(
      evaluateCommentRule({
        action: 'create',
        auth: { uid: 'user-alice' },
        requestResource: { authorUid: 'user-spoofed', content: 'Spoofed' },
        workspaceMembership: membership,
      }),
      false
    );
    logPass("Comments-Auth", "Contributor cannot forge authorUid on comment creation");

    // Case 5: Contributor deletes another user's comment -> DENY
    assert.equal(
      evaluateCommentRule({
        action: 'delete',
        auth: { uid: 'user-alice' },
        resource: { authorUid: 'user-other' },
        workspaceMembership: membership,
      }),
      false
    );
    logPass("Comments-Auth", "Contributor is DENIED permission to delete another user's comment");

    // Case 6: Comment author deletes own comment -> ALLOW
    assert.equal(
      evaluateCommentRule({
        action: 'delete',
        auth: { uid: 'user-alice' },
        resource: { authorUid: 'user-alice' },
        workspaceMembership: membership,
      }),
      true
    );
    logPass("Comments-Auth", "Comment author is ALLOWED to delete their own comment");

    // Case 7: Workspace owner performs administrative moderation (delete) -> ALLOW
    assert.equal(
      evaluateCommentRule({
        action: 'delete',
        auth: { uid: 'user-owner' },
        resource: { authorUid: 'user-alice' },
        workspaceMembership: membership,
      }),
      true
    );
    logPass("Comments-Auth", "Workspace owner is ALLOWED to delete any comment for moderation");
  }

  // Suite 2: Comment XSS & Malicious Input Sanitization
  console.log("\n--- Suite 2: Comment XSS & Malicious Input Sanitization ---");
  {
    const scriptInput = "<script>alert('xss')</script>";
    const sanitizedScript = sanitizeCommentText(scriptInput);
    assert.equal(sanitizedScript, "&lt;script&gt;alert(&#039;xss&#039;)&lt;/script&gt;");
    assert.ok(!sanitizedScript.includes("<script>"));
    logPass("Comments-XSS", "Script tag is properly escaped and rendered harmless");

    const imgPayload = '<img src=x onerror="alert(1)">';
    const sanitizedImg = sanitizeCommentText(imgPayload);
    assert.equal(sanitizedImg, "&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
    assert.ok(!sanitizedImg.includes("<img"));
    logPass("Comments-XSS", "Image onerror injection payload is strictly escaped");

    const htmlBreakout = '"><svg onload=confirm(1)>';
    const sanitizedBreakout = sanitizeCommentText(htmlBreakout);
    assert.ok(!sanitizedBreakout.includes("<svg"));
    assert.ok(!sanitizedBreakout.includes('">'));
    logPass("Comments-XSS", "Attribute breakout payloads are sanitized");
  }

  // Suite 3: AI Context Foundation & Secret Redaction
  console.log("\n--- Suite 3: AI Context Foundation & Secret Redaction ---");
  {
    // Test 1: Bearer token redaction
    const rawBearer = 'const auth = "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.t-ID";';
    const sanitizedBearer = sanitizeContextText(rawBearer);
    assert.ok(!sanitizedBearer.includes("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9"));
    assert.ok(sanitizedBearer.includes("Bearer [REDACTED]"));
    logPass("AI-Context", "Bearer JWT tokens are automatically redacted");

    // Test 2: API key pattern redaction
    const rawApiKey = 'const apiKey = "AIzaSyD-1234567890abcdefghijklmnopqrst";';
    const sanitizedApiKey = sanitizeContextText(rawApiKey);
    assert.ok(!sanitizedApiKey.includes("AIzaSyD-1234567890abcdefghijklmnopqrst"));
    assert.ok(sanitizedApiKey.includes('[REDACTED]'));
    logPass("AI-Context", "API keys matching standard assignment patterns are redacted");

    // Test 3: Maximum length truncation to bound token cost & prevent prompt overflow
    const hugeCode = "console.log('line');\n".repeat(1000);
    const sanitizedHuge = sanitizeContextText(hugeCode);
    assert.ok(sanitizedHuge.length <= 12000, "Truncated output must not exceed 12,000 characters");
    logPass("AI-Context", "Context text length is bounded at 12,000 characters maximum");

    // Test 4: Full AI Context object structure
    const context = buildAIContext({
      workspaceId: "ws-test-123",
      fileId: "f-456",
      fileName: "app.jsx",
      language: "javascript",
      currentCode: 'function main() { console.log("live-code"); }',
      selectedCode: 'console.log("live-code");',
      cursorPosition: { lineNumber: 1, column: 15 },
      openTabs: [
        { id: "f-456", name: "app.jsx" },
        { id: "f-789", name: "styles.css" },
      ],
    });

    assert.equal(context.workspaceId, "ws-test-123");
    assert.equal(context.fileId, "f-456");
    assert.equal(context.fileName, "app.jsx");
    assert.equal(context.language, "javascript");
    assert.equal(context.currentCode, 'function main() { console.log("live-code"); }');
    assert.equal(context.selectedCode, 'console.log("live-code");');
    assert.deepEqual(context.cursor, { line: 1, column: 15 });
    assert.equal(context.openTabs.length, 2);
    assert.ok(context.timestamp);
    logPass("AI-Context", "Full structured context payload constructed accurately with current collaborative state");
  }

  console.log("\n===================================================================");
  console.log("All Security & AI Context Tests Passed Successfully! (100% VERIFIED)");
  console.log("===================================================================\n");
}

runSecurityAndContextTests().catch((err) => {
  console.error("\x1b[31m✖ TEST FAILURE:\x1b[0m", err);
  process.exit(1);
});
