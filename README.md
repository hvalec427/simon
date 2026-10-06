# simon

A CLI for managing both real devices and iOS simulators / Android emulators — boot, stop, wipe, stream logs, open deep links, and send test push notifications, all from the terminal. No more opening Xcode or Android Studio just to boot a simulator.

Built entirely with AI (Claude).

## Why

As a mobile developer you constantly need to start, stop, and switch between simulators and emulators. Doing that through a GUI is friction. Simon lets you do it from the terminal in one command, with an interactive picker when you need it.

## Install

```sh
curl -fsSL https://raw.githubusercontent.com/hvalec427/simon/master/install.sh | sh
```

Or download the binary directly from the [latest release](https://github.com/hvalec427/simon/releases/latest).

### Release channels

- **stable** (default) — tagged releases from `master`.
- **nightly** — prereleases built from `develop` on every push (latest features, less baked).

Switch per machine with `simon update`; the choice is remembered, so afterwards plain `simon update` stays on it:

```sh
simon update --nightly     # switch to nightly and update
simon update --stable      # back to stable
simon update               # update on whichever channel you're on
simon check-update --nightly   # peek at the latest nightly without installing
```

To jump straight onto nightly from a fresh install (or a build too old to have `--nightly`):

```sh
curl -fsSL https://raw.githubusercontent.com/hvalec427/simon/master/install.sh | sh -s nightly
```

## Uninstall

```sh
curl -fsSL https://raw.githubusercontent.com/hvalec427/simon/master/uninstall.sh | sh
```

## Commands

| Command | Description |
|---|---|
| `simon create` | Create a simulator or emulator |
| `simon launch` | Launch a simulator or emulator |
| `simon stop` | Stop a running simulator or emulator |
| `simon delete` | Delete a simulator or emulator |
| `simon wipe` | Erase all data on a simulator or emulator |
| `simon list` | List all simulators and emulators |
| `simon running` | Show what's currently running |
| `simon open-link <url>` | Open a deep link on a running device |
| `simon logs` | Stream logs from a running device (Ctrl+C to stop) |
| `simon location <lat,lon>` | Set a simulated GPS location on a simulator/emulator |
| `simon push <payload>` | Send a push to a simulator, or a real device with `--token` |
| `simon tunnel [start\|stop\|status]` | Manage the iOS developer tunnel (physical-device commands) |
| `simon doctor` | Check your environment for the required tooling |
| `simon check-update` | Check whether a newer version is available |
| `simon update` | Update simon (stable by default, or `--nightly`) |

### Selecting a device

Every device command picks its target the same way:

- **no flag** → pick from a combined list of all devices
- **`-i` / `-a`** → limit the list to iOS / Android
- **a name** → target that device directly
- **exactly one match** → used automatically, no prompt

```sh
simon launch                 # pick any simulator/emulator from a list
simon launch -a              # limit the picker to Android
simon launch -i "iPhone 16"  # launch that specific one, no picker
```

### Command-specific flags

- `location <lat,lon>` — pass coordinates as one argument, e.g. `simon location 51.5074,-0.1278`; `--reset` clears it. Works on simulators and emulators natively. **Physical iOS** (experimental) via [go-ios](https://github.com/danielpaulus/go-ios) — simon installs it automatically if missing and starts the iOS 17+ developer tunnel for you (prompts for `sudo` once); manage it with `simon tunnel start|stop|status`. **Physical Android** works via a tiny helper app simon installs and drives over adb (needs Developer Options enabled on the device).
- `logs -f <expr>` — filter logs (NSPredicate on iOS, regex on Android)
- `logs --app <name>` — show only one app's logs (process/app name; bundle id also matches on iOS simulators). Physical iOS streams the device syslog via [go-ios](https://github.com/danielpaulus/go-ios) (same auto-install/tunnel as `location`). This is the **native** log — for React Native JS logs use `--rn` below.
- `logs --rn [--port 8081]` — React Native **JS console + network** from Metro's inspector (CDP) — the same feed React Native DevTools uses — for any device/simulator connected to Metro (no go-ios/adb needed). In a terminal it opens an **interactive viewer** (dark theme, readable on any terminal background) with **Logs** and **Network** tabs: `[`/`]` switch tabs · `1`-`9` switch device (when several are on Metro) · `f` filter · `/` search (`n`/`N` next/prev) · `c` clear · `p` keep-vs-clear logs on app restart · `r` reconnect · `↑↓`/`jk` / PgUp·PgDn / `g`·`G` scroll · `q` quit. On the **Network** tab, select a request and press **Enter** for a detail view — method, URL, status, request/response **headers and bodies** (JSON pretty-printed). It **auto-reconnects** when the app closes/crashes. Piped/redirected, it falls back to a plain line stream. Dev-only (Metro running); network depth depends on your RN version's CDP support (falls back to summary lines otherwise).
- `open-link <url> -b <id>` — deliver straight to an app instead of routing via Safari (physical iOS)
- `open-link <url> -r` — cold-relaunch the app instead of warm-foregrounding it (physical iOS; default keeps the app's current state so you can test deep-link navigation from a background state)
- `push -t [--fcm]` — print a payload template (`--fcm` for the FCM shape, otherwise the `aps` shape)
- `push <payload> --token <token> [--fcm|--apns]` — send to a real device via FCM/APNs (credentials from `~/.config/simon/push.json`); see [Push notifications](#push-notifications)
- `push <payload> -b <id>` — target app bundle id (if not baked into the payload)
- `push --template` — print an example payload to stdout (e.g. `simon push --template > push.json`)

## Physical device support

Physical devices are shown in `simon list` and `simon running`, and work with `simon open-link` and `simon logs`.

- **Android**: plug in via USB — detected automatically via `adb`
- **iOS**: plug in via USB — detected automatically via `xcrun devicectl` (needs full Xcode, not just the Command Line Tools)

Opening a deep link on a physical iOS device uses `xcrun devicectl`. The simulator's `simctl openurl` can route a scheme to its app directly; `devicectl` has no such command, so simon hands the URL to Safari and lets the system route it to the owning app — the same as tapping the link on a website (a custom scheme may show a one-time "Open in <app>?" confirmation).

To skip Safari and deliver the URL straight to a specific app, pass its bundle id:

```sh
simon open-link "myapp://path" -i "My iPhone" -b com.example.myapp
```

## Push notifications

`simon push` sends to a **simulator** (local inject via `simctl`) or to a **real device** via `--token` (through FCM or APNs).

### Simulator

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

### Real device (FCM / APNs)

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

## Requirements

- **iOS**: macOS with Xcode installed
- **Android**: Android SDK (`ANDROID_HOME` set, or SDK at `~/Library/Android/sdk`)
