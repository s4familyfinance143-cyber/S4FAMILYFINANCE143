describe("S4 Family Finance smoke", () => {
  beforeAll(async () => {
    await device.launchApp({
      newInstance: true,
      delete: false,
      launchArgs: { detoxEnableSynchronization: 0 },
    });
    await device.disableSynchronization();
  });

  it("shows the login surface", async () => {
    await waitFor(element(by.id("auth-screen")))
      .toBeVisible()
      .withTimeout(60000);
  });

  it("shows the login fields", async () => {
    await expect(element(by.id("auth-email"))).toBeVisible();
    await expect(element(by.id("auth-password"))).toBeVisible();
  });

  it("auth sign-in button is tappable", async () => {
    await waitFor(element(by.id("auth-sign-in")))
      .toBeVisible()
      .withTimeout(15000);
  });
});
