/**
 * Architecture checklist — filesystem assertions (no RN/Expo runtime).
 */
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..", "src");

function exists(rel) {
  return fs.existsSync(path.join(root, rel));
}

describe("architecture screens files", () => {
  test("all checklist screen files exist", () => {
    [
      "screens/AuthScreen.tsx",
      "screens/RegisterScreen.tsx",
      "screens/VerifyEmailScreen.tsx",
      "screens/ForgotPasswordScreen.tsx",
      "screens/DashboardScreen.tsx",
      "screens/IncomeScreen.tsx",
      "screens/ExpenseScreen.tsx",
      "screens/GroceryScreen.tsx",
      "screens/LoansScreen.tsx",
      "screens/BudgetScreen.tsx",
      "screens/ReportsScreen.tsx",
      "screens/SettingsScreen.tsx",
      "screens/ScreenShell.tsx",
    ].forEach((f) => expect(exists(f)).toBe(true));
  });
});

describe("architecture navigation files", () => {
  test("AuthStack MainTab DrawerNav RootNavigator exist", () => {
    [
      "navigation/AuthStack.tsx",
      "navigation/MainTab.tsx",
      "navigation/DrawerNav.tsx",
      "navigation/RootNavigator.tsx",
      "navigation/screenHosts.tsx",
      "app/rn-nav.tsx",
    ].forEach((f) => expect(exists(f)).toBe(true));
  });
});

describe("architecture hooks services assets", () => {
  test("useOffline + mlKit + assets + chart + fonts", () => {
    expect(exists("hooks/useOffline.ts")).toBe(true);
    expect(exists("services/mlKit.ts")).toBe(true);
    expect(exists("services/documentScanner.ts")).toBe(true);
    expect(exists("services/authService.ts")).toBe(true);
    expect(exists("assets/index.ts")).toBe(true);
    expect(exists("assets/icons/home.png")).toBe(true);
    expect(exists("assets/images/icon.png")).toBe(true);
    expect(exists("assets/fonts/README.md")).toBe(true);
    expect(exists("assets/fonts/NotoSans_400Regular.ttf")).toBe(true);
    expect(exists("assets/fonts/NotoSans_500Medium.ttf")).toBe(true);
    expect(exists("assets/fonts/NotoSans_700Bold.ttf")).toBe(true);
    expect(exists("assets/fonts/NotoSansBengali_400Regular.ttf")).toBe(true);
    expect(exists("theme/fonts.ts")).toBe(true);
    expect(exists("components/ui/Chart.tsx")).toBe(true);
  });
});

describe("architecture detox under __tests__", () => {
  test("e2e smoke + auth flow mirrored", () => {
    expect(fs.existsSync(path.join(__dirname, "e2e", "smoke.e2e.js"))).toBe(true);
    expect(fs.existsSync(path.join(__dirname, "e2e", "auth.e2e.js"))).toBe(true);
    expect(fs.existsSync(path.join(__dirname, "..", "e2e", "smoke.e2e.js"))).toBe(true);
    expect(fs.existsSync(path.join(__dirname, "..", "e2e", "auth.e2e.js"))).toBe(true);
  });
});

describe("architecture package checklist deps", () => {
  test("ml-kit packages declared", () => {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8")
    );
    expect(pkg.dependencies["@react-native-ml-kit/barcode-scanning"]).toBeTruthy();
    expect(pkg.dependencies["@react-native-ml-kit/text-recognition"]).toBeTruthy();
    expect(pkg.dependencies["react-hook-form"]).toBeTruthy();
    expect(pkg.dependencies.axios).toBeTruthy();
    expect(pkg.devDependencies.detox).toBeTruthy();
  });
});
