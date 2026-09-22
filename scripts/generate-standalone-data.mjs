import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const publicDataDir = path.join(rootDir, "public", "data");
const manifestPath = path.join(publicDataDir, "manifest.json");
const outputPath = path.join(
  rootDir,
  "src",
  "data",
  "standaloneData.generated.ts",
);

async function readManifest() {
  try {
    const text = await readFile(manifestPath, "utf8");
    const parsed = JSON.parse(text);
    if (!parsed || !Array.isArray(parsed.files)) {
      return { files: [] };
    }

    return {
      files: parsed.files.filter(
        (file) => typeof file === "string" && file.endsWith(".json"),
      ),
    };
  } catch {
    return { files: [] };
  }
}

async function loadDatasets(files) {
  const entries = [];

  for (const file of files) {
    const filePath = path.join(publicDataDir, file);

    try {
      const text = await readFile(filePath, "utf8");
      entries.push([file, JSON.parse(text)]);
    } catch (error) {
      console.warn(`Skipping dataset ${file}: ${error.message}`);
    }
  }

  return Object.fromEntries(entries);
}

async function main() {
  const manifest = await readManifest();
  const datasets = await loadDatasets(manifest.files);
  const generated = `import type { IntersectionData } from "./types";

export const embeddedPublicManifest = ${JSON.stringify(manifest, null, 2)};

export const embeddedPublicDatasets: Record<string, IntersectionData> = ${JSON.stringify(datasets, null, 2)};
`;

  await writeFile(outputPath, generated, "utf8");
  console.log(
    `Embedded ${Object.keys(datasets).length} dataset(s) into ${path.relative(rootDir, outputPath)}`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
