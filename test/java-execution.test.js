process.env.NODE_ENV = process.env.NODE_ENV || "test";
if (!process.env.NEXT_PUBLIC_FIREBASE_API_KEY) {
  process.env.NEXT_PUBLIC_FIREBASE_API_KEY = "test-api-key";
  process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID = "codecraft-test";
}

import assert from "node:assert/strict";
import { SandboxExecutor } from "../src/lib/execution/sandboxExecutor.js";
import { resolveJavaExecutionPlan, stripJavaCommentsAndStrings } from "../src/lib/execution/javaResolver.js";
import { parseExecutionDiagnostics } from "../src/lib/diagnostics.js";
import { checkDockerAvailability } from "../src/lib/execution/dockerDetector.js";

async function runJavaTests() {
  console.log("==================================================");
  console.log("  CodeCraft Java Execution Verification Suite");
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

  // ==========================================
  // Suite 1: Source & Comment/String Sanitization
  // ==========================================
  console.log("--- Suite 1: Java Source Parsing & Token Sanitization ---");

  await test("Strips line comments, block comments, and strings before extracting declarations", () => {
    const code = `
      // public class FakeLineComment { }
      /*
         public class FakeBlockComment { }
      */
      public class ActualMain {
          String fake1 = "public class FakeString { }";
          String fake2 = """
              public class FakeTextBlock { }
          """;
          public static void main(String[] args) {
              System.out.println("Hello");
          }
      }
    `;
    const cleaned = stripJavaCommentsAndStrings(code);
    assert.ok(!cleaned.includes("FakeLineComment"));
    assert.ok(!cleaned.includes("FakeBlockComment"));
    assert.ok(!cleaned.includes("FakeString"));
    assert.ok(!cleaned.includes("FakeTextBlock"));
    assert.ok(cleaned.includes("ActualMain"));

    const plan = resolveJavaExecutionPlan({ source: code });
    assert.equal(plan.publicTypeName, "ActualMain");
    assert.equal(plan.sourceFileName, "ActualMain.java");
    assert.equal(plan.entryClass, "ActualMain");
  });

  // ==========================================
  // Suite 2: Deterministic Java Execution Plan Resolution
  // ==========================================
  console.log("\n--- Suite 2: Execution Plan Resolution Matrix ---");

  await test("Plan: public class main in main.java", () => {
    const plan = resolveJavaExecutionPlan({
      source: `public class main {\n    public static void main(String[] args) {\n        System.out.println("Hello, World!");\n    }\n}`,
      files: [{ name: "main.java", content: "..." }],
    });
    assert.equal(plan.sourceFileName, "main.java");
    assert.equal(plan.entryClass, "main");
    assert.deepEqual(plan.compile, ["javac", "-d", ".", "main.java"]);
    assert.deepEqual(plan.run, ["java", "-Xmx200m", "main"]);
  });

  await test("Plan: public class Main in Main.java", () => {
    const plan = resolveJavaExecutionPlan({
      source: `public class Main {\n    public static void main(String[] args) {\n        System.out.println("Hello, World!");\n    }\n}`,
      files: [{ name: "Main.java", content: "..." }],
    });
    assert.equal(plan.sourceFileName, "Main.java");
    assert.equal(plan.entryClass, "Main");
    assert.deepEqual(plan.compile, ["javac", "-d", ".", "Main.java"]);
    assert.deepEqual(plan.run, ["java", "-Xmx200m", "Main"]);
  });

  await test("Plan: public class Hello in Hello.java", () => {
    const plan = resolveJavaExecutionPlan({
      source: `public class Hello {\n    public static void main(String[] args) {\n        System.out.println("Hello");\n    }\n}`,
      files: [{ name: "Hello.java", content: "..." }],
    });
    assert.equal(plan.sourceFileName, "Hello.java");
    assert.equal(plan.entryClass, "Hello");
    assert.deepEqual(plan.compile, ["javac", "-d", ".", "Hello.java"]);
    assert.deepEqual(plan.run, ["java", "-Xmx200m", "Hello"]);
  });

  await test("Plan: class Main without public", () => {
    const plan = resolveJavaExecutionPlan({
      source: `class Main {\n    public static void main(String[] args) {\n        System.out.println("Hello");\n    }\n}`,
    });
    assert.equal(plan.sourceFileName, "Main.java");
    assert.equal(plan.entryClass, "Main");
    assert.deepEqual(plan.compile, ["javac", "-d", ".", "Main.java"]);
    assert.deepEqual(plan.run, ["java", "-Xmx200m", "Main"]);
  });

  await test("Plan: class main without public", () => {
    const plan = resolveJavaExecutionPlan({
      source: `class main {\n    public static void main(String[] args) {\n        System.out.println("Hello");\n    }\n}`,
      files: [{ name: "main.java", content: "..." }],
    });
    assert.equal(plan.sourceFileName, "main.java");
    assert.equal(plan.entryClass, "main");
    assert.deepEqual(plan.compile, ["javac", "-d", ".", "main.java"]);
    assert.deepEqual(plan.run, ["java", "-Xmx200m", "main"]);
  });

  await test("Plan: multiple classes in one file (Helper then public class main)", () => {
    const code = `
      class Helper {
          static void greet() {}
      }
      public class main {
          public static void main(String[] args) {
              Helper.greet();
          }
      }
    `;
    const plan = resolveJavaExecutionPlan({ source: code });
    assert.equal(plan.sourceFileName, "main.java");
    assert.equal(plan.entryClass, "main");
  });

  await test("Plan: package declaration com.example.demo", () => {
    const code = `
      package com.example.demo;
      public class main {
          public static void main(String[] args) {
              System.out.println("pkg");
          }
      }
    `;
    const plan = resolveJavaExecutionPlan({ source: code });
    assert.equal(plan.packageName, "com.example.demo");
    assert.equal(plan.sourceFileName, "main.java");
    assert.equal(plan.entryClass, "com.example.demo.main");
    assert.deepEqual(plan.compile, ["javac", "-d", ".", "main.java"]);
    assert.deepEqual(plan.run, ["java", "-Xmx200m", "com.example.demo.main"]);
  });

  await test("Plan: multi-file project passes auxiliary .java files to javac", () => {
    const plan = resolveJavaExecutionPlan({
      source: `public class main { public static void main(String[] a){} }`,
      files: [
        { name: "main.java", content: `public class main { public static void main(String[] a){} }` },
        { name: "Helper.java", content: `public class Helper {}` },
        { name: "data.txt", content: `some data` },
      ],
    });
    assert.equal(plan.sourceFileName, "main.java");
    assert.ok(plan.compile.includes("main.java"));
    assert.ok(plan.compile.includes("Helper.java"));
    assert.ok(!plan.compile.includes("data.txt"));
  });

  // ==========================================
  // Suite 3: Diagnostics Parsing (Problems Panel)
  // ==========================================
  console.log("\n--- Suite 3: Java Diagnostics & Problems Panel Verification ---");

  await test("Parses Javac compiler errors for main.java and Main.java", () => {
    const javacErr = `main.java:3: error: ';' expected\n        System.out.println("Hello, World!")\n                                           ^\n1 error`;
    const markers = parseExecutionDiagnostics(javacErr, "java", "main.java");
    assert.equal(markers.length, 1);
    assert.equal(markers[0].startLineNumber, 3);
    assert.equal(markers[0].severity, 8);
    assert.ok(markers[0].message.includes("expected"));
  });

  await test("Parses Java runtime exceptions with stack traces for Problems panel", () => {
    const runtimeErr = `Exception in thread "main" java.lang.ArithmeticException: / by zero\n\tat main.main(main.java:3)`;
    const markers = parseExecutionDiagnostics(runtimeErr, "java", "main.java");
    assert.equal(markers.length, 1);
    assert.equal(markers[0].startLineNumber, 3);
    assert.equal(markers[0].severity, 8);
    assert.ok(markers[0].message.includes("ArithmeticException"));
  });

  // ==========================================
  // Suite 4: Real Docker Sandbox Execution
  // ==========================================
  console.log("\n--- Suite 4: Real Docker Sandbox Execution Matrix ---");

  const dockerStatus = await checkDockerAvailability();
  if (!dockerStatus.available) {
    console.log("  [SKIP] Docker daemon not available for live container executions");
  } else {
    // TEST 1: main.java + public class main -> "Hello, World!"
    await test("TEST 1 (Real Docker): File main.java with public class main", async () => {
      const result = await SandboxExecutor.execute({
        language: "java",
        source: `public class main {\n    public static void main(String[] args) {\n        System.out.println("Hello, World!");\n    }\n}`,
        files: [
          {
            name: "main.java",
            content: `public class main {\n    public static void main(String[] args) {\n        System.out.println("Hello, World!");\n    }\n}`,
          },
        ],
      });

      assert.equal(result.status, "SUCCESS", `Expected SUCCESS but got ${result.status}, stderr: ${result.stderr}`);
      assert.equal(result.exitCode, 0);
      assert.equal(result.stdout.trim(), "Hello, World!");
    });

    // TEST 2: Main.java + public class Main -> "Hello, World!"
    await test("TEST 2 (Real Docker): File Main.java with public class Main", async () => {
      const result = await SandboxExecutor.execute({
        language: "java",
        source: `public class Main {\n    public static void main(String[] args) {\n        System.out.println("Hello, World!");\n    }\n}`,
        files: [
          {
            name: "Main.java",
            content: `public class Main {\n    public static void main(String[] args) {\n        System.out.println("Hello, World!");\n    }\n}`,
          },
        ],
      });

      assert.equal(result.status, "SUCCESS", `Expected SUCCESS but got ${result.status}, stderr: ${result.stderr}`);
      assert.equal(result.exitCode, 0);
      assert.equal(result.stdout.trim(), "Hello, World!");
    });

    // TEST 3: Hello.java + public class Hello -> "Hello"
    await test("TEST 3 (Real Docker): File Hello.java with public class Hello", async () => {
      const result = await SandboxExecutor.execute({
        language: "java",
        source: `public class Hello {\n    public static void main(String[] args) {\n        System.out.println("Hello");\n    }\n}`,
        files: [
          {
            name: "Hello.java",
            content: `public class Hello {\n    public static void main(String[] args) {\n        System.out.println("Hello");\n    }\n}`,
          },
        ],
      });

      assert.equal(result.status, "SUCCESS", `Expected SUCCESS but got ${result.status}, stderr: ${result.stderr}`);
      assert.equal(result.exitCode, 0);
      assert.equal(result.stdout.trim(), "Hello");
    });

    // TEST 4: Intentional compiler error
    await test("TEST 4 (Real Docker): Intentional Java compiler error -> COMPILEERROR + diagnostics", async () => {
      const result = await SandboxExecutor.execute({
        language: "java",
        source: `public class main {\n    public static void main(String[] args) {\n        System.out.println("Missing semicolon")\n    }\n}`,
        files: [
          {
            name: "main.java",
            content: `public class main {\n    public static void main(String[] args) {\n        System.out.println("Missing semicolon")\n    }\n}`,
          },
        ],
      });

      assert.equal(result.status, "COMPILEERROR", `Expected COMPILEERROR but got ${result.status}`);
      assert.notEqual(result.exitCode, 0);
      assert.ok(result.stderr && result.stderr.length > 0, "stderr must contain compiler diagnostic");
      assert.match(result.stderr, /error:/i);

      // Verify Problems panel diagnostic parsing
      const markers = parseExecutionDiagnostics(result.stderr, "java", "main.java");
      assert.ok(markers.length > 0, "Problems panel must have at least 1 diagnostic marker");
      assert.equal(markers[0].startLineNumber, 3);
      assert.equal(markers[0].severity, 8);
    });

    // TEST 5: Intentional runtime exception
    await test("TEST 5 (Real Docker): Java runtime exception -> RUNTIMEERROR + diagnostics", async () => {
      const result = await SandboxExecutor.execute({
        language: "java",
        source: `public class main {\n    public static void main(String[] args) {\n        int x = 10 / 0;\n    }\n}`,
        files: [
          {
            name: "main.java",
            content: `public class main {\n    public static void main(String[] args) {\n        int x = 10 / 0;\n    }\n}`,
          },
        ],
      });

      assert.equal(result.status, "RUNTIMEERROR", `Expected RUNTIMEERROR but got ${result.status}`);
      assert.notEqual(result.exitCode, 0);
      assert.ok(result.stderr && result.stderr.length > 0, "stderr must contain runtime error");
      assert.match(result.stderr, /ArithmeticException/);

      // Verify Problems panel diagnostic parsing
      const markers = parseExecutionDiagnostics(result.stderr, "java", "main.java");
      assert.ok(markers.length > 0, "Problems panel must have at least 1 diagnostic marker");
      assert.equal(markers[0].startLineNumber, 3);
      assert.equal(markers[0].severity, 8);
      assert.ok(markers[0].message.includes("ArithmeticException"));
    });

    // TEST 6: Multi-file project
    await test("TEST 6 (Real Docker): Multi-file Java execution", async () => {
      const helperCode = `public class Helper {\n    public static String getMessage() {\n        return "Multi-file Success";\n    }\n}`;
      const mainCode = `public class main {\n    public static void main(String[] args) {\n        System.out.println(Helper.getMessage());\n    }\n}`;

      const result = await SandboxExecutor.execute({
        language: "java",
        source: mainCode,
        files: [
          { name: "main.java", content: mainCode },
          { name: "Helper.java", content: helperCode },
        ],
      });

      assert.equal(result.status, "SUCCESS", `Expected SUCCESS but got ${result.status}, stderr: ${result.stderr}`);
      assert.equal(result.exitCode, 0);
      assert.equal(result.stdout.trim(), "Multi-file Success");
    });

    // TEST 7: Package declaration
    await test("TEST 7 (Real Docker): Package declaration com.example.demo", async () => {
      const pkgCode = `package com.example.demo;\n\npublic class main {\n    public static void main(String[] args) {\n        System.out.println("Package Success");\n    }\n}`;

      const result = await SandboxExecutor.execute({
        language: "java",
        source: pkgCode,
        files: [
          { name: "main.java", content: pkgCode },
        ],
      });

      assert.equal(result.status, "SUCCESS", `Expected SUCCESS but got ${result.status}, stderr: ${result.stderr}`);
      assert.equal(result.exitCode, 0);
      assert.equal(result.stdout.trim(), "Package Success");
    });
  }

  console.log("\n==================================================");
  console.log(`  Java Verification Suite Finished: ${passed} passed, ${failed} failed`);
  console.log("==================================================");

  if (failed > 0) {
    process.exit(1);
  }
}

runJavaTests();
