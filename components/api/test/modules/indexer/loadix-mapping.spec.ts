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
      ['WEB 1080p Light', Quality.HD_1080P],
      ['HDTV 1080p', Quality.HD_1080P],
      ['HD 1080p', Quality.HD_1080P],
      ['REMUX BLURAY', Quality.HD_1080P],
      ['WEB 720p', Quality.HD_720P],
      ['HDLight 720p', Quality.HD_720P],
      ['Blu-Ray 720p', Quality.HD_720P],
      ['4K', Quality.UHD_4K],
      ['4K HDR', Quality.UHD_4K],
      ['UHD', Quality.UHD_4K],
      ['ULTRA HD (x265)', Quality.UHD_4K],
      ['Ultra HDLight (x265)', Quality.UHD_4K],
      ['REMUX UHD', Quality.UHD_4K],
      ['DVDRIP', Quality.SD],
      ['DVDRIP MKV', Quality.SD],
      ['DVD-R', Quality.SD],
      ['Full-DVD', Quality.SD],
      ['TVrip', Quality.SD],
      ['REMUX DVD', Quality.SD],
    ])('maps "%s"', (raw, expected) => {
      expect(mapQuality(raw)).toBe(expected);
    });

    it.each([
      ['CAM'],
      ['TS'],
      ['TC'],
      ['DVDSCR'],
      ['R5'],
      ['DVDRIP MD'],
      ['BDRIP LD'],
      ['HDRiP MD'],
      ['BRRIP MD'],
      ['WEB'],
      ['WEBRIP'],
      ['WEB-DL'],
      ['HDRip'],
      ['HDTV'],
      ['BDRIP'],
      ['BRRIP'],
      ['Autre'],
    ])('maps junk or resolution-less label "%s" to unknown', (raw) => {
      expect(mapQuality(raw)).toBe(Quality.UNKNOWN);
    });
  });

  describe('mapLanguage', () => {
    it.each([
      ['VFF', Language.TRUEFRENCH],
      ['TRUEFRENCH', Language.TRUEFRENCH],
      ['VFF+VOSTFR', Language.TRUEFRENCH],
      ['VFF+VOA', Language.TRUEFRENCH],
      ['MULTi VFF', Language.MULTI],
      ['MULTi TRUEFRENCH', Language.MULTI],
      ['MULTi VOA', Language.MULTI],
      ['MULTI', Language.MULTI],
      ['VOSTFR', Language.VOSTFR],
      ['VOSTFR HC', Language.VOSTFR],
      ['VOSTFR HD', Language.VOSTFR],
      ['VOST', Language.VOSTFR],
      ['VFQ', Language.FRENCH],
      ['VFI', Language.FRENCH],
      ['VFB', Language.FRENCH],
      ['French', Language.FRENCH],
      ['French (Canada)', Language.FRENCH],
      ['VO', Language.ENGLISH],
      ['VOA', Language.ENGLISH],
      ['English', Language.ENGLISH],
      ['Spanish', Language.UNKNOWN],
      ['Japanese', Language.UNKNOWN],
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
