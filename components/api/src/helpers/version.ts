/** The deployed version (the image's APP_VERSION), `dev` when run from the sources. */
export const appVersion = (): string => process.env.APP_VERSION ?? 'dev';
