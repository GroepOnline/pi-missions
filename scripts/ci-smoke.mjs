import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import extension from "../dist/index.js";

const requiredFiles = [
  "dist/index.js",
  "dist/index.d.ts",
  "dist/cli/index.js",
  "dist/database/schema.sql",
];

for (const rel of requiredFiles) {
  if (!fs.existsSync(rel)) {
    console.error(`Missing required build artifact: ${rel}`);
    process.exit(1);
  }
}

if (typeof extension !== "function") {
  console.error("Extension default export is not a function");
  process.exit(1);
}

const dbPath = path.join(
  os.tmpdir(),
  `pi-missions-ci-${process.platform}-${process.pid}.db`,
);

let exitCode = 0;

try {
  const doctor = spawnSync(process.execPath, ["dist/cli/index.js", "doctor"], {
    env: {
      ...process.env,
      PI_MISSIONS_DB_PATH: dbPath,
    },
    stdio: "inherit",
  });

  if (doctor.status !== 0) {
    exitCode = doctor.status ?? 1;
    console.error(`doctor command failed with exit code ${exitCode}`);
  } else {
    const fallbackDoctor = spawnSync(
      process.execPath,
      ["--require", path.resolve("scripts/force-node-sqlite.cjs"), "dist/cli/index.js", "doctor"],
      {
        env: {
          ...process.env,
          PI_MISSIONS_DB_PATH: fallbackDbPath,
        },
        stdio: "inherit",
      },
    );

    if (fallbackDoctor.status !== 0) {
      exitCode = fallbackDoctor.status ?? 1;
      console.error(`node:sqlite fallback doctor failed with exit code ${exitCode}`);
    }
  }
} finally {
  try {
    fs.rmSync(dbPath, { force: true });
    fs.rmSync(fallbackDbPath, { force: true });
  } catch {
    // no-op cleanup
  }
}

if (exitCode !== 0) {
  process.exit(exitCode);
}

console.log("CI smoke test passed (including forced node:sqlite fallback)");
