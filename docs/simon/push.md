# Push notifications

`simon push` sends to a **simulator** (local inject via `simctl`) or to a **real device** via `--token` (through FCM or APNs).

Flags:

- `-t, --template [--fcm]` — print a payload template (`--fcm` for the FCM shape, otherwise the `aps` shape).
- `<payload> --token <token> [--fcm|--apns]` — send to a real device via FCM/APNs (credentials from `~/.config/simon/push.json`).
- `<payload> -b <id>` — target app bundle id (if not baked into the payload).

## Simulator

Injected locally — doesn't touch APNs/Firebase, so it tests how your app *handles* a notification, not your delivery pipeline. Start from the template and send:

```sh
simon push -t > push.json          # aps-shaped payload
simon push push.json -b com.example.myapp
```

The `aps` payload — notification under `aps`, custom data at the top level (that's where it lands in `userInfo`):

```json
{
  "aps": { "alert": { "title": "Notification title", "body": "Notification body" }, "sound": "default", "badge": 1 },
  "custom_data_1": "value1",
  "custom_data_2": "value2"
}
```

The target app comes from `-b <bundle-id>` (or a `"Simulator Target Bundle"` key in the payload). The app must have been launched once on the booted simulator.

## Real device (FCM / APNs)

Sends through the real pipeline, addressed by the device's **push token** — so there's no device picker; the token is the destination (a token-capable simulator works too). Credentials come from `~/.config/simon/push.json`.

**One-time setup** — copy one of these into `~/.config/simon/push.json`:

```json
// FCM — the service-account file holds project id, email and key
{
  "transport": "fcm",
  "fcm": { "serviceAccount": "/absolute/path/to/service-account.json" }
}
```
```json
// APNs — direct to Apple
{
  "transport": "apns",
  "apns": {
    "keyFile": "/absolute/path/to/AuthKey_XXXXXX.p8",
    "keyId": "XXXXXXXXXX",
    "teamId": "YYYYYYYYYY",
    "bundleId": "com.example.myapp",
    "env": "sandbox"
  }
}
```
Both blocks may coexist; `transport` (or `--fcm` / `--apns`) picks when both are set. APNs `env` is `sandbox` for dev builds/simulators, `production` for TestFlight/App Store.

**Send:**
```sh
# FCM payload is shaped differently — get its template with --fcm:
simon push -t --fcm > fcm.json
simon push fcm.json  --token <device-fcm-token>      # FCM
simon push push.json --token <device-apns-token>     # APNs (aps-shaped payload)
```

The FCM payload is an FCM v1 message body (simon injects the token):

```json
{
  "notification": { "title": "Notification title", "body": "Notification body" },
  "data": { "custom_data_1": "value1", "custom_data_2": "value2" },
  "apns": { "payload": { "aps": { "sound": "default", "badge": 1 } } }
}
```

> simon never stores your credentials — it only reads the files your config points to.
