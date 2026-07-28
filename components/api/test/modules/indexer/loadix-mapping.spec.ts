import { mapHost, mapLanguage, mapQuality } from '@/modules/indexer/loadix/mapping';
import { Host, Language, Quality } from '@/modules/indexer/preferences';

describe('loadix mapping', () => {
  describe('mapQuality', () => {
    it.each([
      ['Blu-Ray 1080p', Quality.HD_1080P],
      ['Blu-Ray 1080p (x265)', Quality.HD_1080P],
      ['HDLight 1080p', Quality.HD_1080P],
      ['HDLight 1080p (x265)', Quality.HD_1080P],
      ['WEB 1080p (x265)', Quality.HD_1080P],
      ['WEB 720p', Quality.HD_720P],
      ['4K UHD', Quality.UHD_4K],
      ['REMUX 2160p', Quality.UHD_4K],
      ['DVDRIP', Quality.SD],
    ])('maps "%s" from the quality label alone', (raw, expected) => {
      expect(mapQuality(raw, null)).toBe(expected);
    });

    it('falls back to the release filename when the label has no resolution', () => {
      expect(mapQuality('REMUX BLURAY', 'Taxi.1998.FRENCH.1080p.BluRay.REMUX.AVC-A.H.mkv')).toBe(Quality.HD_1080P);
    });

    it('prefers the label resolution over the filename', () => {
      expect(mapQuality('WEB 720p', 'Show.S01E01.1080p.mkv')).toBe(Quality.HD_720P);
    });

    it('returns unknown when no resolution is found anywhere', () => {
      expect(mapQuality('REMUX BLURAY', null)).toBe(Quality.UNKNOWN);
      expect(mapQuality('REMUX BLURAY', 'no-resolution-here.mkv')).toBe(Quality.UNKNOWN);
    });
  });

  describe('mapLanguage', () => {
    it.each([
      ['VFF', Language.TRUEFRENCH],
      ['TRUEFRENCH', Language.TRUEFRENCH],
      ['MULTi VFF', Language.MULTI],
      ['MULTI', Language.MULTI],
      ['VOSTFR', Language.VOSTFR],
      ['VFQ', Language.FRENCH],
      ['FRENCH', Language.FRENCH],
      ['VF', Language.FRENCH],
      ['VO', Language.ENGLISH],
      ['ENGLISH', Language.ENGLISH],
      ['KLINGON', Language.UNKNOWN],
    ])('maps "%s"', (raw, expected) => {
      expect(mapLanguage(raw)).toBe(expected);
    });
  });

  describe('mapHost', () => {
    it('maps 1fichier regardless of case', () => {
      expect(mapHost('1fichier')).toBe(Host.ONE_FICHIER);
      expect(mapHost('1Fichier')).toBe(Host.ONE_FICHIER);
    });

    it('maps unknown providers to unknown', () => {
      expect(mapHost('rapidgator')).toBe(Host.UNKNOWN);
    });
  });
});
