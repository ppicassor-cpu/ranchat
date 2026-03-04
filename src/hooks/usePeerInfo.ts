import { useMemo } from "react";
import { getLanguageName } from "../i18n/displayNames";
import { countryCodeToFlagEmoji } from "../utils/countryUtils";

type UsePeerInfoArgs = {
  peerInfo: any;
  prefs: any;
  t: (key: string, params?: any) => string;
};

export default function usePeerInfo({ peerInfo, prefs, t }: UsePeerInfoArgs) {
  const peerCountryRaw = useMemo(() => String((peerInfo as any)?.country ?? ""), [peerInfo]);
  const isAiPeer = useMemo(() => Boolean((peerInfo as any)?.ai || (peerInfo as any)?.isAi), [peerInfo]);
  const peerLangRaw = useMemo(() => String((peerInfo as any)?.language ?? (peerInfo as any)?.lang ?? ""), [peerInfo]);
  const peerFlag = useMemo(() => {
    const direct = String((peerInfo as any)?.flag ?? "").trim();
    return direct || countryCodeToFlagEmoji(peerCountryRaw);
  }, [peerInfo, peerCountryRaw]);
  const peerLangLabel = useMemo(() => {
    return getLanguageName(t, peerLangRaw);
  }, [peerLangRaw, t]);
  const peerGenderRaw = useMemo(() => String((peerInfo as any)?.gender ?? ""), [peerInfo]);
  const peerGenderLabel = useMemo(() => {
    const g = String(peerGenderRaw || "").trim().toLowerCase();
    if (!g) return "";
    if (g === "male" || g === "m") return t("gender.male");
    if (g === "female" || g === "f") return t("gender.female");
    return peerGenderRaw;
  }, [peerGenderRaw, t]);

  const peerInfoText = useMemo(() => {
    const parts: string[] = [];

    const countryPart = `${peerFlag ? `${peerFlag} ` : ""}${peerCountryRaw || ""}`;
    if (countryPart.trim()) parts.push(countryPart.trim());

    if (peerLangLabel) parts.push(peerLangLabel);

    if (peerGenderLabel) parts.push(peerGenderLabel);

    return parts.join(" · ");
  }, [peerLangLabel, peerFlag, peerCountryRaw, peerGenderLabel]);

  const myCountryRaw = useMemo(() => String((prefs as any)?.country ?? ""), [prefs]);
  const myLangRaw = useMemo(() => String((prefs as any)?.language ?? (prefs as any)?.lang ?? ""), [prefs]);
  const myFlag = useMemo(() => countryCodeToFlagEmoji(myCountryRaw), [myCountryRaw]);
  const myGenderRaw = useMemo(() => String((prefs as any)?.gender ?? ""), [prefs]);

  return {
    isAiPeer,
    peerInfoText,
    myCountryRaw,
    myLangRaw,
    myGenderRaw,
    myFlag,
  };
}
