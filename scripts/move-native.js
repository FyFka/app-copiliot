import fs from "node:fs";
import path from "node:path";

const src = path.resolve("build");
const destDir = path.resolve("prebuild/native/build");
fs.cpSync(src, destDir, { recursive: true });
fs.rmSync(src, { recursive: true, force: true });
