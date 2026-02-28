import { APP_CONFIG } from "../config/app";

export const MATCH_TIMEOUT_MS = (() => {
  const v = Number((APP_CONFIG as any)?.MATCH_TIMEOUT_MS);
  return Number.isFinite(v) ? v : 60000;
})();

export const FREE_CALL_LIMIT_MS = (() => {
  const direct = Number((APP_CONFIG as any)?.FREE_CALL_LIMIT_MS);
  if (Number.isFinite(direct)) return direct;

  const sec = Number((APP_CONFIG as any)?.FREE_LIMITS?.remoteVideoSeconds);
  if (Number.isFinite(sec)) return sec * 1000;

  return 3000 * 1000;
})();

export const INTERSTITIAL_COOLDOWN_MS = 4 * 60 * 1000;
export const MATCHING_ACTIONS_DELAY_MS = 7500;
