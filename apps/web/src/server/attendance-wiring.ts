import "server-only";
import { lazyEnv } from "@website/config/env";
import {
  createSqlContactReader,
  createSqlMeetingStore,
  createSqlOrgUnitStore,
} from "@website/db/sql";
import { createAttend, createAttendCard } from "./attendance";
import { webDb } from "./db";

const zoneOf = async (uid: string) =>
  (await createSqlContactReader(webDb()).contacts([uid])).get(uid)?.timeZone ?? null;

export const attend = lazyEnv(() =>
  createAttend({ meetings: createSqlMeetingStore(webDb()), zoneOf, now: () => new Date() }),
);

export const attendCard = lazyEnv(() =>
  createAttendCard({
    meetings: createSqlMeetingStore(webDb()),
    unitName: async (id) => (await createSqlOrgUnitStore(webDb()).get(id))?.name ?? null,
    zoneOf,
    now: () => new Date(),
  }),
);
