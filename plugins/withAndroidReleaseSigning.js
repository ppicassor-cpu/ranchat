const { withAppBuildGradle, withGradleProperties } = require("@expo/config-plugins");
const fs = require("fs");
const path = require("path");

function readPropertiesFile(filePath) {
  const out = {};
  const raw = fs.readFileSync(filePath, "utf8");
  const lines = raw.split(/\r?\n/);

  for (const line of lines) {
    const s = String(line || "").trim();
    if (!s || s.startsWith("#")) continue;

    const idx = s.indexOf("=");
    if (idx < 0) continue;

    const key = s.slice(0, idx).trim();
    const value = s.slice(idx + 1).trim();
    if (!key) continue;

    out[key] = value;
  }
  return out;
}

function upsertGradleProp(list, key, value) {
  const idx = list.findIndex((x) => x.type === "property" && x.key === key);
  if (idx >= 0) {
    list[idx].value = value;
    return;
  }
  list.push({ type: "property", key, value });
}

function findBlockRange(text, name, from = 0) {
  const re = new RegExp(`\\b${name}\\b\\s*\\{`, "m");
  re.lastIndex = from;
  const m = re.exec(text);
  if (!m) return null;

  const keywordStart = m.index;
  const braceStart = text.indexOf("{", keywordStart);
  if (braceStart < 0) return null;

  let depth = 0;
  for (let i = braceStart; i < text.length; i++) {
    const ch = text[i];
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return { keywordStart, braceStart, braceEnd: i };
    }
  }
  return null;
}

function ensureReleaseSigningConfig(gradle) {
  const android = findBlockRange(gradle, "android");
  if (!android) return gradle;

  let androidBody = gradle.slice(android.braceStart + 1, android.braceEnd);

  // 1) signingConfigs 블록 없으면 생성
  let signingConfigs = findBlockRange(androidBody, "signingConfigs");
  if (!signingConfigs) {
    const buildTypes = findBlockRange(androidBody, "buildTypes");
    const insertAt = buildTypes ? buildTypes.keywordStart : androidBody.length;

    const insert =
      "\n\n    signingConfigs {\n" +
      "    }\n";

    androidBody = androidBody.slice(0, insertAt) + insert + androidBody.slice(insertAt);
  }

  // 2) buildTypes 블록 없으면 생성
  let buildTypes = findBlockRange(androidBody, "buildTypes");
  if (!buildTypes) {
    const insert =
      "\n\n    buildTypes {\n" +
      "        release {\n" +
      "        }\n" +
      "        debug {\n" +
      "        }\n" +
      "    }\n";
    androidBody = androidBody.replace(/\s*$/, "") + insert;
  }

  // 3) signingConfigs 안에 release 없으면 추가 (기본값 제거: findProperty만 사용)
  signingConfigs = findBlockRange(androidBody, "signingConfigs");
  if (!signingConfigs) return gradle;

  let scBody = androidBody.slice(signingConfigs.braceStart + 1, signingConfigs.braceEnd);
  const hasReleaseConfig = /\brelease\s*\{/.test(scBody);

  if (!hasReleaseConfig) {
    const releaseBlock =
      "\n\n        release {\n" +
      "            def storeFilePath = findProperty('RN_STORE_FILE')\n" +
      "            storeFile file(storeFilePath)\n" +
      "            storePassword findProperty('RN_STORE_PASSWORD')\n" +
      "            keyAlias findProperty('RN_KEY_ALIAS')\n" +
      "            keyPassword findProperty('RN_KEY_PASSWORD')\n" +
      "        }\n";

    scBody = scBody.replace(/\s*$/, "") + releaseBlock + "\n";
    androidBody =
      androidBody.slice(0, signingConfigs.braceStart + 1) +
      scBody +
      androidBody.slice(signingConfigs.braceEnd);
  }

  // 4) buildTypes.release에 signingConfig signingConfigs.release 강제 + debug 제거
  buildTypes = findBlockRange(androidBody, "buildTypes");
  if (!buildTypes) return gradle;

  let btBody = androidBody.slice(buildTypes.braceStart + 1, buildTypes.braceEnd);

  let releaseBt = findBlockRange(btBody, "release");
  if (!releaseBt) {
    const addRelease =
      "\n\n        release {\n" +
      "            signingConfig signingConfigs.release\n" +
      "        }\n";
    btBody = btBody.replace(/\s*$/, "") + addRelease + "\n";
  } else {
    let releaseBody = btBody.slice(releaseBt.braceStart + 1, releaseBt.braceEnd);

    // signingConfig 라인 전부 제거 후 release로 1개만 삽입
    releaseBody = releaseBody.replace(/^\s*signingConfig\s+signingConfigs\.\w+\s*$/gm, "");
    releaseBody = releaseBody.replace(/\n{3,}/g, "\n\n");
    releaseBody = releaseBody.replace(/^\s*\n/, "\n");

    const hasReleaseSigning = /^\s*signingConfig\s+signingConfigs\.release\s*$/m.test(releaseBody);
    if (!hasReleaseSigning) {
      releaseBody = "\n            signingConfig signingConfigs.release\n" + releaseBody;
    }

    btBody =
      btBody.slice(0, releaseBt.braceStart + 1) +
      releaseBody +
      btBody.slice(releaseBt.braceEnd);
  }

  androidBody =
    androidBody.slice(0, buildTypes.braceStart + 1) +
    btBody +
    androidBody.slice(buildTypes.braceEnd);

  // android 블록 재조립
  return gradle.slice(0, android.braceStart + 1) + androidBody + gradle.slice(android.braceEnd);
}

module.exports = function withAndroidReleaseSigning(config) {
  // ✅ 목표 1) 루트 keystore.properties -> android/gradle.properties에 매번 주입 (prebuild에도 유지)
  config = withGradleProperties(config, (config) => {
    const projectRoot = config.modRequest.projectRoot;
    const srcPath = path.join(projectRoot, "keystore.properties");

    if (!fs.existsSync(srcPath)) {
      throw new Error(`Missing ${srcPath} (RN_STORE_* values source).`);
    }

    const props = readPropertiesFile(srcPath);
    const required = ["RN_STORE_FILE", "RN_STORE_PASSWORD", "RN_KEY_ALIAS", "RN_KEY_PASSWORD"];

    for (const k of required) {
      const v = String(props[k] ?? "").trim();
      if (!v) throw new Error(`Missing "${k}" in ${srcPath}`);
    }

    const list = config.modResults;

    upsertGradleProp(list, "RN_STORE_FILE", props.RN_STORE_FILE);
    upsertGradleProp(list, "RN_STORE_PASSWORD", props.RN_STORE_PASSWORD);
    upsertGradleProp(list, "RN_KEY_ALIAS", props.RN_KEY_ALIAS);
    upsertGradleProp(list, "RN_KEY_PASSWORD", props.RN_KEY_PASSWORD);

    config.modResults = list;
    return config;
  });

  // ✅ 목표 2) app/build.gradle의 release 빌드 타입에 release signingConfig 강제 (debug 서명 방지)
  return withAppBuildGradle(config, (config) => {
    const src = config.modResults.contents;
    config.modResults.contents = ensureReleaseSigningConfig(src);
    return config;
  });
};
