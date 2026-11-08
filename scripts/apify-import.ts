import { closeDb } from '../src/db';
import { importApifyJobs } from '../src/integrations/apify';
const dryRun = process.argv.includes('--dry-run');
const result = await importApifyJobs({
  dryRun,
  datasetFile: process.env.APIFY_DATASET_FILE?.trim(),
  input: process.env.APIFY_INPUT
    ? (JSON.parse(process.env.APIFY_INPUT) as Record<string, unknown>)
    : undefined,
  logger: (message) => console.log(message),
});
console.log(
  `Fetched ${result.fetched}; ready ${result.ready}; created ${result.imported}; updated ${result.updated}; already present ${result.existing}; awaiting source approval ${result.awaitingApproval}; skipped ${result.skipped}.${dryRun ? ' Dry run only.' : ''}`,
);
await closeDb();
