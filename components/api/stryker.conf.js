module.exports = {
  packageManager: 'pnpm',
  incrementalFile: 'reports/tests/stryker/incremental.json',
  reporters: ['html', 'progress','dashboard'],
  htmlReporter: { fileName: "reports/tests/stryker/index.html"},
  testRunner: 'jest',
  coverageAnalysis: 'perTest',
  disableTypeChecks: '**/*.ts',
  jest: {
    configFile: 'jest.config.js',
  },
  checkers: ['typescript'],
  tsconfigFile: 'tsconfig.json',
  incremental: true,
  ignoreStatic: true,
  cleanTempDir: 'always',
  mutate: [
    'src/**/*.ts',
    '!**/schemas/**',
    '!**/*.schemas.ts',
    '!src/local.ts',
  ],
};
