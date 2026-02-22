const { withDangerousMod } = require("@expo/config-plugins");
const fs = require("fs");
const path = require("path");

function insertMlKitDeps(gradleText) {
  if (gradleText.includes("com.google.mlkit:face-mesh-detection")) return gradleText;

  const eol = gradleText.includes("\r\n") ? "\r\n" : "\n";
  const insert =
    "    implementation 'com.google.mlkit:face-mesh-detection:16.0.0-beta3'" + eol +
    "    implementation 'com.google.mlkit:segmentation-selfie:16.0.0-beta6'" + eol;

  const re = /(dependencies\s*\{\s*)/m;
  if (!re.test(gradleText)) {
    throw new Error("dependencies { ... } block not found in react-native-webrtc/android/build.gradle");
  }

  return gradleText.replace(re, (m, p1) => p1 + insert);
}

function insertMinSdkVersion(gradleText) {
  const minSdkRegex = /minSdkVersion\s*=\s*(\d+)/;
  if (minSdkRegex.test(gradleText)) {
    // Already defined minSdkVersion, skip modification
    return gradleText;
  }

  const eol = gradleText.includes("\r\n") ? "\r\n" : "\n";
  const insertMinSdk =
    "ext {" + eol +
    "    minSdkVersion = 23" + eol +
    "}" + eol;

  const re = /(\s*\{\s*)/m;
  if (!re.test(gradleText)) {
    throw new Error("ext block not found in react-native-webrtc/android/build.gradle");
  }

  return gradleText.replace(re, (m, p1) => p1 + insertMinSdk);
}

module.exports = function withWebRTCMlKitDeps(config) {
  return withDangerousMod(config, [
    "android",
    async (cfg) => {
      const root = cfg.modRequest.projectRoot;
      const gradlePath = path.join(root, "node_modules", "react-native-webrtc", "android", "build.gradle");

      if (!fs.existsSync(gradlePath)) {
        throw new Error("NOT FOUND: " + gradlePath);
      }

      const before = fs.readFileSync(gradlePath, "utf8");
      const afterWithDeps = insertMlKitDeps(before);
      const finalAfter = insertMinSdkVersion(afterWithDeps);

      if (finalAfter !== before) {
        fs.writeFileSync(gradlePath, finalAfter, "utf8");
      }

      return cfg;
    },
  ]);
};