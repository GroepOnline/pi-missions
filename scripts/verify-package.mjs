#!/usr/bin/env node
// Catalog contract for pi.dev/packages. Fail closed on required rules before
// publish; the description lower bound is advisory (warn only).
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = process.argv[2] ?? join(root, "package.json");

function loadManifest() {
  try {
    return JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch (error) {
    const reason = error instanceof Error ? error.message : error;
    throw new Error(`Package metadata check failed: could not read ${manifestPath}: ${reason}`);
  }
}

const CANONICAL_REPOSITORY = "https://github.com/GroepOnline/pi-missions";
const CANONICAL_IMAGE =
  "https://raw.githubusercontent.com/GroepOnline/pi-missions/main/docs/images/missions_banner.png";
const REQUIRED_KEYWORDS = [
  "pi-package",
  "pi-extension",
  "pi-coding-agent",
  "missions",
];
const REQUIRED_FILES = ["dist", "README.md", "CHANGELOG.md", "LICENSE"];
const PEER_AGENT = "@earendil-works/pi-coding-agent";

function assert(condition, message) {
  if (!condition) {
    throw new Error(`Package metadata check failed: ${message}`);
  }
}

function verify() {
  const pkg = loadManifest();
  assert(pkg.name === "@groeponline/pi-missions", "unexpected package name");
  assert(pkg.license === "MIT", "license must remain explicit");
  assert(pkg.publishConfig?.access === "public", "scoped package must publish publicly");

  const description = pkg.description ?? "";
  if (description.length < 80) {
    console.warn(
      `Warning: description is ${description.length} chars; aim for >= 80 for catalog discovery`,
    );
  }
  assert(description.length <= 240, "description is too long for catalog cards");

  for (const keyword of REQUIRED_KEYWORDS) {
    assert(pkg.keywords?.includes(keyword), `missing discovery keyword ${keyword}`);
  }

  const repositoryUrl =
    typeof pkg.repository === "string" ? pkg.repository : pkg.repository?.url ?? "";
  const normalizedRepository = repositoryUrl
    .replace(/^git\+/, "")
    .replace(/\.git$/, "")
    .replace(/\/$/, "");
  assert(
    normalizedRepository === CANONICAL_REPOSITORY,
    "repository must point at GroepOnline/pi-missions",
  );

  assert(
    Array.isArray(pkg.pi?.extensions) && pkg.pi.extensions.includes("./dist/index.js"),
    "pi.extensions must declare the built ./dist/index.js",
  );

  for (const entry of REQUIRED_FILES) {
    assert(pkg.files?.includes(entry), `files must ship ${entry}`);
  }

  assert(
    pkg.publishConfig?.registry === "https://registry.npmjs.org",
    "publishConfig.registry must be npmjs.org, not GitHub Packages",
  );

  // A caret range on a 0.x peer pins exactly one pi minor and blocks install.
  const agentRange = pkg.peerDependencies?.[PEER_AGENT] ?? "";
  assert(agentRange !== "", `peerDependencies must declare ${PEER_AGENT}`);
  assert(
    !agentRange.startsWith("^0."),
    `${PEER_AGENT} range ${agentRange} pins one pi minor; use a ">=x <y" range`,
  );

  const image = pkg.pi?.image;
  assert(image === CANONICAL_IMAGE, "pi.image must use the canonical banner.png URL");

  return pkg;
}

let pkg;
try {
  pkg = verify();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}

console.log("Package catalog contract OK");
console.log(`  npm: https://www.npmjs.com/package/${pkg.name}`);
console.log(`  pi.dev: https://pi.dev/packages/${pkg.name}`);
console.log(`  search: https://pi.dev/packages?name=missions`);
console.log(`  groeponline: https://pi.dev/packages?name=groeponline`);
