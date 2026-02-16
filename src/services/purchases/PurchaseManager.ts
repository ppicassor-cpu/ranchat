import Purchases from "react-native-purchases";
import { APP_CONFIG } from "../../config/app";
import { useAppStore } from "../../store/useAppStore";

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
  } catch {
    // UI는 글로벌 모달에서 처리
  }
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
  } catch {
    // 무응답
  }
}

export async function purchasePremium() {
  const entitlementId = APP_CONFIG.PURCHASES.entitlementId;
  try {
    const offerings = await Purchases.getOfferings();
    const current = offerings.current;
    if (!current || current.availablePackages.length === 0) {
      useAppStore.getState().showGlobalModal("구독", "현재 구매 가능한 상품을 불러오지 못했습니다.");
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
    if (e?.userCancelled) return;
    useAppStore.getState().showGlobalModal("구독", "결제를 완료하지 못했습니다. 잠시 후 다시 시도해 주세요.");
  }
}

export async function openManageSubscriptions() {
  try {
    // 일부 환경에서 미지원일 수 있어 예외 처리
    // @ts-ignore
    await Purchases.showManageSubscriptions();
  } catch {
    useAppStore.getState().showGlobalModal("구독관리", "기기에서 구독관리 화면을 열 수 없습니다.");
  }
}
