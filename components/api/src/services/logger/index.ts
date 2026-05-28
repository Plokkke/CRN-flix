import chalk from 'chalk';
import { TransformableInfo } from 'logform';
import * as winston from 'winston';

const levelColors: Record<string, typeof chalk> = {
  error: chalk.red,
  warn: chalk.hex('#FFB020'),
  info: chalk.green,
  debug: chalk.blue,
};

const colorizedLine = winston.format.printf((infos: TransformableInfo) => {
  const levelColor = levelColors[infos.level] || chalk.white;

  const colorizedTimestamp = chalk.cyan(infos.timestamp);
  const colorizedMs = chalk.yellow((infos.ms as string).padStart(7));
  const colorizedLevel = levelColor.bold(infos.level.toUpperCase().padStart(5));

  let logLine = `${colorizedTimestamp} ${colorizedMs} ${colorizedLevel}: `;

  if (infos.context) {
    logLine += chalk.magenta(`[${infos.context}] `);
  }

  logLine += levelColor(infos.message as string);

  if (infos.meta && Object.keys(infos.meta).length > 0) {
    logLine += ` ${chalk.gray(JSON.stringify(infos.meta))}`;
  }

  return logLine;
});

const level = process.env.LOG_LEVEL ?? (process.env.NODE_ENV === 'production' ? 'info' : 'debug');

const format = winston.format.combine(winston.format.timestamp(), winston.format.ms(), colorizedLine);

const consoleTransport = new winston.transports.Console();

export const logger = winston.createLogger({
  level,
  format,
  transports: [consoleTransport],
});

logger.info(`Use log level: ${level}`);
