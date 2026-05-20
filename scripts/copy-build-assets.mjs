import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const files = [
  ['src/database/schema.sql', 'dist/database/schema.sql'],
];

for (const [from, to] of files) {
  mkdirSync(dirname(to), { recursive: true });
  copyFileSync(from, to);
}

console.log('Copied build assets.');
