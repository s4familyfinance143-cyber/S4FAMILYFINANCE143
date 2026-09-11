/** @type {import('jest').Config} */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  testMatch: ["**/__tests__/**/*.test.ts", "**/__tests__/**/*.test.js"],
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/src/$1",
  },
  globals: {
    "ts-jest": {
      diagnostics: false,
      tsconfig: {
        module: "commonjs",
        esModuleInterop: true,
        resolveJsonModule: true,
        allowSyntheticDefaultImports: true,
        types: ["jest", "node"],
      },
    },
  },
};
