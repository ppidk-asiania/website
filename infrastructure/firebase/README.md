# Firebase configuration

Templates only. Nothing here is deployed automatically.

| File                               | Purpose                                                                                                                                      |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `.firebaserc`                      | Project aliases. **Must match** `PRODUCTION_FIREBASE_PROJECT_IDS` / `STAGING_FIREBASE_PROJECT_IDS` in `packages/config/src/environments.ts`. |
| `firebase.json`                    | Rules/indexes paths and local emulator ports.                                                                                                |
| `firestore.rules`, `storage.rules` | Deny-all for clients. All access is server-side via the Admin SDK.                                                                           |

Local emulators (optional, requires the Firebase CLI and Java):

```bash
cd infrastructure/firebase
firebase emulators:start --project demo-ppidk-website
```

`demo-*` project IDs never touch real cloud resources. Deploy rules explicitly and per alias:

```bash
firebase deploy --only firestore:rules,storage --project staging
```

See `docs/environment.md` for the staging/production boundary and `docs/disaster-recovery.md` for backups.
