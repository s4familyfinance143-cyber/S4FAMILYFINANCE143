describe("S4 auth navigation surface", () => {
  beforeAll(async () => {
    await device.launchApp({
      newInstance: true,
      delete: false,
      launchArgs: { detoxEnableSynchronization: 0 },
    });
    await device.disableSynchronization();
  });

  it("shows the auth screen on cold start", async () => {
    await waitFor(element(by.id("auth-screen")))
      .toBeVisible()
      .withTimeout(60000);
  });

  it("exposes email and password fields for login", async () => {
    await expect(element(by.id("auth-email"))).toBeVisible();
    await expect(element(by.id("auth-password"))).toBeVisible();
    await expect(element(by.id("auth-sign-in"))).toBeVisible();
  });
});
