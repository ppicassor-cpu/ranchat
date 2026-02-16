const { withAndroidManifest } = require("@expo/config-plugins");

const AD_ID_PERMISSION = "com.google.android.gms.permission.AD_ID";

function ensureAdIdPermission(androidManifest) {
  const manifest = androidManifest.manifest;

  if (!manifest["uses-permission"]) manifest["uses-permission"] = [];
  const list = manifest["uses-permission"];

  const exists = list.some((p) => p?.$?.["android:name"] === AD_ID_PERMISSION);
  if (!exists) {
    list.push({ $: { "android:name": AD_ID_PERMISSION } });
  }

  return androidManifest;
}

module.exports = function withAdIdPermission(config) {
  return withAndroidManifest(config, (config) => {
    config.modResults = ensureAdIdPermission(config.modResults);
    return config;
  });
};
