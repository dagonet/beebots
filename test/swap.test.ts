import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Db } from "../src/db.js";
import { freshBee } from "../src/ledger.js";
import type { Settings } from "../src/settings.js";
import { swapSlot } from "../src/swap.js";
import { NOW } from "./fixtures.js";

const beeDef = (name: string, style: "bizzy" | "breezy" | "boozy" | "wanna") => ({ name, style, tagline: "t", rules: "", coins: [], image: true });

function setupDir(openBee2 = false) {
  const dir = mkdtempSync(join(tmpdir(), "bees-swap-"));
  const settingsPath = join(dir, "settings.json");
  const dbPath = join(dir, "bees-dry.sqlite");
  const s: Settings = { version: 1, jevKey: "jev-key-123", openaiKey: "sk-test-123", acceptedRiskAt: NOW, bees: [beeDef("Calm Canopy", "breezy"), beeDef("Honey Break", "bizzy"), beeDef("Hexchaser", "boozy")], hive: false, createdAt: NOW };
  writeFileSync(settingsPath, JSON.stringify(s));
  mkdirSync(join(dir, "bee-images"));
  writeFileSync(join(dir, "bee-images", "bee2.jpg"), "old");
  const db = new Db(dbPath);
  for (const id of ["bee1", "bee2", "bee3"] as const) {
    const b = freshBee(id, 333, NOW);
    if (id === "bee2" && openBee2) b.position = { instId: "BTC-X", coin: "BTC", side: "long", contracts: 1, entryPx: 1, openedAt: NOW, stopPx: null, riskUsd: 1 };
    db.saveBee(b, NOW);
    db.insertCap(id, NOW, "trade_cap", "x");
  }
  db.close();
  return { dir, settingsPath, dbPath };
}
const count = (dbPath: string, table: string, bee: string) => {
  const db = new Db(dbPath);
  const n = (db.raw.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE bee = ?`).get(bee) as { n: number }).n;
  db.close();
  return n;
};
const wannaBee = { name: "Wanna Bee", style: "wanna" as const, tagline: "the contrarian", rules: "Rotate freely.", coins: [], image: false };

describe("swapSlot", () => {
  it("replaces one slot's settings and keeps keys, password, Hive choice and the other bees", () => {
    const t = setupDir();
    swapSlot({ settingsPath: t.settingsPath, dbPath: t.dbPath, slot: "bee2", bee: wannaBee, now: NOW });
    const s = JSON.parse(readFileSync(t.settingsPath, "utf8")) as Settings;
    expect(s.bees.map((b) => b.name)).toEqual(["Calm Canopy", "Wanna Bee", "Hexchaser"]);
    expect(s.bees[1]).toMatchObject({ style: "wanna", rules: "Rotate freely.", image: false });
    expect(s).toMatchObject({ jevKey: "jev-key-123", openaiKey: "sk-test-123", hive: false });
  });

  it("clears only that slot's rows; the other slots keep theirs", () => {
    const t = setupDir();
    swapSlot({ settingsPath: t.settingsPath, dbPath: t.dbPath, slot: "bee2", bee: wannaBee, now: NOW });
    expect(count(t.dbPath, "bee_state", "bee2")).toBe(0);
    expect(count(t.dbPath, "caps", "bee2")).toBe(0);
    expect(count(t.dbPath, "bee_state", "bee1")).toBe(1);
    expect(count(t.dbPath, "caps", "bee3")).toBe(1);
  });

  it("backs up settings, DB and portraits first, and removes the old portrait", () => {
    const t = setupDir();
    const { backupDir } = swapSlot({ settingsPath: t.settingsPath, dbPath: t.dbPath, slot: "bee2", bee: wannaBee, now: NOW });
    expect(JSON.parse(readFileSync(join(backupDir, "settings.json"), "utf8")).bees[1].name).toBe("Honey Break");
    expect(existsSync(join(backupDir, "bees-dry.sqlite"))).toBe(true);
    expect(readFileSync(join(backupDir, "bee-images", "bee2.jpg"), "utf8")).toBe("old");
    expect(existsSync(join(t.dir, "bee-images", "bee2.jpg"))).toBe(false);
  });

  it("refuses a slot with an open position unless forced, and changes nothing when it refuses", () => {
    const t = setupDir(true);
    expect(() => swapSlot({ settingsPath: t.settingsPath, dbPath: t.dbPath, slot: "bee2", bee: wannaBee, now: NOW })).toThrow(/open position/);
    expect((JSON.parse(readFileSync(t.settingsPath, "utf8")) as Settings).bees[1]!.name).toBe("Honey Break");
    swapSlot({ settingsPath: t.settingsPath, dbPath: t.dbPath, slot: "bee2", bee: wannaBee, now: NOW, force: true });
    expect(count(t.dbPath, "bee_state", "bee2")).toBe(0);
  });

  it("rejects an invalid bee before touching anything", () => {
    const t = setupDir();
    expect(() => swapSlot({ settingsPath: t.settingsPath, dbPath: t.dbPath, slot: "bee2", bee: { ...wannaBee, name: "" }, now: NOW })).toThrow();
    expect(count(t.dbPath, "bee_state", "bee2")).toBe(1);
  });
});
