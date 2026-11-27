import "server-only";
import { lazyEnv } from "@website/config/env";
import { createSqlSubmissionReader } from "@website/db/sql";
import { webDb } from "./db";
import { registrations } from "./events";
import { myLoans } from "./inventory";
import { createSubmissions } from "./submissions";

/** `submissionsOf(uid)` for the account page: every module's reader behind one call. */
export const submissionsOf = lazyEnv(() =>
  createSubmissions({
    events: registrations(),
    loans: { mine: myLoans },
    rows: createSqlSubmissionReader(webDb()),
    now: () => new Date(),
  }),
);
