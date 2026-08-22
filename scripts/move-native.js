import fs from "node:fs";
import path from "node:path";

const src = path.resolve("build");
const destDir = path.resolve("prebuild/native/build");

// `yarn build` runs this even when the native addon has not been compiled yet
// (electron-rebuild is a separate step), so a missing build/ is not an error.
if (!fs.existsSync(src)) {
  console.warn("move-native: no build/ directory — skipping. Run `electron-rebuild` to compile the addon.");
  process.exit(0);
}

fs.rmSync(destDir, { recursive: true, force: true });
fs.mkdirSync(path.dirname(destDir), { recursive: true });
fs.cpSync(src, destDir, { recursive: true });
fs.rmSync(src, { recursive: true, force: true });
console.log(`move-native: ${src} -> ${destDir}`);
