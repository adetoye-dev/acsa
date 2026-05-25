import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const requiredFiles = [
  ".next/types/routes.d.ts",
  ".next/types/cache-life.d.ts",
  ".next/types/app/layout.ts",
  ".next/types/app/page.ts",
  ".next/types/app/(product)/layout.ts",
  ".next/types/app/(product)/connectors/page.ts",
  ".next/types/app/(product)/credentials/page.ts",
  ".next/types/app/(product)/executions/page.ts",
  ".next/types/app/(product)/workflows/page.ts",
  ".next/types/app/(studio)/layout.ts",
  ".next/types/app/(studio)/workflows/[workflowId]/page.ts",
  ".next/types/app/(studio)/workflows/new/page.ts",
  ".next/types/validator.ts",
];

for (const relativePath of requiredFiles) {
  const fullPath = path.join(root, relativePath);
  mkdirSync(path.dirname(fullPath), { recursive: true });
  if (!existsSync(fullPath)) {
    writeFileSync(fullPath, "", "utf8");
  }
}
