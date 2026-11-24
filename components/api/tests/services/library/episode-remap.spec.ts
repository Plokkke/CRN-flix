import {
  claims,
  EpisodeFile,
  parseEpisodeTag,
  remapProblems,
  seasonOf,
  sideFilesOf,
  sideFileTarget,
  twoPhase,
} from '@/services/library/episode-remap';

const file = (relativePath: string): EpisodeFile => ({
  relativePath,
  tag: parseEpisodeTag(relativePath.split('/').pop()!),
});

describe('episode remap', () => {
  it('reads single and double episode tags, whatever the separators', () => {
    expect(parseEpisodeTag('Bluey.S01E03.mkv')).toEqual({ season: 1, start: 3, end: 3 });
    expect(parseEpisodeTag('Bluey.S01E03-E04.mkv')).toEqual({ season: 1, start: 3, end: 4 });
    expect(parseEpisodeTag('paw.patrol.s02e05e06.french.mkv')).toEqual({ season: 2, start: 5, end: 6 });
    expect(parseEpisodeTag('Bluey.S01E03.Episode.mkv')).toEqual({ season: 1, start: 3, end: 3 });
    expect(parseEpisodeTag('Bluey - Le xylophone.mkv')).toBeNull();
  });

  it('takes the season from the tag, else from the season folder', () => {
    expect(seasonOf(file('Bluey/Season01/Bluey.S02E01.mkv'))).toBe(2);
    expect(seasonOf(file('Bluey/Season 3/episode.mkv'))).toBe(3);
    expect(seasonOf(file('Bluey/episode.mkv'))).toBeNull();
  });

  it('lets assignments override tags, and a file left out keep its own episodes', () => {
    const files = [file('B/S01/B.S01E01-E02.mkv'), file('B/S01/B.S01E03-E04.mkv')];

    const held = claims(files, [{ relativePath: 'B/S01/B.S01E01-E02.mkv', season: 1, start: 4, end: 5 }]);

    expect(held.get('S01E01')).toBeUndefined();
    expect(held.get('S01E04')).toEqual(['B/S01/B.S01E01-E02.mkv', 'B/S01/B.S01E03-E04.mkv']);
  });

  it('checks conflicts in the season a file moves to', () => {
    const files = [file('P/Season08/P.S08E02-E03.mkv'), file('P/Season07/P.S07E40.mkv')];

    expect(
      remapProblems(files, [{ relativePath: 'P/Season08/P.S08E02-E03.mkv', season: 7, start: 40, end: 41 }]),
    ).toEqual(['S07E40 revendiqué par 2 fichiers']);
    expect(
      remapProblems(files, [{ relativePath: 'P/Season08/P.S08E02-E03.mkv', season: 7, start: 41, end: 42 }]),
    ).toEqual([]);
  });

  it('refuses conflicts, invalid ranges and files it does not know', () => {
    const files = [file('B/S01/B.S01E01-E02.mkv'), file('B/S01/B.S01E03-E04.mkv'), file('B/S01/B.S01E05.mkv')];

    expect(
      remapProblems(files, [
        { relativePath: 'B/S01/B.S01E01-E02.mkv', season: 1, start: 3, end: 4 },
        { relativePath: 'B/S01/B.S01E05.mkv', season: 1, start: 2, end: 1 },
        { relativePath: '../../etc/passwd', season: 1, start: 1, end: 1 },
      ]),
    ).toEqual([
      'Fichier inconnu : ../../etc/passwd',
      'Saison ou épisodes invalides pour B.S01E05.mkv',
      'S01E03 revendiqué par 2 fichiers',
      'S01E04 revendiqué par 2 fichiers',
    ]);
  });

  it('accepts a swap of two files', () => {
    const files = [file('B/S01/B.S01E01-E02.mkv'), file('B/S01/B.S01E03-E04.mkv')];

    expect(
      remapProblems(files, [
        { relativePath: 'B/S01/B.S01E01-E02.mkv', season: 1, start: 3, end: 4 },
        { relativePath: 'B/S01/B.S01E03-E04.mkv', season: 1, start: 1, end: 2 },
      ]),
    ).toEqual([]);
  });

  it('gives each side file to the longest video name it starts with', () => {
    const siblings = ['A.mkv', 'A.fr.srt', 'A.nfo', 'A.part2.mkv', 'A.part2.srt', 'B.srt'];

    expect(sideFilesOf('A.mkv', siblings)).toEqual(['A.fr.srt', 'A.nfo']);
    expect(sideFilesOf('A.part2.mkv', siblings)).toEqual(['A.part2.srt']);
    expect(sideFileTarget({ from: '/s/A.mkv', to: '/s/Season01/B.S01E03.mkv' }, 'A.fr.srt')).toBe(
      '/s/Season01/B.S01E03.fr.srt',
    );
  });

  it('parks every file before moving any to its final name', () => {
    const phases = twoPhase(
      [
        { from: 'a', to: 'b' },
        { from: 'b', to: 'a' },
      ],
      (move) => `tmp-${move.from}`,
    );

    expect(phases).toEqual([
      [
        { from: 'a', to: 'tmp-a' },
        { from: 'b', to: 'tmp-b' },
      ],
      [
        { from: 'tmp-a', to: 'b' },
        { from: 'tmp-b', to: 'a' },
      ],
    ]);
  });
});
