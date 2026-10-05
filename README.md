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

| Command | Description |
|---|---|
| `simon create -i` | Create a new iOS simulator (interactive) |
| `simon create -a` | Create a new Android emulator (interactive) |
| `simon delete -i` | Delete an iOS simulator |
| `simon delete -a` | Delete an Android emulator |
| `simon launch -i` | Launch iOS simulator (interactive picker) |
| `simon launch -a` | Launch Android emulator (interactive picker) |
| `simon launch -i "iPhone 16"` | Launch a specific iOS simulator by name |
| `simon launch -a Pixel_9_Pro` | Launch a specific Android emulator by name |
| `simon stop -i` | Stop a running iOS simulator |
| `simon stop -a` | Stop a running Android emulator |
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
| `simon wipe -i` | Wipe all data on an iOS simulator (interactive picker) |
| `simon wipe -a` | Wipe all data on an Android emulator (interactive picker) |
| `simon wipe -i "iPhone 16"` | Wipe a specific iOS simulator |
| `simon wipe -a Pixel_9_Pro` | Wipe a specific Android emulator |

## Physical device support

Physical devices are shown in `simon list` and `simon running`, and work with `simon open-link`.

- **Android**: plug in via USB — detected automatically via `adb`
- **iOS**: plug in via USB — detected automatically via `xcrun devicectl` (needs full Xcode, not just the Command Line Tools)

Opening a deep link on a physical iOS device uses `xcrun devicectl`. Unlike a simulator, iOS can't auto-route a custom scheme to its app on a real device, so you must say which app opens the link. simon prompts with a picker of the installed apps, or you can pass it directly:

```sh
simon open-link "myapp://path" -i "My iPhone" -b com.example.myapp
```

## Requirements

- **iOS**: macOS with Xcode installed
- **Android**: Android SDK (`ANDROID_HOME` set, or SDK at `~/Library/Android/sdk`)
