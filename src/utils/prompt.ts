import { Separator } from '@inquirer/core';
import select from '@inquirer/select';
import chalk from 'chalk';

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
