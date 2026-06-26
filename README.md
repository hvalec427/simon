# simon

A CLI tool for managing iOS simulators and Android emulators — because opening Xcode or Android Studio just to boot a simulator is too slow.

Built entirely with AI (Claude).

## Why

As a mobile developer you constantly need to start, stop, and switch between simulators and emulators. Doing that through a GUI is friction. Simon lets you do it from the terminal in one command, with an interactive picker when you need it and a preferred device setting so your go-to simulator launches instantly.

## Install

```sh
curl -fsSL https://raw.githubusercontent.com/hvalec427/simon/master/install.sh | sh
```

Or download the binary directly from the [latest release](https://github.com/hvalec427/simon/releases/latest).

## Commands

| Command | Description |
|---|---|
| `simon create -i` | Create a new iOS simulator (interactive) |
| `simon create -a` | Create a new Android emulator (interactive) |
| `simon launch -i` | Launch iOS simulator (uses preferred, or interactive picker) |
| `simon launch -a` | Launch Android emulator (uses preferred, or interactive picker) |
| `simon launch -i "iPhone 16"` | Launch a specific iOS simulator by name |
| `simon launch -a Pixel_9_Pro` | Launch a specific Android emulator by name |
| `simon stop -i` | Stop a running iOS simulator |
| `simon stop -a` | Stop a running Android emulator |
| `simon list` | List all simulators and emulators |
| `simon list -i` | List iOS simulators |
| `simon list -a` | List Android emulators |
| `simon running` | Show what's currently running |
| `simon prefer -i` | Set your preferred iOS simulator |
| `simon prefer -a` | Set your preferred Android emulator |
| `simon prefer` | Show current preferred settings |

## Requirements

- **iOS**: macOS with Xcode installed
- **Android**: Android SDK (`ANDROID_HOME` set, or SDK at `~/Library/Android/sdk`)
