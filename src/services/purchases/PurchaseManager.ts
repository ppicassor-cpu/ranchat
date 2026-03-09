// FILE: C:\ranchat\src\services\purchases\PurchaseManager.ts
import Purchases from "react-native-purchases";
import { APP_CONFIG } from "../../config/app";
import { useAppStore } from "../../store/useAppStore";
import { useTranslation } from "../../i18n/LanguageProvider";
import { createDefaultMatchFilter, saveMatchFilterOnServer } from "../call/MatchFilterService";

let inited = false;
let initInFlight: Promise<void> | null = null;
let currentRcAppUserId: string | null = null;
let customerInfoListenerBound = false;

export type OneTimePurchaseResult = {
  ok: boolean;
  cancelled: boolean;
  productId: string;
  transactionId: string;
  purchaseDate: string;
  rcAppUserId: string;
  errorCode: string;
  errorMessage: string;
};

function inferPlanId(productIdRaw: string): string | null {
  const productId = String(productIdRaw || "").toLowerCase();
  if (!productId) return null;
  if (productId.includes("year")) return "yearly";
  if (productId.includes("month")) return "monthly";
  if (productId.includes("week")) return "weekly";
  return null;
}

function toUserId(v: string | null | undefined): string {
  return String(v || "").trim();
}

function parseRevenueCatExpiryMs(entitlement: any): number | null {
  const raw =
    entitlement?.expirationDate ??
    entitlement?.expiresDate ??
    entitlement?.expiration_date ??
    entitlement?.expires_at_ms ??
    entitlement?.expirationDateMillis ??
    null;
  if (raw == null || raw === "") return null;
  const numeric = Number(raw);
  if (Number.isFinite(numeric) && numeric > 0) return Math.trunc(numeric);
  const parsed = Date.parse(String(raw));
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : null;
}

function readStoreUserId(): string {
  const st: any = useAppStore.getState?.() ?? {};
  return toUserId(st?.auth?.userId);
}

async function resetMatchFilterToAllOnServerIfNeeded(): Promise<void> {
  const st: any = useAppStore.getState?.() ?? {};
  const token = String(st?.auth?.token || "").trim();
  const userId = String(st?.auth?.userId || "").trim();
  const deviceKey = String(st?.auth?.deviceKey || "").trim();
  if (!token || !userId || !deviceKey) return;
  try {
    await saveMatchFilterOnServer({
      token,
      userId,
      deviceKey,
      filter: createDefaultMatchFilter(),
    });
  } catch {
    // Ignore network failures; next refresh can retry.
  }
}

async function loginRcUserIfNeeded(userIdRaw: string | null | undefined): Promise<void> {
  const userId = toUserId(userIdRaw);
  if (!userId) return;
  if (!inited) return;
  if (currentRcAppUserId === userId) return;

  try {
    await (Purchases as any).logIn(userId);
    currentRcAppUserId = userId;
  } catch {
    // Ignore and keep current identity.
  }
}

function applyCustomerInfoToStore(customerInfo: any): void {
  const entitlementId = APP_CONFIG.PURCHASES.entitlementId;
  const prevPremium = Boolean((useAppStore.getState() as any)?.sub?.isPremium);
  const activeEntitlement = customerInfo?.entitlements?.active?.[entitlementId] as any;
  const entitlement = (activeEntitlement ?? customerInfo?.entitlements?.all?.[entitlementId]) as any;
  const active = Boolean(activeEntitlement);
  const productId = String(
    active
      ? activeEntitlement?.productIdentifier ??
        activeEntitlement?.productId ??
        customerInfo?.activeSubscriptions?.[0] ??
        ""
      : ""
  ).trim();
  const premiumExpiresAtMs = parseRevenueCatExpiryMs(entitlement);

  useAppStore.getState().setSub({
    isPremium: active,
    entitlementId: entitlementId,
    lastCheckedAt: Date.now(),
    storeProductId: productId || null,
    planId: inferPlanId(productId),
    premiumExpiresAtMs,
  });

  if (prevPremium && !active) {
    resetMatchFilterToAllOnServerIfNeeded().catch(() => undefined);
  }
}

export async function initPurchases(userIdRaw?: string | null) {
  const key = APP_CONFIG.PURCHASES.revenueCatKey;
  if (!key) return;

  const userId = toUserId(userIdRaw) || readStoreUserId();

  if (inited) {
    await loginRcUserIfNeeded(userId);
    return;
  }

  if (initInFlight) {
    await initInFlight;
    await loginRcUserIfNeeded(userId);
    return;
  }

  initInFlight = (async () => {
    try {
      Purchases.setLogLevel(Purchases.LOG_LEVEL.ERROR);
      const cfg: any = { apiKey: key };
      if (userId) cfg.appUserID = userId;

      await Purchases.configure(cfg);
      inited = true;
      currentRcAppUserId = userId || null;
      if (
        !customerInfoListenerBound &&
        typeof (Purchases as any).addCustomerInfoUpdateListener === "function"
      ) {
        try {
          (Purchases as any).addCustomerInfoUpdateListener((customerInfo: any) => {
            applyCustomerInfoToStore(customerInfo);
          });
          customerInfoListenerBound = true;
        } catch {
          // Ignore listener binding failure.
        }
      }
      await refreshSubscription();
    } catch {
      // Ignore init failure.
    } finally {
      initInFlight = null;
    }
  })();

  await initInFlight;
}

export async function syncPurchasesAppUser(userIdRaw?: string | null): Promise<void> {
  const userId = toUserId(userIdRaw) || readStoreUserId();
  await initPurchases(userId);
  await loginRcUserIfNeeded(userId);
}

export async function purchasePremiumByProductId(productId: string) {
  await initPurchases(readStoreUserId());
  const offerings = await Purchases.getOfferings();
  const current = offerings.current;
  if (!current) throw new Error("No current offering");

  const allPkgs = current.availablePackages ?? [];
  const target = allPkgs.find((p) => p?.product?.identifier === productId);

  if (!target) {
    throw new Error(`Product not found in offering: ${productId}`);
  }

  await Purchases.purchasePackage(target);
}

async function findOfferingPackageByProductId(productId: string): Promise<any | null> {
  const pid = String(productId || "").trim();
  if (!pid) return null;

  try {
    const offerings: any = await Purchases.getOfferings();
    const all = offerings?.all && typeof offerings.all === "object" ? offerings.all : {};
    const seen = new Set<any>();
    const offeringRows: any[] = [];

    if (offerings?.current) {
      offeringRows.push(offerings.current);
      seen.add(offerings.current);
    }

    for (const key of Object.keys(all)) {
      const offering = all[key];
      if (offering && !seen.has(offering)) {
        offeringRows.push(offering);
        seen.add(offering);
      }
    }

    for (const offering of offeringRows) {
      const rows = Array.isArray(offering?.availablePackages) ? offering.availablePackages : [];
      const match = rows.find((row: any) => String(row?.product?.identifier || "").trim() === pid);
      if (match) return match;
    }
  } catch {
    // Fall back to direct store-product lookup.
  }

  return null;
}

async function findStoreProductById(productId: string): Promise<any | null> {
  const pid = String(productId || "").trim();
  if (!pid) return null;

  const candidates: any[] = [
    (Purchases as any)?.PRODUCT_CATEGORY?.NON_SUBSCRIPTION,
    (Purchases as any)?.PURCHASE_TYPE?.INAPP,
    (Purchases as any)?.PRODUCT_CATEGORY?.SUBSCRIPTION,
  ].filter(Boolean);

  const attempts: Array<() => Promise<any[]>> = [
    async () => await (Purchases as any).getProducts([pid]),
    ...candidates.map((type) => async () => await (Purchases as any).getProducts([pid], type)),
  ];

  for (const run of attempts) {
    try {
      const rows: any[] = await run();
      if (!Array.isArray(rows) || rows.length === 0) continue;
      const match =
        rows.find((row: any) => String(row?.identifier || row?.productIdentifier || "").trim() === pid) || rows[0];
      if (match) return match;
    } catch {
      // Try next lookup strategy.
    }
  }

  return null;
}

export async function purchaseOneTimeByProductId(productId: string): Promise<OneTimePurchaseResult> {
  const pid = String(productId || "").trim();
  if (!pid) {
    return {
      ok: false,
      cancelled: false,
      productId: "",
      transactionId: "",
      purchaseDate: "",
      rcAppUserId: "",
      errorCode: "PRODUCT_ID_MISSING",
      errorMessage: "PRODUCT_ID_MISSING",
    };
  }

  try {
    await syncPurchasesAppUser(readStoreUserId());
    const pkg = await findOfferingPackageByProductId(pid);
    const product = pkg ? null : await findStoreProductById(pid);
    if (!pkg && !product) {
      return {
        ok: false,
        cancelled: false,
        productId: pid,
        transactionId: "",
        purchaseDate: "",
        rcAppUserId: "",
        errorCode: "PRODUCT_NOT_FOUND",
        errorMessage: "PRODUCT_NOT_FOUND",
      };
    }

    const out: any = pkg
      ? await Purchases.purchasePackage(pkg)
      : await (Purchases as any).purchaseStoreProduct(product);
    const boughtProductId = String(out?.productIdentifier || pkg?.product?.identifier || product?.identifier || pid).trim() || pid;
    const customerInfo: any = out?.customerInfo ?? null;
    const rcAppUserId = String(customerInfo?.originalAppUserId || (await (Purchases as any).getAppUserID?.()) || "").trim();

    let transactionId = "";
    let purchaseDate = "";
    const txs = Array.isArray(customerInfo?.nonSubscriptionTransactions) ? customerInfo.nonSubscriptionTransactions : [];
    const matched = txs
      .filter((tx: any) => String(tx?.productIdentifier || "").trim() === boughtProductId)
      .sort((a: any, b: any) => {
        const ta = Date.parse(String(a?.purchaseDate || "")) || 0;
        const tb = Date.parse(String(b?.purchaseDate || "")) || 0;
        return tb - ta;
      });

    const pick = matched[0] || txs[0] || null;
    if (pick) {
      transactionId = String(pick?.transactionIdentifier || "").trim();
      purchaseDate = String(pick?.purchaseDate || "").trim();
    }

    if (!transactionId) {
      transactionId = `rc_${boughtProductId}_${Date.now()}`;
    }

    return {
      ok: true,
      cancelled: false,
      productId: boughtProductId,
      transactionId,
      purchaseDate,
      rcAppUserId,
      errorCode: "",
      errorMessage: "",
    };
  } catch (e: any) {
    const cancelled = Boolean(e?.userCancelled);
    return {
      ok: false,
      cancelled,
      productId: pid,
      transactionId: "",
      purchaseDate: "",
      rcAppUserId: "",
      errorCode: cancelled ? "USER_CANCELLED" : String(e?.code || "PURCHASE_FAILED"),
      errorMessage: cancelled ? "USER_CANCELLED" : String(e?.message || "PURCHASE_FAILED"),
    };
  }
}

export async function refreshSubscription() {
  if (!inited) return;
  try {
    const customerInfo = await Purchases.getCustomerInfo();
    applyCustomerInfoToStore(customerInfo);
  } catch {}
}

export async function purchasePremium() {
  const { t } = useTranslation();
  try {
    await initPurchases(readStoreUserId());
    const offerings = await Purchases.getOfferings();
    const current = offerings.current;
    if (!current || current.availablePackages.length === 0) {
      useAppStore.getState().showGlobalModal(t("subscription.title"), t("subscription.no_offering"));
      return;
    }

    const pick =
      current.availablePackages.find((p) => p.packageType === Purchases.PACKAGE_TYPE.WEEKLY) ||
      current.availablePackages.find((p) => p.packageType === Purchases.PACKAGE_TYPE.MONTHLY) ||
      current.availablePackages.find((p) => p.packageType === Purchases.PACKAGE_TYPE.SIX_MONTH) ||
      current.availablePackages[0];

    await Purchases.purchasePackage(pick);

    const customerInfo = await Purchases.getCustomerInfo();
    applyCustomerInfoToStore(customerInfo);
  } catch (e: any) {
    const { t } = useTranslation();
    if (e?.userCancelled) return;
    useAppStore.getState().showGlobalModal(t("subscription.title"), t("subscription.payment_failed"));
  }
}

export async function openManageSubscriptions() {
  const { t } = useTranslation();
  try {
    // @ts-ignore
    await Purchases.showManageSubscriptions();
  } catch {
    useAppStore.getState().showGlobalModal(t("subscription.manage"), t("subscription.manage_failed"));
  }
}
