import { InternalAxiosRequestConfig } from 'axios';

import { PluginLogger } from '@crn-flix/contracts';

import { logAxiosRequest, redactUrl } from '../src/axios-logger';

describe('redactUrl', () => {
  it('hides credentials passed in the query string and keeps the rest readable', () => {
    expect(redactUrl('https://api.test/3/search/tv?api_key=abc123&language=fr-FR&query=Troie')).toBe(
      'https://api.test/3/search/tv?api_key=***&language=fr-FR&query=Troie',
    );
    expect(redactUrl('https://x.test/a?token=t0k&apikey=k&client_secret=s#frag')).toBe(
      'https://x.test/a?token=***&apikey=***&client_secret=***#frag',
    );
  });

  it('leaves urls without credentials untouched', () => {
    expect(redactUrl('https://api.trakt.tv/shows/199379?extended=full')).toBe(
      'https://api.trakt.tv/shows/199379?extended=full',
    );
  });
});

describe('logAxiosRequest', () => {
  it('never logs an api key passed as a request parameter', () => {
    const logger = { debug: jest.fn() } as unknown as PluginLogger;

    logAxiosRequest(logger, {
      method: 'get',
      baseURL: 'https://api.themoviedb.org',
      url: '/3/search/tv',
      params: { api_key: 'secret-value', language: 'fr-FR' },
    } as InternalAxiosRequestConfig);

    expect(jest.mocked(logger.debug).mock.calls[0][0]).toBe(
      '→ GET https://api.themoviedb.org/3/search/tv?api_key=***&language=fr-FR',
    );
  });
});
