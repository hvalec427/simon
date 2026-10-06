import type { Command } from 'commander';

// Emit a zsh completion script derived from the registered commands/options,
// so it stays in sync with the CLI automatically.
export function completionsCommand(shell: string | undefined, program: Command): void {
  if (shell && shell !== 'zsh') {
    console.error(`Only zsh completions are supported right now (got "${shell}").`);
    process.exit(1);
  }
  process.stdout.write(zshScript(program));
}

const esc = (s: string) => s.replace(/'/g, '').replace(/:/g, ' -');

function zshScript(program: Command): string {
  const subs = program.commands.filter(c => c.name() !== 'completions');

  const commandList = subs.map(c => `    '${c.name()}:${esc(c.description())}'`).join('\n');

  const optionCases = subs
    .map(c => {
      const flags = c.options.flatMap(o => {
        const names = o.flags.match(/-{1,2}[a-zA-Z][\w-]*/g) ?? [];
        return names.map(n => `'${n}[${esc(o.description)}]'`);
      });
      return `      ${c.name()})\n        _arguments ${flags.length ? flags.join(' ') : "'*: :_files'"} ;;`;
    })
    .join('\n');

  return `# zsh completion for simon — install with:
#   simon completions zsh > ~/.simon-completion.zsh
#   echo 'source ~/.simon-completion.zsh' >> ~/.zshrc   # after compinit
_simon() {
  local state
  _arguments -C '1: :->command' '*:: :->args'
  case $state in
    command)
      local -a commands
      commands=(
${commandList}
      )
      _describe 'command' commands ;;
    args)
      case $words[1] in
${optionCases}
      esac ;;
  esac
}
compdef _simon simon
`;
}
