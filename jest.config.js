/** Jest config — ts-jest, unit tests live next to source as `*.spec.ts` (TDD §3). */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testRegex: '.*\\.spec\\.ts$',
  moduleFileExtensions: ['ts', 'js', 'json'],
  collectCoverageFrom: ['**/*.ts', '!**/*.module.ts', '!**/main.ts'],
};
