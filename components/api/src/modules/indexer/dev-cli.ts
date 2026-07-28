#!/usr/bin/env node
/**
 * Standalone indexer harness: runs any registered indexer against a media
 * description, without booting Nest, the database or Discord.
 *
 *   npm run indexer:find -- --imdb tt0133093 --title "The Matrix" --year 1999
 */
import { parseArgs } from 'node:util';

import { Logger } from '@nestjs/common';

import { IndexerMedia, MediaType, passesPreferences } from './contract';
import { EnginePreferences } from './preferences';
import { createIndexers, IndexersConfig } from './registry';

const ALLOW_ALL_PREFERENCES: EnginePreferences = {
  allowedQualities: [],
  allowedLanguages: [],
  allowedHosts: [],
  sizePolicy: { bytesPerMinute: {}, tolerance: 1 },
};

const USAGE = `Usage: npm run indexer:find -- [indexer] --imdb <tt...> --title <title> [options]

Note: the "--" after indexer:find is required, otherwise npm swallows the arguments.

Arguments:
  [indexer]                Only run this indexer, e.g. "loadix" (default: all configured)

Options:
  --imdb <id>              IMDB id (required)
  --title <title>          Title (required)
  --type <movie|episode>   Media type (default: movie)
  --original-title <t>     Original title
  --year <n>               Release year
  --season <n>             Season number (episode only)
  --episode <n>            Episode number (episode only)
  --runtime <n>            Runtime in minutes
  --indexer <name>         Same as the [indexer] positional argument
  --verbose                Show HTTP request/response debug logs`;

function parseCliArgs() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      imdb: { type: 'string' },
      title: { type: 'string' },
      type: { type: 'string', default: MediaType.Movie as string },
      'original-title': { type: 'string' },
      year: { type: 'string' },
      season: { type: 'string' },
      episode: { type: 'string' },
      runtime: { type: 'string' },
      indexer: { type: 'string' },
      verbose: { type: 'boolean', default: false },
    },
  });

  return { ...values, indexer: values.indexer ?? positionals[0] };
}

type CliValues = ReturnType<typeof parseCliArgs>;

function toNumber(value: string | undefined): number | null {
  return value === undefined ? null : Number(value);
}

function buildMedia(values: CliValues): IndexerMedia {
  if (!values.imdb || !values.title) {
    console.error(USAGE);
    process.exit(1);
  }
  if (!Object.values(MediaType).includes(values.type as MediaType)) {
    console.error(`Invalid --type "${values.type}", expected: ${Object.values(MediaType).join(' | ')}`);
    process.exit(1);
  }

  return {
    imdbId: values.imdb,
    type: values.type as MediaType,
    title: values.title,
    originalTitle: values['original-title'] ?? null,
    year: toNumber(values.year),
    seasonNumber: toNumber(values.season),
    episodeNumber: toNumber(values.episode),
    runtimeMinutes: toNumber(values.runtime),
  };
}

function configFromEnv(): IndexersConfig {
  const { HYDRACKER_API_KEY, HYDRACKER_HOST, HYDRACKER_CONTACT_EMAIL, LOADIX_API_HOST, LOADIX_SITE_HOST } = process.env;

  return {
    hydracker:
      HYDRACKER_API_KEY && HYDRACKER_HOST
        ? {
            apiKey: HYDRACKER_API_KEY,
            host: HYDRACKER_HOST,
            ...(HYDRACKER_CONTACT_EMAIL && { contactEmail: HYDRACKER_CONTACT_EMAIL }),
          }
        : null,
    loadix:
      LOADIX_API_HOST && LOADIX_SITE_HOST
        ? {
            apiHost: LOADIX_API_HOST,
            siteHost: LOADIX_SITE_HOST,
          }
        : null,
  };
}

async function main(): Promise<void> {
  const values = parseCliArgs();
  Logger.overrideLogger(values.verbose ? ['verbose', 'debug', 'log', 'warn', 'error'] : ['log', 'warn', 'error']);

  const media = buildMedia(values);
  const serviceName = process.env.SERVICE_NAME ?? 'crn-flix-dev-cli';
  const indexers = createIndexers(configFromEnv(), serviceName).filter(
    (indexer) => !values.indexer || indexer.name === values.indexer,
  );

  if (!indexers.length) {
    console.error(
      values.indexer ? `Indexer "${values.indexer}" is not configured` : 'No indexer configured (check your env)',
    );
    process.exit(1);
  }

  for (const indexer of indexers) {
    console.log(`\n▶ ${indexer.name} — ${media.title} (${media.imdbId}, ${media.type})`);
    const startedAt = Date.now();
    const candidates = await indexer.find(media, ALLOW_ALL_PREFERENCES);
    console.log(`  ${candidates.length} candidate(s) in ${Date.now() - startedAt}ms`);

    for (const candidate of candidates) {
      const eligible = passesPreferences(candidate, media, ALLOW_ALL_PREFERENCES);
      console.log(`  ${eligible ? '✔' : '✘'} ${JSON.stringify(candidate, null, 2)}`);
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
