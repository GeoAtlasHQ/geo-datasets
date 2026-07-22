/**
 * G17 — Validate geo-datasets release layout and Phase G manifest consistency.
 *
 * Usage: npx tsx scripts/validate-phase-g-release.ts [datasetsRoot]
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

async function main(): Promise<void> {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const repoRoot = path.resolve(__dirname, '..');

  const datasetsRoot =
    process.argv[2]?.trim() ?? path.join(repoRoot, 'az/v1.0.0/datasets');

  interface ManifestLike {
    readonly datasetVersion?: string;
    readonly checksums?: readonly { path: string }[];
    readonly classification?: Record<string, unknown>;
    readonly buildings?: Record<string, unknown>;
    readonly classificationZones?: Record<string, unknown>;
    readonly notablePlaces?: Record<string, unknown>;
  }

  let exitCode = 0;

  function fail(message: string): void {
    console.error(`FAIL: ${message}`);
    exitCode = 1;
  }

  function warn(message: string): void {
    console.warn(`WARN: ${message}`);
  }

  function pass(message: string): void {
    console.log(`PASS: ${message}`);
  }

  const manifestPath = path.join(datasetsRoot, 'manifest.json');
  const raw = await fs.readFile(manifestPath, 'utf8');
  const manifest = JSON.parse(raw) as ManifestLike;

  if (!manifest.checksums || manifest.checksums.length === 0) {
    fail('manifest.json missing checksums');
  } else {
    pass(`${manifest.checksums.length} checksum entries listed`);
  }

  let missingOnDisk = 0;
  for (const entry of manifest.checksums ?? []) {
    const target = path.join(datasetsRoot, entry.path);
    try {
      await fs.access(target);
    } catch {
      missingOnDisk += 1;
    }
  }

  if (missingOnDisk > 0) {
    fail(`${missingOnDisk} manifest files missing on disk under ${datasetsRoot}`);
  } else {
    pass('All manifest checksum paths exist on disk');
  }

  const hasPhaseG =
    manifest.classification !== undefined ||
    manifest.buildings !== undefined ||
    manifest.classificationZones !== undefined ||
    manifest.notablePlaces !== undefined;

  if (!hasPhaseG) {
    warn(
      'Published manifest has no Phase G/H blocks — expected until next dataset semver release',
    );
    warn(`Current datasetVersion: ${manifest.datasetVersion ?? 'unknown'}`);
  } else {
    pass('Phase G/H manifest blocks present');
    if (!manifest.classification) fail('Partial Phase G: missing classification block');
    if (!manifest.buildings) fail('Partial Phase G: missing buildings block');
    if (!manifest.classificationZones) fail('Partial Phase G: missing classificationZones block');
    if (!manifest.notablePlaces) fail('Partial Phase H: missing notablePlaces block');
  }

  const releaseJsonPath = path.join(datasetsRoot, '..', 'release.json');
  try {
    await fs.access(releaseJsonPath);
    pass('release.json present beside datasets/');
  } catch {
    warn('release.json not found — CDN layout may differ');
  }

  console.log(`\nValidation finished (exit ${exitCode})`);
  process.exit(exitCode);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
