import { createLogger, PluginLogger, setPluginLoggerFactory } from '../src';

function recorder(lines: string[]): (context: string) => PluginLogger {
  return (context) => ({
    debug: (message) => lines.push(`debug ${context} ${message}`),
    log: (message) => lines.push(`log ${context} ${message}`),
    warn: (message) => lines.push(`warn ${context} ${message}`),
    error: (message) => lines.push(`error ${context} ${message}`),
  });
}

describe('createLogger', () => {
  it('writes through the factory installed after the logger was created', () => {
    const logger = createLogger('Plugin');
    const lines: string[] = [];
    setPluginLoggerFactory(recorder(lines));

    logger.log('hello');
    logger.error('boom');

    expect(lines).toEqual(['log Plugin hello', 'error Plugin boom']);
  });

  it('follows a factory replaced later on', () => {
    const logger = createLogger('Plugin');
    const first: string[] = [];
    const second: string[] = [];
    setPluginLoggerFactory(recorder(first));
    logger.warn('a');
    setPluginLoggerFactory(recorder(second));
    logger.warn('b');

    expect(first).toEqual(['warn Plugin a']);
    expect(second).toEqual(['warn Plugin b']);
  });
});
