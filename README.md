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
| `simon push <payload>` | Send a push notification to an iOS simulator |
| `simon tunnel [start\|stop\|status]` | Manage the iOS developer tunnel (physical-device commands) |
| `simon doctor` | Check your environment for the required tooling |
| `simon check-update` | Check whether a newer version is available |
| `simon update` | Update simon to the latest version |

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
- `open-link <url> -b <id>` — deliver straight to an app instead of routing via Safari (physical iOS)
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

`simon push` injects a notification straight into a booted simulator via `simctl` — it does **not** go through APNs or Firebase, so it won't exercise your delivery pipeline (tokens, server send). It's for testing how your app *handles* a notification.

Start from the template, edit it, and send:

```sh
simon push --template > push.json
simon push push.json -b com.example.myapp
```

The payload is a standard APNs payload — the same shape FCM delivers on iOS. The notification goes under `aps`; any custom **data** goes at the **top level** (that's where it lands in `userInfo`), with string values:

```json
{
  "aps": {
    "alert": { "title": "Order update", "body": "Your laundry is on the way 🚚" },
    "sound": "default",
    "badge": 1
  },
  "order_uuid": "47e8e4ef-db82-4f8c-ab25-5af7c5462185",
  "redirect": "RC"
}
```

The target app comes from `-b <bundle-id>` (in production this is the APNs topic, which lives outside the payload). The app must have been launched once on the booted simulator. Physical devices and Android aren't supported.

## Requirements

- **iOS**: macOS with Xcode installed
- **Android**: Android SDK (`ANDROID_HOME` set, or SDK at `~/Library/Android/sdk`)
