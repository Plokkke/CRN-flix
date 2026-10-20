import { Logger } from '@nestjs/common';

import { setPluginLoggerFactory } from '@crn-flix/contracts';

/** Plugin logs go through Nest's logger, hence through the engine's own transport. */
export function routePluginLogsToNest(): void {
  setPluginLoggerFactory((context) => new Logger(context));
}
