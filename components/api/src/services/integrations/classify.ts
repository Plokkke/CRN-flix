/**
 * Statuses meaning the integration no longer accepts what we send it: its API changed.
 * 401 (one account's credentials) and 404 (one missing resource) are not about the API.
 */
const INCOMPATIBLE_STATUSES = new Set([400, 403, 405, 410, 415, 422]);

const statusOf = (error: object): number | undefined => {
  const response = (error as { response?: { status?: unknown } }).response;
  return typeof response?.status === 'number' ? response.status : undefined;
};

/**
 * An integration that is merely down (network, timeout, 5xx, 429) needs nobody; one whose
 * answers no longer match our schemas, or that rejects our requests, needs the admin.
 */
export function isIncompatibilityError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  // Compared by name: each plugin may bundle its own copy of zod.
  if (error.name === 'ZodError') {
    return true;
  }
  const status = statusOf(error);
  return status !== undefined && INCOMPATIBLE_STATUSES.has(status);
}
