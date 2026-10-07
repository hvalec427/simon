# React Native dashboard (`simon rn`)

Run and manage a whole React Native project from a single terminal window: start
and drive Metro, boot simulators/emulators, build & run the app on them, forward
Metro's interactive keys (`r`/`d`/`j`…), and watch the JS logs / network / perf —
all at once.

```sh
simon rn init     # register the current directory as a project
simon rn          # open the dashboard for the current project
simon rn config   # print the config file path
```

## Config

Projects live in `~/.config/simon/rn.json`, a registry keyed by repo root. `simon
rn` picks the project whose `root` is a prefix of your current directory, so you
just `cd` into a repo and run `simon rn`.

`simon rn init` scaffolds a minimal entry; everything else falls back to sensible
defaults derived from your package manager (detected from the lockfile). A full
entry looks like:

```jsonc
{
  "projects": [
    {
      "name": "MyApp",
      "root": "/Users/me/dev/myapp",      // matched as a prefix of the cwd
      "packageManager": "yarn",           // optional; npm | yarn | pnpm (auto-detected)
      "metro":   { "command": "yarn start", "port": 8081 },
      "ios":     { "command": "yarn ios", "bundleId": "com.myapp" },
      "android": { "command": "yarn android", "bundleId": "com.myapp" },
      "openLink": "https://myapp.com/home",// optional; `o` opens it on a device
      "env": { "FOO": "bar" }             // optional, merged into every command
    }
  ]
}
```

Anything omitted is derived:

| Package manager | metro | ios | android |
|---|---|---|---|
| npm | `npm start` | `npm run ios` | `npm run android` |
| yarn | `yarn start` | `yarn ios` | `yarn android` |
| pnpm | `pnpm start` | `pnpm ios` | `pnpm android` |

**Port in one place.** Set `metro.port` and nothing else — simon connects its log
feed to that port *and* exports it as `RCT_METRO_PORT` into every command it runs,
so Metro and your builds use the same port. It defaults to `8081`. (Set
`RCT_METRO_PORT` yourself in `env` only if you want to override that.)

**Which device?** You don't pin a simulator/emulator in config — you pick one live
from the dashboard's Devices pane (select + `b` to boot). `i` / `a` just run the
build command against whatever's booted.

## The dashboard

Three tiled panes plus a status bar:

- **Processes** — Metro and each `run ios`/`android`, one sub-tab each, shown as a
  live terminal (colors and Metro's interactive menu render faithfully).
- **Devices & Actions** — Metro status and every installed simulator/emulator
  with a running marker.
- **JS Logs / Network / Perf** — the full `logs --rn` viewer embedded (see
  [logs](logs.md) for its keys).

### Keys

| Key | Action |
|---|---|
| `⇥` / `⇧⇥` | move focus between panes |
| `m` | start (or restart) Metro |
| `i` / `a` | run iOS / Android (on whatever device you've booted) |
| `R` / `D` / `J` | send Metro reload / dev-menu / debugger from any pane |
| `[` / `]` | *(Processes)* switch sub-tab |
| `⏎` | *(Processes)* enter **input mode** — raw keys go to the process |
| `esc` | leave input mode |
| `↑↓` / `jk`, `b` | *(Devices)* select, then boot the selected device |
| `o` | *(Devices)* open the configured `openLink` on the selected device, delivered straight to the app when `bundleId` is set |
| `q` / `Ctrl-C` | quit (stops the processes simon started) |

**Driving Metro.** Focus the Processes pane, press `⏎`, and every key goes
straight to Metro — exactly like a normal terminal, so `r`, `d`, `j` and anything
else Metro supports work. `esc` returns to navigation, so you're never trapped.
Don't want to switch panes? `R` / `D` / `J` send the common Metro keys from
anywhere. `R` falls back to a CDP reload when Metro isn't running under simon.

> **Dev-only, macOS.** The JS feed needs Metro running; booting simulators uses
> the same `xcrun`/`adb` tooling as the rest of simon.
