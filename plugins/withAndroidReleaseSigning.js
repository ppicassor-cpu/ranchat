const { withAppBuildGradle } = require("@expo/config-plugins");

function ensureReleaseSigningConfig(gradle) {
  const hasSigningConfigs = /signingConfigs\s*\{/.test(gradle);
  if (!hasSigningConfigs) return gradle;

  const signingConfigsToBuildTypes = /signingConfigs\s*\{([\s\S]*?)\n\s*\}\s*\n\s*buildTypes\s*\{/m;
  const m = gradle.match(signingConfigsToBuildTypes);
  if (!m) return gradle;

  const inner = m[1];
  const hasRelease = /\n\s*release\s*\{/.test(inner);

  let newInner = inner;
  if (!hasRelease) {
    const releaseBlock =
      "\n        release {\n" +
      "            def storeFilePath = (findProperty('RN_STORE_FILE') ?: '../../release.keystore')\n" +
      "            storeFile file(storeFilePath)\n" +
      "            storePassword (findProperty('RN_STORE_PASSWORD') ?: '123456')\n" +
      "            keyAlias (findProperty('RN_KEY_ALIAS') ?: 'my-key-alias')\n" +
      "            keyPassword (findProperty('RN_KEY_PASSWORD') ?: '123456')\n" +
      "        }\n";
    newInner = inner.replace(/\n\s*$/m, "") + releaseBlock;
  }

  gradle = gradle.replace(signingConfigsToBuildTypes, (full) => {
    return full.replace(m[1], newInner);
  });

  const buildTypesBlock = /buildTypes\s*\{([\s\S]*?)\n\s*\}\s*(?=\n\s*\w|\n\}|\s*$)/m;
  const bt = gradle.match(buildTypesBlock);
  if (!bt) return gradle;

  const btInner = bt[1];
  const releaseBlockRegex = /release\s*\{\s*\n([\s\S]*?)\n\s*\}/m;
  const rb = btInner.match(releaseBlockRegex);
  if (!rb) return gradle;

  let rbBody = rb[1].replace(/^\s*signingConfig\s+signingConfigs\.debug\s*\n/gm, "");
  const hasReleaseSigning = /^\s*signingConfig\s+signingConfigs\.release\s*$/m.test(rbBody);

  if (!hasReleaseSigning) {
    rbBody = "            signingConfig signingConfigs.release\n" + rbBody;
  }

  const fixedRelease =
    "release {\n" +
    rbBody +
    "\n        }";

  const newBtInner = btInner.replace(releaseBlockRegex, fixedRelease);

  gradle = gradle.replace(buildTypesBlock, (full) => {
    return full.replace(btInner, newBtInner);
  });

  return gradle;
}

module.exports = function withAndroidReleaseSigning(config) {
  return withAppBuildGradle(config, (config) => {
    const src = config.modResults.contents;
    config.modResults.contents = ensureReleaseSigningConfig(src);
    return config;
  });
};
