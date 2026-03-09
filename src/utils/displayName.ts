const DEFAULT_PROFILE_NICKNAME_RE = /^user[A-Z0-9]{6}$/;
const INTERNAL_PLACEHOLDER_NAME_RE = /^(?:u|d)$/i;

function toText(value: unknown, maxLen = 240): string {
  return String(value ?? "").trim().slice(0, maxLen);
}

function stripInternalAliasPrefix(value: unknown, maxLen = 240): string {
  return toText(value, maxLen).replace(/^[a-z]:/i, "");
}

function isInternalPlaceholderName(value: unknown): boolean {
  return INTERNAL_PLACEHOLDER_NAME_RE.test(toText(value, 8));
}

export function isGeneratedProfileNickname(value: unknown): boolean {
  const text = toText(value, 32);
  return Boolean(text) && DEFAULT_PROFILE_NICKNAME_RE.test(text);
}

export function extractEmailAccountPrefix(...values: unknown[]): string {
  for (const value of values) {
    const text = stripInternalAliasPrefix(value, 240);
    if (!text) continue;
    const match = text.match(/^([^@\s]+)@[^@\s]+$/);
    if (match?.[1]) {
      return toText(match[1], 64);
    }
  }
  return "";
}

export function extractIdentityFallback(...values: unknown[]): string {
  for (const value of values) {
    const text = stripInternalAliasPrefix(value, 180);
    if (!text) continue;
    const part = text
      .split(/[@:_-]/)
      .find((segment) => toText(segment, 64).length > 0);
    const fallback = toText(part, 64);
    if (fallback && !isInternalPlaceholderName(fallback)) {
      return fallback;
    }
  }
  return "";
}

type ResolveDisplayNameInput = {
  nickname?: unknown;
  loginAccount?: unknown;
  email?: unknown;
  userId?: unknown;
  profileId?: unknown;
  contactKey?: unknown;
  displayName?: unknown;
  name?: unknown;
  fallback?: unknown;
};

export function resolveDisplayName(input: ResolveDisplayNameInput): string {
  const nickname = toText(input.nickname, 32);
  if (nickname && !isGeneratedProfileNickname(nickname)) {
    return nickname;
  }

  const displayName = toText(input.displayName, 64);
  if (displayName && !isGeneratedProfileNickname(displayName) && !isInternalPlaceholderName(displayName)) {
    return displayName;
  }

  const name = toText(input.name, 64);
  if (name && !isGeneratedProfileNickname(name) && !isInternalPlaceholderName(name)) {
    return name;
  }

  const emailPrefix = extractEmailAccountPrefix(
    input.loginAccount,
    input.email,
    input.userId,
    input.profileId,
    input.contactKey
  );
  if (emailPrefix) {
    return emailPrefix;
  }

  const fallbackIdentity = extractIdentityFallback(input.profileId, input.contactKey, input.userId);
  if (fallbackIdentity) {
    return fallbackIdentity;
  }

  return toText(input.fallback, 64);
}

export function formatDisplayName(value: unknown, fallback = ""): string {
  const text = toText(value, 64);
  if (!text) {
    return toText(fallback, 64);
  }
  if (isGeneratedProfileNickname(text)) {
    return toText(fallback, 64);
  }
  const emailPrefix = extractEmailAccountPrefix(text);
  return emailPrefix || text;
}
