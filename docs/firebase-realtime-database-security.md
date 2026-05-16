# Firebase Realtime Database security

The database rules in `database.rules.json` deny root access and only allow known Firebase Auth UIDs under the app paths that the credit card tracker uses.

## 1. Collect the Firebase Auth UIDs

Each browser/device signs in with Firebase anonymous auth and gets a stable UID.

1. Deploy or run this app version.
2. Open the main app as Tony/Nugs.
3. Open `tools`, then use `copy debug`.
4. Copy the `firebaseUid=...` line.

Collect the UID for each person/device that should keep access. Also create one stable backend UID for the scheduled email job:

```powershell
$apiKey = "YOUR_FIREBASE_WEB_API_KEY"
$body = @{ returnSecureToken = $true } | ConvertTo-Json
Invoke-RestMethod `
  -Method Post `
  -Uri "https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=$apiKey" `
  -ContentType "application/json" `
  -Body $body
```

Save the returned `refreshToken` as `FIREBASE_AUTH_REFRESH_TOKEN` in Vercel. Treat it like a password. Add the returned `localId` to the access allowlist as an admin UID so cron/API routes can read transactions and write automation logs.

## 2. Seed the access allowlist

Before publishing the strict rules, add this shape in Realtime Database data:

```json
{
  "appAccess": {
    "users": {
      "TONY_FIREBASE_UID": {
        "admin": true,
        "profiles": {
          "Tony": true
        }
      },
      "NUGS_FIREBASE_UID": {
        "profiles": {
          "Nugs": true
        }
      },
      "BACKEND_CRON_FIREBASE_UID": {
        "admin": true
      }
    }
  }
}
```

Set `admin: true` on any UID that needs the upload/tools/admin screens. A UID can have both profiles if the same browser legitimately switches between Tony and Nugs.

## 3. Publish the rules

In Firebase Console, open Realtime Database > Rules, paste `database.rules.json`, and publish.

With Firebase CLI configured, you can also deploy from this repo:

```bash
firebase deploy --only database
```

After publishing, Firebase should stop warning that every logged-in user can read/write the entire database.
