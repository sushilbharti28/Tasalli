/** Unit tests need nothing running. API tests need Postgres and Redis (see README). */
const tsJest = ['ts-jest', { isolatedModules: false }];
module.exports = {
  projects: [
    {
      displayName: 'unit',
      testMatch: ['<rootDir>/test/unit/**/*.spec.ts'],
      transform: { '^.+\\.ts$': tsJest },
      testEnvironment: 'node',
    },
    {
      displayName: 'api',
      testMatch: ['<rootDir>/test/api/**/*.spec.ts'],
      transform: { '^.+\\.ts$': tsJest },
      testEnvironment: 'node',
      globalSetup: '<rootDir>/test/api/global-setup.ts',
    },
  ],
};
