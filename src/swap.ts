// Swap one bee without running Setup again: back up, replace that slot in settings.json, clear the slot's rows in the
// trade DB (it restarts at the start equity on the next engine start). Run with the engine stopped.
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { BEES, type BeeId } from "./config.js";
import { BeeSchema, loadSettings, saveSettings, SettingsSchema, type BeeSettings } from "./settings.js";
import { imageDir } from "./setup.js";

/** Every table with a per-bee row. */
export const SLOT_TABLES = ["bee_state", "decisions", "orders", "fills", "funding", "equity_snapshots", "reconciliations", "caps"] as const;
/** A bee_state write newer than this means the engine is probably still running (it saves every tick). */
const LIVE_ENGINE_MS = 30_000;

export interface SwapOptions {
  settingsPath: string;
  dbPath: string;
  slot: BeeId;
  bee: BeeSettings;
  now: number;
  /** Swap even if the slot holds a position (it is dropped from the books, not closed on an exchange). */
  force?: boolean;
}

export function swapSlot(o: SwapOptions): { backupDir: string } {
  const bee = BeeSchema.parse(o.bee);
  const settings = loadSettings(o.settingsPath);
  if (!settings) throw new Error(`${o.settingsPath} not found: run Setup first`);
  const i = BEES.indexOf(o.slot);
  const next = SettingsSchema.parse({ ...settings, bees: settings.bees.map((b, j) => (j === i ? bee : b)) });

  const db = new DatabaseSync(o.dbPath);
  try {
    const row = db.prepare(`SELECT json FROM bee_state WHERE bee = ?`).get(o.slot) as { json: string } | undefined;
    const open = row ? (JSON.parse(row.json) as { position: unknown }).position : null;
    if (open && !o.force) throw new Error(`${o.slot} has an open position; close it first or pass --force`);
    // A running engine saves every bee each tick and would write the old bee's state straight back over the swap.
    const last = (db.prepare(`SELECT MAX(updated_ts) AS t FROM bee_state`).get() as { t: number | null }).t;
    if (last !== null && o.now - last < LIVE_ENGINE_MS && !o.force) {
      throw new Error(`the engine saved its state ${Math.round((o.now - last) / 1000)} s ago: stop the engine, wait ${LIVE_ENGINE_MS / 1000} s, then retry`);
    }

    const backupDir = join(dirname(o.settingsPath), `pre-swap-${o.slot}-${o.now}`);
    mkdirSync(backupDir, { recursive: true });
    cpSync(o.settingsPath, join(backupDir, basename(o.settingsPath)));
    db.exec(`VACUUM INTO '${join(backupDir, basename(o.dbPath)).replaceAll("'", "''")}'`);
    const images = imageDir(o.settingsPath);
    if (existsSync(images)) cpSync(images, join(backupDir, "bee-images"), { recursive: true });

    db.exec("BEGIN");
    for (const t of SLOT_TABLES) db.prepare(`DELETE FROM ${t} WHERE bee = ?`).run(o.slot);
    // The dashboard stream replays recent events; they carry the bee inside the JSON, not in a column.
    db.prepare(`DELETE FROM events WHERE json_extract(json, '$.bee') = ?`).run(o.slot);
    db.exec("COMMIT");
    rmSync(join(images, `${o.slot}.jpg`), { force: true });
    saveSettings(o.settingsPath, next);
    return { backupDir };
  } finally {
    db.close();
  }
}
