# Logs

Stream native logs from a running simulator, emulator, or physical device:

```sh
simon logs                 # pick a running device
simon logs "iPhone 16"     # target one directly
```

- `-f, --filter <expr>` — filter logs (NSPredicate on iOS, regex on Android).
- `--app <name>` — show only one app's logs (process/app name; a bundle id also matches on iOS simulators).

Physical iOS streams the device syslog via [go-ios](https://github.com/danielpaulus/go-ios) (auto-installed, and simon starts the iOS 17+ developer tunnel for you — see [physical devices](physical-devices.md)).

This is the **native** device log. For React Native **JS console + network** logs, use the metroctl viewer — see [metroctl logs](../metroctl/logs.md).
