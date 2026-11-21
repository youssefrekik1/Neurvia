import { chromium, expect as baseExpect } from "@playwright/test";
const expect = baseExpect.configure({ timeout: 20000 });

const root = process.env.NEURVIA_URL ?? "http://127.0.0.1:3147";
const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE });
const errors = [];
try {
  for (const [role, email, paths] of [
    ["teacher", "prof.fahm@example.com", ["dashboard", "classes", "lessons", "bank", "mindmirror", "groups", "settings"]],
    ["student", "eleve2.fahm@example.com", ["dashboard", "classes", "tasks", "courses", "progress", "help"]],
  ]) {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(root + "/login");
    await page.getByLabel("Adresse e-mail").fill(email);
    await page.getByLabel("Mot de passe", { exact: true }).fill("FAHM-demo-2026");
    await page.getByRole("button", { name: "Se connecter", exact: true }).click();
    await expect(page).toHaveURL(new RegExp("/" + role + "/dashboard$"));
    for (const route of paths) {
      await page.goto(root + "/" + role + "/" + route);
      await expect(page.locator("#contenu h1")).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth), route).toBeLessThanOrEqual(391);
    }
    await page.close();
  }
  expect(errors).toEqual([]);
  console.log("Authenticated teacher and student navigation passed at mobile width.");
} finally {
  await browser.close();
}
