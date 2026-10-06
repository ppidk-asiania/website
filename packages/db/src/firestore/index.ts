/**
 * Firestore access is confined to this folder. No other package or app may import
 * `firebase-admin/firestore` (lint-enforced), so the backing store can change —
 * e.g. the shop moving to PostgreSQL — without touching domain or UI code.
 */
import {
  applicationDefault,
  cert,
  getApp,
  getApps,
  initializeApp,
  type App,
} from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { assertEnvironmentIsolation, type AppEnvironment } from "@platform/config";
import type { DatabaseRole } from "../roles";

if ("window" in globalThis) {
  throw new Error("@platform/db must never be bundled into browser code.");
}

export interface FirestoreConfig {
  readonly appEnv: AppEnvironment;
  readonly role: DatabaseRole;
  readonly projectId: string;
  /** Per-role service account (least privilege). Omit to use Workload Identity / ADC. */
  readonly clientEmail?: string | undefined;
  readonly privateKey?: string | undefined;
  readonly emulatorHost?: string | undefined;
}

export function getFirestoreForRole(config: FirestoreConfig): Firestore {
  assertEnvironmentIsolation({
    appEnv: config.appEnv,
    firebaseProjectId: config.projectId,
    emulatorHost: config.emulatorHost,
  });
  const name = `platform-db-${config.role}`;
  const app: App = getApps().some((a) => a.name === name)
    ? getApp(name)
    : initializeApp(
        {
          projectId: config.projectId,
          credential:
            config.clientEmail && config.privateKey
              ? cert({
                  projectId: config.projectId,
                  clientEmail: config.clientEmail,
                  privateKey: config.privateKey.replace(/\\n/g, "\n"),
                })
              : applicationDefault(),
        },
        name,
      );
  return getFirestore(app);
}

// Repository implementations (events, content, chapters, apiKeys, audit) are added
// in the next phase, after the data model is validated. They implement the ports
// declared in @platform/domain and are exposed per role via ../roles.ts.
