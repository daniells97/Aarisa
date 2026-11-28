import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

// Report files are kept so every import can be traced to its original (open question 17:
// local volume or S3-compatible bucket). FILE_STORAGE_DIR points at a private volume.
function root() {
  return resolve(process.env.FILE_STORAGE_DIR ?? './storage');
}

export async function saveImportFile(operation: string, sha: string, text: string) {
  const dir = join(root(), 'imports', operation);
  await mkdir(dir, { recursive: true });
  const name = `${sha}.csv`;
  await writeFile(join(dir, name), text, { flag: 'w' });
  return `file://imports/${operation}/${name}`;
}
