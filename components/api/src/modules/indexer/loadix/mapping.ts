import { Host, Language, Quality } from '@/modules/indexer/preferences';

/**
 * Explicit mapping of Loadix's closed label taxonomy onto the contract enums.
 * The label is the single source of truth (a "CAM" happily claims 1080p in its
 * filename); any label absent from these tables maps to UNKNOWN.
 *
 * Labels keep the site's exact casing for readability; lookups are case-insensitive.
 */

const QUALITY_LABELS: [string, Quality][] = [
  // Theater rips and screeners: worthless whatever they claim.
  ['CAM', Quality.UNKNOWN],
  ['TS', Quality.UNKNOWN],
  ['TC', Quality.UNKNOWN],
  ['DVDSCR', Quality.UNKNOWN],
  ['R5', Quality.UNKNOWN],
  // MD/LD variants: audio recorded over another source.
  ['DVDRIP MD', Quality.UNKNOWN],
  ['DVDRIP LD', Quality.UNKNOWN],
  ['HDRiP MD', Quality.UNKNOWN],
  ['BDRIP MD', Quality.UNKNOWN],
  ['BDRIP LD', Quality.UNKNOWN],
  ['BRRIP MD', Quality.UNKNOWN],
  ['BRRIP LD', Quality.UNKNOWN],
  // SD sources.
  ['DVDRIP', Quality.SD],
  ['DVDRIP MKV', Quality.SD],
  ['DVD-R', Quality.SD],
  ['Full-DVD', Quality.SD],
  ['TVrip', Quality.SD],
  ['REMUX DVD', Quality.SD],
  // 720p.
  ['HDTV 720p', Quality.HD_720P],
  ['HD 720p', Quality.HD_720P],
  ['WEB 720p', Quality.HD_720P],
  ['HDLight 720p', Quality.HD_720P],
  ['Blu-Ray 720p', Quality.HD_720P],
  // 1080p. A Blu-Ray remux is 1080p by definition (4K remuxes are "REMUX UHD").
  ['HDTV 1080p', Quality.HD_1080P],
  ['HD 1080p', Quality.HD_1080P],
  ['WEB 1080p', Quality.HD_1080P],
  ['WEB 1080p (x265)', Quality.HD_1080P],
  ['WEB 1080p Light', Quality.HD_1080P],
  ['HDLight 1080p', Quality.HD_1080P],
  ['HDLight 1080p (x265)', Quality.HD_1080P],
  ['Blu-Ray 1080p', Quality.HD_1080P],
  ['Blu-Ray 1080p (x265)', Quality.HD_1080P],
  ['REMUX BLURAY', Quality.HD_1080P],
  // 4K.
  ['Ultra HDLight (x265)', Quality.UHD_4K],
  ['ULTRA HD (x265)', Quality.UHD_4K],
  ['4K', Quality.UHD_4K],
  ['UHD', Quality.UHD_4K],
  ['4K HDR', Quality.UHD_4K],
  ['REMUX UHD', Quality.UHD_4K],
  // Resolution-less or unwanted labels.
  ['HDTV', Quality.UNKNOWN],
  ['HDRip', Quality.UNKNOWN],
  ['WEB', Quality.UNKNOWN],
  ['WEBRIP', Quality.UNKNOWN],
  ['WEB-DL', Quality.UNKNOWN],
  ['BDRIP', Quality.UNKNOWN],
  ['BRRIP', Quality.UNKNOWN],
  ['Blu-Ray 3D', Quality.UNKNOWN],
  ['Autre', Quality.UNKNOWN],
];

const LANGUAGE_LABELS: [string, Language][] = [
  ['MULTI', Language.MULTI],
  ['MULTi VFF', Language.MULTI],
  ['MULTi VF2', Language.MULTI],
  ['MULTi VFQ', Language.MULTI],
  ['MULTi TRUEFRENCH', Language.MULTI],
  ['MULTi VOA', Language.MULTI],
  ['VFF', Language.TRUEFRENCH],
  ['TRUEFRENCH', Language.TRUEFRENCH],
  ['VFF+VOSTFR', Language.TRUEFRENCH],
  ['VFF+VOA', Language.TRUEFRENCH],
  ['VFQ', Language.FRENCH],
  ['VFI', Language.FRENCH],
  ['VFB', Language.FRENCH],
  ['French', Language.FRENCH],
  ['French (Canada)', Language.FRENCH],
  ['VOSTFR', Language.VOSTFR],
  ['VOSTFR HC', Language.VOSTFR],
  ['VOSTFR HD', Language.VOSTFR],
  ['VOST', Language.VOSTFR],
  ['VO', Language.ENGLISH],
  ['VOA', Language.ENGLISH],
  ['English', Language.ENGLISH],
  // Everything else (Spanish, Japanese, …) falls through to UNKNOWN.
];

const PROVIDER_LABELS: [string, Host][] = [['1fichier', Host.ONE_FICHIER]];

const qualityByLabel = new Map(QUALITY_LABELS.map(([label, quality]) => [label.toLowerCase(), quality]));
const languageByLabel = new Map(LANGUAGE_LABELS.map(([label, language]) => [label.toLowerCase(), language]));
const hostByProvider = new Map(PROVIDER_LABELS.map(([label, host]) => [label.toLowerCase(), host]));

export function mapQuality(label: string): Quality {
  return qualityByLabel.get(label.toLowerCase()) ?? Quality.UNKNOWN;
}

export function mapLanguage(label: string): Language {
  return languageByLabel.get(label.toLowerCase()) ?? Language.UNKNOWN;
}

export function mapHost(provider: string): Host {
  return hostByProvider.get(provider.toLowerCase()) ?? Host.UNKNOWN;
}
