#!/usr/bin/env node
// Step 10.1: the four old core unit types were removed, not swapped. Run once, locally, against a
// database that still holds units (and the appointment role map) saved under the old ids.
import { parseArgs } from "node:util";

const RENAMES = {
  koordinator: "sekretaris_jenderal",
  wakil_koordinator: "wakil_sekretaris_jenderal",
  sekjen: "sekretaris_eksekutif",
  wasekjen: "wakil_sekretaris_eksekutif",
};

const { values } = parseArgs({ options: { apply: { type: "boolean", default: false } } });
if (!process.env.DATABASE_URL) {
  console.error("Missing environment variable: DATABASE_URL");
  process.exit(2);
}

const { getDatabase } = await import("../../packages/db/src/sql/store.ts");
const db = getDatabase({ url: process.env.DATABASE_URL });
const mapRef = db.collection("settings").doc("appointmentRoles");

const result = await db.runTransaction(async (tx) => {
  const units = (await tx.get(db.collection("orgUnits"))).docs.filter(
    (doc) => doc.get("type") in RENAMES,
  );
  const map = (await tx.get(mapRef)).get("map");
  const oldKeys = Object.keys(map?.core ?? {}).filter((key) => key in RENAMES);
  if (values.apply) {
    for (const doc of units) {
      tx.update(doc.ref, {
        type: RENAMES[doc.get("type")],
        version: (doc.get("version") ?? 0) + 1,
        updatedAt: new Date(),
      });
    }
    if (oldKeys.length > 0) {
      const core = Object.fromEntries(
        Object.entries(map.core).map(([key, roleId]) => [RENAMES[key] ?? key, roleId]),
      );
      tx.update(mapRef, { map: { ...map, core } });
    }
  }
  return { units: units.length, mapKeys: oldKeys.length };
});

const verb = values.apply ? "Renamed" : "Dry run: would rename";
console.log(`${verb} ${result.units} unit(s) and ${result.mapKeys} appointment role map key(s).`);
if (!values.apply && result.units + result.mapKeys > 0) console.log("Re-run with --apply.");
await db.close();
