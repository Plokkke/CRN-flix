const sharedConfig = require('../jest.config.json');

module.exports = {
  ...sharedConfig,
  "rootDir": "..",
  coverageDirectory: '<rootDir>/reports/tests/unit/coverage',
  coveragePathIgnorePatterns: [...sharedConfig.coveragePathIgnorePatterns],
  testRegex: '\\.spec\\.ts$',
  testTimeout: 16,
};
