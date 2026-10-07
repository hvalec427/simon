# Physical device support

Physical devices show up in `simon list` and `simon running`, and work with `simon open-link`, `simon logs`, and `simon location`.

- **Android**: plug in via USB — detected automatically via `adb` (needs Developer Options enabled on the device).
- **iOS**: plug in via USB — detected automatically via `xcrun devicectl` (needs full Xcode, not just the Command Line Tools).

## The iOS developer tunnel

Physical-iOS features that go through [go-ios](https://github.com/danielpaulus/go-ios) (`logs`, `location`) need the iOS 17+ developer tunnel. simon installs go-ios automatically if missing and starts the tunnel for you (prompts for `sudo` once). Manage it manually with:

```sh
simon tunnel start | stop | status
```

## Deep links on physical iOS

Opening a deep link on a physical iOS device uses `xcrun devicectl`. The simulator's `simctl openurl` can route a scheme straight to its app; `devicectl` has no such command, so simon hands the URL to Safari and lets the system route it to the owning app — the same as tapping the link on a website (a custom scheme may show a one-time "Open in <app>?" confirmation).

To skip Safari and deliver the URL straight to a specific app, pass its bundle id:

```sh
simon open-link "myapp://path" -i "My iPhone" -b com.example.myapp
```

Other `open-link` flags:

- `-b, --bundle-id <id>` — deliver straight to an app instead of routing via Safari (physical iOS).
- `-r, --restart` — cold-relaunch the app instead of warm-foregrounding it (physical iOS; the default keeps the app's current state so you can test deep-link navigation from a backgrounded state).
