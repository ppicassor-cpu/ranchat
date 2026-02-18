// FILE: C:\ranchat\src\services\purchases\PurchaseManager.ts
import Purchases from "react-native-purchases";
import { APP_CONFIG } from "../../config/app";
import { useAppStore } from "../../store/useAppStore";
import { useTranslation } from "../../i18n/LanguageProvider";

let inited = false;

export async function initPurchases() {
  const key = APP_CONFIG.PURCHASES.revenueCatKey;
  if (!key) return;

  if (inited) return;
  inited = true;

  try {
    Purchases.setLogLevel(Purchases.LOG_LEVEL.ERROR);
    await Purchases.configure({ apiKey: key });
    await refreshSubscription();
  } catch {}
}

export async function purchasePremiumByProductId(productId: string) {
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

export async function refreshSubscription() {
  const entitlementId = APP_CONFIG.PURCHASES.entitlementId;
  try {
    const customerInfo = await Purchases.getCustomerInfo();
    const active = Boolean(customerInfo?.entitlements?.active?.[entitlementId]);
    useAppStore.getState().setSub({
      isPremium: active,
      entitlementId: entitlementId,
      lastCheckedAt: Date.now(),
    });
  } catch {}
}

export async function purchasePremium() {
  const { t } = useTranslation();
  const entitlementId = APP_CONFIG.PURCHASES.entitlementId;
  try {
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
    useAppStore.getState().setSub({
      isPremium: active,
      entitlementId: entitlementId,
      lastCheckedAt: Date.now(),
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