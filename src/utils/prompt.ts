import { Separator } from '@inquirer/core';
import select from '@inquirer/select';
import chalk from 'chalk';

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

export function spinner(text: string): () => void {
  if (!process.stdout.isTTY) return () => {};
  let i = 0;
  process.stdout.write(`\x1B[?25l\r${chalk.cyan(SPINNER_FRAMES[i++])} ${text}`);
  const id = setInterval(() => {
    process.stdout.write(`\r${chalk.cyan(SPINNER_FRAMES[i++ % SPINNER_FRAMES.length])} ${text}`);
  }, 80);
  return () => {
    clearInterval(id);
    process.stdout.write('\r\x1B[K\x1B[?25h');
  };
}

export async function selectWithExit<T>(
  message: string,
  choices: { name: string; value: T }[]
): Promise<T> {
  const onKeypress = (_: unknown, key: { name?: string } | undefined) => {
    if (key?.name === 'q') process.kill(process.pid, 'SIGINT');
  };

  process.stdin.on('keypress', onKeypress);

  try {
    const result = await (select as any)({
      message,
      loop: false,
      choices: [
        ...choices,
        new Separator(),
        { name: chalk.gray('Exit  (q / ctrl+c)'), value: '__exit__' },
      ],
    });

    process.stdin.removeListener('keypress', onKeypress);
    if (result === '__exit__') process.exit(0);
    return result as T;
  } catch (e) {
    process.stdin.removeListener('keypress', onKeypress);
    throw e;
  }
}
