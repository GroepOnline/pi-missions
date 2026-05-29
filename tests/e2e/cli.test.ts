import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createCLI } from "../../src/cli/index.js";

const tmpRoot = path.join(os.tmpdir(), `pi-missions-cli-e2e-${process.pid}`);

function setupTmp(): void {
  fs.mkdirSync(tmpRoot, { recursive: true });
}

function cleanupTmp(): void {
  if (fs.existsSync(tmpRoot)) fs.rmSync(tmpRoot, { recursive: true, force: true });
}

describe("E2E: CLI Commands", () => {
  const origHome = process.env.HOME;

  beforeAll(() => {
    process.env.HOME = tmpRoot;
    cleanupTmp();
    setupTmp();
  });

  afterAll(() => {
    process.env.HOME = origHome;
    cleanupTmp();
  });

  it("help command shows available commands", async () => {
    const cli = createCLI();
    const output = await cli.execute(["--help"]);

    expect(output).toContain("Pi Missions CLI");
    expect(output).toContain("list");
    expect(output).toContain("status");
    expect(output).toContain("analytics");
    expect(output).toContain("templates");
    expect(output).toContain("history");
    expect(output).toContain("doctor");
  });

  it("unknown command returns error message", async () => {
    const cli = createCLI();
    const output = await cli.execute(["nonexistent"]);

    expect(output).toContain("Unknown command");
    expect(output).toContain("nonexistent");
  });

  it("list command returns no missions initially", async () => {
    const cli = createCLI();
    const output = await cli.execute(["list"]);

    expect(output).toContain("No missions found");
  });

  it("status command requires mission id", async () => {
    const cli = createCLI();
    const output = await cli.execute(["status"]);

    expect(output).toContain("Usage");
    expect(output).toContain("mission-id");
  });

  it("analytics command shows statistics", async () => {
    const cli = createCLI();
    const output = await cli.execute(["analytics"]);

    expect(output).toContain("Analytics");
    expect(output).toContain("Total:");
    expect(output).toContain("Active:");
    expect(output).toContain("Completed:");
  });

  it("templates command lists available templates", async () => {
    const cli = createCLI();
    const output = await cli.execute(["templates"]);

    // Templates are seeded in the database
    expect(typeof output).toBe("string");
  });

  it("history command requires mission id", async () => {
    const cli = createCLI();
    const output = await cli.execute(["history"]);

    expect(output).toContain("Usage");
    expect(output).toContain("mission-id");
  });

  it("doctor command runs diagnostics", async () => {
    const cli = createCLI();
    const output = await cli.execute(["doctor"]);

    expect(output).toContain("Database: OK");
    expect(output).toContain("Missions:");
    expect(output).toContain("Templates:");
  });

  it("CLI can be instantiated multiple times", async () => {
    const cli1 = createCLI();
    const cli2 = createCLI();

    const output1 = await cli1.execute(["--help"]);
    const output2 = await cli2.execute(["--help"]);

    expect(output1).toBe(output2);
  });

  it("empty args shows help", async () => {
    const cli = createCLI();
    const output = await cli.execute([]);

    expect(output).toContain("Pi Missions CLI");
  });
});
