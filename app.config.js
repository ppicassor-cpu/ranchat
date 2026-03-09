const base = require("./app.base.json");

const SHOP_EXTRA_KEYS = [
  "EXPO_PUBLIC_REVENUECAT_ANDROID_KEY",
  "EXPO_PUBLIC_REVENUECAT_IOS_KEY",
  "EXPO_PUBLIC_REVENUECAT_PUBLIC_SDK_KEY",
  "EXPO_PUBLIC_REVENUECAT_ENTITLEMENT_ID",
  "EXPO_PUBLIC_SHOP_POPTALK_2000_PRODUCT_ID",
  "EXPO_PUBLIC_SHOP_POPTALK_5000_PRODUCT_ID",
  "EXPO_PUBLIC_SHOP_POPTALK_10000_PRODUCT_ID",
  "EXPO_PUBLIC_SHOP_POPTALK_20000_PRODUCT_ID",
  "EXPO_PUBLIC_SHOP_POPTALK_30000_PRODUCT_ID",
  "EXPO_PUBLIC_SHOP_POPTALK_50000_PRODUCT_ID",
  "EXPO_PUBLIC_SHOP_POPTALK_100000_PRODUCT_ID",
  "EXPO_PUBLIC_SHOP_POPTALK_UNLIMITED_1M_PRODUCT_ID",
  "EXPO_PUBLIC_SHOP_POPCORN_2000_PRODUCT_ID",
  "EXPO_PUBLIC_SHOP_POPCORN_5000_PRODUCT_ID",
  "EXPO_PUBLIC_SHOP_POPCORN_10000_PRODUCT_ID",
  "EXPO_PUBLIC_SHOP_POPCORN_20000_PRODUCT_ID",
  "EXPO_PUBLIC_SHOP_POPCORN_30000_PRODUCT_ID",
  "EXPO_PUBLIC_SHOP_POPCORN_50000_PRODUCT_ID",
  "EXPO_PUBLIC_SHOP_POPCORN_100000_PRODUCT_ID",
  "EXPO_PUBLIC_SHOP_POPCORN_UNLIMITED_1M_PRODUCT_ID",
  "EXPO_PUBLIC_SHOP_KERNEL_500_PRODUCT_ID",
  "EXPO_PUBLIC_SHOP_KERNEL_2000_PRODUCT_ID",
  "EXPO_PUBLIC_SHOP_KERNEL_5000_PRODUCT_ID",
  "EXPO_PUBLIC_SHOP_KERNEL_10000_PRODUCT_ID",
  "EXPO_PUBLIC_SHOP_KERNEL_25000_PRODUCT_ID",
  "EXPO_PUBLIC_SHOP_KERNEL_50000_PRODUCT_ID",
];

const SHOP_ALIAS_KEYS = [
  ["EXPO_PUBLIC_SHOP_POPTALK_2000_PRODUCT_ID", "EXPO_PUBLIC_SHOP_POPCORN_2000_PRODUCT_ID"],
  ["EXPO_PUBLIC_SHOP_POPTALK_5000_PRODUCT_ID", "EXPO_PUBLIC_SHOP_POPCORN_5000_PRODUCT_ID"],
  ["EXPO_PUBLIC_SHOP_POPTALK_10000_PRODUCT_ID", "EXPO_PUBLIC_SHOP_POPCORN_10000_PRODUCT_ID"],
  ["EXPO_PUBLIC_SHOP_POPTALK_20000_PRODUCT_ID", "EXPO_PUBLIC_SHOP_POPCORN_20000_PRODUCT_ID"],
  ["EXPO_PUBLIC_SHOP_POPTALK_30000_PRODUCT_ID", "EXPO_PUBLIC_SHOP_POPCORN_30000_PRODUCT_ID"],
  ["EXPO_PUBLIC_SHOP_POPTALK_50000_PRODUCT_ID", "EXPO_PUBLIC_SHOP_POPCORN_50000_PRODUCT_ID"],
  ["EXPO_PUBLIC_SHOP_POPTALK_100000_PRODUCT_ID", "EXPO_PUBLIC_SHOP_POPCORN_100000_PRODUCT_ID"],
  ["EXPO_PUBLIC_SHOP_POPTALK_UNLIMITED_1M_PRODUCT_ID", "EXPO_PUBLIC_SHOP_POPCORN_UNLIMITED_1M_PRODUCT_ID"],
];

function toText(v) {
  return String(v ?? "").trim();
}

function deriveGoogleIosUrlScheme() {
  const candidates = [
    process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID,
    process.env.GOOGLE_IOS_CLIENT_ID,
    process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID,
    process.env.GOOGLE_WEB_CLIENT_ID,
  ]
    .map(toText)
    .filter((v) => v.length > 0);

  for (const raw of candidates) {
    if (raw.startsWith("com.googleusercontent.apps.")) {
      return raw;
    }
    if (raw.endsWith(".apps.googleusercontent.com")) {
      const prefix = raw.slice(0, -".apps.googleusercontent.com".length);
      if (prefix) return `com.googleusercontent.apps.${prefix}`;
    }
  }

  return "com.googleusercontent.apps.not_configured";
}

function withGooglePlugin(plugins, iosUrlScheme) {
  const next = Array.isArray(plugins) ? [...plugins] : [];
  let found = false;

  for (let i = 0; i < next.length; i += 1) {
    const p = next[i];
    if (Array.isArray(p) && p[0] === "@react-native-google-signin/google-signin") {
      next[i] = [p[0], { ...(p[1] || {}), iosUrlScheme }];
      found = true;
      break;
    }
  }

  if (!found) {
    next.push(["@react-native-google-signin/google-signin", { iosUrlScheme }]);
  }

  return next;
}

function withShopExtra(expo) {
  const extra = { ...((expo && expo.extra && typeof expo.extra === "object" ? expo.extra : {}) || {}) };

  for (const key of SHOP_EXTRA_KEYS) {
    const value = toText(process.env[key] ?? extra[key]);
    if (value) extra[key] = value;
  }

  for (const [targetKey, sourceKey] of SHOP_ALIAS_KEYS) {
    const targetValue = toText(extra[targetKey]);
    const sourceValue = toText(extra[sourceKey]);
    if (!targetValue && sourceValue) extra[targetKey] = sourceValue;
    if (!sourceValue && targetValue) extra[sourceKey] = targetValue;
  }

  expo.extra = extra;
  return expo;
}

module.exports = ({ config }) => {
  // Start from Expo incoming config, then override with base.expo.
  // This keeps dynamic defaults but ensures app.base.json stays authoritative.
  const merged = {
    ...((config && typeof config === "object" ? config : {}) || {}),
    ...(base.expo || {}),
  };
  const expo = JSON.parse(JSON.stringify(merged));
  const googleIosUrlScheme = deriveGoogleIosUrlScheme();
  expo.plugins = withGooglePlugin(expo.plugins, googleIosUrlScheme);
  return withShopExtra(expo);
};
