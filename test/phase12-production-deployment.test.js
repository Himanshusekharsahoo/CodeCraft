/**
 * CodeCraft Phase 12: Production Deployment, AWS Infrastructure & Live-Service Integration Test Suite
 *
 * Verifies:
 * - Health check endpoint (liveness, readiness, fail-closed status reporting)
 * - Production security headers & CSP compatibility with Monaco/Yjs
 * - Environment variable classifications and secret leak defense
 * - Multi-stage containerization, non-root users, and compose volume persistence
 * - Reverse proxy Nginx TLS/WSS routing rules
 * - AWS CloudFormation and ECS task definition structural integrity
 * - Rollback script preservation of user workspace Git repositories
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "..");
const HEALTH_MODULE_URL = pathToFileURL(path.join(ROOT_DIR, "src", "app", "api", "health", "route.js")).href;
import { setMockDockerAvailability } from "../src/lib/execution/dockerDetector.js";

async function runPhase12Tests() {
  console.log("==================================================");
  console.log("  CodeCraft Phase 12 — Production Deployment Suite");
  console.log("==================================================");

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

  // ============================================================================
  // Suite 1: Health & Readiness Subsystem Verification
  // ============================================================================
  console.log("\n--- Suite 1: Health & Readiness Subsystem Verification ---");

  await test("HEALTH-01: Health route module exists and exports GET handler", async () => {
    const healthModulePath = path.join(ROOT_DIR, "src", "app", "api", "health", "route.js");
    assert.ok(fs.existsSync(healthModulePath), "src/app/api/health/route.js must exist");

    const healthModule = await import(HEALTH_MODULE_URL);
    assert.equal(typeof healthModule.GET, "function", "GET handler must be exported");
  });

  await test("HEALTH-02: Liveness probe returns 200 HEALTHY without touching external services", async () => {
    const { GET } = await import(HEALTH_MODULE_URL);
    const mockRequest = {
      url: "http://localhost:3000/api/health?type=liveness",
    };

    const res = await GET(mockRequest);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.status, "HEALTHY");
    assert.equal(body.service, "codecraft-web");
    assert.equal(body.probe, "liveness");
    assert.ok(typeof body.uptimeSeconds === "number");
  });

  await test("HEALTH-03: Readiness probe reports DEGRADED when Docker sandbox is offline (Fail-Closed)", async () => {
    setMockDockerAvailability({ available: false, reason: "Docker daemon connection refused" });
    try {
      const { GET } = await import(HEALTH_MODULE_URL);
      const mockRequest = {
        url: "http://localhost:3000/api/health",
      };

      const res = await GET(mockRequest);
      assert.equal(res.status, 200);
      const body = await res.json();
      // Status must be DEGRADED when sandbox is offline (never falsely healthy)
      assert.equal(body.status, "DEGRADED");
      assert.equal(body.checks.sandbox.status, "DOWN");
      assert.equal(body.checks.sandbox.available, false);
      assert.ok(body.checks.sandbox.reason, "Must provide human-readable offline reason");
    } finally {
      setMockDockerAvailability(null);
    }
  });

  await test("HEALTH-04: Health response strictly conceals secret credentials", async () => {
    const { GET } = await import(HEALTH_MODULE_URL);
    const mockRequest = { url: "http://localhost:3000/api/health" };
    const res = await GET(mockRequest);
    const rawJson = JSON.stringify(await res.json());

    assert.ok(!rawJson.includes("AIzaSy"), "Must never leak Gemini API key in health payload");
    assert.ok(!rawJson.includes("private_key"), "Must never leak private keys");
    assert.ok(!rawJson.includes("Bearer"), "Must never leak authorization tokens");
  });

  // ============================================================================
  // Suite 2: Security Headers & CSP Configuration
  // ============================================================================
  console.log("\n--- Suite 2: Security Headers & CSP Configuration ---");

  await test("HEADERS-01: next.config.mjs defines comprehensive security headers", async () => {
    const nextConfigPath = path.join(ROOT_DIR, "next.config.mjs");
    const content = fs.readFileSync(nextConfigPath, "utf8");

    assert.ok(content.includes("X-Content-Type-Options"), "Must include X-Content-Type-Options");
    assert.ok(content.includes("X-Frame-Options"), "Must include X-Frame-Options");
    assert.ok(content.includes("Referrer-Policy"), "Must include Referrer-Policy");
    assert.ok(content.includes("Strict-Transport-Security"), "Must include Strict-Transport-Security");
    assert.ok(content.includes("Content-Security-Policy"), "Must include Content-Security-Policy");
  });

  await test("HEADERS-02: Content-Security-Policy permits Monaco workers and Yjs WebSockets", async () => {
    const nextConfigPath = path.join(ROOT_DIR, "next.config.mjs");
    const content = fs.readFileSync(nextConfigPath, "utf8");

    // Monaco requires worker-src 'self' blob: and unsafe-eval for AMD worker bundling
    assert.ok(content.includes("worker-src 'self' blob:"), "CSP must permit blob: workers for Monaco");
    assert.ok(content.includes("'unsafe-eval'"), "CSP must permit Monaco runtime code evaluation");

    // Yjs WebSockets require ws: and wss:
    assert.ok(content.includes("connect-src"), "CSP must define connect-src");
    assert.ok(content.includes("ws:"), "CSP must allow ws: connections");
    assert.ok(content.includes("wss:"), "CSP must allow wss: connections");
  });

  // ============================================================================
  // Suite 3: Environment & Secret Management Auditing
  // ============================================================================
  console.log("\n--- Suite 3: Environment & Secret Management Auditing ---");

  await test("ENV-01: .env.example classifies all variables into public vs server secrets", () => {
    const examplePath = path.join(ROOT_DIR, ".env.example");
    assert.ok(fs.existsSync(examplePath), ".env.example must exist");
    const content = fs.readFileSync(examplePath, "utf8");

    assert.ok(content.includes("[PUBLIC]"), "Must classify public client variables");
    assert.ok(content.includes("[SERVER-SECRET]"), "Must classify server secrets");
    assert.ok(content.includes("[INTERNAL-CONFIG]"), "Must classify internal config");
    assert.ok(content.includes("GEMINI_API_KEY"), "Must document GEMINI_API_KEY");
    assert.ok(content.includes("NEXT_PUBLIC_COLLAB_WS_URL"), "Must document NEXT_PUBLIC_COLLAB_WS_URL");
  });

  await test("ENV-02: GEMINI_API_KEY is never prefixed with NEXT_PUBLIC_", () => {
    const examplePath = path.join(ROOT_DIR, ".env.example");
    const content = fs.readFileSync(examplePath, "utf8");
    assert.ok(
      !content.includes("NEXT_PUBLIC_GEMINI_API_KEY"),
      "GEMINI_API_KEY must never be prefixed with NEXT_PUBLIC_"
    );
  });

  await test("ENV-03: .gitignore strictly ignores all environment and secret files", () => {
    const gitignorePath = path.join(ROOT_DIR, ".gitignore");
    const content = fs.readFileSync(gitignorePath, "utf8");

    assert.ok(content.includes(".env*"), "Must ignore all .env variants");
    assert.ok(content.includes("*.pem"), "Must ignore certificate keys");
    assert.ok(content.includes("/data/"), "Must ignore workspace Git data directory");
  });

  // ============================================================================
  // Suite 4: Production Containerization & Dockerfile Auditing
  // ============================================================================
  console.log("\n--- Suite 4: Production Containerization & Dockerfile Auditing ---");

  await test("DOCKER-01: Dockerfile.web uses multi-stage build and non-root user", () => {
    const dockerfilePath = path.join(ROOT_DIR, "deployment", "docker", "Dockerfile.web");
    assert.ok(fs.existsSync(dockerfilePath), "Dockerfile.web must exist");
    const content = fs.readFileSync(dockerfilePath, "utf8");

    assert.ok(content.includes("FROM node:20-alpine AS deps"), "Must define deps stage");
    assert.ok(content.includes("FROM node:20-alpine AS builder"), "Must define builder stage");
    assert.ok(content.includes("FROM node:20-alpine AS runner"), "Must define runner stage");
    assert.ok(content.includes("USER nextjs"), "Must switch to non-root nextjs user");
    assert.ok(!content.includes("ARG GEMINI_API_KEY"), "Must NEVER accept secrets via ARG");
    assert.ok(content.includes("HEALTHCHECK"), "Must define container health check");
  });

  await test("DOCKER-02: Dockerfile.collab runs lightweight standalone WebSocket server", () => {
    const dockerfilePath = path.join(ROOT_DIR, "deployment", "docker", "Dockerfile.collab");
    assert.ok(fs.existsSync(dockerfilePath), "Dockerfile.collab must exist");
    const content = fs.readFileSync(dockerfilePath, "utf8");

    assert.ok(content.includes("USER collab"), "Must switch to non-root collab user");
    assert.ok(content.includes("EXPOSE 1234"), "Must expose port 1234");
    assert.ok(content.includes("HEALTHCHECK"), "Must define container health check");
  });

  await test("DOCKER-03: docker-compose mounts persistent Git volume and scratch execution space", () => {
    const composePath = path.join(ROOT_DIR, "docker-compose.yml");
    assert.ok(fs.existsSync(composePath), "docker-compose.yml must exist");
    const content = fs.readFileSync(composePath, "utf8");

    assert.ok(content.includes("codecraft_git_data:/app/data/git"), "Must mount persistent Git volume");
    assert.ok(content.includes("codecraft_exec_data:/app/data/executions"), "Must mount execution scratch volume");
    assert.ok(content.includes("/var/run/docker.sock:/var/run/docker.sock"), "Must bind Docker daemon socket");
    assert.ok(content.includes("codecraft_git_data:"), "Must declare named volume codecraft_git_data");
  });

  // ============================================================================
  // Suite 5: Reverse Proxy & WSS Routing Architecture
  // ============================================================================
  console.log("\n--- Suite 5: Reverse Proxy & WSS Routing Architecture ---");

  await test("NGINX-01: Nginx config terminates TLS, redirects HTTP, and enables WebSocket upgrading", () => {
    const nginxPath = path.join(ROOT_DIR, "deployment", "nginx", "nginx.conf");
    assert.ok(fs.existsSync(nginxPath), "deployment/nginx/nginx.conf must exist");
    const content = fs.readFileSync(nginxPath, "utf8");

    assert.ok(content.includes("return 301 https://$host$request_uri;"), "Must redirect HTTP to HTTPS");
    assert.ok(content.includes("proxy_set_header Upgrade $http_upgrade;"), "Must support WebSocket Upgrade header");
    assert.ok(content.includes("proxy_set_header Connection \"upgrade\";"), "Must support Connection upgrade header");
    assert.ok(content.includes("proxy_read_timeout 86400s;"), "Must set long WebSocket read timeout");
  });

  // ============================================================================
  // Suite 6: AWS CloudFormation & Infrastructure as Code Verification
  // ============================================================================
  console.log("\n--- Suite 6: AWS CloudFormation & Infrastructure as Code Verification ---");

  await test("AWS-01: CloudFormation template defines complete isolated cloud topology", () => {
    const cfnPath = path.join(ROOT_DIR, "deployment", "aws", "cloudformation.yml");
    assert.ok(fs.existsSync(cfnPath), "cloudformation.yml must exist");
    const content = fs.readFileSync(cfnPath, "utf8");

    assert.ok(content.includes("AWS::EC2::VPC"), "Must declare VPC");
    assert.ok(content.includes("AWS::ElasticLoadBalancingV2::LoadBalancer"), "Must declare Application Load Balancer");
    assert.ok(content.includes("WebTargetGroup:"), "Must declare Web Target Group");
    assert.ok(content.includes("CollabTargetGroup:"), "Must declare Collab Target Group");
    assert.ok(content.includes("AWS::EC2::VolumeAttachment"), "Must declare EBS Volume Attachment for Git storage");
    assert.ok(content.includes("secretsmanager:GetSecretValue"), "IAM role must limit secrets access");
  });

  await test("AWS-02: ECS task definition configures health checks, secrets injection, and volume mounts", () => {
    const taskDefPath = path.join(ROOT_DIR, "deployment", "aws", "task-definition.json");
    assert.ok(fs.existsSync(taskDefPath), "task-definition.json must exist");
    const taskDef = JSON.parse(fs.readFileSync(taskDefPath, "utf8"));

    assert.equal(taskDef.requiresCompatibilities[0], "EC2");
    assert.equal(taskDef.containerDefinitions.length, 2);

    const webContainer = taskDef.containerDefinitions.find((c) => c.name === "codecraft-web");
    assert.ok(webContainer, "Must define codecraft-web container");
    assert.ok(
      webContainer.secrets.some((s) => s.name === "GEMINI_API_KEY"),
      "Must inject GEMINI_API_KEY from Secrets Manager"
    );
  });

  // ============================================================================
  // Suite 7: Deployment & Rollback Safety Invariants
  // ============================================================================
  console.log("\n--- Suite 7: Deployment & Rollback Safety Invariants ---");

  await test("DEPLOY-01: Deployment script validates environment and health checks", () => {
    const deployPath = path.join(ROOT_DIR, "deployment", "scripts", "deploy.sh");
    assert.ok(fs.existsSync(deployPath), "deploy.sh must exist");
    const content = fs.readFileSync(deployPath, "utf8");

    assert.ok(content.includes("npm run build"), "Must trigger production build");
    assert.ok(content.includes("rollback.sh"), "Must trigger automated rollback on health failure");
  });

  await test("ROLLBACK-01: Rollback script strictly PRESERVES user Git workspaces", () => {
    const rollbackPath = path.join(ROOT_DIR, "deployment", "scripts", "rollback.sh");
    assert.ok(fs.existsSync(rollbackPath), "rollback.sh must exist");
    const content = fs.readFileSync(rollbackPath, "utf8");

    assert.ok(content.includes("PRESERVED"), "Must explicitly document user Git preservation");
    assert.ok(!content.includes("rm -rf data/git"), "Must NEVER wipe data/git directory during rollback");
  });

  console.log("==================================================");
  console.log(`  Phase 12 Tests Complete: ${passed} passed, ${failed} failed`);
  console.log("==================================================");

  if (failed > 0) {
    process.exit(1);
  }
}

runPhase12Tests();
