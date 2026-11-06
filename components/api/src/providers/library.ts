import { Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { Player } from '@crn-flix/contracts';

import { Config } from '@/app.module';
import { PLAYER } from '@/providers/player';
import { LibraryTitlesRepository } from '@/services/database/library';
import { LibraryPaths } from '@/services/library/paths';
import { LibraryShelves, STANDARD_ONLY } from '@/services/library/shelves';

export const libraryProviders: Provider[] = [
  {
    provide: LibraryPaths,
    inject: [ConfigService],
    useFactory: (configService: ConfigService<Config, true>): LibraryPaths =>
      new LibraryPaths(configService.get('library')),
  },
  {
    provide: LibraryShelves,
    inject: [LibraryPaths, LibraryTitlesRepository, PLAYER],
    useFactory: (paths: LibraryPaths, titles: LibraryTitlesRepository, player: Player): LibraryShelves =>
      new LibraryShelves(paths, titles, STANDARD_ONLY, player),
  },
];
