import { existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const script = resolve(root, process.argv[2] ?? "scripts/build_site36_dataset.py");
const candidates = [];

if (process.env.PYTHON) candidates.push([process.env.PYTHON, []]);
if (process.platform === "win32" && process.env.LOCALAPPDATA) {
  const pythonRoot = join(process.env.LOCALAPPDATA, "Programs", "Python");
  if (existsSync(pythonRoot)) {
    const versions = readdirSync(pythonRoot)
      .filter((name) => /^Python\d+$/i.test(name))
      .sort()
      .reverse();
    for (const version of versions) {
      candidates.push([join(pythonRoot, version, "python.exe"), []]);
    }
  }
}
candidates.push(["python3", []], ["python", []], ["py", ["-3"]]);

for (const [executable, args] of candidates) {
  if (executable.includes("\\") && !existsSync(executable)) continue;
  const result = spawnSync(executable, [...args, script], { stdio: "inherit" });
  if (result.status === 0) process.exit(0);
}

console.error(`Unable to run ${script} with an available Python interpreter.`);
process.exit(1);
