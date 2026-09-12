#!/usr/bin/env node
/**
 * Standalone indexer harness: runs any registered indexer against a media
 * description, without booting Nest, the database or Discord.
 *
 *   npm run indexer:find -- --imdb tt0133093 --title "The Matrix" --year 1999
 *   npm run indexer:find -- --imdb tt14688458 --title "Silo" --type show --episodes "1:1-10,2:1-6" --runtime 50
 */
import { parseArgs } from 'node:util';

import { Logger } from '@nestjs/common';

import { assessCandidate, IndexerBookmark, IndexerShowEpisode, IndexerTarget, MediaType } from './contract';
import { preferencesFromEnv } from './preferences';
import { createIndexers, IndexersConfig } from './registry';

const USAGE = `Usage: npm run indexer:find -- [indexer] --imdb <tt...> --title <title> [options]

Note: the "--" after indexer:find is required, otherwise npm swallows the arguments.

Arguments:
  [indexer]                Only run this indexer, e.g. "loadix" (default: all configured)

Options:
  --imdb <id>              IMDB id (required)
  --title <title>          Title (required)
  --type <movie|show>      Target type (default: movie)
  --original-title <t>     Original title
  --year <n>               Release year
  --episodes <spec>        Show only: episode intent, e.g. "1:1-10,2:1-6" (season:from-to)
  --runtime <n>            Runtime in minutes (per episode for shows)
  --indexer <name>         Same as the [indexer] positional argument
  --bookmark <json>        Bookmark handed to the indexer, as printed by a previous run
  --verbose                Show HTTP request/response debug logs`;

function parseCliArgs() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      imdb: { type: 'string' },
      title: { type: 'string' },
      type: { type: 'string', default: 'movie' },
      'original-title': { type: 'string' },
      year: { type: 'string' },
      episodes: { type: 'string' },
      runtime: { type: 'string' },
      indexer: { type: 'string' },
      bookmark: { type: 'string' },
      verbose: { type: 'boolean', default: false },
    },
  });

  return { ...values, indexer: values.indexer ?? positionals[0] };
}

type CliValues = ReturnType<typeof parseCliArgs>;

function toNumber(value: string | undefined): number | null {
  return value === undefined ? null : Number(value);
}

/** "1:1-10,2:1-6" → one entry per episode; a bare "1:4" means the single episode S1E4. */
function parseEpisodesSpec(spec: string, runtimeMinutes: number | null): IndexerShowEpisode[] {
  return spec.split(',').flatMap((part) => {
    const match = part.trim().match(/^(\d+):(\d+)(?:-(\d+))?$/);
    if (!match) {
      console.error(`Invalid --episodes segment "${part}", expected "season:from-to"`);
      process.exit(1);
    }
    const season = Number(match[1]);
    const from = Number(match[2]);
    const to = Number(match[3] ?? match[2]);
    return Array.from({ length: to - from + 1 }, (_, i) => ({ season, episode: from + i, runtimeMinutes }));
  });
}

function buildTarget(values: CliValues): IndexerTarget {
  if (!values.imdb || !values.title) {
    console.error(USAGE);
    process.exit(1);
  }

  if (values.type === 'show') {
    if (!values.episodes) {
      console.error('--episodes is required for --type show');
      process.exit(1);
    }
    return {
      kind: 'show',
      imdbId: values.imdb,
      title: values.title,
      originalTitle: values['original-title'] ?? null,
      year: toNumber(values.year),
      episodes: parseEpisodesSpec(values.episodes, toNumber(values.runtime)),
    };
  }

  if (values.type !== 'movie') {
    console.error(`Invalid --type "${values.type}", expected: movie | show`);
    process.exit(1);
  }

  return {
    kind: 'movie',
    media: {
      imdbId: values.imdb,
      type: MediaType.Movie,
      title: values.title,
      originalTitle: values['original-title'] ?? null,
      year: toNumber(values.year),
      seasonNumber: null,
      episodeNumber: null,
      runtimeMinutes: toNumber(values.runtime),
    },
  };
}

function parseBookmark(json: string | undefined): IndexerBookmark | null {
  if (!json) {
    return null;
  }
  const parsed: unknown = JSON.parse(json);
  if (typeof parsed !== 'object' || parsed === null || !('state' in parsed)) {
    console.error('--bookmark must be a JSON object with pageUrl, searchUrl and state');
    process.exit(1);
  }
  return parsed as IndexerBookmark;
}

function configFromEnv(): IndexersConfig {
  const { LOADIX_API_HOST, LOADIX_SITE_HOST } = process.env;

  return {
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

  const target = buildTarget(values);
  const bookmark = parseBookmark(values.bookmark);
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

  const prefs = preferencesFromEnv(process.env);
  console.log(`Preferences (from INDEXER_* env, empty = allow all): ${JSON.stringify(prefs)}`);

  const label =
    target.kind === 'movie'
      ? `${target.media.title} (${target.media.imdbId}, movie)`
      : `${target.title} (${target.imdbId}, show, ${target.episodes.length} episode(s))`;

  for (const indexer of indexers) {
    console.log(`\n▶ ${indexer.name} — ${label}`);
    const startedAt = Date.now();
    const result = await indexer.find(target, prefs, bookmark);
    const { candidates } = result;
    console.log(`  ${candidates.length} candidate(s) in ${Date.now() - startedAt}ms`);
    console.log(`  bookmark: ${JSON.stringify(result.bookmark)}`);

    for (const candidate of candidates) {
      const reasons = assessCandidate(candidate, target, prefs);
      const verdict = reasons.length === 0 ? '✔' : `✘ ${reasons.join(', ')}`;
      console.log(`  ${verdict} ${JSON.stringify(candidate, null, 2)}`);
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
