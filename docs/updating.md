# Updating & completions

## Update

```sh
simon check-update      # shows installed vs latest, plus the changelog of what's new
simon update            # update on your current channel (prints the changelog as it installs)
```

`check-update` prints your **installed** version and the **latest** available one, and — when they differ — the release notes for what you'd get. `update` shows the same changelog as it installs.

simon self-updates in place (over the binary you're running). It only uses `sudo` when the install directory isn't writable by you.

### Channels

- **stable** (default) — tagged releases from `master`.
- **nightly** — prereleases built from `develop` on every push (latest features, less baked).

The channel is remembered per machine, so plain `simon update` stays on whichever you picked:

```sh
simon update --nightly        # switch to nightly and update
simon update --stable         # back to stable
simon check-update --nightly  # peek at the latest nightly without installing
```

Each release lists its own changelog (and nightlies include a one-line install command for that exact build).

## Shell completions (zsh)

```sh
simon completions zsh > ~/.simon-completion.zsh
echo 'source ~/.simon-completion.zsh' >> ~/.zshrc   # after `autoload -U compinit && compinit`
```
