# simon

This repo is a **monorepo** (a Cargo workspace under [`rust/`](rust)) of small, composable macOS dev tools:

| Tool | What it is | Status |
|---|---|---|
| **simon** | CLI for managing iOS simulators, Android emulators, and physical devices (boot, stop, wipe, logs, deep links, push). | Installed via the script below; self-updates. |
| **metroctl** | A single-window React Native dashboard (Metro + build/run + JS logs/network/perf), built on simon. See [docs/rn.md](docs/rn.md). | Build from source for now — see [metroctl](#metroctl). |

simon is the core and can be used entirely on its own; metroctl depends on it.

---

## simon

A CLI for managing both real devices and iOS simulators / Android emulators — boot, stop, wipe, stream logs, open deep links, and send test push notifications, all from the terminal. No more opening Xcode or Android Studio just to boot a simulator.

Built entirely with AI (Claude).

> **macOS only.** simon ships as a signed macOS binary (Apple Silicon / Intel) and relies on macOS-only tooling (`xcrun`, `simctl`, `devicectl`). The installer and `simon update` are macOS-only; iOS features won't work elsewhere.

## Install

```sh
curl -fsSL https://raw.githubusercontent.com/hvalec427/simon/master/install.sh | sh
```

Or grab the binary from the [latest release](https://github.com/hvalec427/simon/releases/latest). Update with `simon update`; see [Updating](docs/updating.md) for channels (stable/nightly/dev).

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
| `simon logs` | Stream logs from a running device |
| `simon location <lat,lon>` | Set a simulated GPS location |
| `simon push <payload>` | Send a push to a simulator, or a real device with `--token` |
| `simon tunnel [start\|stop\|status]` | Manage the iOS developer tunnel |
| `simon doctor` | Check your environment for the required tooling |
| `simon check-update` / `simon update` | Check for / install a newer version |

Run any command with `--help` for its flags.

## Selecting a device

Every device command picks its target the same way:

- **a single device** → used automatically, no prompt
- **no flag** → pick from a combined list of all devices
- **`-i` / `-a`** → limit the list to iOS / Android
- **a name** → target that device directly (on either platform — no `-i`/`-a` needed)

```sh
simon launch                 # pick any simulator/emulator from a list
simon launch -a              # limit the picker to Android
simon launch "iPhone 16"     # launch that one directly, no flag needed
```

## Guides

- [Logs](docs/logs.md) — native device logs
- [RN dashboard](docs/rn.md) — **metroctl**, a separate companion tool that runs a whole React Native project (Metro, build/run, JS logs) from one window, built on simon
- [Push notifications](docs/push.md) — simulators and real devices (FCM / APNs)
- [Location](docs/location.md) — simulated GPS on simulators, emulators, and real devices
- [Physical devices](docs/physical-devices.md) — USB detection, the iOS tunnel, deep links
- [Updating](docs/updating.md) — release channels, self-update

## Requirements

- **OS**: macOS (Apple Silicon or Intel)
- **iOS**: Xcode installed
- **Android**: Android SDK (`ANDROID_HOME` set, or SDK at `~/Library/Android/sdk`)

---

## metroctl

A companion tool that runs a whole React Native project from one terminal window —
start/drive Metro, boot simulators/emulators, build & run the app, open deep links,
and watch JS logs/network/perf — all built on top of simon. Full guide:
[docs/rn.md](docs/rn.md).

It isn't in the installer yet; build it from the workspace:

```sh
cd rust
cargo install --path metroctl     # puts `metroctl` on your PATH
```

Then, from inside a React Native project:

```sh
metroctl init     # register the project (writes ~/.config/simon/rn.json)
metroctl          # open the dashboard
metroctl logs     # just the RN JS log viewer
```

Or run it without installing: `cargo run -p metroctl -- <args>`.

## Repo layout

```
rust/
  Cargo.toml      # workspace
  simon/          # device-management library + the `simon` CLI
  metroctl/       # the metroctl binary (depends on simon)
```

Build everything with `cargo build` in `rust/`; build one tool with
`cargo build -p simon` / `-p metroctl`.
