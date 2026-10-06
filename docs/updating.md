# Updating & completions

## Update

```sh
simon check-update      # is a newer version available?
simon update            # update on your current channel
```

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
