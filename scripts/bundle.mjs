import { readFileSync } from 'fs';
import { execSync } from 'child_process';

const { version } = JSON.parse(readFileSync('package.json', 'utf8'));

execSync(
  `esbuild src/index.ts --bundle --platform=node --format=cjs --outfile=bundle.cjs "--define:process.env.npm_package_version=\\"${version}\\""`,
  { stdio: 'inherit', shell: true }
);
