# simon

A CLI tool for managing iOS simulators and Android emulators — because opening Xcode or Android Studio just to boot a simulator is too slow.

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

Every device command follows the same rule: **no flag** → pick from a combined list of all devices · **`-i`/`-a`** → limit to that platform · **name** → target it directly · **exactly one match** → used automatically, no prompt.

| Command | Description |
|---|---|
| `simon create` | Create a simulator or emulator (asks which) |
| `simon create -i` / `-a` | Skip the platform prompt (iOS / Android) |
| `simon delete` | Pick any simulator/emulator to delete |
| `simon delete -i` / `-a` | Limit the list to iOS / Android |
| `simon launch` | Pick any simulator/emulator to launch |
| `simon launch -i` / `-a` | Limit the list to iOS / Android |
| `simon launch -i "iPhone 16"` | Launch a specific device by name |
| `simon stop` | Pick any running device to stop |
| `simon stop -i` / `-a` | Limit the list to iOS / Android |
| `simon list` | List all simulators and emulators |
| `simon list -i` | List iOS simulators |
| `simon list -a` | List Android emulators |
| `simon running` | Show what's currently running |
| `simon open-link <url>` | Open a deep link on a running device (picker if multiple) |
| `simon open-link <url> -i` | Open on a running iOS simulator |
| `simon open-link <url> -a` | Open on a running Android emulator |
| `simon open-link <url> -i "iPhone 16"` | Open on a specific running simulator |
| `simon logs` | Stream logs from a running device (Ctrl+C to stop) |
| `simon logs -i` | Stream logs from a running iOS simulator |
| `simon logs -a` | Stream logs from a running Android emulator |
| `simon logs -f <expr>` | Stream logs with a filter expression |
| `simon wipe` | Pick any stopped simulator/emulator to wipe |
| `simon wipe -i` / `-a` | Limit the list to iOS / Android |
| `simon wipe -i "iPhone 16"` | Wipe a specific device by name |
| `simon push <payload>` | Send a push notification to an iOS simulator |
| `simon push <payload> -b <id>` | …specifying the target app bundle id |
| `simon doctor` | Check your environment for the required tooling |
| `simon check-update` | Check whether a newer version is available |
| `simon update` | Download and install the latest version |

## Physical device support

Physical devices are shown in `simon list` and `simon running`, and work with `simon open-link`.

- **Android**: plug in via USB — detected automatically via `adb`
- **iOS**: plug in via USB — detected automatically via `xcrun devicectl` (needs full Xcode, not just the Command Line Tools)

Opening a deep link on a physical iOS device uses `xcrun devicectl`. The simulator's `simctl openurl` can route a scheme to its app directly; `devicectl` has no such command, so simon hands the URL to Safari and lets the system route it to the owning app — the same as tapping the link on a website (a custom scheme may show a one-time "Open in <app>?" confirmation).

To skip Safari and deliver the URL straight to a specific app, pass its bundle id:

```sh
simon open-link "myapp://path" -i "My iPhone" -b com.example.myapp
```

## Requirements

- **iOS**: macOS with Xcode installed
- **Android**: Android SDK (`ANDROID_HOME` set, or SDK at `~/Library/Android/sdk`)

## Releasing

Releases are automated with [semantic-release](https://semantic-release.gitbook.io/). Versioning and changelog come from commit messages, so commits must follow [Conventional Commits](https://www.conventionalcommits.org/) (enforced locally by a commitlint git hook):

| Prefix | Example | Release |
|---|---|---|
| `fix:` | `fix: handle missing udid` | patch (x.y.**z**) |
| `feat:` | `feat: add logs filter` | minor (x.**y**.0) |
| `feat!:` / `BREAKING CHANGE:` in body | `feat!: drop prefer command` | major (**x**.0.0) |
| `chore:`, `docs:`, `ci:`, `refactor:`, `test:` | `chore: bump deps` | no release |

On every push to `master`, CI analyzes the new commits, bumps the version, writes `CHANGELOG.md`, builds the macOS binaries, and publishes a GitHub Release with a matching `vX.Y.Z` tag. Don't edit the version in `package.json` by hand.
