export default {
  testEnvironment: "jsdom",
  setupFilesAfterEnv: ["<rootDir>/tests/setup.js"],
  testMatch: ["<rootDir>/tests/**/*.test.js"],
  collectCoverageFrom: [
    "ext/**/*.js",
    "!ext/node_modules/**",
    "!**/node_modules/**",
    "!coverage/**"
  ],
  coverageDirectory: "coverage",
  coverageReporters: ["text", "lcov", "html"],
  moduleFileExtensions: ["js"],
  transform: {},
  testEnvironmentOptions: {
    url: "https://example.com"
  }
};