# Location

Set a simulated GPS location. Pass coordinates as a single `lat,lon` argument:

```sh
simon location 51.5074,-0.1278          # pick a device, or add -i/-a/a name
simon location 51.5074,-0.1278 "iPhone 16"
simon location --reset                   # clear it (iOS simulators)
```

- **Simulators and emulators** — set natively (`simctl` / `adb emu geo fix`).
- **Physical iOS** (experimental) — via [go-ios](https://github.com/danielpaulus/go-ios); simon auto-installs it and starts the iOS 17+ developer tunnel for you (see [physical devices](physical-devices.md)).
- **Physical Android** — via a tiny mock-location helper app that simon installs and drives over adb (needs Developer Options enabled on the device).
