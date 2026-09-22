import { copyFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const distFile = path.join(rootDir, "dist", "index.html");
const releaseDir = path.join(rootDir, "release");
const releaseFile = path.join(releaseDir, "smarter-than-scats-standalone.html");

async function main() {
  await mkdir(releaseDir, { recursive: true });
  await copyFile(distFile, releaseFile);
  console.log(`Wrote ${path.relative(rootDir, releaseFile)}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
