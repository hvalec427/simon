# simon-mock-location

A tiny headless helper app that lets `simon location` fake GPS on a **physical
Android device** (Android has no adb command to set a real device's location).

`simon` installs the prebuilt `simon-mock-location.apk` automatically and drives
it over adb — you normally never touch this directly.

## How it works

- A single hidden `Activity` (started via `am start`, which counts as a
  foreground launch, so it avoids Android 12+'s background-service limits).
- It registers test providers for `gps`/`network` and republishes the given
  coordinates once a second; `--ez stop true` removes them again.
- `simon` first runs `appops set <pkg> android:mock_location allow` and grants
  the runtime location permissions.

## Rebuilding the APK

Requires JDK 17 + the Android SDK (platform 34, build-tools 34).

```sh
cd android
./gradlew assembleDebug
cp app/build/outputs/apk/debug/app-debug.apk simon-mock-location.apk
```

Commit the refreshed `simon-mock-location.apk` — that's the file `simon`
downloads at runtime.
