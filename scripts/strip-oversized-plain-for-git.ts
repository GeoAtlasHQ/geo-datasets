/**
 * Removes oversized plain dataset files when a .gz sidecar exists and updates
 * manifest.json + checksums.json to reference the .gz paths (GitHub 100MB limit).
 */
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const GITHUB_MAX = 100 * 1024 * 1024;

async function hashFile(filePath: string): Promise<{ sha256: string; sha512: string; sizeBytes: number }> {
  const data = await fs.readFile(filePath);
  const sha256 = createHash('sha256').update(data).digest('hex');
  const sha512 = createHash('sha512').update(data).digest('hex');
  return { sha256, sha512, sizeBytes: data.length };
}

async function main(): Promise<void> {
  const version = process.argv[2]?.trim() ?? 'v1.1.0';
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const bundleRoot = path.join(repoRoot, 'az', version);
  const datasetsRoot = path.join(bundleRoot, 'datasets');

  const manifestPath = path.join(datasetsRoot, 'manifest.json');
  const checksumsPath = path.join(bundleRoot, 'checksums.json');

  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8')) as {
    checksums: Array<{ path: string; sha256?: string; sizeBytes?: number }>;
  };

  const remapped = new Map<string, string>();

  for (const entry of manifest.checksums) {
    const plainRel = entry.path;
    const plainAbs = path.join(datasetsRoot, plainRel);
    let stat: Awaited<ReturnType<typeof fs.stat>>;
    try {
      stat = await fs.stat(plainAbs);
    } catch {
      continue;
    }

    const gzRel = `${plainRel}.gz`;
    const gzAbs = `${plainAbs}.gz`;
    let gzStat: Awaited<ReturnType<typeof fs.stat>>;
    try {
      gzStat = await fs.stat(gzAbs);
    } catch {
      continue;
    }

    if (stat.size > GITHUB_MAX && gzStat.size > 0) {
      await fs.unlink(plainAbs);
      remapped.set(plainRel, gzRel);
    }
  }

  if (remapped.size === 0) {
    console.log('No oversized plain files with gzip sidecars to strip.');
    return;
  }

  console.log('Stripped plain → using gzip:', [...remapped.entries()]);

  for (const entry of manifest.checksums) {
    const gzRel = remapped.get(entry.path);
    if (!gzRel) continue;
    entry.path = gzRel;
    const hashes = await hashFile(path.join(datasetsRoot, gzRel));
    entry.sha256 = hashes.sha256;
    entry.sizeBytes = hashes.sizeBytes;
  }

  await fs.writeFile(manifestPath, JSON.stringify(manifest));

  const checksumsDoc = JSON.parse(await fs.readFile(checksumsPath, 'utf8')) as {
    entries: Array<{ dataset: string; sizeBytes: number; sha256: string; sha512: string }>;
  };

  for (const entry of checksumsDoc.entries) {
    const gzRel = remapped.get(entry.dataset);
    if (!gzRel) continue;
    entry.dataset = gzRel;
    const hashes = await hashFile(path.join(datasetsRoot, gzRel));
    entry.sizeBytes = hashes.sizeBytes;
    entry.sha256 = hashes.sha256;
    entry.sha512 = hashes.sha512;
  }

  await fs.writeFile(checksumsPath, JSON.stringify(checksumsDoc));
  console.log('Updated manifest.json and checksums.json');
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
