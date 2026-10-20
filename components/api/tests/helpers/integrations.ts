import { IntegrationTracker } from '@/services/integrations/monitor';

/** Runs the tracked call and reports nothing. */
export const UNTRACKED: IntegrationTracker = { track: (_integration, _operation, run) => run() };
