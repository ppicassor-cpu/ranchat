const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      continue;
    }

    const name = token.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      parsed[name] = "true";
      continue;
    }

    parsed[name] = next;
    index += 1;
  }

  return parsed;
}

const args = parseArgs(process.argv.slice(2));
const port = Number(args.port || 8765);
const executable = path.resolve(args.executable);
const stdoutLog = path.resolve(args["stdout-log"]);
const stderrLog = path.resolve(args["stderr-log"]);
const urlBaseFile = path.resolve(args["url-base-file"]);
const childPidFile = path.resolve(args["child-pid-file"]);
const statusFile = path.resolve(args["status-file"]);

let foundUrl = "";
let rollingBuffer = "";

for (const filePath of [stdoutLog, stderrLog, urlBaseFile, childPidFile, statusFile]) {
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
  } catch {}
}

for (const filePath of [stdoutLog, stderrLog, urlBaseFile, statusFile]) {
  try {
    fs.unlinkSync(filePath);
  } catch {}
}

function appendLog(filePath, chunk) {
  fs.appendFileSync(filePath, chunk);
}

function detectUrl(text) {
  if (foundUrl) {
    return;
  }

  rollingBuffer = `${rollingBuffer}${text}`;
  if (rollingBuffer.length > 16000) {
    rollingBuffer = rollingBuffer.slice(-16000);
  }

  const matches = rollingBuffer.match(/https?:\/\/[^\s"]+/g) || [];
  for (const match of matches) {
    const candidate = match.replace(/[.,;\]]+$/, "");
    let parsed;
    try {
      parsed = new URL(candidate);
    } catch {
      continue;
    }

    const host = String(parsed.hostname || "").toLowerCase();
    const pathName = String(parsed.pathname || "");
    if (/^(127\.0\.0\.1|localhost)$/i.test(host)) {
      continue;
    }
    if (!host.endsWith("trycloudflare.com")) {
      continue;
    }
    if (pathName && pathName !== "/") {
      continue;
    }

    foundUrl = candidate;
    fs.writeFileSync(urlBaseFile, foundUrl);
    break;
  }
}

const child = spawn(
  executable,
  [
    "tunnel",
    "--url",
    `http://127.0.0.1:${port}`,
    "--no-autoupdate",
  ],
  {
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  },
);

fs.writeFileSync(childPidFile, String(child.pid));
fs.writeFileSync(statusFile, JSON.stringify({ ok: true, pid: process.pid, childPid: child.pid }));

child.stdout.on("data", (chunk) => {
  const text = chunk.toString("utf8");
  appendLog(stdoutLog, text);
  detectUrl(text);
});

child.stderr.on("data", (chunk) => {
  const text = chunk.toString("utf8");
  appendLog(stderrLog, text);
  detectUrl(text);
});

child.on("exit", (code, signal) => {
  try {
    fs.writeFileSync(
      statusFile,
      JSON.stringify({
        ok: code === 0,
        pid: process.pid,
        childPid: child.pid,
        exitCode: code,
        signal: signal || "",
        foundUrl,
      }),
    );
  } catch {}

  process.exit(code === null ? 1 : code);
});

function shutdown() {
  try {
    child.kill("SIGTERM");
  } catch {}
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
