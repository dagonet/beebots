// Swap one bee without Setup. Engine stopped, inside the engine container:
//   node dist/tools/swap-bee.js --slot bee2 --name "Wanna Bee" --style wanna --tagline "the contrarian" --rules "..." [--coins BTC,ETH] [--look "..."] [--force]
// Paints a portrait with the stored OpenAI key when --look is given.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { BEES, type BeeId } from "../config.js";
import { paintBee } from "../openai.js";
import { loadSettings, saveSettings, STYLES, type StyleId } from "../settings.js";
import { imageDir } from "../setup.js";
import { swapSlot } from "../swap.js";

const { values: a } = parseArgs({
  options: {
    slot: { type: "string" },
    name: { type: "string" },
    style: { type: "string" },
    tagline: { type: "string", default: "" },
    rules: { type: "string", default: "" },
    coins: { type: "string", default: "" },
    look: { type: "string" },
    force: { type: "boolean", default: false },
  },
});
const settingsPath = process.env.SETTINGS_PATH ?? "/data/settings.json";
const dbPath = (process.env.DB_PATH ?? "/data/bees-{mode}.sqlite").replaceAll("{mode}", process.env.MODE ?? "dry");
if (!BEES.includes(a.slot as BeeId)) throw new Error(`--slot must be one of ${BEES.join(", ")}`);
if (!STYLES.includes(a.style as StyleId)) throw new Error(`--style must be one of ${STYLES.join(", ")}`);
const slot = a.slot as BeeId;
const coins = a.coins ? a.coins.split(",").map((c) => c.trim().toUpperCase()).filter(Boolean) : [];

const { backupDir } = swapSlot({
  settingsPath,
  dbPath,
  slot,
  bee: { name: a.name ?? "", style: a.style as StyleId, tagline: a.tagline!, rules: a.rules!, coins, image: false, ...(a.look ? { look: a.look } : {}) },
  now: Date.now(),
  force: a.force,
});
console.log(`backed up to ${backupDir}; ${slot} is now ${a.name}`);

const s = loadSettings(settingsPath)!;
if (a.look && s.openaiKey) {
  const jpg = await paintBee(s.openaiKey, process.env.OPENAI_IMAGE_MODEL ?? "gpt-image-2", process.env.REF_DIR ?? "./ref", a.name!, a.look);
  const dir = imageDir(settingsPath);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${slot}.jpg`), jpg);
  const i = BEES.indexOf(slot);
  saveSettings(settingsPath, { ...s, bees: s.bees.map((b, j) => (j === i ? { ...b, image: true } : b)) });
  console.log("portrait painted");
} else console.log("no portrait (needs --look and a stored OpenAI key): the dashboard shows the placeholder");
