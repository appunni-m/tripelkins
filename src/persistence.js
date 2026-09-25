import { migrateWorld } from "./game/state.js";
import { colonyHealth } from "./game/health.js";
import { interruptCommands } from "./game/memory.js";
import { appendTimeline, readMoment, historySize } from "./game/timeline.js";
import { VOICE_CACHES } from "./voice/model.js";
const DB_NAME = "tripelkins-local-index";
let connection,
  pending,
  writer,
  expectedVersion = 0,
  recoveredLoad = false;
export const saveHealth = {
  status: "Opening local save…",
  lastSaved: null,
  error: null,
  bytes: 0,
  historyBytes: 0,
  conflict: false,
};
function openDatabase() {
  if (connection) return connection;
  connection = new Promise((resolve, reject) => {
    // Version 11 fences older tabs that discard concurrent local work crews.
    // Existing stores and records remain intact during the upgrade.
    const request = indexedDB.open(DB_NAME, 11);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("worlds"))
        db.createObjectStore("worlds");
      if (!db.objectStoreNames.contains("journal"))
        db.createObjectStore("journal", { keyPath: "id" });
    };
    request.onsuccess = () => {
      request.result.onversionchange = () => {
        request.result.close();
        connection = null;
      };
      resolve(request.result);
    };
    request.onerror = () => {
      connection = null;
      reject(request.error);
    };
    request.onblocked = () => {
      saveHealth.status = "Close another game tab to finish updating storage.";
    };
  });
  return connection;
}
async function read(key) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const req = db
      .transaction("worlds", "readonly")
      .objectStore("worlds")
      .get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function archive(key, value) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("worlds", "readwrite");
    tx.objectStore("worlds").put(value, key);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}
async function readSession() {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("worlds", "readonly"),
      store = tx.objectStore("worlds");
    const active = store.get("active-world"),
      history = store.get("timeline-v1");
    tx.oncomplete = () =>
      resolve({ raw: active.result, history: history.result });
    tx.onabort = tx.onerror = () =>
      reject(tx.error || new Error("Could not read saved history."));
  });
}
export async function loadWorld() {
  try {
    const { raw, history } = await readSession();
    expectedVersion = history?.version || 0;
    saveHealth.historyBytes = historySize(history);
    if (raw?.schema === 1 && !(await read("legacy-v1")))
      await archive("legacy-v1", raw);
    saveHealth.status = raw
      ? "Saved on this device"
      : "A new world, ready to save";
    saveHealth.lastSaved = raw?.savedAt || null;
    const world = raw ? migrateWorld(raw) : null;
    if (world && (raw.schema === 1 || colonyHealth(world).atRisk))
      world.ui.paused = true;
    return world ? interruptCommands(world) : null;
  } catch (error) {
    try {
      const previous = await read("previous-world");
      if (previous) {
        saveHealth.status = "Recovered previous snapshot";
        const recovered = migrateWorld(previous);
        recovered.ui.paused = true;
        recoveredLoad = true;
        return interruptCommands(recovered);
      }
    } catch {}
    saveHealth.error = error.message;
    throw error;
  }
}
async function writeSnapshot(record, replacement) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(["worlds", "journal"], "readwrite");
    const worlds = tx.objectStore("worlds");
    const old = worlds.get("active-world");
    const historyRequest = worlds.get("timeline-v1");
    let failure, nextHistory;
    historyRequest.onsuccess = () => {
      const prior = old.result;
      if ((historyRequest.result?.version || 0) !== expectedVersion) {
        failure = new Error(
          "Another game tab saved a newer world. Reload this tab before continuing.",
        );
        saveHealth.conflict = true;
        tx.abort();
        return;
      }
      try {
        nextHistory = appendTimeline(
          historyRequest.result,
          replacement?.current || prior,
          record,
          replacement || recoveredLoad,
        );
        worlds.put(nextHistory, "timeline-v1");
      } catch (error) {
        failure = error;
        tx.abort();
        return;
      }
      const progressed =
        prior &&
        (prior.time !== record.time ||
          prior.nextEvent !== record.nextEvent ||
          prior.population !== record.population);
      if (progressed) worlds.put(prior, "previous-world");
      if (replacement) {
        worlds.put(replacement.current, "archived-world");
        worlds.put(replacement.source, "restored-source");
      }
      worlds.put(record, "active-world");
      const history = worlds.get("checkpoints");
      history.onsuccess = () => {
        const entries = history.result || [];
        // A bounded minute-by-minute history, independent of the five-second autosave.
        if (
          prior &&
          (progressed || replacement) &&
          (!entries.length ||
            replacement ||
            Date.parse(record.savedAt) - Date.parse(entries[0].savedAt) >=
              60000)
        )
          worlds.put([prior, ...entries].slice(0, 8), "checkpoints");
      };
      if (
        record.creatures.length &&
        Object.values(colonyHealth(record).lowest).every((need) => need >= 35)
      )
        worlds.put(record, "healthy-world");
    };
    const journal = tx.objectStore("journal");
    if (replacement) journal.clear();
    for (const event of record.memory.recent) journal.put(event);
    const count = journal.count();
    count.onsuccess = () => {
      let excess = count.result - 512;
      if (excess > 0) {
        const cursor = journal.openCursor();
        cursor.onsuccess = () => {
          const item = cursor.result;
          if (item && excess-- > 0) {
            item.delete();
            item.continue();
          }
        };
      }
    };
    tx.oncomplete = () => {
      expectedVersion = nextHistory.version;
      recoveredLoad = false;
      saveHealth.historyBytes = historySize(nextHistory);
      resolve(record.savedAt);
    };
    tx.onerror = () => reject(failure || tx.error);
    tx.onabort = () =>
      reject(failure || tx.error || new Error("Save interrupted"));
  });
}
export async function saveWorld(world) {
  if (saveHealth.conflict)
    throw new Error(
      "A newer world is open in another tab. Reload before saving.",
    );
  // Explicit schema normalization excludes API keys and arbitrary AI payloads.
  pending = migrateWorld(world);
  pending.savedAt = new Date().toISOString();
  if (writer) return writer;
  writer = (async () => {
    while (pending) {
      const record = pending;
      pending = null;
      try {
        saveHealth.status = "Saving…";
        saveHealth.bytes = new TextEncoder().encode(
          JSON.stringify(record),
        ).length;
        let at;
        try {
          at = await writeSnapshot(record);
        } catch (error) {
          if (error.name !== "QuotaExceededError") throw error;
          saveHealth.status = "Making room for your save…";
          for (const name of [
            "tripelkins-laya-q8-v1",
            "tripelkins-laya-fp16-v1",
            ...VOICE_CACHES,
          ])
            await caches.delete(name);
          at = await writeSnapshot(record);
        }
        saveHealth.lastSaved = at;
        saveHealth.error = null;
        saveHealth.status = "Saved on this device";
      } catch (error) {
        saveHealth.error = error.message;
        saveHealth.status = saveHealth.conflict
          ? "Newer world in another tab — reload to continue"
          : error.name === "QuotaExceededError"
            ? "Storage full — export your world"
            : "Save unavailable — export your world";
        throw error;
      }
    }
  })();
  try {
    await writer;
  } finally {
    writer = null;
  }
  return saveHealth.lastSaved;
}
// Caller freezes gameplay and autosaves until this transaction commits.
export async function replaceWorld(
  current,
  next,
  source = next,
  origin = null,
) {
  if (writer) await writer;
  const record = interruptCommands(migrateWorld(next));
  record.ui.paused = true;
  record.ui.welcome = true;
  record.savedAt = new Date().toISOString();
  const prior = migrateWorld(current);
  prior.savedAt = saveHealth.lastSaved || record.savedAt;
  await writeSnapshot(record, {
    current: prior,
    source: migrateWorld(source),
    origin,
  });
  saveHealth.lastSaved = record.savedAt;
  saveHealth.status = "Saved on this device";
  saveHealth.error = null;
  return record;
}
export async function listRecoveryWorlds() {
  const fixed = [
    ["before-catastrophe", "Before the final transformation"],
    ["healthy-world", "Last healthy colony"],
    ["archived-world", "Before the last world change"],
    ["restored-source", "Last opened world, before changes"],
    ["previous-world", "Previous autosave"],
    ["legacy-v1", "Original prototype"],
  ];
  const values = await Promise.all(
    fixed.map(async ([key, label]) => ({ key, label, raw: await read(key) })),
  );
  const history = (await read("checkpoints")) || [];
  history.forEach((raw, i) =>
    values.push({ key: `checkpoint:${i}`, label: "Earlier checkpoint", raw }),
  );
  return values
    .filter(({ raw }) => raw)
    .map(({ key, label, raw }) => {
      try {
        const world = migrateWorld(raw);
        const health = colonyHealth(world);
        const facilities = world.objects
          .filter((o) =>
            ["orchard", "bath", "roundabout", "dwelling", "theatre"].includes(
              o.type,
            ),
          )
          .map((o) => o.type);
        return {
          key,
          label,
          world,
          savedAt: raw.savedAt,
          health,
          facilities,
          legacy: raw.schema === 1,
        };
      } catch (error) {
        return { key, label, error: error.message };
      }
    });
}
export async function listHistoryMoments() {
  const history = await read("timeline-v1");
  if (!history) return [];
  return history.branches
    .slice()
    .reverse()
    .map((branch, index) => ({
      id: branch.id,
      label: index ? "Earlier path" : "Your current story",
      compacted: branch.compacted,
      moments: [
        {
          id: branch.base.id,
          at: branch.base.at,
          tick: branch.base.world.time,
          population: branch.base.world.population,
        },
        ...branch.frames.map(({ id, at, tick, population }) => ({
          id,
          at,
          tick,
          population,
        })),
      ].reverse(),
    }));
}
export async function recoverMoment(branchId, momentId) {
  const history = await read("timeline-v1");
  const branch = history?.branches.find((item) => item.id === branchId);
  if (!branch)
    throw new Error(
      "This earlier path is no longer retained. Choose a saved world instead.",
    );
  return migrateWorld(readMoment(branch, momentId));
}
export async function estimateStorage() {
  const { usage = 0, quota = 0 } =
    (await navigator.storage?.estimate?.()) || {};
  return `${(usage / 1048576).toFixed(1)} MB used${quota ? ` / ${(quota / 1073741824).toFixed(1)} GB available to this origin` : ""}`;
}
export async function persistStorage() {
  return (await navigator.storage?.persist?.()) || false;
}
export function downloadSave(world) {
  const url = URL.createObjectURL(
    new Blob(
      [
        JSON.stringify(
          {
            app: "Tripelkins",
            exportedAt: new Date().toISOString(),
            world: migrateWorld(world),
          },
          null,
          2,
        ),
      ],
      { type: "application/json" },
    ),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = `tripelkins-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export async function importSaveFile(file) {
  if (!file || file.size > 16 * 1024 * 1024)
    throw new Error("Choose a world JSON smaller than 16 MB.");
  const data = JSON.parse(await file.text());
  return migrateWorld(data.world || data);
}

export async function checkpointWorld(world) {
  await saveWorld(world);
  const copy = migrateWorld(world);
  copy.savedAt = new Date().toISOString();
  await archive("before-catastrophe", copy);
}
