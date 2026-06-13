# Firebase Realtime Database security

The app now uses anonymous Firebase auth only as a transport identity for database access. The user-facing login remains PIN-based, and there is no longer any per-device UID allowlist to seed in Realtime Database.

## What changed

- The browser still signs in to Firebase silently so the database rules can distinguish authenticated clients.
- The app no longer reads, writes, or logs the Firebase anonymous identity in its normal user flow.
- Database access is now governed by authenticated access to the app paths instead of a UID allowlist.

## Operational note

If Firebase reads or writes fail, the app will continue showing the last cached data from the browser so the UI still remains usable. That can make the UI and Firebase diverge until the auth or network problem is fixed.
