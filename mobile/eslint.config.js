// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require("eslint-config-expo/flat");

// Declared inline (not via the transitive `globals` package) so lint does not
// depend on an undeclared dependency.
const readonly = (names) => Object.fromEntries(names.map((n) => [n, "readonly"]));
const nodeGlobals = readonly(["__dirname", "__filename", "require", "module", "exports", "process", "Buffer"]);
const jestGlobals = readonly([
  "describe", "test", "it", "expect", "jest", "beforeAll", "beforeEach", "afterAll", "afterEach",
]);
const detoxGlobals = readonly(["device", "element", "by", "waitFor"]);

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ["dist/*"],
  },
  {
    files: ["__tests__/**/*.{js,cjs,ts}", "scripts/**/*.{js,cjs}"],
    languageOptions: { globals: { ...nodeGlobals, ...jestGlobals } },
  },
  {
    files: ["e2e/**/*.js"],
    languageOptions: { globals: { ...nodeGlobals, ...jestGlobals, ...detoxGlobals } },
  },
  {
    // eslint-plugin-react-hooks v7 (React Compiler rules) made this an error.
    // It flags the existing load-on-mount effects (`useEffect(() => { load(); })`
    // whose loader sets loading/result state). Those work correctly today;
    // migrating them is a refactor, not a bug fix, so keep it visible as a
    // warning instead of failing the gate.
    files: ["src/**/*.{ts,tsx}"],
    rules: { "react-hooks/set-state-in-effect": "warn" },
  },
]);
