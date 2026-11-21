import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium, expect } from "@playwright/test";

const root = process.env.NEURVIA_URL || "http://127.0.0.1:3147";
const screenshots = fileURLToPath(
  new URL("../docs/screenshots/", import.meta.url),
);
const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined,
});
const runtimeErrors = [];

async function capture(page, name) {
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({
    path: screenshots + name + ".png",
    fullPage: true,
    animations: "disabled",
  });
}

async function checkWidth(page) {
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(page.viewportSize().width + 1);
}

async function signIn(page, role, remember = false) {
  await page.goto(root + "/login");
  await page
    .getByRole("button", {
      name: role === "teacher" ? "Professeur" : "Étudiant",
      exact: true,
    })
    .click();
  if (remember) await page.getByLabel("Se souvenir de moi").check();
  await page.getByRole("button", { name: "Se connecter", exact: true }).click();
  await expect(page).toHaveURL(root + "/" + role + "/dashboard");
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "Bonjour",
  );
}

async function signOut(page) {
  await page.getByRole("button", { name: "Mon compte" }).click();
  await page.getByRole("button", { name: "Se déconnecter" }).click();
  await expect(page).toHaveURL(root + "/login");
  await page.waitForLoadState("networkidle");
}

async function checkDestination(page, href) {
  await page.goto(new URL(href, root).href);
  await expect(page.locator("#contenu")).toBeVisible();
  await expect(page.locator("#contenu")).not.toContainText("Page introuvable");
  await expect(page.locator("#contenu")).not.toHaveText("");
}

async function checkDashboardLinks(page) {
  const hrefs = await page
    .locator("#contenu a[href], .nv-side a[href]")
    .evaluateAll((links) => [
      ...new Set(links.map((link) => link.getAttribute("href"))),
    ]);
  for (const href of hrefs) await checkDestination(page, href);
}

async function checkDialog(page, button) {
  console.log("Dialog", button);
  await page.getByRole("button", { name: button, exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
}

async function desktop() {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    locale: "fr-FR",
  });
  const page = await context.newPage();
  page.on("pageerror", (error) => runtimeErrors.push(error.message));
  await page.goto(root + "/teacher/dashboard");
  await expect(page).toHaveURL(root + "/login");
  await page.waitForLoadState("networkidle");
  await capture(page, "login");
  await checkWidth(page);
  await expect(
    page.getByRole("button", { name: "Professeur" }),
  ).toHaveAttribute("aria-pressed", "true");
  for (const button of [
    "Fonctionnalités",
    "Établissements",
    "Tarifs",
    "Aide et support",
    "Mot de passe oublié ?",
    "Continuer avec Google",
    "Continuer avec Microsoft",
    "Continuer avec mon établissement (SSO)",
    "À propos",
    "Conditions d’utilisation",
    "Politique de confidentialité",
    "Contact",
  ])
    await checkDialog(page, button);
  await page.getByLabel("Mot de passe", { exact: true }).fill("exemple");
  await page.getByRole("button", { name: "Afficher le mot de passe" }).click();
  await expect(
    page.getByLabel("Mot de passe", { exact: true }),
  ).toHaveAttribute("type", "text");
  await page.getByRole("button", { name: "Masquer le mot de passe" }).click();

  await signIn(page, "teacher", true);
  await capture(page, "teacher-dashboard");
  await checkWidth(page);
  await page.getByRole("button", { name: "Notifications" }).click();
  await expect(
    page
      .getByRole("link", { name: "Examiner les groupes", exact: false })
      .last(),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await checkDashboardLinks(page);
  await page.goto(root + "/teacher/classes");
  await expect(
    page.getByRole("heading", { name: "Mes classes" }),
  ).toBeVisible();
  await capture(page, "teacher-classes");
  await page
    .getByRole("textbox", { name: "Rechercher un identifiant" })
    .fill("A17");
  await expect(page.locator(".nd-roster a")).toHaveCount(1);
  await expect(page.locator(".nd-roster a")).toContainText("A17");
  await page
    .getByRole("combobox", { name: "Classe active" })
    .selectOption({ index: 1 });
  await expect(page.getByRole("heading", { name: /Étudiants/ })).toContainText(
    "Groupe B",
  );
  await page.reload();
  await expect(
    page.getByRole("combobox", { name: "Classe active" }),
  ).toHaveValue(/Groupe B/);
  await page.getByRole("button", { name: /Groupe A/ }).click();
  await expect(
    page.getByRole("combobox", { name: "Classe active" }),
  ).toHaveValue(/Groupe A/);
  await page.getByRole("link", { name: "Paramètres" }).click();
  await expect(page.getByRole("heading", { name: "Paramètres" })).toBeVisible();
  await capture(page, "teacher-settings");
  const motion = page.getByRole("checkbox", { name: /Réduire les animations/ });
  await motion.check();
  await page.reload();
  await expect(motion).toBeChecked();
  await motion.uncheck();
  const remembered = await context.newPage();
  await remembered.goto(root + "/teacher/dashboard");
  await expect(
    remembered.getByRole("heading", { name: /Mme Ben Salem/ }),
  ).toBeVisible();
  await remembered.close();
  await signOut(page);

  await signIn(page, "student");
  await capture(page, "student-dashboard");
  await checkWidth(page);
  await checkDashboardLinks(page);
  await page.goto(root + "/student/help");
  const questions = page.locator("summary");
  for (const question of await questions.all()) {
    await question.click();
    await expect(question.locator("..")).toHaveAttribute("open", "");
    await question.click();
  }
  await questions.first().click();
  await capture(page, "student-help");
  await page.goto(root + "/teacher/dashboard");
  await expect(page).toHaveURL(root + "/student/dashboard");
  await signOut(page);
  await context.close();
}

async function mobile() {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    locale: "fr-FR",
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  page.on("pageerror", (error) => runtimeErrors.push(error.message));
  await page.goto(root + "/login");
  await capture(page, "login-mobile");
  await checkWidth(page);
  await page.getByRole("button", { name: "Ouvrir le menu" }).click();
  await checkDialog(page, "Fonctionnalités");
  for (const role of ["teacher", "student"]) {
    await signIn(page, role);
    await capture(page, role + "-dashboard-mobile");
    await checkWidth(page);
    await page.getByRole("button", { name: "Ouvrir le menu" }).click();
    const label = role === "teacher" ? "Mes classes" : "Aide";
    await page.getByRole("link", { name: label, exact: true }).click();
    await expect(
      page.getByRole("heading", { name: label, exact: true }),
    ).toBeVisible();
    await checkWidth(page);
    await signOut(page);
  }
  await context.close();
}

try {
  await mkdir(screenshots, { recursive: true });
  await desktop();
  await mobile();
  expect(runtimeErrors).toEqual([]);
  console.log(
    "Navigation, authentification, fenêtres de dialogue et affichages mobiles vérifiés.",
  );
} finally {
  await browser.close();
}
