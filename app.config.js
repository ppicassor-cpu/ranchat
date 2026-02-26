const base = require("./app.json");

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

const expo = JSON.parse(JSON.stringify(base.expo || {}));
const googleIosUrlScheme = deriveGoogleIosUrlScheme();
expo.plugins = withGooglePlugin(expo.plugins, googleIosUrlScheme);

module.exports = { expo };
