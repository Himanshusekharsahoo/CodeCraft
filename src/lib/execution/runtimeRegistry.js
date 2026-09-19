import { ExecutionError, ExecutionErrorCodes } from "./errors.js";

/**
 * Immutable Language Runtime Registry.
 * Defines trusted, pinned Docker images, default source filenames,
 * and deterministic compile/run argument arrays.
 *
 * Arbitrary images or commands provided by the client are strictly forbidden.
 */
const REGISTRY_OBJECT = {
  javascript: {
    language: "javascript",
    aliases: ["js", "node"],
    image: "node:20-alpine",
    sourceFileName: "main.js",
    requiresCompilation: false,
    compile: null,
    run: ["node", "--max-old-space-size=200", "main.js"],
    timeoutMs: 8000,
    memoryMb: 256,
  },
  typescript: {
    language: "typescript",
    aliases: ["ts"],
    image: "node:22-alpine",
    sourceFileName: "main.ts",
    requiresCompilation: false,
    compile: null,
    // CC-022: Native zero-dependency execution via Node 22 type stripping (eliminates missing ts-node dependency)
    run: ["node", "--no-warnings", "--experimental-strip-types", "main.ts"],
    timeoutMs: 8000,
    memoryMb: 256,
  },
  python: {
    language: "python",
    aliases: ["py", "python3"],
    image: "python:3.11-alpine",
    sourceFileName: "main.py",
    requiresCompilation: false,
    compile: null,
    run: ["python3", "-u", "main.py"],
    timeoutMs: 8000,
    memoryMb: 256,
  },
  java: {
    language: "java",
    aliases: [],
    image: "eclipse-temurin:17-alpine",
    sourceFileName: "Main.java",
    requiresCompilation: true,
    compile: ["javac", "Main.java"],
    run: ["java", "-Xmx200m", "Main"],
    timeoutMs: 10000,
    memoryMb: 384,
  },
  cpp: {
    language: "cpp",
    aliases: ["c++"],
    image: "gcc:13-alpine",
    sourceFileName: "main.cpp",
    requiresCompilation: true,
    compile: ["g++", "-O2", "-std=c++17", "-o", "main", "main.cpp"],
    run: ["./main"],
    timeoutMs: 10000,
    memoryMb: 256,
  },
  c: {
    language: "c",
    aliases: [],
    image: "gcc:13-alpine",
    sourceFileName: "main.c",
    requiresCompilation: true,
    compile: ["gcc", "-O2", "-std=c11", "-o", "main", "main.c"],
    run: ["./main"],
    timeoutMs: 10000,
    memoryMb: 256,
  },
  php: {
    language: "php",
    aliases: [],
    image: "php:8.3-cli-alpine",
    sourceFileName: "main.php",
    requiresCompilation: false,
    compile: null,
    run: ["php", "main.php"],
    timeoutMs: 8000,
    memoryMb: 256,
  },
};

/**
 * Normalizes and retrieves runtime configuration for a requested language.
 *
 * @param {string} rawLanguage
 * @returns {object} Runtime configuration
 */
export function getRuntimeConfig(rawLanguage) {
  if (!rawLanguage || typeof rawLanguage !== "string") {
    throw new ExecutionError(
      ExecutionErrorCodes.UNSUPPORTED_LANGUAGE,
      "Language must be specified as a non-empty string",
      400
    );
  }

  const normalized = rawLanguage.trim().toLowerCase();

  // Direct match
  if (RUNTIME_REGISTRY[normalized]) {
    return RUNTIME_REGISTRY[normalized];
  }

  // Alias lookup
  for (const config of Object.values(RUNTIME_REGISTRY)) {
    if (config.aliases.includes(normalized)) {
      return config;
    }
  }

  const supported = Object.keys(RUNTIME_REGISTRY).join(", ");
  throw new ExecutionError(
    ExecutionErrorCodes.UNSUPPORTED_LANGUAGE,
    `Language '${rawLanguage}' is not supported. Supported languages: ${supported}`,
    400
  );
}

/**
 * Returns list of all supported language identifiers.
 *
 * @returns {string[]}
 */
export function isLanguageSupported(rawLanguage) {
  try {
    return Boolean(getRuntimeConfig(rawLanguage));
  } catch {
    return false;
  }
}

export function getSupportedLanguages() {
  return Object.keys(RUNTIME_REGISTRY);
}


// Deep freeze runtime configurations
for (const key of Object.keys(REGISTRY_OBJECT)) {
  if (Array.isArray(REGISTRY_OBJECT[key].compile)) {
    Object.freeze(REGISTRY_OBJECT[key].compile);
  }
  if (Array.isArray(REGISTRY_OBJECT[key].run)) {
    Object.freeze(REGISTRY_OBJECT[key].run);
  }
  if (Array.isArray(REGISTRY_OBJECT[key].aliases)) {
    Object.freeze(REGISTRY_OBJECT[key].aliases);
  }
  Object.freeze(REGISTRY_OBJECT[key]);
}
Object.freeze(REGISTRY_OBJECT);

export const RUNTIME_REGISTRY = REGISTRY_OBJECT;
export const SUPPORTED_RUNTIMES = REGISTRY_OBJECT;
