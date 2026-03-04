type PopTalkLike = {
  balance?: unknown;
  cap?: unknown;
  plan?: unknown;
};

const POPTALK_UNLIMITED_THRESHOLD = 1_000_000_000;

function toInt(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.trunc(n));
}

export function isPopTalkUnlimited(popTalk: PopTalkLike | null | undefined): boolean {
  const balance = toInt(popTalk?.balance);
  const cap = toInt(popTalk?.cap);
  const plan = String(popTalk?.plan || "").trim().toLowerCase();

  if (balance >= POPTALK_UNLIMITED_THRESHOLD || cap >= POPTALK_UNLIMITED_THRESHOLD) return true;
  if (plan === "monthly" && (balance >= 500_000_000 || cap >= 500_000_000)) return true;
  return false;
}

export function formatPopTalkCount(v: unknown): string {
  return toInt(v).toLocaleString("ko-KR");
}

