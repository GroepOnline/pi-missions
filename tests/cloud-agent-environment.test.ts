import { readFileSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

interface CloudAgentEnvironment {
  name: string;
  build: {
    dockerfile: string;
    context: string;
  };
  install: string;
}

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cursorDirectory = join(repositoryRoot, ".cursor");
const environmentPath = join(cursorDirectory, "environment.json");
const dockerfilePath = join(cursorDirectory, "Dockerfile");

function readEnvironment(): CloudAgentEnvironment {
  return JSON.parse(readFileSync(environmentPath, "utf8")) as CloudAgentEnvironment;
}

function parseVersion(version: string): [number, number, number] {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) throw new Error(`Expected a complete semantic version, received: ${version}`);
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function compareVersions(left: [number, number, number], right: [number, number, number]): number {
  for (let index = 0; index < left.length; index += 1) {
    const difference = left[index]! - right[index]!;
    if (difference !== 0) return difference;
  }
  return 0;
}

describe("Cursor Cloud Agent environment", () => {
  it("uses the repository Dockerfile and a deterministic dependency install", () => {
    const environment = readEnvironment();

    expect(environment).toEqual({
      name: "pi-missions",
      build: {
        dockerfile: "Dockerfile",
        context: "..",
      },
      install: "npm ci",
    });
  });

  it("keeps the Dockerfile inside .cursor and the build context at the repository root", () => {
    const { build } = readEnvironment();
    const configuredDockerfile = resolve(cursorDirectory, build.dockerfile);
    const configuredContext = resolve(cursorDirectory, build.context);
    const dockerfileRelativePath = relative(cursorDirectory, configuredDockerfile);

    expect(isAbsolute(build.dockerfile)).toBe(false);
    expect(dockerfileRelativePath).not.toBe("..");
    expect(dockerfileRelativePath.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`)).toBe(false);
    expect(statSync(configuredDockerfile).isFile()).toBe(true);
    expect(configuredDockerfile).toBe(dockerfilePath);
    expect(configuredContext).toBe(repositoryRoot);
  });

  it("pins a supported Node release on the bookworm image", () => {
    const dockerfile = readFileSync(dockerfilePath, "utf8");
    const from = /^FROM node:(\d+\.\d+\.\d+)-([^\s]+)$/m.exec(dockerfile);

    expect(from, "Dockerfile must pin a complete official Node image tag").not.toBeNull();
    const [, nodeVersion, distribution] = from!;
    expect(compareVersions(parseVersion(nodeVersion!), [22, 19, 0])).toBeGreaterThanOrEqual(0);
    expect(distribution).toBe("bookworm");
  });

  it("installs the checkout tools and removes apt metadata", () => {
    const dockerfile = readFileSync(dockerfilePath, "utf8");

    expect(dockerfile).toMatch(/apt-get install -y --no-install-recommends\s+\\\s+git\s+\\\s+sudo/);
    expect(dockerfile).toContain("rm -rf /var/lib/apt/lists/*");
  });

  it("provisions passwordless sudo for ubuntu without failing when the user already exists", () => {
    const dockerfile = readFileSync(dockerfilePath, "utf8");

    expect(dockerfile).toContain("id -u ubuntu >/dev/null 2>&1 || useradd -m -s /bin/bash ubuntu");
    expect(dockerfile).toContain("usermod -aG sudo ubuntu");
    expect(dockerfile).toContain("ubuntu ALL=(ALL) NOPASSWD:ALL");
    expect(dockerfile).toContain("chmod 0440 /etc/sudoers.d/ubuntu");
  });
});
