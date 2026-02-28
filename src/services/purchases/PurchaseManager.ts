// FILE: C:\ranchat\src\services\purchases\PurchaseManager.ts
import Purchases from "react-native-purchases";
import { APP_CONFIG } from "../../config/app";
import { useAppStore } from "../../store/useAppStore";
import { useTranslation } from "../../i18n/LanguageProvider";

let inited = false;
let initInFlight: Promise<void> | null = null;
let currentRcAppUserId: string | null = null;

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

function readStoreUserId(): string {
  const st: any = useAppStore.getState?.() ?? {};
  return toUserId(st?.auth?.userId);
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

async function findStoreProductById(productId: string): Promise<any | null> {
  const pid = String(productId || "").trim();
  if (!pid) return null;

  const candidates: any[] = [
    (Purchases as any)?.PRODUCT_CATEGORY?.NON_SUBSCRIPTION,
    (Purchases as any)?.PURCHASE_TYPE?.INAPP,
    (Purchases as any)?.PRODUCT_CATEGORY?.SUBSCRIPTION,
  ].filter(Boolean);

  for (const type of candidates) {
    try {
      const rows: any[] = await (Purchases as any).getProducts([pid], type);
      if (Array.isArray(rows) && rows.length > 0) return rows[0];
    } catch {
      // Try next category.
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
    const product = await findStoreProductById(pid);
    if (!product) {
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

    const out: any = await (Purchases as any).purchaseStoreProduct(product);
    const boughtProductId = String(out?.productIdentifier || pid).trim() || pid;
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
  const entitlementId = APP_CONFIG.PURCHASES.entitlementId;
  try {
    const customerInfo = await Purchases.getCustomerInfo();
    const active = Boolean(customerInfo?.entitlements?.active?.[entitlementId]);
    const entitlement = customerInfo?.entitlements?.active?.[entitlementId] as any;
    const productId = String(
      entitlement?.productIdentifier ??
        entitlement?.productId ??
        customerInfo?.activeSubscriptions?.[0] ??
        ""
    ).trim();

    useAppStore.getState().setSub({
      isPremium: active,
      entitlementId: entitlementId,
      lastCheckedAt: Date.now(),
      storeProductId: productId || null,
      planId: inferPlanId(productId),
    });
  } catch {}
}

export async function purchasePremium() {
  const { t } = useTranslation();
  const entitlementId = APP_CONFIG.PURCHASES.entitlementId;
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
    const active = Boolean(customerInfo?.entitlements?.active?.[entitlementId]);
    const entitlement = customerInfo?.entitlements?.active?.[entitlementId] as any;
    const productId = String(
      entitlement?.productIdentifier ??
        entitlement?.productId ??
        customerInfo?.activeSubscriptions?.[0] ??
        ""
    ).trim();

    useAppStore.getState().setSub({
      isPremium: active,
      entitlementId: entitlementId,
      lastCheckedAt: Date.now(),
      storeProductId: productId || null,
      planId: inferPlanId(productId),
    });
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
