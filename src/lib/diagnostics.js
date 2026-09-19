/**
 * CodeCraft Diagnostics and Error Marker Parser (Phase 10 Hardening).
 *
 * Converts runtime tracebacks and compiler error output from supported languages
 * into Monaco editor marker diagnostics.
 */

/**
 * Parses execution or compiler output into structured Monaco markers.
 *
 * @param {string} output - Raw stderr or stdout containing error output
 * @param {string} language - Programming language (javascript, python, cpp, c, java)
 * @param {string} currentFileName - Active file name for relative matching
 * @returns {Array<{ startLineNumber: number, startColumn: number, endLineNumber: number, endColumn: number, message: string, severity: number }>}
 */
function matchesFile(candidateFile, currentFileName, language) {
  if (!candidateFile) return false;
  if (!currentFileName) return true;

  const cand = candidateFile.replace(/\\/g, "/").split("/").pop().toLowerCase();
  const curr = currentFileName.replace(/\\/g, "/").split("/").pop().toLowerCase();

  // Exact basename match (e.g. "app.js" === "app.js")
  if (cand === curr) return true;

  // Name without extension match (e.g. "main" === "main.js")
  const candNoExt = cand.replace(/\.[^.]+$/, "");
  const currNoExt = curr.replace(/\.[^.]+$/, "");
  if (candNoExt === currNoExt && candNoExt.length > 0) return true;

  return false;
}

/**
 * Parses execution or compiler output into structured Monaco markers.
 *
 * @param {string} output - Raw stderr or stdout containing error output
 * @param {string} language - Programming language (javascript, python, cpp, c, java)
 * @param {string} currentFileName - Active file name for relative matching
 * @returns {Array<{ startLineNumber: number, startColumn: number, endLineNumber: number, endColumn: number, message: string, severity: number }>}
 */
export function parseExecutionDiagnostics(output, language, currentFileName = "") {
  if (!output || typeof output !== "string") return [];

  const markers = [];
  const lines = output.split(/\r?\n/);
  const lang = (language || "").toLowerCase();

  // Monaco MarkerSeverity constants (3 = Warning, 8 = Error)
  const SEVERITY_ERROR = 8;
  const SEVERITY_WARNING = 4;

  const seenLines = new Map();
  function addMarker(lineNum, colNum, msg, severity = SEVERITY_ERROR) {
    if (seenLines.has(lineNum)) {
      const existing = seenLines.get(lineNum);
      if (existing.startColumn === 1 && colNum > 1) {
        existing.startColumn = colNum;
        existing.endColumn = colNum + 10;
      }
      if (!existing.message.includes("Error") && msg.includes("Error")) {
        existing.message = msg;
      }
      return;
    }
    const marker = {
      startLineNumber: lineNum,
      startColumn: colNum,
      endLineNumber: lineNum,
      endColumn: colNum > 1 ? colNum + 10 : 120,
      message: msg,
      severity,
    };
    seenLines.set(lineNum, marker);
    markers.push(marker);
  }

  if (lang === "python" || lang === "py") {
    // Python traceback parsing
    for (let i = 0; i < lines.length; i++) {
      const match = lines[i].match(/File\s+["']([^"']+)["'],\s+line\s+(\d+)/i);
      if (match) {
        const file = match[1];
        if (!matchesFile(file, currentFileName, lang)) continue;

        const lineNum = parseInt(match[2], 10);
        let colNum = 1;
        let errMsg = "Python runtime exception";

        for (let j = i + 1; j < Math.min(i + 8, lines.length); j++) {
          const next = lines[j].trim();
          const caretIdx = lines[j].indexOf("^");
          if (caretIdx !== -1 && lines[j].trim().replace(/\^/g, "").length === 0) {
            colNum = caretIdx + 1;
          }
          if (/^[A-Za-z]+Error:/i.test(next) || /^[A-Za-z]+Exception:/i.test(next)) {
            errMsg = next;
            break;
          }
        }

        addMarker(lineNum, colNum, errMsg, SEVERITY_ERROR);
      }
    }
  } else if (lang === "javascript" || lang === "js" || lang === "typescript" || lang === "ts") {
    // 1. Locate primary error message (e.g. "TypeError: item.quantity is not a function")
    let primaryErrMsg = "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (/^[A-Za-z]+Error:\s*.+$/i.test(trimmed) || /^Error:\s*.+$/i.test(trimmed)) {
        primaryErrMsg = trimmed;
        break;
      }
    }

    // 2. Scan lines for syntax headers, carets, and stack trace frames
    for (let i = 0; i < lines.length; i++) {
      // Syntax header: file:line or file:line:col
      const lineMatch = lines[i].match(/^([^:\s]+):(\d+)(?::(\d+))?$/);
      if (lineMatch) {
        const file = lineMatch[1];
        if (matchesFile(file, currentFileName, lang)) {
          const lineNum = parseInt(lineMatch[2], 10);
          let colNum = lineMatch[3] ? parseInt(lineMatch[3], 10) : 1;

          // Look ahead for caret symbol
          for (let j = i + 1; j < Math.min(i + 4, lines.length); j++) {
            const caretIdx = lines[j].indexOf("^");
            if (caretIdx !== -1 && lines[j].trim().replace(/\^/g, "").length === 0) {
              colNum = caretIdx + 1;
              break;
            }
          }

          let msg = primaryErrMsg;
          if (!msg) {
            for (let j = i + 1; j < Math.min(i + 8, lines.length); j++) {
              if (/^[A-Za-z]+Error:/i.test(lines[j].trim())) {
                msg = lines[j].trim();
                break;
              }
            }
          }
          addMarker(lineNum, colNum, msg || "JavaScript execution error", SEVERITY_ERROR);
        }
      }

      // Stack trace frame: at Object.<anonymous> (file:line:col) or at file:line:col
      const stackMatch = lines[i].match(/at\s+(?:.*?\s+)?\(?(.*?):(\d+):(\d+)\)?/);
      if (stackMatch) {
        const file = stackMatch[1];
        if (matchesFile(file, currentFileName, lang)) {
          const lineNum = parseInt(stackMatch[2], 10);
          const colNum = parseInt(stackMatch[3], 10);
          const msg = primaryErrMsg || (lines[0] && lines[0].includes("Error") ? lines[0] : "Runtime error");
          addMarker(lineNum, colNum, msg, SEVERITY_ERROR);
        }
      }
    }
  } else if (lang === "cpp" || lang === "c" || lang === "c++") {
    // GCC / Clang format: filename:line:col: error: message
    for (const line of lines) {
      const match = line.match(/^([^:\s]+):(\d+):(\d+):\s+(error|warning):\s+(.+)$/i);
      if (match) {
        const file = match[1];
        if (matchesFile(file, currentFileName, lang)) {
          const lineNum = parseInt(match[2], 10);
          const colNum = parseInt(match[3], 10);
          const isWarn = match[4].toLowerCase() === "warning";
          const msg = match[5].trim();

          markers.push({
            startLineNumber: lineNum,
            startColumn: colNum,
            endLineNumber: lineNum,
            endColumn: colNum + 5,
            message: msg,
            severity: isWarn ? SEVERITY_WARNING : SEVERITY_ERROR,
          });
        }
      }
    }
  } else if (lang === "java") {
    // 1. Javac compiler error format: Main.java:12: error: message
    for (const line of lines) {
      const match = line.match(/^([^:\s]+):(\d+):\s+(error|warning):\s+(.+)$/i);
      if (match) {
        const file = match[1];
        if (matchesFile(file, currentFileName, lang)) {
          const lineNum = parseInt(match[2], 10);
          const isWarn = match[3].toLowerCase() === "warning";
          const msg = match[4].trim();

          markers.push({
            startLineNumber: lineNum,
            startColumn: 1,
            endLineNumber: lineNum,
            endColumn: 120,
            message: msg,
            severity: isWarn ? SEVERITY_WARNING : SEVERITY_ERROR,
          });
        }
      }
    }

    // 2. Java runtime exception format:
    // Exception in thread "main" java.lang.ArithmeticException: / by zero
    //     at main.main(main.java:3)
    if (markers.length === 0) {
      let primaryExceptionMsg = "";
      for (const line of lines) {
        const trimmed = line.trim();
        const excMatch = trimmed.match(/^Exception in thread "[^"]+"\s+(.+)$/i);
        if (excMatch) {
          primaryExceptionMsg = excMatch[1];
          break;
        }
        if (/^[a-zA-Z_$][a-zA-Z0-9_$.]*(?:Exception|Error)(?::\s+.*)?$/.test(trimmed)) {
          primaryExceptionMsg = trimmed;
          break;
        }
      }

      if (primaryExceptionMsg) {
        let frameFound = false;
        for (const line of lines) {
          const frameMatch = line.match(/^\s*at\s+.*?\(([^:()]+):(\d+)\)/);
          if (frameMatch) {
            const file = frameMatch[1];
            if (matchesFile(file, currentFileName, lang)) {
              const lineNum = parseInt(frameMatch[2], 10);
              addMarker(lineNum, 1, primaryExceptionMsg, SEVERITY_ERROR);
              frameFound = true;
              break;
            }
          }
        }
        if (!frameFound) {
          addMarker(1, 1, primaryExceptionMsg, SEVERITY_ERROR);
        }
      }
    }
  }

  return markers;
}
