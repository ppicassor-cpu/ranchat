export function countryCodeToFlagEmoji(code: string) {
  const cc = String(code || "").trim().toUpperCase();
  if (cc.length !== 2) return "";
  const A = 0x1f1e6;
  const c1 = cc.charCodeAt(0) - 65;
  const c2 = cc.charCodeAt(1) - 65;
  if (c1 < 0 || c1 > 25 || c2 < 0 || c2 > 25) return "";
  return String.fromCodePoint(A + c1, A + c2);
}
