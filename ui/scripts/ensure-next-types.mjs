import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const requiredFiles = [
  ".next/types/routes.d.ts",
  ".next/types/cache-life.d.ts",
  ".next/types/app/layout.ts",
  ".next/types/app/page.ts",
];

for (const relativePath of requiredFiles) {
  const fullPath = path.join(root, relativePath);
  mkdirSync(path.dirname(fullPath), { recursive: true });
  if (!existsSync(fullPath)) {
    writeFileSync(fullPath, "", "utf8");
  }
}
