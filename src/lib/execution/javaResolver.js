import path from "node:path";
import { validateExecutionFilePath } from "./security.js";

/**
 * Strips block comments, line comments, character literals, and string literals (including Java 15 text blocks)
 * from Java source code so regex analysis only matches real declarations.
 *
 * @param {string} code
 * @returns {string} Cleaned code with whitespace preserved
 */
export function stripJavaCommentsAndStrings(code) {
  if (!code || typeof code !== "string") return "";
  return code
    .replace(/"""[\s\S]*?"""/g, '""')       // Java 15+ multiline text blocks
    .replace(/\/\*[\s\S]*?\*\//g, " ")       // Block comments
    .replace(/\/\/.*/g, " ")                 // Line comments
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')     // String literals
    .replace(/'(?:[^'\\]|\\.)*'/g, "''");    // Character literals
}

/**
 * Resolves a deterministic, secure execution plan for Java code execution.
 * Correctly aligns:
 * 1. Source filename (e.g. main.java, Main.java, Hello.java)
 * 2. Public class / entry class name
 * 3. Compilation command arguments
 * 4. Runtime entrypoint class (including package prefix if applicable)
 *
 * @param {object} params
 * @param {string} [params.source]
 * @param {Array<{ name: string, content: string }>} [params.files]
 * @param {string} [params.entrypoint]
 * @param {object} [defaultRuntime]
 * @returns {{
 *   sourceFileName: string,
 *   entryClass: string,
 *   packageName: string | null,
 *   publicTypeName: string | null,
 *   mainClassName: string | null,
 *   compile: string[],
 *   run: string[]
 * }}
 */
export function resolveJavaExecutionPlan(params, defaultRuntime = {}) {
  let primarySource = typeof params?.source === "string" ? params.source : "";
  let candidateFileName = null;

  // 1. If params.entrypoint is given, look for matching file or use as filename
  if (params?.entrypoint && typeof params.entrypoint === "string") {
    const epClean = path.basename(params.entrypoint.trim());
    if (/\.java$/i.test(epClean)) {
      candidateFileName = epClean;
    }
    if (Array.isArray(params.files)) {
      const matched = params.files.find(
        (f) => f?.name && (f.name === params.entrypoint || path.basename(f.name) === epClean)
      );
      if (matched) {
        candidateFileName = path.basename(matched.name);
        if (!primarySource && typeof matched.content === "string") {
          primarySource = matched.content;
        }
      }
    }
  }

  // 2. Check params.files for candidate Java files if not yet determined
  if (Array.isArray(params?.files) && params.files.length > 0) {
    if (!candidateFileName && primarySource) {
      const match = params.files.find(
        (f) => f?.name && /\.java$/i.test(f.name) && f.content === primarySource
      );
      if (match) {
        candidateFileName = path.basename(match.name);
      }
    }
    if (!candidateFileName) {
      const firstJava = params.files.find((f) => f?.name && /\.java$/i.test(f.name));
      if (firstJava) {
        candidateFileName = path.basename(firstJava.name);
        if (!primarySource && typeof firstJava.content === "string") {
          primarySource = firstJava.content;
        }
      }
    }
  }

  // 3. Parse cleaned source code
  const cleaned = stripJavaCommentsAndStrings(primarySource);

  // Extract package name
  const pkgMatch = cleaned.match(
    /\bpackage\s+([a-zA-Z_$][a-zA-Z0-9_$]*(?:\.[a-zA-Z_$][a-zA-Z0-9_$]*)*)\s*;/
  );
  const packageName = pkgMatch ? pkgMatch[1] : null;

  // Extract public class, record, or enum
  const publicTypeMatch = cleaned.match(
    /\bpublic\s+(?:(?:final|abstract|sealed|non-sealed|static)\s+)*(?:class|record|enum)\s+([a-zA-Z_$][a-zA-Z0-9_$]*)/
  );
  const publicTypeName = publicTypeMatch ? publicTypeMatch[1] : null;

  // Extract class containing public static void main
  let mainClassName = null;
  const mainMethodIdx = cleaned.search(
    /\b(?:public\s+static|static\s+public)\s+void\s+main\s*\(/
  );
  if (mainMethodIdx !== -1) {
    const codeBeforeMain = cleaned.slice(0, mainMethodIdx);
    const classMatches = [
      ...codeBeforeMain.matchAll(/\b(?:class|record|enum)\s+([a-zA-Z_$][a-zA-Z0-9_$]*)/g),
    ];
    if (classMatches.length > 0) {
      mainClassName = classMatches[classMatches.length - 1][1];
    }
  }

  // 4. Resolve the source file name
  let resolvedSourceFileName = "Main.java";
  if (publicTypeName) {
    // Java specification strictly requires the file to be named <PublicType>.java
    resolvedSourceFileName = `${publicTypeName}.java`;
  } else if (candidateFileName) {
    resolvedSourceFileName = candidateFileName;
  } else if (mainClassName) {
    resolvedSourceFileName = `${mainClassName}.java`;
  } else if (defaultRuntime.sourceFileName) {
    resolvedSourceFileName = defaultRuntime.sourceFileName;
  }

  // Sanitize resolvedSourceFileName to strictly alphanumeric Java file name
  if (!/^[a-zA-Z0-9_$-]+\.java$/i.test(resolvedSourceFileName)) {
    resolvedSourceFileName = "Main.java";
  }

  // 5. Determine entry class to execute
  let entryClass = publicTypeName || mainClassName;
  if (!entryClass) {
    if (candidateFileName) {
      entryClass = candidateFileName.replace(/\.java$/i, "");
    } else {
      entryClass = resolvedSourceFileName.replace(/\.java$/i, "");
    }
  }

  // Sanitize entryClass
  if (!/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(entryClass)) {
    entryClass = "Main";
  }

  // Fully qualified class name with package if present
  let fullyQualifiedClass = packageName ? `${packageName}.${entryClass}` : entryClass;
  if (!/^[a-zA-Z_$][a-zA-Z0-9_$]*(?:\.[a-zA-Z_$][a-zA-Z0-9_$]*)*$/.test(fullyQualifiedClass)) {
    fullyQualifiedClass = entryClass;
  }

  // 6. Gather auxiliary Java files from params.files to pass to javac
  const additionalCompileFiles = [];
  if (Array.isArray(params?.files)) {
    for (const file of params.files) {
      if (!file?.name || !/\.java$/i.test(file.name)) continue;
      const base = path.basename(file.name);
      if (base.toLowerCase() === resolvedSourceFileName.toLowerCase()) continue;
      try {
        const validatedRel = validateExecutionFilePath(file.name);
        if (!additionalCompileFiles.includes(validatedRel)) {
          additionalCompileFiles.push(validatedRel);
        }
      } catch {
        // Skip invalid file paths
      }
    }
  }

  return {
    sourceFileName: resolvedSourceFileName,
    entryClass: fullyQualifiedClass,
    packageName,
    publicTypeName,
    mainClassName,
    compile: ["javac", "-d", ".", resolvedSourceFileName, ...additionalCompileFiles],
    run: ["java", "-Xmx200m", fullyQualifiedClass],
  };
}
