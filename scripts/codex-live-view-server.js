const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const { URL } = require("url");

const ROOT = path.resolve(__dirname, "..");

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
const PORT = Number(args.port || process.env.CODEX_LIVE_VIEW_PORT || 8765);
const CODEX_HOME = path.resolve(
  args["codex-home"] || process.env.CODEX_HOME || path.join(os.homedir(), ".codex"),
);
const ACCESS_TOKEN = String(args.token || process.env.CODEX_LIVE_VIEW_TOKEN || "").trim();
const SESSIONS_ROOT = path.join(CODEX_HOME, "sessions");
const INITIAL_BYTES = Number(
  args["initial-bytes"] || process.env.CODEX_LIVE_VIEW_INITIAL_BYTES || 384 * 1024,
);
const RESCAN_INTERVAL_MS = Number(
  args["rescan-interval-ms"] || process.env.CODEX_LIVE_VIEW_RESCAN_INTERVAL_MS || 3000,
);
const POLL_INTERVAL_MS = Number(
  args["poll-interval-ms"] || process.env.CODEX_LIVE_VIEW_POLL_INTERVAL_MS || 1200,
);
const MAX_TURNS = Number(args["max-turns"] || process.env.CODEX_LIVE_VIEW_MAX_TURNS || 8);
const MAX_PROGRESS_MESSAGES = Number(
  args["max-progress-messages"] || process.env.CODEX_LIVE_VIEW_MAX_PROGRESS_MESSAGES || 6,
);
const APP_SERVER_PORT = Number(
  args["app-server-port"] || process.env.CODEX_LIVE_VIEW_APP_SERVER_PORT || 8766,
);
const MAX_SUBMIT_CHARS = Number(
  args["max-submit-chars"] || process.env.CODEX_LIVE_VIEW_MAX_SUBMIT_CHARS || 12000,
);
const MAX_SUBMIT_BODY_BYTES = Number(
  args["max-submit-body-bytes"] || process.env.CODEX_LIVE_VIEW_MAX_SUBMIT_BODY_BYTES || 24 * 1024 * 1024,
);
const MAX_ATTACHMENTS = Number(
  args["max-attachments"] || process.env.CODEX_LIVE_VIEW_MAX_ATTACHMENTS || 6,
);
const MAX_ATTACHMENT_BYTES = Number(
  args["max-attachment-bytes"] || process.env.CODEX_LIVE_VIEW_MAX_ATTACHMENT_BYTES || 8 * 1024 * 1024,
);
const MAX_TOTAL_ATTACHMENT_BYTES = Number(
  args["max-total-attachment-bytes"] || process.env.CODEX_LIVE_VIEW_MAX_TOTAL_ATTACHMENT_BYTES || 20 * 1024 * 1024,
);
const POWERSHELL_EXE = path.join(
  process.env.WINDIR || "C:\\Windows",
  "System32",
  "WindowsPowerShell",
  "v1.0",
  "powershell.exe",
);
const SUBMIT_SCRIPT = path.join(__dirname, "codex-live-view-submit.ps1");
const ATTACHMENTS_DIR = path.join(ROOT, "logs", "codex-live-view-uploads");
const FULL_ACCESS_CONFIG = Object.freeze({
  approvalPolicy: "never",
  sandbox: "danger-full-access",
});
const DEFAULT_CUSTOM_ACCESS_CONFIG = Object.freeze({
  approvalPolicy: "on-request",
  sandbox: "workspace-write",
});
const VALID_APPROVAL_POLICIES = new Set([
  "never",
  "on-request",
  "on-failure",
  "untrusted",
]);
const VALID_SANDBOX_MODES = new Set([
  "read-only",
  "workspace-write",
  "danger-full-access",
]);

let currentRolloutPath = null;
let currentPosition = 0;
let lastRescanAt = 0;
let knownSession = null;
let turns = [];
let turnsById = new Map();
let activeTurnId = null;
let syntheticTurnCounter = 1;
let stateVersion = 1;
let submitInFlight = false;
let latestRateLimits = null;
let accessSelection = {
  mode: "full",
  custom: { ...DEFAULT_CUSTOM_ACCESS_CONFIG },
};
let queuedSubmissions = [];
let queuedSubmissionCounter = 1;
let queueDrainTimer = null;

function bumpState() {
  stateVersion += 1;
}

function normalizeAccessMode(value) {
  return value === "custom" ? "custom" : "full";
}

function normalizeApprovalPolicy(value, fallback = FULL_ACCESS_CONFIG.approvalPolicy) {
  return VALID_APPROVAL_POLICIES.has(value) ? value : fallback;
}

function normalizeSandboxMode(value, fallback = FULL_ACCESS_CONFIG.sandbox) {
  return VALID_SANDBOX_MODES.has(value) ? value : fallback;
}

function normalizeAccessSelection(value) {
  const nextValue = value && typeof value === "object" ? value : {};
  const baseCustom =
    accessSelection && accessSelection.custom
      ? accessSelection.custom
      : DEFAULT_CUSTOM_ACCESS_CONFIG;
  const nextCustom =
    nextValue.custom && typeof nextValue.custom === "object" ? nextValue.custom : {};

  return {
    mode: normalizeAccessMode(nextValue.mode),
    custom: {
      approvalPolicy: normalizeApprovalPolicy(
        nextCustom.approvalPolicy || nextValue.approvalPolicy,
        baseCustom.approvalPolicy,
      ),
      sandbox: normalizeSandboxMode(nextCustom.sandbox || nextValue.sandbox, baseCustom.sandbox),
    },
  };
}

function getEffectiveAccessConfig(selection = accessSelection) {
  if (selection && selection.mode === "custom") {
    return { ...selection.custom };
  }

  return { ...FULL_ACCESS_CONFIG };
}

function getAccessSummary(selection = accessSelection) {
  const effective = getEffectiveAccessConfig(selection);
  return `${effective.sandbox} / ${effective.approvalPolicy}`;
}

function getAccessPayload() {
  return {
    mode: accessSelection.mode,
    custom: { ...accessSelection.custom },
    effective: getEffectiveAccessConfig(),
    summary: getAccessSummary(),
  };
}

function setAccessSelection(nextValue) {
  const nextSelection = normalizeAccessSelection(nextValue);
  if (JSON.stringify(nextSelection) === JSON.stringify(accessSelection)) {
    return getAccessPayload();
  }

  accessSelection = nextSelection;
  bumpState();
  return getAccessPayload();
}

function sanitizeAttachmentName(value) {
  const trimmed = String(value || "").trim();
  const normalized = trimmed
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "-")
    .replace(/\s+/g, " ")
    .slice(0, 120)
    .trim();
  return normalized || "attachment";
}

function isImageAttachment(attachment) {
  const mimeType = String(attachment?.mimeType || "").toLowerCase();
  if (mimeType.startsWith("image/")) {
    return true;
  }

  const name = String(attachment?.name || "").toLowerCase();
  return /\.(png|jpe?g|gif|webp|bmp|svg|heic|heif)$/i.test(name);
}

function persistAttachments(rawAttachments) {
  const list = Array.isArray(rawAttachments) ? rawAttachments : [];
  if (list.length === 0) {
    return [];
  }

  if (list.length > MAX_ATTACHMENTS) {
    throw createHttpError(`Too many attachments. Maximum is ${MAX_ATTACHMENTS}.`, 400, "too_many_attachments");
  }

  fs.mkdirSync(ATTACHMENTS_DIR, { recursive: true });

  let totalBytes = 0;
  return list.map((item, index) => {
    const name = sanitizeAttachmentName(item?.name || `attachment-${index + 1}`);
    const mimeType = String(item?.mimeType || "application/octet-stream").trim() || "application/octet-stream";
    const base64 = String(item?.dataBase64 || "").trim();
    if (!base64) {
      throw createHttpError(`Attachment ${name} was empty.`, 400, "empty_attachment");
    }

    let bytes;
    try {
      bytes = Buffer.from(base64, "base64");
    } catch {
      throw createHttpError(`Attachment ${name} was not valid base64.`, 400, "invalid_attachment");
    }

    if (bytes.length === 0) {
      throw createHttpError(`Attachment ${name} was empty.`, 400, "empty_attachment");
    }
    if (bytes.length > MAX_ATTACHMENT_BYTES) {
      throw createHttpError(
        `Attachment ${name} exceeded ${Math.round(MAX_ATTACHMENT_BYTES / (1024 * 1024))} MB.`,
        400,
        "attachment_too_large",
      );
    }

    totalBytes += bytes.length;
    if (totalBytes > MAX_TOTAL_ATTACHMENT_BYTES) {
      throw createHttpError(
        `Attachments exceeded ${Math.round(MAX_TOTAL_ATTACHMENT_BYTES / (1024 * 1024))} MB total.`,
        400,
        "attachments_too_large",
      );
    }

    const ext = path.extname(name).slice(0, 16);
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const storedName = `${stamp}${ext || ""}`;
    const storedPath = path.join(ATTACHMENTS_DIR, storedName);
    fs.writeFileSync(storedPath, bytes);

    return {
      kind: isImageAttachment({ mimeType, name }) ? "image" : "file",
      mimeType,
      name,
      path: storedPath,
      relativePath: path.relative(ROOT, storedPath).replace(/\\/g, "/"),
      sizeBytes: bytes.length,
    };
  });
}

function formatAttachmentList(savedAttachments) {
  return savedAttachments
    .map((item) => `- ${item.kind}: ${item.relativePath}`)
    .join("\n");
}

function composePromptWithAttachments(message, savedAttachments) {
  const text = String(message || "").trim();
  if (!savedAttachments.length) {
    return text;
  }

  const note = `Attached items in workspace:\n${formatAttachmentList(savedAttachments)}`;
  if (!text) {
    return note;
  }

  return `${text}\n\n${note}`;
}

function makeSubmissionPreview(message, savedAttachments) {
  const text = String(message || "").trim();
  if (!savedAttachments.length) {
    return text;
  }

  const summary = `[Attachments: ${savedAttachments.map((item) => item.name).join(", ")}]`;
  return text ? `${text}\n\n${summary}` : summary;
}

function createQueuedSubmission(message, promptText, accessConfig, attachments = []) {
  const now = new Date().toISOString();
  return {
    id: `queued-${queuedSubmissionCounter++}`,
    accessConfig: { ...(accessConfig || getEffectiveAccessConfig()) },
    attachments,
    at: now,
    error: "",
    message,
    promptText,
    status: "queued",
    updatedAt: now,
  };
}

function serializeQueuedSubmission(item) {
  return {
    id: item.id,
    accessSummary: `${item.accessConfig.sandbox} / ${item.accessConfig.approvalPolicy}`,
    attachments: item.attachments.map((attachment) => ({
      kind: attachment.kind,
      name: attachment.name,
      relativePath: attachment.relativePath,
    })),
    at: item.at,
    error: item.error || "",
    message: item.message,
    status: item.status,
    updatedAt: item.updatedAt,
  };
}

function getQueuePayload() {
  return {
    items: queuedSubmissions.map(serializeQueuedSubmission),
  };
}

function hasActiveConversationTurn() {
  return turns.some((turn) => turn.status === "in_progress");
}

function scheduleQueueDrain(delayMs = POLL_INTERVAL_MS) {
  if (queueDrainTimer || queuedSubmissions.length === 0) {
    return;
  }

  queueDrainTimer = setTimeout(() => {
    queueDrainTimer = null;
    drainQueuedSubmissions().catch(() => {});
  }, Math.max(25, delayMs));
}

function enqueueSubmission(message, promptText, accessConfig, attachments = []) {
  const item = createQueuedSubmission(message, promptText, accessConfig, attachments);
  queuedSubmissions.push(item);
  bumpState();
  scheduleQueueDrain(150);
  return item;
}

async function drainQueuedSubmissions() {
  syncLog();

  if (submitInFlight) {
    return;
  }

  const nextItem = queuedSubmissions.find((item) => item.status === "queued");
  if (!nextItem) {
    return;
  }

  if (hasActiveConversationTurn()) {
    scheduleQueueDrain(POLL_INTERVAL_MS);
    return;
  }

  const threadId = pickFirstString(knownSession?.id);
  if (!threadId) {
    scheduleQueueDrain(POLL_INTERVAL_MS);
    return;
  }

  nextItem.status = "sending";
  nextItem.updatedAt = new Date().toISOString();
  nextItem.error = "";
  submitInFlight = true;
  bumpState();

  try {
    const result = await runSubmitBridge(threadId, nextItem.promptText, nextItem.accessConfig, {
      attachments: nextItem.attachments,
      disallowSteer: true,
    });
    if (result.mode === "busy") {
      nextItem.status = "queued";
      nextItem.updatedAt = new Date().toISOString();
      bumpState();
      scheduleQueueDrain(POLL_INTERVAL_MS);
      return;
    }

    queuedSubmissions = queuedSubmissions.filter((item) => item.id !== nextItem.id);
    bumpState();
    if (queuedSubmissions.some((item) => item.status === "queued")) {
      scheduleQueueDrain(150);
    }
  } catch (error) {
    nextItem.status = "error";
    nextItem.error = error.message || "Failed to submit queued command.";
    nextItem.updatedAt = new Date().toISOString();
    bumpState();
  } finally {
    submitInFlight = false;
    bumpState();
  }
}

function truncate(text, maxLength = 4000) {
  if (text === null || text === undefined) {
    return "";
  }

  const normalized = String(text).trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength)}...`;
}

function pickFirstString(...values) {
  for (const value of values) {
    if (value === null || value === undefined) {
      continue;
    }

    const text = String(value).trim();
    if (text) {
      return text;
    }
  }

  return "";
}

function normalizeMessage(text) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .trim();
}

function pickFirstFiniteNumber(...values) {
  for (const value of values) {
    const number = Number(value);
    if (Number.isFinite(number)) {
      return number;
    }
  }

  return null;
}

function extractText(value, depth = 0) {
  if (value === null || value === undefined || depth > 6) {
    return "";
  }

  if (typeof value === "string") {
    return value.trim();
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  if (Array.isArray(value)) {
    const parts = [];
    for (const item of value) {
      const chunk = extractText(item, depth + 1);
      if (chunk) {
        parts.push(chunk);
      }
      if (parts.length >= 4) {
        break;
      }
    }
    return parts.join("\n");
  }

  if (typeof value === "object") {
    if (typeof value.text === "string" && value.text.trim()) {
      return value.text.trim();
    }

    const preferredKeys = [
      "message",
      "last_agent_message",
      "content",
      "summary",
      "output",
      "input",
    ];

    for (const key of preferredKeys) {
      const candidate = extractText(value[key], depth + 1);
      if (candidate) {
        return candidate;
      }
    }

    for (const item of Object.values(value)) {
      const candidate = extractText(item, depth + 1);
      if (candidate) {
        return candidate;
      }
    }
  }

  return "";
}

function resetConversationState() {
  turns = [];
  turnsById = new Map();
  activeTurnId = null;
  syntheticTurnCounter = 1;
  latestRateLimits = null;
  bumpState();
}

function createSyntheticTurnId() {
  const turnId = `synthetic-${syntheticTurnCounter}`;
  syntheticTurnCounter += 1;
  return turnId;
}

function ensureTurn(turnId, at) {
  const resolvedTurnId = turnId || activeTurnId || createSyntheticTurnId();
  let turn = turnsById.get(resolvedTurnId);

  if (!turn) {
    turn = {
      id: resolvedTurnId,
      startedAt: at || new Date().toISOString(),
      updatedAt: at || new Date().toISOString(),
      completedAt: "",
      status: "in_progress",
      userMessage: "",
      progressMessages: [],
      finalMessage: "",
    };
    turns.push(turn);
    turnsById.set(resolvedTurnId, turn);
    bumpState();
  }

  if (at) {
    turn.updatedAt = at;
    if (!turn.startedAt) {
      turn.startedAt = at;
    }
  }

  return turn;
}

function startTurn(turnId, at) {
  if (activeTurnId && activeTurnId !== turnId) {
    const previous = turnsById.get(activeTurnId);
    if (previous && previous.status === "in_progress") {
      previous.status = previous.finalMessage ? "completed" : "stopped";
      previous.updatedAt = at || previous.updatedAt;
      if (!previous.completedAt && previous.status === "completed") {
        previous.completedAt = at || previous.updatedAt;
      }
      bumpState();
    }
  }

  const turn = ensureTurn(turnId, at);
  const changed = turn.status !== "in_progress" || turn.startedAt !== at;
  turn.status = "in_progress";
  if (at) {
    turn.startedAt = at;
    turn.updatedAt = at;
  }
  activeTurnId = turn.id;

  if (changed) {
    bumpState();
  }

  return turn;
}

function getCurrentTurn(at) {
  if (activeTurnId) {
    return ensureTurn(activeTurnId, at);
  }

  const lastTurn = turns[turns.length - 1];
  if (lastTurn && lastTurn.status === "in_progress") {
    activeTurnId = lastTurn.id;
    return ensureTurn(lastTurn.id, at);
  }

  const turn = ensureTurn(createSyntheticTurnId(), at);
  activeTurnId = turn.id;
  return turn;
}

function setUserMessage(turn, text, at) {
  const cleaned = truncate(text, 1200);
  if (!cleaned) {
    return;
  }

  if (normalizeMessage(turn.userMessage) === normalizeMessage(cleaned)) {
    turn.updatedAt = at || turn.updatedAt;
    return;
  }

  turn.userMessage = cleaned;
  turn.updatedAt = at || turn.updatedAt;
  bumpState();
}

function addProgressMessage(turn, text, at) {
  const cleaned = truncate(text, 2600);
  if (!cleaned) {
    return;
  }

  const normalized = normalizeMessage(cleaned);
  const lastMessage = turn.progressMessages[turn.progressMessages.length - 1];
  if (lastMessage && lastMessage.normalized === normalized) {
    turn.updatedAt = at || turn.updatedAt;
    return;
  }

  if (turn.finalMessage && normalizeMessage(turn.finalMessage) === normalized) {
    turn.updatedAt = at || turn.updatedAt;
    return;
  }

  turn.progressMessages.push({
    text: cleaned,
    at: at || new Date().toISOString(),
    normalized,
  });

  if (turn.progressMessages.length > MAX_PROGRESS_MESSAGES) {
    turn.progressMessages = turn.progressMessages.slice(-MAX_PROGRESS_MESSAGES);
  }

  turn.status = "in_progress";
  turn.updatedAt = at || turn.updatedAt;
  activeTurnId = turn.id;
  bumpState();
}

function setFinalMessage(turn, text, at) {
  const cleaned = truncate(text, 12000);
  if (!cleaned) {
    return;
  }

  if (normalizeMessage(turn.finalMessage) === normalizeMessage(cleaned)) {
    turn.updatedAt = at || turn.updatedAt;
    return;
  }

  turn.finalMessage = cleaned;
  turn.updatedAt = at || turn.updatedAt;
  bumpState();
}

function completeTurn(turn, at) {
  const changed = turn.status !== "completed" || !turn.completedAt;
  turn.status = "completed";
  turn.completedAt = at || turn.completedAt || new Date().toISOString();
  turn.updatedAt = at || turn.updatedAt;

  if (activeTurnId === turn.id) {
    activeTurnId = null;
  }

  if (changed) {
    bumpState();
  }
}

function normalizeRateLimitBucket(bucket) {
  if (!bucket || typeof bucket !== "object") {
    return null;
  }

  const usedPercent = pickFirstFiniteNumber(bucket.used_percent, bucket.usedPercent);
  const windowMinutes = pickFirstFiniteNumber(bucket.window_minutes, bucket.windowMinutes);
  const resetsAt = pickFirstFiniteNumber(bucket.resets_at, bucket.resetsAt);

  if (usedPercent === null && windowMinutes === null && resetsAt === null) {
    return null;
  }

  const boundedUsedPercent =
    usedPercent === null ? null : Math.max(0, Math.min(100, usedPercent));

  return {
    usedPercent: boundedUsedPercent,
    remainingPercent:
      boundedUsedPercent === null ? null : Math.max(0, Math.min(100, 100 - boundedUsedPercent)),
    windowMinutes,
    resetsAt: resetsAt === null ? null : Math.round(resetsAt),
  };
}

function normalizeRateLimits(rateLimits, at) {
  if (!rateLimits || typeof rateLimits !== "object") {
    return null;
  }

  const primary = normalizeRateLimitBucket(rateLimits.primary);
  const secondary = normalizeRateLimitBucket(rateLimits.secondary);

  if (!primary && !secondary) {
    return null;
  }

  return {
    updatedAt: at || new Date().toISOString(),
    limitId: pickFirstString(rateLimits.limit_id, rateLimits.limitId),
    limitName: pickFirstString(rateLimits.limit_name, rateLimits.limitName),
    planType: pickFirstString(rateLimits.plan_type, rateLimits.planType),
    primary,
    secondary,
  };
}

function updateRateLimits(rateLimits, at) {
  const nextRateLimits = normalizeRateLimits(rateLimits, at);
  if (JSON.stringify(nextRateLimits) === JSON.stringify(latestRateLimits)) {
    return;
  }

  latestRateLimits = nextRateLimits;
  bumpState();
}

function updateSessionMeta(payload) {
  const nextSession = {
    id: pickFirstString(payload.id),
    cwd: pickFirstString(payload.cwd),
    source: pickFirstString(payload.source),
    cliVersion: pickFirstString(payload.cli_version),
    originator: pickFirstString(payload.originator),
  };

  if (JSON.stringify(nextSession) !== JSON.stringify(knownSession)) {
    knownSession = nextSession;
    bumpState();
  }
}

function handleAssistantMessage(text, phase, at) {
  const cleaned = truncate(text, 12000);
  if (!cleaned) {
    return;
  }

  const turn = getCurrentTurn(at);
  const normalizedPhase = String(phase || "").trim().toLowerCase();

  if (normalizedPhase === "final_answer") {
    setFinalMessage(turn, cleaned, at);
    return;
  }

  addProgressMessage(turn, cleaned, at);
}

function processEventMessage(payload, at) {
  const innerType = pickFirstString(payload.type);

  if (innerType === "task_started") {
    startTurn(payload.turn_id || createSyntheticTurnId(), at);
    return;
  }

  if (innerType === "token_count") {
    updateRateLimits(payload.rate_limits || payload.rateLimits, at);
    return;
  }

  if (innerType === "user_message") {
    const turn = getCurrentTurn(at);
    setUserMessage(turn, payload.message, at);
    return;
  }

  if (innerType === "agent_message") {
    handleAssistantMessage(payload.message, payload.phase, at);
    return;
  }

  if (innerType === "task_complete") {
    const turn = ensureTurn(payload.turn_id || activeTurnId || createSyntheticTurnId(), at);
    if (payload.last_agent_message) {
      setFinalMessage(turn, payload.last_agent_message, at);
    }
    completeTurn(turn, at);
  }
}

function processResponseItem(payload, at) {
  const innerType = pickFirstString(payload.type);

  if (innerType !== "message") {
    return;
  }

  const role = pickFirstString(payload.role).toLowerCase();
  const text = extractText(payload.content);
  if (!text) {
    return;
  }

  if (role === "user") {
    const turn = getCurrentTurn(at);
    setUserMessage(turn, text, at);
    return;
  }

  if (role === "assistant") {
    handleAssistantMessage(text, payload.phase, at);
  }
}

function processRolloutLine(line) {
  let record;
  try {
    record = JSON.parse(line);
  } catch {
    return;
  }

  const at = pickFirstString(record.timestamp, record.payload?.timestamp) || new Date().toISOString();
  const type = pickFirstString(record.type);
  const payload = record.payload || {};

  if (type === "session_meta") {
    updateSessionMeta(payload);
    return;
  }

  if (type === "event_msg") {
    processEventMessage(payload, at);
    return;
  }

  if (type === "response_item") {
    processResponseItem(payload, at);
  }
}

function listLocalIpv4Addresses() {
  const interfaces = os.networkInterfaces();
  const addresses = [];

  for (const [name, items] of Object.entries(interfaces)) {
    if (/wintun|tailscale|loopback|vethernet|hyper-v|wsl|virtualbox|vmware/i.test(name)) {
      continue;
    }

    for (const item of items || []) {
      if (item.family !== "IPv4" || item.internal) {
        continue;
      }
      if (item.address.startsWith("169.254.")) {
        continue;
      }
      if (!addresses.includes(item.address)) {
        addresses.push(item.address);
      }
    }
  }

  return addresses.sort();
}

function findLatestRollout(rootDir) {
  if (!fs.existsSync(rootDir)) {
    return null;
  }

  const stack = [rootDir];
  let best = null;

  while (stack.length > 0) {
    const current = stack.pop();
    let entries = [];

    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
        continue;
      }

      if (!entry.isFile() || !/^rollout-.*\.jsonl$/i.test(entry.name)) {
        continue;
      }

      let stats;
      try {
        stats = fs.statSync(fullPath);
      } catch {
        continue;
      }

      if (!best || stats.mtimeMs > best.mtimeMs) {
        best = {
          path: fullPath,
          mtimeMs: stats.mtimeMs,
        };
      }
    }
  }

  return best ? best.path : null;
}

function readNewLines(filePath, { initial = false } = {}) {
  const handle = fs.openSync(filePath, "r");

  try {
    const stats = fs.fstatSync(handle);
    if (initial) {
      currentPosition = Math.max(0, stats.size - INITIAL_BYTES);
    } else if (currentPosition > stats.size) {
      currentPosition = 0;
    }

    const bytesToRead = Math.max(0, stats.size - currentPosition);
    if (bytesToRead === 0) {
      return [];
    }

    const buffer = Buffer.alloc(bytesToRead);
    fs.readSync(handle, buffer, 0, bytesToRead, currentPosition);
    currentPosition = stats.size;

    let text = buffer.toString("utf8");
    if (initial && currentPosition > INITIAL_BYTES && text.includes("\n")) {
      text = text.slice(text.indexOf("\n") + 1);
    }

    return text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
  } finally {
    fs.closeSync(handle);
  }
}

function hydrateSessionMeta(filePath) {
  const handle = fs.openSync(filePath, "r");

  try {
    const stats = fs.fstatSync(handle);
    const bytesToRead = Math.min(stats.size, 64 * 1024);
    if (bytesToRead <= 0) {
      return;
    }

    const buffer = Buffer.alloc(bytesToRead);
    fs.readSync(handle, buffer, 0, bytesToRead, 0);

    const lines = buffer
      .toString("utf8")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(0, 40);

    for (const line of lines) {
      try {
        const parsed = JSON.parse(line);
        if (parsed.type === "session_meta") {
          updateSessionMeta(parsed.payload || {});
          return;
        }
      } catch {}
    }
  } finally {
    fs.closeSync(handle);
  }
}

function switchToRollout(filePath) {
  currentRolloutPath = filePath;
  currentPosition = 0;
  knownSession = null;
  resetConversationState();
  hydrateSessionMeta(filePath);

  for (const line of readNewLines(filePath, { initial: true })) {
    processRolloutLine(line);
  }
}

function syncLog(forceRescan = false) {
  const now = Date.now();
  const shouldRescan =
    forceRescan ||
    !currentRolloutPath ||
    !fs.existsSync(currentRolloutPath) ||
    now - lastRescanAt >= RESCAN_INTERVAL_MS;

  if (shouldRescan) {
    const latest = findLatestRollout(SESSIONS_ROOT);
    lastRescanAt = now;
    if (latest && latest !== currentRolloutPath) {
      switchToRollout(latest);
    }
  }

  if (!currentRolloutPath || !fs.existsSync(currentRolloutPath)) {
    return;
  }

  for (const line of readNewLines(currentRolloutPath)) {
    processRolloutLine(line);
  }

  if (queuedSubmissions.some((item) => item.status === "queued")) {
    scheduleQueueDrain(150);
  }
}

function makePreview(text, maxLength = 140) {
  return truncate(text, maxLength);
}

function getStatusLabel(status) {
  if (status === "in_progress") {
    return "In Progress";
  }
  if (status === "completed") {
    return "Completed";
  }
  if (status === "stopped") {
    return "Stopped";
  }
  return "Idle";
}

function getVisibleTurns() {
  return turns
    .filter((turn) => turn.userMessage || turn.progressMessages.length > 0 || turn.finalMessage)
    .slice(-MAX_TURNS)
    .map((turn) => ({
      id: turn.id,
      status: turn.status,
      statusLabel: getStatusLabel(turn.status),
      startedAt: turn.startedAt,
      updatedAt: turn.updatedAt,
      completedAt: turn.completedAt,
      userMessage: turn.userMessage,
      progressMessages: turn.progressMessages.map((message) => ({
        text: message.text,
        at: message.at,
      })),
      finalMessage: turn.finalMessage,
      preview: makePreview(turn.finalMessage || turn.progressMessages[turn.progressMessages.length - 1]?.text || ""),
    }));
}

function getConversationStatus(visibleTurns) {
  const activeTurn = visibleTurns.find((turn) => turn.status === "in_progress");
  if (activeTurn) {
    return {
      state: "in_progress",
      label: "In Progress",
      detail: activeTurn.preview || makePreview(activeTurn.userMessage, 120) || "Waiting for assistant text",
    };
  }

  const latestTurn = visibleTurns[visibleTurns.length - 1];
  if (latestTurn) {
    return {
      state: latestTurn.status,
      label: latestTurn.statusLabel,
      detail: latestTurn.preview || makePreview(latestTurn.userMessage, 120) || "No recent assistant text",
    };
  }

  return {
    state: "idle",
    label: "Idle",
    detail: "No visible Codex turns yet",
  };
}

function getStatePayload() {
  syncLog();

  const visibleTurns = getVisibleTurns();
  const sessionId = pickFirstString(knownSession?.id);
  const access = getAccessPayload();
  return {
    ok: true,
    serverTime: new Date().toISOString(),
    version: stateVersion,
    repoRoot: ROOT,
    codexHome: CODEX_HOME,
    activeRollout: currentRolloutPath,
    session: knownSession,
    urls: listLocalIpv4Addresses().map((address) => `http://${address}:${PORT}/`),
    queue: getQueuePayload(),
    status: getConversationStatus(visibleTurns),
    turns: visibleTurns,
    rateLimits: latestRateLimits,
    access,
    composer: {
      enabled: Boolean(sessionId),
      busy: submitInFlight,
      maxChars: MAX_SUBMIT_CHARS,
      approvalPolicy: access.effective.approvalPolicy,
      sandbox: access.effective.sandbox,
    },
  };
}

function writeJson(response, payload, statusCode = 200) {
  const body = JSON.stringify(payload);
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
  });
  response.end(body);
}

function writeHtml(response, body, statusCode = 200) {
  response.writeHead(statusCode, {
    "Content-Type": "text/html; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
  });
  response.end(body);
}

function createHttpError(message, statusCode = 500, code = "server_error") {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

function readRequestBody(request, maxBytes = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let totalBytes = 0;
    const chunks = [];

    request.on("data", (chunk) => {
      totalBytes += chunk.length;
      if (totalBytes > maxBytes) {
        reject(createHttpError("Request body was too large.", 413, "body_too_large"));
        request.destroy();
        return;
      }

      chunks.push(chunk);
    });

    request.on("end", () => {
      resolve(Buffer.concat(chunks).toString("utf8"));
    });

    request.on("error", (error) => {
      reject(createHttpError(error.message, 400, "request_error"));
    });
  });
}

function runSubmitBridge(threadId, message, accessConfig, options = {}) {
  const effectiveAccess = accessConfig || getEffectiveAccessConfig();
  const attachments = Array.isArray(options.attachments) ? options.attachments : [];
  const disallowSteer = Boolean(options.disallowSteer);
  return new Promise((resolve, reject) => {
    const args = [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      SUBMIT_SCRIPT,
      "-ThreadId",
      threadId,
      "-AppServerPort",
      String(APP_SERVER_PORT),
      "-SandboxMode",
      effectiveAccess.sandbox,
      "-ApprovalPolicy",
      effectiveAccess.approvalPolicy,
    ];
    if (attachments.length > 0) {
      fs.mkdirSync(ATTACHMENTS_DIR, { recursive: true });
      const manifestPath = path.join(
        ATTACHMENTS_DIR,
        `manifest-${Date.now()}-${Math.random().toString(36).slice(2, 10)}.json`,
      );
      fs.writeFileSync(manifestPath, JSON.stringify({ attachments }, null, 2), "utf8");
      args.push("-AttachmentsManifestPath", manifestPath);
    }
    if (disallowSteer) {
      args.push("-DisallowSteer");
    }

    const child = spawn(
      POWERSHELL_EXE,
      args,
      {
        cwd: ROOT,
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
      },
    );

    let stdout = "";
    let stderr = "";
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) {
        return;
      }

      settled = true;
      child.kill();
      reject(createHttpError("Submitting the message timed out.", 504, "submit_timeout"));
    }, 45000);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeout);
      reject(
        createHttpError(
          `Failed to start the submit bridge: ${error.message}`,
          500,
          "submit_bridge_start_failed",
        ),
      );
    });
    child.on("close", (code) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeout);

      const output = stdout.trim();
      const detail = String(stderr || output || "").trim();

      if (code !== 0) {
        reject(
          createHttpError(
            detail || `The submit bridge exited with code ${code}.`,
            500,
            "submit_bridge_failed",
          ),
        );
        return;
      }

      try {
        const parsed = JSON.parse(output);
        resolve(parsed);
      } catch (error) {
        reject(
          createHttpError(
            `The submit bridge returned invalid JSON: ${error.message}`,
            500,
            "submit_bridge_invalid_json",
          ),
        );
      }
    });

    child.stdin.end(Buffer.from(message, "utf8"));
  });
}

async function submitPromptToCodex(message, rawAttachments = []) {
  syncLog();

  const threadId = pickFirstString(knownSession?.id);
  const effectiveAccess = getEffectiveAccessConfig();
  if (!threadId) {
    throw createHttpError("No active Codex session was found.", 503, "no_active_session");
  }

  const text = String(message || "").trim();
  if (text.length > MAX_SUBMIT_CHARS) {
    throw createHttpError(
      `Message exceeded ${MAX_SUBMIT_CHARS} characters.`,
      400,
      "message_too_long",
    );
  }

  const attachments = persistAttachments(rawAttachments);
  if (!text && attachments.length === 0) {
    throw createHttpError("Message was empty.", 400, "empty_message");
  }

  const promptText = composePromptWithAttachments(text, attachments);
  const previewText = makeSubmissionPreview(text, attachments);

  if (!fs.existsSync(SUBMIT_SCRIPT)) {
    throw createHttpError("Submit bridge script is missing.", 500, "missing_submit_bridge");
  }

  if (
    submitInFlight ||
    queuedSubmissions.some((item) => item.status === "queued" || item.status === "sending")
  ) {
    const queued = enqueueSubmission(previewText, promptText, effectiveAccess, attachments);
    return { ok: true, mode: "queued", queued: serializeQueuedSubmission(queued) };
  }

  submitInFlight = true;
  bumpState();

  try {
    const result = await runSubmitBridge(threadId, promptText, effectiveAccess, { attachments });
    if (result.mode === "busy") {
      const queued = enqueueSubmission(previewText, promptText, effectiveAccess, attachments);
      return { ok: true, mode: "queued", queued: serializeQueuedSubmission(queued) };
    }

    return result;
  } finally {
    submitInFlight = false;
    bumpState();
  }
}

async function handleSubmitRequest(request, response) {
  let payload;
  try {
    payload = JSON.parse(await readRequestBody(request, MAX_SUBMIT_BODY_BYTES));
  } catch (error) {
    if (error && error.statusCode) {
      throw error;
    }

    throw createHttpError("Request body must be valid JSON.", 400, "invalid_json");
  }

  const result = await submitPromptToCodex(payload.message, payload.attachments);
  writeJson(response, { ok: true, access: getAccessPayload(), ...result });
}

async function handleAccessUpdateRequest(request, response) {
  let payload = {};
  try {
    const rawBody = await readRequestBody(request);
    payload = rawBody ? JSON.parse(rawBody) : {};
  } catch (error) {
    if (error && error.statusCode) {
      throw error;
    }

    throw createHttpError("Request body must be valid JSON.", 400, "invalid_json");
  }

  setAccessSelection(payload);
  writeJson(response, getStatePayload());
}

function isAuthorized(requestUrl, request) {
  if (!ACCESS_TOKEN) {
    return true;
  }

  const queryToken = String(requestUrl.searchParams.get("token") || "").trim();
  if (queryToken && queryToken === ACCESS_TOKEN) {
    return true;
  }

  const headerToken = String(request.headers["x-codex-live-view-token"] || "").trim();
  if (headerToken && headerToken === ACCESS_TOKEN) {
    return true;
  }

  const authHeader = String(request.headers.authorization || "");
  if (authHeader.startsWith("Bearer ")) {
    const bearerToken = authHeader.slice("Bearer ".length).trim();
    if (bearerToken === ACCESS_TOKEN) {
      return true;
    }
  }

  return false;
}

function getIndexHtml(tokenFromRequest = "") {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Codex Live View</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;500;700;800&display=swap" rel="stylesheet">
  <style>
    :root {
      --paper: #efe4d2;
      --ink: #f8f0e3;
      --panel: #161210;
      --panel-2: #211916;
      --line: #3b3028;
      --muted: #c2b29c;
      --accent: #ef7e1d;
      --progress: #facc15;
      --done: #2dd4bf;
      --stopped: #fb7185;
      --page-gutter: 0.8rem;
      --composer-control-height: 3.4rem;
      --composer-side-width: 2.8rem;
      --composer-icon-size: 2.55rem;
      --viewport-offset-left: 0px;
      --viewport-right-gap: 0px;
      --viewport-bottom-gap: 0px;
      --shadow: 0 18px 50px rgba(20, 16, 14, 0.2);
      --font-sans: "Noto Sans KR", "Apple SD Gothic Neo", "Malgun Gothic", "Noto Sans", "Segoe UI", sans-serif;
    }
    * { box-sizing: border-box; }
    html {
      width: 100%;
      max-width: 100%;
      overflow-x: clip;
      overscroll-behavior-x: none;
      -webkit-text-size-adjust: 100%;
    }
    body {
      margin: 0;
      width: 100%;
      max-width: 100%;
      min-height: 100vh;
      overflow-x: clip;
      overscroll-behavior-x: none;
      touch-action: pan-y pinch-zoom;
      background:
        radial-gradient(circle at top right, rgba(239,126,29,0.14), transparent 24rem),
        radial-gradient(circle at bottom left, rgba(45,212,191,0.08), transparent 26rem),
        linear-gradient(180deg, #f8f1e7 0%, var(--paper) 100%);
      color: var(--ink);
      font-family: var(--font-sans);
    }
    button,
    input,
    select,
    textarea {
      font-family: inherit;
    }
    .page {
      width: min(100%, calc(62rem + (var(--page-gutter) * 2)));
      max-width: 100%;
      margin: 0 auto;
      padding: 1rem var(--page-gutter) 8.5rem;
    }
    .hero {
      position: relative;
      overflow: visible;
      padding: 0.85rem 1rem;
      border-radius: 1.15rem;
      background: linear-gradient(160deg, #201915 0%, #161210 100%);
      box-shadow: var(--shadow);
    }
    .hero::after {
      content: "";
      position: absolute;
      right: -4rem;
      bottom: -4rem;
      width: 12rem;
      height: 12rem;
      border-radius: 999px;
      background: radial-gradient(circle, rgba(239,126,29,0.3), transparent 70%);
      pointer-events: none;
    }
    .hero-stack {
      position: relative;
      z-index: 1;
      display: flex;
      align-items: center;
      gap: 0.75rem;
      flex-wrap: nowrap;
      min-width: 0;
    }
    .chips {
      display: flex;
      align-items: center;
      gap: 0.45rem;
      flex: 1 1 auto;
      flex-wrap: nowrap;
      min-width: 0;
      width: 0;
    }
    .chip {
      display: inline-flex;
      align-items: center;
      flex: 1 1 0;
      gap: 0.45rem;
      width: auto;
      max-width: min(100%, 18rem);
      min-width: 0;
      padding: 0.42rem 0.72rem;
      border-radius: 999px;
      border: 1px solid rgba(248,240,227,0.12);
      background: rgba(248,240,227,0.05);
      color: var(--ink);
      font-size: 0.8rem;
      white-space: nowrap;
    }
    .chip strong { color: white; }
    .chip-value {
      display: inline-block;
      min-width: 0;
      max-width: 100%;
      overflow: hidden;
      text-overflow: ellipsis;
      vertical-align: bottom;
      white-space: nowrap;
    }
    .access-toolbar {
      position: relative;
      display: flex;
      align-items: center;
      gap: 0.6rem;
      flex: 0 0 auto;
      flex-wrap: nowrap;
      min-width: 0;
      flex-shrink: 0;
      margin-left: auto;
      padding: 0;
      border: 0;
      background: transparent;
    }
    .segmented {
      display: flex;
      gap: 0.5rem;
      flex-wrap: nowrap;
      flex: 0 0 auto;
    }
    .segmented-btn {
      border: 1px solid rgba(194,178,156,0.22);
      border-radius: 999px;
      min-height: 2.5rem;
      padding: 0.55rem 0.9rem;
      background: rgba(248,240,227,0.04);
      color: #f8f0e3;
      font: inherit;
      font-size: 0.82rem;
      cursor: pointer;
    }
    .segmented-btn[data-active="true"] {
      border-color: rgba(239,126,29,0.42);
      background: linear-gradient(180deg, rgba(239,126,29,0.22), rgba(239,126,29,0.12));
      color: white;
    }
    .segmented-btn:disabled {
      cursor: not-allowed;
      opacity: 0.6;
    }
    .access-fields {
      position: absolute;
      top: calc(100% + 0.65rem);
      right: 0;
      z-index: 3;
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 0.6rem;
      width: min(26rem, calc(100vw - 1.6rem));
      padding: 0.8rem;
      border-radius: 1rem;
      border: 1px solid rgba(248,240,227,0.12);
      background: rgba(22,18,16,0.97);
      box-shadow: 0 18px 40px rgba(20, 16, 14, 0.24);
    }
    .access-fields[hidden] {
      display: none;
    }
    .access-field {
      display: grid;
      gap: 0.35rem;
    }
    .access-field-label {
      font-size: 0.72rem;
      letter-spacing: 0.05em;
      text-transform: uppercase;
      color: var(--muted);
    }
    .access-select {
      width: 100%;
      min-height: 2.7rem;
      border: 1px solid rgba(194,178,156,0.22);
      border-radius: 0.85rem;
      background: rgba(248,240,227,0.05);
      color: #f8f0e3;
      font: inherit;
      font-size: 0.88rem;
      padding: 0.7rem 0.8rem;
      outline: none;
    }
    .access-select:disabled {
      opacity: 0.6;
    }
    .access-note {
      min-height: auto;
      color: var(--muted);
      font-size: 0.74rem;
      flex: 0 0 auto;
      white-space: nowrap;
      max-width: 10rem;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .access-note[data-error="true"] {
      color: #fda4af;
    }
    .panel {
      margin-top: 0.9rem;
      border-radius: 1.1rem;
      overflow: hidden;
      background: linear-gradient(180deg, rgba(22,18,16,0.99), rgba(33,25,22,0.99));
      border: 1px solid rgba(59,48,40,0.8);
      box-shadow: var(--shadow);
    }
    .stream {
      min-height: 24rem;
      padding: 0.85rem;
    }
    .quota-line {
      display: flex;
      align-items: center;
      gap: 0.45rem;
      padding: 0.72rem 0.95rem 0.14rem;
      border-top: 1px solid rgba(59,48,40,0.72);
      background: rgba(248,240,227,0.03);
      color: #d7c8b5;
      font-size: 0.76rem;
      letter-spacing: 0.01em;
      white-space: nowrap;
      overflow-x: auto;
      scrollbar-width: none;
    }
    .quota-line::-webkit-scrollbar {
      display: none;
    }
    .quota-line[hidden] {
      display: none;
    }
    .activity-line {
      display: flex;
      align-items: center;
      gap: 0.55rem;
      min-height: 2.45rem;
      padding: 0.72rem 0.95rem 0.82rem;
      border-top: 1px solid rgba(59,48,40,0.72);
      background: rgba(248,240,227,0.03);
      color: var(--muted);
      font-size: 0.8rem;
      letter-spacing: 0.01em;
    }
    .activity-line[data-stacked="true"] {
      min-height: 1.95rem;
      padding-top: 0.18rem;
      border-top: 0;
    }
    .activity-line[hidden] {
      display: none;
    }
    .activity-line::before {
      content: "";
      width: 0.58rem;
      height: 0.58rem;
      border-radius: 999px;
      background: rgba(250,204,21,0.92);
      box-shadow: 0 0 0 0 rgba(250,204,21,0.26);
      animation: activity-pulse 1.4s ease-out infinite;
      flex: 0 0 auto;
    }
    .activity-line[data-state="queued"]::before {
      background: rgba(239,126,29,0.92);
      box-shadow: 0 0 0 0 rgba(239,126,29,0.24);
    }
    .activity-line[data-state="completed"]::before {
      background: rgba(96,165,250,0.96);
      box-shadow: 0 0 0 0 rgba(96,165,250,0.24);
    }
    @keyframes activity-pulse {
      0% {
        transform: scale(0.95);
        box-shadow: 0 0 0 0 rgba(250,204,21,0.28);
      }
      70% {
        transform: scale(1);
        box-shadow: 0 0 0 0.5rem rgba(250,204,21,0);
      }
      100% {
        transform: scale(0.95);
        box-shadow: 0 0 0 0 rgba(250,204,21,0);
      }
    }
    .empty {
      border: 1px dashed rgba(194,178,156,0.24);
      border-radius: 0.95rem;
      padding: 1.1rem;
      text-align: center;
      color: var(--muted);
      background: rgba(248,240,227,0.03);
    }
    .turn {
      padding: 0.85rem;
      border-radius: 1rem;
      border: 1px solid rgba(59,48,40,0.85);
      background: linear-gradient(180deg, rgba(255,255,255,0.03), rgba(255,255,255,0.015));
    }
    .turn + .turn {
      margin-top: 0.8rem;
    }
    .turn-head {
      display: flex;
      justify-content: space-between;
      gap: 0.75rem;
      margin-bottom: 0.7rem;
      flex-wrap: wrap;
      align-items: center;
    }
    .badge {
      display: inline-flex;
      align-items: center;
      gap: 0.4rem;
      padding: 0.24rem 0.6rem;
      border-radius: 999px;
      font-size: 0.72rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.03em;
      background: rgba(248,240,227,0.08);
      color: var(--muted);
    }
    .badge.in_progress { color: var(--progress); background: rgba(250,204,21,0.14); }
    .badge.completed { color: var(--done); background: rgba(45,212,191,0.14); }
    .badge.stopped { color: var(--stopped); background: rgba(251,113,133,0.14); }
    .badge.queued { color: var(--accent); background: rgba(239,126,29,0.14); }
    .badge.sending { color: #93c5fd; background: rgba(147,197,253,0.16); }
    .badge.error { color: #fda4af; background: rgba(251,113,133,0.14); }
    .meta { color: var(--muted); font-size: 0.74rem; }
    .block {
      border-radius: 0.9rem;
      padding: 0.75rem 0.8rem;
    }
    .block + .block {
      margin-top: 0.6rem;
    }
    .block-label {
      display: block;
      margin-bottom: 0.35rem;
      font-size: 0.7rem;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: var(--muted);
    }
    .prompt {
      background: rgba(248,240,227,0.05);
      border: 1px solid rgba(194,178,156,0.16);
    }
    .progress {
      background: rgba(250,204,21,0.08);
      border: 1px solid rgba(250,204,21,0.16);
    }
    .answer {
      background: rgba(45,212,191,0.08);
      border: 1px solid rgba(45,212,191,0.16);
    }
    .waiting {
      background: rgba(248,240,227,0.03);
      border: 1px dashed rgba(194,178,156,0.2);
      color: var(--muted);
    }
    .error-block {
      background: rgba(251,113,133,0.08);
      border: 1px solid rgba(251,113,133,0.16);
    }
    p {
      margin: 0;
      white-space: pre-wrap;
      word-break: break-word;
      line-height: 1.55;
      font-size: 0.92rem;
      color: #f5e7d5;
    }
    .bottom-jump {
      position: fixed;
      right: 1rem;
      bottom: 7.85rem;
      z-index: 20;
      border: 1px solid rgba(239,126,29,0.34);
      border-radius: 999px;
      padding: 0.68rem 0.9rem;
      background: rgba(22,18,16,0.94);
      color: #f8f0e3;
      font: inherit;
      font-size: 0.84rem;
      cursor: pointer;
      box-shadow: 0 12px 30px rgba(20, 16, 14, 0.24);
    }
    .bottom-jump[hidden] {
      display: none;
    }
    .composer {
      position: fixed;
      left: 0;
      right: 0;
      bottom: 0.8rem;
      transform: none;
      width: min(62rem, calc(100vw - (var(--page-gutter) * 2)));
      max-width: calc(100vw - (var(--page-gutter) * 2));
      margin: 0 auto;
      display: grid;
      gap: 0.55rem;
      padding: 0.75rem 0.72rem 0.75rem 0.5rem;
      border-radius: 1rem;
      border: 1px solid rgba(59,48,40,0.85);
      background: rgba(22,18,16,0.95);
      box-shadow: 0 16px 40px rgba(20, 16, 14, 0.28);
      backdrop-filter: blur(14px);
    }
    .composer-row {
      display: grid;
      grid-template-columns: var(--composer-side-width) minmax(0, 1fr) var(--composer-side-width);
      gap: 0.35rem;
      align-items: center;
    }
    .sr-only {
      position: absolute;
      width: 1px;
      height: 1px;
      padding: 0;
      margin: -1px;
      overflow: hidden;
      clip: rect(0, 0, 0, 0);
      white-space: nowrap;
      border: 0;
    }
    .composer-attach {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      align-self: center;
      justify-self: start;
      width: var(--composer-icon-size);
      min-width: var(--composer-icon-size);
      height: var(--composer-icon-size);
      border: 1px solid rgba(194,178,156,0.22);
      border-radius: 999px;
      padding: 0;
      background: rgba(248,240,227,0.05);
      color: #f8f0e3;
      font: inherit;
      font-size: 1.5rem;
      font-weight: 400;
      line-height: 1;
      cursor: pointer;
    }
    .composer-attach:disabled {
      cursor: not-allowed;
      opacity: 0.55;
    }
    .composer-file-input {
      display: none;
    }
    .composer-input-wrap {
      min-width: 0;
      display: flex;
    }
    .composer-input {
      display: block;
      box-sizing: border-box;
      width: 100%;
      min-height: var(--composer-control-height);
      height: var(--composer-control-height);
      max-height: 7.5rem;
      resize: none;
      border: 1px solid rgba(194,178,156,0.18);
      border-radius: 0.9rem;
      background: rgba(248,240,227,0.04);
      color: #f8f0e3;
      font: inherit;
      font-size: 0.94rem;
      line-height: 1.35;
      padding: calc((var(--composer-control-height) - 1.35em - 2px) / 2) 0.82rem;
      outline: none;
      overflow-y: auto;
    }
    .composer-input::placeholder {
      color: rgba(194,178,156,0.74);
    }
    .composer-input:disabled {
      opacity: 0.6;
    }
    .composer-attachments {
      display: flex;
      flex-wrap: wrap;
      gap: 0.45rem;
    }
    .composer-attachments[hidden] {
      display: none;
    }
    .attachment-chip {
      display: inline-flex;
      align-items: center;
      gap: 0.45rem;
      max-width: 100%;
      padding: 0.42rem 0.7rem;
      border-radius: 999px;
      border: 1px solid rgba(194,178,156,0.22);
      background: rgba(248,240,227,0.05);
      color: #f8f0e3;
      font-size: 0.78rem;
    }
    .attachment-chip[data-kind="image"] {
      border-color: rgba(45,212,191,0.22);
      background: rgba(45,212,191,0.08);
    }
    .attachment-name {
      max-width: 12rem;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .attachment-remove {
      border: 0;
      background: transparent;
      color: inherit;
      font: inherit;
      cursor: pointer;
      padding: 0;
    }
    .attachment-remove:disabled {
      cursor: not-allowed;
      opacity: 0.55;
    }
    .composer-status {
      min-height: 1rem;
      color: var(--muted);
      font-size: 0.74rem;
      overflow-wrap: anywhere;
    }
    .composer-status[data-error="true"] {
      color: #fda4af;
    }
    .composer-send {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      align-self: center;
      justify-self: end;
      border: 1px solid rgba(239,126,29,0.34);
      border-radius: 999px;
      width: var(--composer-icon-size);
      min-width: var(--composer-icon-size);
      height: var(--composer-icon-size);
      padding: 0;
      background: linear-gradient(180deg, rgba(239,126,29,0.18), rgba(239,126,29,0.12));
      color: #f8f0e3;
      font: inherit;
      font-size: 1.08rem;
      font-weight: 800;
      line-height: 1;
      cursor: pointer;
    }
    .composer-send:disabled {
      cursor: not-allowed;
      opacity: 0.55;
    }
    .composer-send[data-state="busy"] {
      background: linear-gradient(180deg, rgba(239,126,29,0.14), rgba(239,126,29,0.08));
    }
    .composer-icon {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 100%;
      height: 100%;
      pointer-events: none;
    }
    @media (max-width: 640px) {
      :root {
        --page-gutter: 0.55rem;
        --composer-side-width: 2.65rem;
        --composer-icon-size: 2.42rem;
      }
      .page { padding: 0.75rem var(--page-gutter) 8.9rem; }
      .hero { padding: 0.9rem 0.85rem 0.8rem; }
      .chip {
        max-width: 9.4rem;
      }
      .access-note {
        display: none;
      }
      .access-fields {
        width: min(22rem, calc(100vw - 1rem));
        grid-template-columns: 1fr;
      }
      .bottom-jump {
        right: 0.7rem;
        bottom: 8.35rem;
      }
      .composer {
        bottom: calc(var(--viewport-bottom-gap) + 0.35rem);
        left: calc(var(--viewport-offset-left) + max(0.38rem, env(safe-area-inset-left)));
        right: calc(var(--viewport-right-gap) + max(0.38rem, env(safe-area-inset-right)));
        width: auto;
        max-width: none;
        margin: 0;
        padding: 0.56rem 0.48rem 0.56rem 0.16rem;
      }
      .composer-row {
        gap: 0.28rem;
      }
      .composer-input {
        font-size: 16px;
      }
      .attachment-name {
        max-width: 9.2rem;
      }
    }
  </style>
</head>
<body>
  <main class="page">
    <section class="hero">
      <div class="hero-stack">
        <div class="chips">
          <div class="chip"><strong>Working dir:</strong> <span class="chip-value" id="session-cwd">unknown</span></div>
          <div class="chip"><strong>Access:</strong> <span class="chip-value" id="session-access">danger-full-access / never</span></div>
        </div>
        <div class="access-toolbar">
          <div class="segmented" role="group" aria-label="Access mode">
            <button class="segmented-btn" id="access-full" type="button">모든 권한</button>
            <button class="segmented-btn" id="access-custom" type="button">커스텀 권한</button>
          </div>
          <div class="access-fields" id="access-fields" hidden>
            <label class="access-field">
              <span class="access-field-label">Sandbox</span>
              <select class="access-select" id="access-sandbox">
                <option value="read-only">read-only</option>
                <option value="workspace-write">workspace-write</option>
                <option value="danger-full-access">danger-full-access</option>
              </select>
            </label>
            <label class="access-field">
              <span class="access-field-label">Approval</span>
              <select class="access-select" id="access-approval">
                <option value="never">never</option>
                <option value="on-request">on-request</option>
                <option value="untrusted">untrusted</option>
                <option value="on-failure">on-failure</option>
              </select>
            </label>
          </div>
          <div class="access-note" id="access-note"></div>
        </div>
      </div>
    </section>
    <section class="panel">
      <div class="stream" id="stream">
        <div class="empty" id="empty">No assistant activity yet.</div>
      </div>
      <div class="quota-line" id="quota-line" hidden></div>
      <div class="activity-line" id="activity-line" hidden></div>
    </section>
  </main>
  <form class="composer" id="composer">
    <div class="composer-row">
      <button class="composer-attach" id="composer-attach" type="button" aria-label="Attach files" title="Attach files">
        <span class="composer-icon" aria-hidden="true">+</span>
        <span class="sr-only">Attach files</span>
      </button>
      <input class="composer-file-input" id="composer-file-input" type="file" multiple>
      <div class="composer-input-wrap">
        <textarea
          class="composer-input"
          id="composer-input"
          rows="1"
          maxlength="${MAX_SUBMIT_CHARS}"
          placeholder="명령 입력"
        ></textarea>
      </div>
      <button class="composer-send" id="composer-send" type="submit" aria-label="Send" title="Send">
        <span class="composer-icon" aria-hidden="true">&uarr;</span>
        <span class="sr-only">Send</span>
      </button>
    </div>
    <div class="composer-attachments" id="composer-attachments" hidden></div>
    <div class="composer-status" id="composer-status"></div>
  </form>
  <button class="bottom-jump" id="bottom-jump" type="button">맨 아래로</button>
  <script>
    const state = {
      accessSaving: false,
      attachments: [],
      autoScrollEnabled: true,
      loading: false,
      programmaticScrollUntil: 0,
      version: 0,
      submitBusy: false,
      payload: null,
    };
    const AUTO_SCROLL_BOTTOM_THRESHOLD = 24;
    const PROGRAMMATIC_SCROLL_GRACE_MS = 900;
    const accessToken = ${JSON.stringify(tokenFromRequest)};
    const accessApproval = document.getElementById("access-approval");
    const accessCustomButton = document.getElementById("access-custom");
    const accessFields = document.getElementById("access-fields");
    const accessFullButton = document.getElementById("access-full");
    const accessNote = document.getElementById("access-note");
    const accessSandbox = document.getElementById("access-sandbox");
    const composerAttach = document.getElementById("composer-attach");
    const composerAttachments = document.getElementById("composer-attachments");
    const composerFileInput = document.getElementById("composer-file-input");
    const sessionCwd = document.getElementById("session-cwd");
    const sessionAccess = document.getElementById("session-access");
    const stream = document.getElementById("stream");
    const quotaLine = document.getElementById("quota-line");
    const activityLine = document.getElementById("activity-line");
    const bottomJump = document.getElementById("bottom-jump");
    const composer = document.getElementById("composer");
    const composerInput = document.getElementById("composer-input");
    const composerSend = document.getElementById("composer-send");
    const composerStatus = document.getElementById("composer-status");
    const LIVE_STATUS_REFRESH_MS = 1000;
    let liveStatusTimer = 0;

    function updateComposerSendButton() {
      const label = state.submitBusy
        ? "Sending"
        : state.accessSaving
          ? "Saving access"
          : "Send";
      composerSend.dataset.state = state.submitBusy || state.accessSaving ? "busy" : "idle";
      composerSend.setAttribute("aria-label", label);
      composerSend.setAttribute("title", label);
    }

    function escapeHtml(value) {
      return String(value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;");
    }

    function formatTime(value) {
      if (!value) {
        return "-";
      }
      return new Date(value).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
    }

    function formatBytes(value) {
      const size = Number(value || 0);
      if (size < 1024) {
        return size + " B";
      }
      if (size < 1024 * 1024) {
        return (size / 1024).toFixed(1).replace(/\.0$/, "") + " KB";
      }
      return (size / (1024 * 1024)).toFixed(1).replace(/\.0$/, "") + " MB";
    }

    function formatQuotaPercent(value) {
      const percent = Number(value);
      if (!Number.isFinite(percent)) {
        return "";
      }

      const rounded = Math.round(percent * 10) / 10;
      return rounded.toFixed(1).replace(/\.0$/, "") + "%";
    }

    function formatQuotaWindowLabel(windowMinutes) {
      const minutes = Number(windowMinutes);
      if (!Number.isFinite(minutes) || minutes <= 0) {
        return "";
      }

      if (minutes === 10080) {
        return "1\uC8FC";
      }
      if (minutes % 1440 === 0) {
        const days = Math.round(minutes / 1440);
        return days === 7 ? "1\uC8FC" : days + "\uC77C";
      }
      if (minutes % 60 === 0) {
        return Math.round(minutes / 60) + "\uC2DC\uAC04";
      }

      return Math.round(minutes) + "\uBD84";
    }

    function formatQuotaResetLabel(resetsAt, windowMinutes) {
      const seconds = Number(resetsAt);
      if (!Number.isFinite(seconds) || seconds <= 0) {
        return "";
      }

      const resetDate = new Date(seconds * 1000);
      if (Number.isNaN(resetDate.getTime())) {
        return "";
      }

      if (Number(windowMinutes || 0) <= 720) {
        return resetDate.toLocaleTimeString([], {
          hour: "numeric",
          minute: "2-digit",
        });
      }

      return resetDate.toLocaleDateString([], {
        month: "short",
        day: "numeric",
      });
    }

    function buildQuotaSegment(bucket) {
      if (!bucket) {
        return "";
      }

      const parts = [
        formatQuotaWindowLabel(bucket.windowMinutes),
        formatQuotaPercent(bucket.remainingPercent),
        formatQuotaResetLabel(bucket.resetsAt, bucket.windowMinutes),
      ].filter(Boolean);

      return parts.join(" ");
    }

    function resizeComposerInput() {
      composerInput.style.height = "var(--composer-control-height)";
      const nextHeight = Math.min(Math.max(composerInput.scrollHeight, 54), 120);
      composerInput.style.height = nextHeight + "px";
    }

    function renderAttachments() {
      const items = state.attachments || [];
      composerAttachments.hidden = items.length === 0;
      if (items.length === 0) {
        composerAttachments.innerHTML = "";
        return;
      }

      composerAttachments.innerHTML = items
        .map(
          (item) => \`
            <div class="attachment-chip" data-kind="\${escapeHtml(item.kind)}">
              <span class="attachment-name">\${escapeHtml(item.name)}</span>
              <span>\${escapeHtml(formatBytes(item.sizeBytes))}</span>
              <button class="attachment-remove" type="button" data-attachment-id="\${escapeHtml(item.id)}" aria-label="Remove attachment" \${state.submitBusy || state.accessSaving ? "disabled" : ""}>&times;</button>
            </div>
          \`,
        )
        .join("");
    }

    function setAttachments(nextAttachments) {
      state.attachments = Array.isArray(nextAttachments) ? nextAttachments : [];
      renderAttachments();
    }

    function clearAttachments() {
      setAttachments([]);
      composerFileInput.value = "";
    }

    function removeAttachmentById(attachmentId) {
      setAttachments((state.attachments || []).filter((item) => item.id !== attachmentId));
    }

    function readFileAsDataBase64(file) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const result = String(reader.result || "");
          const commaIndex = result.indexOf(",");
          if (commaIndex < 0) {
            reject(new Error("Failed to read attachment."));
            return;
          }
          resolve(result.slice(commaIndex + 1));
        };
        reader.onerror = () => reject(new Error("Failed to read attachment."));
        reader.readAsDataURL(file);
      });
    }

    async function filesToAttachmentPayloads(fileList) {
      const files = Array.from(fileList || []).filter(Boolean);
      if (files.length === 0) {
        return [];
      }

      if ((state.attachments || []).length + files.length > ${MAX_ATTACHMENTS}) {
        throw new Error("Too many attachments.");
      }

      let totalBytes = (state.attachments || []).reduce(
        (sum, item) => sum + Number(item.sizeBytes || 0),
        0,
      );
      const next = [];
      for (const file of files) {
        const sizeBytes = Number(file.size || 0);
        if (sizeBytes > ${MAX_ATTACHMENT_BYTES}) {
          throw new Error("Each attachment must be smaller than ${Math.round(MAX_ATTACHMENT_BYTES / (1024 * 1024))} MB.");
        }

        totalBytes += sizeBytes;
        if (totalBytes > ${MAX_TOTAL_ATTACHMENT_BYTES}) {
          throw new Error("Combined attachments are too large.");
        }

        const base64 = await readFileAsDataBase64(file);
        next.push({
          dataBase64: base64,
          id: Math.random().toString(36).slice(2, 10),
          kind: String(file.type || "").startsWith("image/") ? "image" : "file",
          mimeType: file.type || "application/octet-stream",
          name: file.name || "attachment",
          sizeBytes,
        });
      }
      return next;
    }

    async function appendAttachments(fileList) {
      const next = await filesToAttachmentPayloads(fileList);
      if (next.length === 0) {
        return;
      }

      setAttachments([...(state.attachments || []), ...next]);
      setComposerStatus(next.length + "개 첨부를 추가했습니다.", false);
      composerInput.focus();
    }

    async function handlePickedFiles(fileList) {
      try {
        await appendAttachments(fileList);
      } catch (error) {
        setComposerStatus(error.message || "첨부를 추가하지 못했습니다.", true);
      }
    }

    function extractFilesFromClipboard(event) {
      const clipboardItems = Array.from(event.clipboardData?.items || [])
        .filter((item) => item && item.kind === "file")
        .map((item) => item.getAsFile())
        .filter(Boolean);
      if (clipboardItems.length > 0) {
        return clipboardItems;
      }

      return Array.from(event.clipboardData?.files || []).filter(Boolean);
    }

    function formatElapsedLabel(value) {
      const at = Date.parse(String(value || ""));
      if (!Number.isFinite(at) || at <= 0) {
        return "";
      }

      const seconds = Math.max(0, Math.floor((Date.now() - at) / 1000));
      if (seconds < 60) {
        return seconds + "초 전";
      }

      const minutes = Math.floor(seconds / 60);
      return minutes + "분 전";
    }

    function inferLiveStatusLabel(turn) {
      const lastText = String(
        turn?.progressMessages?.[turn.progressMessages.length - 1]?.text || "",
      ).toLowerCase();
      if (!lastText) {
        return "생각중";
      }

      if (/(수정|패치|편집|파일|고침|edit|patch|write|update|modify|replace|apply_patch|diff|fix)/i.test(lastText)) {
        return "수정중";
      }
      if (/(테스트|검증|빌드|체크|실행|health|test|verify|build|lint|compile|check|run)/i.test(lastText)) {
        return "검증중";
      }
      if (/(확인|검색|조사|읽|분석|read|search|inspect|find|scan|review|analy)/i.test(lastText)) {
        return "확인중";
      }

      return "처리중";
    }

    function getLiveStatusSnapshot(payload = state.payload) {
      const queuedItems = payload?.queue?.items || [];
      const queueCount = queuedItems.filter((item) => item.status === "queued" || item.status === "sending").length;
      const turns = payload?.turns || [];
      const activeTurn = turns.find((turn) => turn.status === "in_progress");
      const completedTurn = [...turns]
        .filter((turn) => turn.status === "completed")
        .sort((left, right) => {
          const leftAt = Date.parse(String(left?.completedAt || left?.updatedAt || left?.startedAt || "")) || 0;
          const rightAt = Date.parse(String(right?.completedAt || right?.updatedAt || right?.startedAt || "")) || 0;
          return rightAt - leftAt;
        })[0];

      if (activeTurn) {
        const lastProgress = activeTurn.progressMessages?.[activeTurn.progressMessages.length - 1] || null;
        return {
          ageLabel: formatElapsedLabel(lastProgress?.at || activeTurn.updatedAt || activeTurn.startedAt),
          label: inferLiveStatusLabel(activeTurn),
          queueCount,
          state: "in_progress",
        };
      }

      if (completedTurn) {
        return {
          ageLabel: formatElapsedLabel(completedTurn.completedAt || completedTurn.updatedAt || completedTurn.startedAt),
          label: "처리완료",
          queueCount,
          state: "completed",
        };
      }

      if (queueCount > 0) {
        return {
          ageLabel: "",
          label: "대기중",
          queueCount,
          state: "queued",
        };
      }

      return null;
    }

    function renderQuotaLine(payload = state.payload, snapshot = getLiveStatusSnapshot(payload)) {
      const rateLimits = payload?.rateLimits || null;
      const segments = rateLimits
        ? [buildQuotaSegment(rateLimits.primary), buildQuotaSegment(rateLimits.secondary)].filter(Boolean)
        : [];

      if (!snapshot || snapshot.state !== "completed" || segments.length === 0) {
        quotaLine.hidden = true;
        quotaLine.textContent = "";
        activityLine.dataset.stacked = "false";
        return;
      }

      quotaLine.hidden = false;
      quotaLine.textContent = "\uB0A8\uC740 \uC694\uAE08 \uD55C\uB3C4 " + segments.join(" \u00B7 ");
      activityLine.dataset.stacked = "true";
    }

    function renderLiveStatus(payload = state.payload) {
      const snapshot = getLiveStatusSnapshot(payload);
      renderQuotaLine(payload, snapshot);
      if (!snapshot) {
        activityLine.hidden = true;
        activityLine.textContent = "";
        activityLine.dataset.state = "idle";
        return;
      }

      const dotCount = (Math.floor(Date.now() / LIVE_STATUS_REFRESH_MS) % 3) + 1;
      const dots = ".".repeat(dotCount);
      const animatedLabel = snapshot.state === "in_progress" ? snapshot.label + dots : snapshot.label;
      const parts = [animatedLabel];
      if (snapshot.ageLabel) {
        parts.push("마지막 갱신 " + snapshot.ageLabel);
      }
      if (snapshot.queueCount > 0) {
        parts.push("대기열 " + snapshot.queueCount + "건");
      }
      if (snapshot.state === "queued") {
        parts.push("앞선 작업이 끝나면 자동 실행");
      }

      activityLine.hidden = false;
      activityLine.dataset.state = snapshot.state;
      activityLine.textContent = parts.join(" · ");
    }

    function ensureLiveStatusTicker() {
      if (liveStatusTimer) {
        return;
      }

      liveStatusTimer = window.setInterval(() => {
        renderLiveStatus();
      }, LIVE_STATUS_REFRESH_MS);
    }

    function renderTurn(turn) {
      const completedText = turn.completedAt ? "Completed " + formatTime(turn.completedAt) : "Updated " + formatTime(turn.updatedAt);
      const finalText =
        turn.finalMessage ||
        (turn.status === "completed" && turn.progressMessages.length > 0
          ? turn.progressMessages[turn.progressMessages.length - 1].text
          : "");

      const progressBlocks =
        Array.isArray(turn.progressMessages) && turn.progressMessages.length > 0
          ? (turn.progressMessages || [])
              .map(
                (message) => \`
                  <div class="block progress">
                    <span class="block-label">Assistant Progress</span>
                    <p>\${escapeHtml(message.text)}</p>
                  </div>
                \`,
              )
              .join("")
          : "";

      const waitingBlock =
        turn.status === "in_progress" && (!turn.progressMessages || turn.progressMessages.length === 0)
          ? \`
              <div class="block waiting">
                <span class="block-label">Assistant</span>
                <p>Codex is working. No visible assistant text yet.</p>
              </div>
            \`
          : "";

      const answerBlock = finalText
        ? \`
            <div class="block answer">
              <span class="block-label">Assistant Reply</span>
              <p>\${escapeHtml(finalText)}</p>
            </div>
          \`
        : "";

      const promptBlock = turn.userMessage
        ? \`
            <div class="block prompt">
              <span class="block-label">User Request</span>
              <p>\${escapeHtml(turn.userMessage)}</p>
            </div>
          \`
        : "";

      return \`
        <article class="turn">
          <div class="turn-head">
            <div class="badge \${escapeHtml(turn.status)}">\${escapeHtml(turn.statusLabel)}</div>
            <div class="meta">\${escapeHtml(completedText)}</div>
          </div>
          \${promptBlock}
          \${progressBlocks}
          \${waitingBlock}
          \${turn.status === "completed" ? answerBlock : ""}
          \${turn.status !== "completed" && turn.finalMessage ? answerBlock : ""}
        </article>
      \`;
    }

    function renderQueuedSubmission(item) {
      const badgeLabel =
        item.status === "sending" ? "Sending" : item.status === "error" ? "Error" : "Queued";
      const errorBlock = item.error
        ? \`
            <div class="block error-block">
              <span class="block-label">Queue Error</span>
              <p>\${escapeHtml(item.error)}</p>
            </div>
          \`
        : "";

      return \`
        <article class="turn">
          <div class="turn-head">
            <div class="badge \${escapeHtml(item.status)}">\${escapeHtml(badgeLabel)}</div>
            <div class="meta">\${escapeHtml("Queued " + formatTime(item.updatedAt || item.at))}</div>
          </div>
          <div class="block prompt">
            <span class="block-label">Queued Command</span>
            <p>\${escapeHtml(item.message)}</p>
          </div>
          <div class="block waiting">
            <span class="block-label">Access</span>
            <p>\${escapeHtml(item.accessSummary)}</p>
          </div>
          \${errorBlock}
        </article>
      \`;
    }

    function setComposerStatus(text, isError = false) {
      composerStatus.textContent = text || "";
      composerStatus.dataset.error = isError ? "true" : "false";
    }

    function setAccessNote(text, isError = false) {
      accessNote.textContent = text || "";
      accessNote.dataset.error = isError ? "true" : "false";
    }

    function getBottomOffset() {
      return document.documentElement.scrollHeight - (window.scrollY + window.innerHeight);
    }

    function lockHorizontalScroll() {
      if (window.scrollX === 0) {
        return;
      }

      window.scrollTo({
        left: 0,
        top: window.scrollY,
        behavior: "auto",
      });
    }

    function syncViewportInsets() {
      const root = document.documentElement;
      const mobileViewport = window.matchMedia("(max-width: 640px)").matches;
      if (!mobileViewport || !window.visualViewport) {
        root.style.setProperty("--viewport-offset-left", "0px");
        root.style.setProperty("--viewport-right-gap", "0px");
        root.style.setProperty("--viewport-bottom-gap", "0px");
        return;
      }

      const visualViewport = window.visualViewport;
      const layoutWidth = document.documentElement.clientWidth || window.innerWidth || 0;
      const layoutHeight = window.innerHeight || document.documentElement.clientHeight || 0;
      const offsetLeft = Math.max(0, visualViewport.offsetLeft || 0);
      const rightGap = Math.max(0, layoutWidth - ((visualViewport.offsetLeft || 0) + visualViewport.width));
      const bottomGap = Math.max(0, layoutHeight - ((visualViewport.offsetTop || 0) + visualViewport.height));

      root.style.setProperty("--viewport-offset-left", offsetLeft.toFixed(2) + "px");
      root.style.setProperty("--viewport-right-gap", rightGap.toFixed(2) + "px");
      root.style.setProperty("--viewport-bottom-gap", bottomGap.toFixed(2) + "px");
    }

    function isProgrammaticScrollActive() {
      return Date.now() < state.programmaticScrollUntil;
    }

    function updateBottomJumpVisibility() {
      bottomJump.hidden = getBottomOffset() <= AUTO_SCROLL_BOTTOM_THRESHOLD;
    }

    function scrollToBottom(behavior = "auto", enableAutoScroll = true) {
      if (enableAutoScroll) {
        state.autoScrollEnabled = true;
      }

      state.programmaticScrollUntil =
        Date.now() + (behavior === "smooth" ? PROGRAMMATIC_SCROLL_GRACE_MS : 120);
      window.scrollTo({
        top: document.documentElement.scrollHeight,
        behavior,
      });
      window.setTimeout(updateBottomJumpVisibility, behavior === "smooth" ? 420 : 60);
    }

    function syncAutoScrollAfterRender() {
      if (state.autoScrollEnabled) {
        scrollToBottom("auto", true);
        return;
      }

      updateBottomJumpVisibility();
    }

    function handleWindowScroll() {
      lockHorizontalScroll();
      syncViewportInsets();
      updateBottomJumpVisibility();
      if (isProgrammaticScrollActive()) {
        return;
      }

      state.autoScrollEnabled = false;
    }

    function handleWindowResize() {
      lockHorizontalScroll();
      syncViewportInsets();
      if (state.autoScrollEnabled) {
        scrollToBottom("auto", true);
        return;
      }

      updateBottomJumpVisibility();
    }

    function updateAccessControls(payload) {
      const accessState = payload && payload.access ? payload.access : null;
      const mode = accessState && accessState.mode === "custom" ? "custom" : "full";
      const custom =
        accessState && accessState.custom
          ? accessState.custom
          : { sandbox: "workspace-write", approvalPolicy: "on-request" };
      const effective =
        accessState && accessState.effective
          ? accessState.effective
          : { sandbox: "danger-full-access", approvalPolicy: "never" };
      const controlsDisabled = state.submitBusy || state.accessSaving;

      sessionAccess.textContent =
        accessState && accessState.summary
          ? accessState.summary
          : effective.sandbox + " / " + effective.approvalPolicy;
      accessFullButton.dataset.active = mode === "full" ? "true" : "false";
      accessCustomButton.dataset.active = mode === "custom" ? "true" : "false";
      accessFullButton.disabled = controlsDisabled;
      accessCustomButton.disabled = controlsDisabled;
      accessFields.hidden = mode !== "custom";
      accessSandbox.value = custom.sandbox;
      accessApproval.value = custom.approvalPolicy;
      accessSandbox.disabled = controlsDisabled || mode !== "custom";
      accessApproval.disabled = controlsDisabled || mode !== "custom";
    }

    function updateComposer(payload) {
      const composerState = payload && payload.composer ? payload.composer : null;
      const enabled = Boolean(composerState && composerState.enabled);
      const disabled = !enabled || state.submitBusy || state.accessSaving;

      composerAttach.disabled = disabled;
      composerFileInput.disabled = disabled;
      composerInput.disabled = disabled;
      composerSend.disabled = disabled;
      updateComposerSendButton();

      if (!enabled) {
        composerInput.placeholder = "세션 연결 대기 중";
        if (!state.submitBusy) {
          setComposerStatus("현재 세션을 아직 찾지 못했습니다.", false);
        }
        renderAttachments();
        resizeComposerInput();
        return;
      }

      composerInput.placeholder = "명령 입력";
      if (!state.submitBusy && composerStatus.textContent === "현재 세션을 아직 찾지 못했습니다.") {
        setComposerStatus("", false);
      }
      renderAttachments();
      resizeComposerInput();
    }
    function collectCustomAccessSelection() {
      return {
        mode: "custom",
        custom: {
          approvalPolicy: accessApproval.value,
          sandbox: accessSandbox.value,
        },
      };
    }

    async function updateAccessSelection(nextSelection) {
      if (state.accessSaving || state.submitBusy) {
        return;
      }

      state.accessSaving = true;
      updateAccessControls(state.payload);
      updateComposer(state.payload);
      setAccessNote("권한 설정 저장 중...", false);

      try {
        const response = await fetch(
          "/api/access" + (accessToken ? "?token=" + encodeURIComponent(accessToken) : ""),
          {
            method: "POST",
            cache: "no-store",
            headers: {
              "Content-Type": "application/json; charset=utf-8",
            },
            body: JSON.stringify(nextSelection),
          },
        );

        const payload = await response.json();
        if (!response.ok || !payload.ok) {
          throw new Error(payload.error || "권한 설정 저장에 실패했습니다.");
        }

        render(payload);
        state.version = payload.version;
        setAccessNote(
          payload.access && payload.access.summary
            ? "현재 권한: " + payload.access.summary
            : "권한 설정이 저장되었습니다.",
          false,
        );
      } catch (error) {
        setAccessNote(error.message || "권한 설정 저장에 실패했습니다.", true);
      } finally {
        state.accessSaving = false;
        updateAccessControls(state.payload);
        updateComposer(state.payload);
      }
    }

    function render(payload) {
      state.payload = payload;
      sessionCwd.textContent = payload.session && payload.session.cwd ? payload.session.cwd : "unknown";
      updateAccessControls(payload);
      updateComposer(payload);

      const queuedItems = payload.queue && payload.queue.items ? payload.queue.items : [];
      const turns = payload.turns || [];
      if (queuedItems.length === 0 && turns.length === 0) {
        stream.innerHTML = '<div class="empty">No assistant activity yet.</div>';
        renderLiveStatus(payload);
        syncAutoScrollAfterRender();
        return;
      }

      stream.innerHTML = queuedItems.map(renderQueuedSubmission).join("") + turns.map(renderTurn).join("");
      renderLiveStatus(payload);
      syncAutoScrollAfterRender();
    }

    async function poll() {
      if (state.loading) {
        return;
      }

      state.loading = true;
      try {
        const response = await fetch(
          "/api/state?_=" + Date.now() + (accessToken ? "&token=" + encodeURIComponent(accessToken) : ""),
          { cache: "no-store" },
        );
        if (!response.ok) {
          throw new Error("HTTP " + response.status);
        }

        const payload = await response.json();
        if (payload.version !== state.version) {
          render(payload);
          state.version = payload.version;
        }
      } catch (error) {
      } finally {
        state.loading = false;
        window.setTimeout(poll, ${POLL_INTERVAL_MS});
      }
    }

    async function submitPromptSafe(event) {
      event.preventDefault();

      if (state.submitBusy) {
        return;
      }

      const message = composerInput.value.trim();
      const attachments = (state.attachments || []).map((item) => ({
        dataBase64: item.dataBase64,
        mimeType: item.mimeType,
        name: item.name,
      }));
      if (!message && attachments.length === 0) {
        composerInput.focus();
        return;
      }

      state.submitBusy = true;
      updateComposer(state.payload);
      setComposerStatus("보내는 중...", false);

      try {
        const response = await fetch(
          "/api/submit" + (accessToken ? "?token=" + encodeURIComponent(accessToken) : ""),
          {
            method: "POST",
            cache: "no-store",
            headers: {
              "Content-Type": "application/json; charset=utf-8",
            },
            body: JSON.stringify({
              message,
              attachments,
            }),
          },
        );

        const payload = await response.json();
        if (!response.ok || !payload.ok) {
          throw new Error(payload.error || "전송에 실패했습니다.");
        }

        composerInput.value = "";
        clearAttachments();
        resizeComposerInput();
        if (payload.mode === "queued") {
          setComposerStatus("현재 응답이 끝나면 자동으로 보냅니다.", false);
        } else if (payload.mode === "steer") {
          setComposerStatus("현재 작업 흐름에 바로 반영했습니다.", false);
        } else {
          setComposerStatus("명령을 보냈습니다.", false);
        }
        state.version = 0;
        scrollToBottom("smooth", true);
        window.setTimeout(poll, 150);
      } catch (error) {
        setComposerStatus(error.message || "전송에 실패했습니다.", true);
      } finally {
        state.submitBusy = false;
        updateComposer(state.payload);
      }
    }

    bottomJump.addEventListener("click", () => {
      scrollToBottom("smooth", true);
    });
    accessFullButton.addEventListener("click", () => {
      updateAccessSelection({ mode: "full" });
    });
    accessCustomButton.addEventListener("click", () => {
      updateAccessSelection(collectCustomAccessSelection());
    });
    accessSandbox.addEventListener("change", () => {
      updateAccessSelection(collectCustomAccessSelection());
    });
    accessApproval.addEventListener("change", () => {
      updateAccessSelection(collectCustomAccessSelection());
    });
    composerAttach.addEventListener("click", () => {
      if (!composerAttach.disabled) {
        composerFileInput.click();
      }
    });
    composerFileInput.addEventListener("change", async (event) => {
      await handlePickedFiles(event.target.files);
      composerFileInput.value = "";
    });
    composerAttachments.addEventListener("click", (event) => {
      const removeButton = event.target.closest("[data-attachment-id]");
      if (!removeButton) {
        return;
      }

      removeAttachmentById(removeButton.getAttribute("data-attachment-id"));
    });
    composerInput.addEventListener("input", () => {
      resizeComposerInput();
    });
    composerInput.addEventListener("focus", () => {
      syncViewportInsets();
      window.setTimeout(syncViewportInsets, 80);
      window.setTimeout(syncViewportInsets, 220);
    });
    composerInput.addEventListener("blur", () => {
      window.setTimeout(syncViewportInsets, 120);
    });
    composerInput.addEventListener("paste", async (event) => {
      const files = extractFilesFromClipboard(event);
      if (files.length === 0) {
        return;
      }

      event.preventDefault();
      await handlePickedFiles(files);
    });
    window.addEventListener("scroll", handleWindowScroll, { passive: true });
    window.addEventListener("resize", handleWindowResize);
    window.addEventListener("orientationchange", handleWindowResize);
    if (window.visualViewport) {
      window.visualViewport.addEventListener("resize", handleWindowResize);
      window.visualViewport.addEventListener("scroll", syncViewportInsets);
    }
    composer.addEventListener("submit", submitPromptSafe);

    renderAttachments();
    resizeComposerInput();
    renderLiveStatus();
    ensureLiveStatusTicker();
    lockHorizontalScroll();
    syncViewportInsets();
    updateBottomJumpVisibility();
    poll();
  </script>
</body>
</html>`;
}

syncLog(true);

const server = http.createServer((request, response) => {
  const requestUrl = new URL(request.url, `http://127.0.0.1:${PORT}`);

  if (requestUrl.pathname === "/health") {
    response.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("ok");
    return;
  }

  if (!isAuthorized(requestUrl, request)) {
    writeJson(response, { ok: false, error: "unauthorized" }, 401);
    return;
  }

  if (requestUrl.pathname === "/api/state") {
    writeJson(response, getStatePayload());
    return;
  }

  if (requestUrl.pathname === "/api/access") {
    if (request.method !== "POST") {
      writeJson(response, { ok: false, error: "method not allowed" }, 405);
      return;
    }

    handleAccessUpdateRequest(request, response).catch((error) => {
      writeJson(
        response,
        {
          ok: false,
          error: error.message || "Failed to update access settings.",
          code: error.code || "access_update_failed",
        },
        error.statusCode || 500,
      );
    });
    return;
  }

  if (requestUrl.pathname === "/api/submit") {
    if (request.method !== "POST") {
      writeJson(response, { ok: false, error: "method not allowed" }, 405);
      return;
    }

    handleSubmitRequest(request, response).catch((error) => {
      writeJson(
        response,
        {
          ok: false,
          error: error.message || "Failed to submit the message.",
          code: error.code || "submit_failed",
        },
        error.statusCode || 500,
      );
    });
    return;
  }

  if (requestUrl.pathname === "/" || requestUrl.pathname === "/index.html") {
    writeHtml(response, getIndexHtml(String(requestUrl.searchParams.get("token") || "").trim()));
    return;
  }

  writeJson(response, { ok: false, error: "not found" }, 404);
});

server.listen(PORT, "0.0.0.0", () => {
  const urls = listLocalIpv4Addresses().map((address) => `http://${address}:${PORT}/`);
  const summary = urls.length > 0 ? urls.join("  ") : `http://127.0.0.1:${PORT}/`;
  process.stdout.write(`Codex Live View listening on ${summary}\n`);
});

process.on("SIGINT", () => process.exit(0));
process.on("SIGTERM", () => process.exit(0));
