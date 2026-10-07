# Updating & completions

## Update

```sh
simon check-update      # shows installed vs latest, plus the changelog of what's new
simon update            # update on your current channel (prints the changelog as it installs)
```

`check-update` prints your **installed** version and the **latest** available one, and — when they differ — the release notes for what you'd get. `update` shows the same changelog as it installs.

simon self-updates in place (over the binary you're running). It only uses `sudo` when the install directory isn't writable by you.

### Channels

- **stable** (default) — tagged releases from `master`, with full changelogs.
- **nightly** — a dated prerelease built from `develop` once a day (with a changelog), skipped on days with no code changes.
- **dev** — the bleeding edge: rebuilt on **every** `develop` commit. It's **not** a GitHub release at all — the binaries live on the `dev-dist` branch and are fetched over `raw.githubusercontent.com`, so there's no release, tag, or changelog. The version carries a build timestamp so updates are still detectable.

The channel is remembered per machine, so plain `simon update` stays on whichever you picked:

```sh
simon update --stable         # stable line
simon update --nightly        # daily nightly
simon update --dev            # every-commit dev build
simon update --force          # reinstall / install a same-or-older build (e.g. switching rings)
simon check-update --dev      # peek at the latest dev build without installing
```

Each stable/nightly release lists its own changelog; nightlies also include a one-line install command for that exact build. Dev builds have neither — use nightly or stable if you want notes.

## Shell completions (zsh)

```sh
simon completions zsh > ~/.simon-completion.zsh
echo 'source ~/.simon-completion.zsh' >> ~/.zshrc   # after `autoload -U compinit && compinit`
```
