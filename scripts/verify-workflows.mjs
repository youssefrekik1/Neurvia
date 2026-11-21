import { chromium, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";
const root = process.env.NEURVIA_URL || "http://127.0.0.1:3147";
const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
});
const page = await context.newPage();
page.setDefaultTimeout(10000);
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
async function visit(path) {
  await page.goto(root + path);
  await page.locator("#contenu").waitFor();
  await page.waitForLoadState("networkidle");
}
async function capture(name) {
  await page.screenshot({
    path: "docs/screenshots/" + name + ".png",
    fullPage: true,
  });
}
try {
  await mkdir("docs/screenshots", { recursive: true });
  await page.goto(root + "/login");
  await page.evaluate(() =>
    sessionStorage.setItem("neurvia.demo.role", "teacher"),
  );
  await visit("/teacher/lessons");
  await capture("teacher-lessons");
  await visit("/teacher/lessons/new");
  await capture("lesson-editor");
  await visit("/teacher/quiz");
  await capture("quiz-editor");
  await visit("/teacher/lessons/new");
  await page.getByLabel("Titre de la séance").fill("TD de démonstration");
  await page.getByLabel("Notions principales").fill("Bornes des boucles");
  await page
    .getByLabel("Contenu du cours")
    .fill("range commence à la première borne et exclut la dernière.");
  await page
    .getByRole("button", { name: "Préparer le quiz", exact: true })
    .click();
  await page.waitForLoadState("networkidle");
  await page.getByLabel("Nombre de questions").selectOption("3");
  await page
    .getByRole("button", { name: "Préparer le quiz", exact: true })
    .click();
  await page.waitForLoadState("networkidle");
  await page
    .getByRole("button", { name: "Valider et publier", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Valider et publier", exact: true }),
  ).toBeDisabled();
  await page.getByRole("checkbox").check();
  await page
    .getByRole("button", { name: "Valider et publier", exact: true })
    .click();
  await expect(page).toHaveURL(/published=1/);
  await page.waitForLoadState("networkidle");
  await capture("lesson-published");
  await visit("/teacher/groups");
  await page.locator(".mm-group-trigger").first().click();
  await page
    .getByRole("button", { name: "Accepter", exact: true })
    .first()
    .click();
  await page
    .getByRole("button", { name: "Valider le plan", exact: true })
    .first()
    .click();
  await capture("groups");
  await visit("/teacher/dashboard");
  await expect(page.locator(".nd-kpis")).toContainText("2");
  await visit("/teacher/mindmirror");
  await capture("mindmirror");
  await page.getByRole("button", { name: /Étudiant A03,/ }).click();
  await expect(page.locator(".mm-panel")).toContainText("A03");
  await page.getByRole("button", { name: /Zoom avant/ }).click();
  await capture("mindmirror-selected");
  await page.setViewportSize({ width: 390, height: 844 });
  await capture("mindmirror-mobile");
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(391);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.evaluate(() =>
    sessionStorage.setItem("neurvia.demo.role", "student"),
  );
  for (const path of ["tasks", "courses", "progress"]) {
    await visit("/student/" + path);
    await capture("student-" + path);
  }
  await visit("/student/quiz?lesson=boucles-indices");
  await capture("student-quiz");
  for (let i = 0; i < 6; i++) {
    await page.locator(".lr-option.interactive").first().click();
    await page.locator(".lr-confidence label").first().click();
    await page
      .getByRole("button", {
        name: i === 5 ? "Terminer" : "Suivant",
        exact: true,
      })
      .click();
  }
  await expect(page).toHaveURL(/result=/);
  await page.waitForLoadState("networkidle");
  await capture("student-feedback");
  const saved = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("neurvia.learning.v1")),
  );
  const initial = saved.attempts[0];
  const checks = saved.practice.filter((p) => p.fromAttempt === initial.id);
  expect(checks.length).toBeGreaterThan(0);
  expect(checks.length).toBeLessThanOrEqual(2);
  const task = checks[0];
  expect(initial.questions.map((q) => q.id)).not.toContain(task.question.id);
  await visit("/student/quiz?mode=confirmation&task=" + task.id);
  await page
    .locator(".lr-option.interactive")
    .nth((task.question.correct + 1) % 4)
    .click();
  await page.locator(".lr-confidence label").first().click();
  await page.getByRole("button", { name: "Terminer", exact: true }).click();
  await expect(page).toHaveURL(/result=/);
  await page.waitForLoadState("networkidle");
  const after = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("neurvia.learning.v1")),
  );
  const retest = after.practice.find(
    (p) => p.fromAttempt === after.attempts[0].id,
  );
  expect(retest.mode).toBe("retest");
  expect(retest.question.id).not.toBe(task.question.id);
  await visit("/student/quiz?mode=retest&task=" + retest.id);
  await page
    .locator(".lr-option.interactive")
    .nth(retest.question.correct)
    .click();
  await page.locator(".lr-confidence label").first().click();
  await page.getByRole("button", { name: "Terminer", exact: true }).click();
  await expect(page).toHaveURL(/result=/);
  await visit("/student/tasks");
  await page.getByRole("button", { name: "Simuler J+7", exact: true }).click();
  await expect(page.locator("#contenu")).toContainText("Simulation");
  await page.reload();
  await expect(page.locator("#contenu")).toContainText("Simulation");
  expect(errors).toEqual([]);
  console.log(
    "Group validation, graph selection, student submission, distinct confirmation/retest and simulated J+7 passed.",
  );
} finally {
  await browser.close();
}
