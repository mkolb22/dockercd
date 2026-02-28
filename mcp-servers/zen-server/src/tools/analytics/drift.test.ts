import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { scanDirectory, compareDirectories } from "./drift.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "drift-test-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function writeFile(dir: string, relPath: string, content: string): void {
  const full = path.join(dir, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}

describe("scanDirectory", () => {
  it("returns empty for non-existent directory", () => {
    expect(scanDirectory("/nonexistent")).toHaveLength(0);
  });

  it("scans files with SHA256 hashes", () => {
    writeFile(tmpDir, "commands/foo.yaml", "hello");
    const entries = scanDirectory(tmpDir);
    expect(entries).toHaveLength(1);
    expect(entries[0].relativePath).toBe("commands/foo.yaml");
    expect(entries[0].hash).toHaveLength(64);
    expect(entries[0].category).toBe("commands");
  });

  it("strips .template suffix", () => {
    writeFile(tmpDir, "agents/test.yaml.template", "content");
    const entries = scanDirectory(tmpDir);
    expect(entries[0].relativePath).toBe("agents/test.yaml");
  });

  it("ignores node_modules and .DS_Store", () => {
    writeFile(tmpDir, "node_modules/foo.js", "x");
    writeFile(tmpDir, ".DS_Store", "x");
    writeFile(tmpDir, "real.yaml", "x");
    const entries = scanDirectory(tmpDir);
    expect(entries).toHaveLength(1);
    expect(entries[0].relativePath).toBe("real.yaml");
  });

  it("detects categories from path", () => {
    writeFile(tmpDir, "hooks/pre-commit.sh", "#!/bin/sh");
    writeFile(tmpDir, "schemas/config.json", "{}");
    writeFile(tmpDir, "random/file.txt", "data");
    const entries = scanDirectory(tmpDir);
    const cats = new Map(entries.map((e) => [e.relativePath, e.category]));
    expect(cats.get("hooks/pre-commit.sh")).toBe("hooks");
    expect(cats.get("schemas/config.json")).toBe("schemas");
    expect(cats.get("random/file.txt")).toBe("other");
  });
});

describe("compareDirectories", () => {
  it("detects identical directories as in sync", () => {
    const templateDir = path.join(tmpDir, "templates");
    const installedDir = path.join(tmpDir, "installed");
    writeFile(templateDir, "commands/a.yaml.template", "same");
    writeFile(installedDir, "commands/a.yaml", "same");

    const report = compareDirectories(templateDir, installedDir);
    expect(report.modified).toHaveLength(0);
    expect(report.missing).toHaveLength(0);
    expect(report.added).toHaveLength(0);
  });

  it("detects modified files", () => {
    const templateDir = path.join(tmpDir, "templates");
    const installedDir = path.join(tmpDir, "installed");
    writeFile(templateDir, "commands/a.yaml.template", "version 1");
    writeFile(installedDir, "commands/a.yaml", "version 2 (modified)");

    const report = compareDirectories(templateDir, installedDir);
    expect(report.modified).toHaveLength(1);
    expect(report.modified[0].category).toBe("commands");
  });

  it("detects missing files", () => {
    const templateDir = path.join(tmpDir, "templates");
    const installedDir = path.join(tmpDir, "installed");
    writeFile(templateDir, "agents/bot.yaml.template", "content");
    fs.mkdirSync(installedDir, { recursive: true });

    const report = compareDirectories(templateDir, installedDir);
    expect(report.missing).toHaveLength(1);
    expect(report.missing[0].relativePath).toBe("agents/bot.yaml");
  });

  it("detects added files", () => {
    const templateDir = path.join(tmpDir, "templates");
    const installedDir = path.join(tmpDir, "installed");
    fs.mkdirSync(templateDir, { recursive: true });
    writeFile(installedDir, "custom/my-hook.sh", "#!/bin/sh");

    const report = compareDirectories(templateDir, installedDir);
    expect(report.added).toHaveLength(1);
    expect(report.added[0].relativePath).toBe("custom/my-hook.sh");
  });

  it("handles non-existent directories gracefully", () => {
    const report = compareDirectories("/nonexistent1", "/nonexistent2");
    expect(report.modified).toHaveLength(0);
    expect(report.missing).toHaveLength(0);
    expect(report.added).toHaveLength(0);
  });
});
