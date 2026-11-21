import { chromium, expect as baseExpect } from "@playwright/test";
const expect = baseExpect.configure({ timeout: 20000 });

const root = process.env.NEURVIA_URL ?? "http://127.0.0.1:3147";
const demo = process.env.NEURVIA_MODE === "demo";
const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
});
const errors = [];
const suffix = Date.now().toString(36);
const demoPassword = "FAHM-demo-2026";
const testPassword = "verified-faHm-2026";

async function browserPage() {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  page.setDefaultTimeout(17000);
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  return page;
}

async function authenticated(page, { email, password, role, register }) {
  await page.goto(root + "/login");
  if (register) {
    await page.getByRole("button", { name: role === "teacher" ? "Professeur" : "Étudiant", exact: true }).click();
    await page.getByRole("button", { name: "Créer un compte", exact: true }).click();
    await page.getByLabel("Nom complet").fill(role === "teacher" ? "Professeur Test" : "Apprenant Test");
  }
  await page.getByLabel("Adresse e-mail").fill(email);
  await page.getByLabel("Mot de passe", { exact: true }).fill(password);
  await page.getByRole("button", { name: register ? "Créer le compte" : "Se connecter", exact: true }).click();
  await expect(page).toHaveURL(new RegExp("/" + role + "/dashboard$"));
  await expect(page.locator("#contenu h1")).toContainText("Bonjour");
  expect(await page.evaluate(() => document.cookie)).not.toContain("neurvia_session");
  expect((await page.context().cookies()).find((cookie) => cookie.name === "neurvia_session")?.httpOnly).toBe(true);
}

async function visit(page, route, heading) {
  await page.goto(root + route);
  await expect(page.locator("#contenu h1")).toContainText(heading);
}

async function api(page, path) {
  const response = await page.request.get(root + "/backend" + path);
  expect(response.ok(), path + " returned " + response.status()).toBeTruthy();
  return response.json();
}

async function answer(page, option, last = true) {
  await page.locator(".lr-option.interactive").nth(option).click();
  await page.locator(".lr-confidence label").first().click();
  await page.getByRole("button", { name: last ? "Terminer" : "Suivant", exact: true }).click();
  if (last) await expect(page).toHaveURL(/result=/);
}

async function normalWorkflow(teacher, student) {
  await authenticated(teacher, { email: "teacher-" + suffix + "@example.com",
    password: testPassword, role: "teacher", register: true });
  await visit(teacher, "/teacher/classes", "Mes classes");
  await teacher.getByLabel("Nom de la classe").fill("TD Python " + suffix);
  await teacher.getByRole("button", { name: "Créer la classe" }).click();
  await expect(teacher.getByRole("heading", { name: "Invitation · TD Python " + suffix })).toBeVisible();
  await expect(teacher.getByAltText("QR d’adhésion à la classe")).toBeVisible();
  const [classroom] = await api(teacher, "/classrooms");

  await authenticated(student, { email: "student-" + suffix + "@example.com",
    password: testPassword, role: "student", register: true });
  await visit(student, "/join/" + classroom.join_code, "Mes classes");
  await expect(student.getByLabel("Code de la classe")).toHaveValue(classroom.join_code);
  await student.getByLabel("Pseudonyme (facultatif)").fill("Apprenant A");
  await student.getByRole("button", { name: "Rejoindre la classe" }).click();
  await expect(student.getByRole("status")).toContainText("Classe rejointe.");

  await visit(teacher, "/teacher/lessons/new", "Nouvelle séance");
  await teacher.getByLabel("Titre de la séance").fill("Indices et listes " + suffix);
  await teacher.getByLabel("Indices et listes", { exact: true }).check();
  await teacher.getByLabel("Contenu du cours").fill("Les indices positifs commencent à zéro. len(notes) ne désigne pas un indice.");
  await teacher.getByRole("button", { name: "Préparer le quiz", exact: true }).click();
  await expect(teacher.getByRole("heading", { name: "Paramètres du quiz" })).toBeVisible();
  await teacher.getByLabel("Nombre de questions").selectOption("1");
  await teacher.getByLabel("Inclure les brouillons de la banque Python à relire").check();
  await teacher.getByRole("button", { name: "Préparer le quiz", exact: true }).click();
  await expect(teacher.getByRole("heading", { name: "Relire les questions" })).toBeVisible();
  await teacher.getByRole("button", { name: "Modifier", exact: true }).click();
  await teacher.getByLabel("Énoncé").fill("Que produit ce calcul sur la liste Python ?");
  await teacher.getByRole("button", { name: "Enregistrer la question" }).click();
  await expect(teacher.locator(".lr-review")).toContainText("Que produit ce calcul sur la liste Python ?");
  const publish = teacher.getByRole("button", { name: "Valider et publier", exact: true });
  await publish.click();
  await expect(publish).toBeDisabled();
  await teacher.getByLabel("J’ai vérifié les questions, les réponses et les explications.").check();
  await publish.click();
  await expect(teacher).toHaveURL(/published=1/);

  await visit(student, "/student/tasks", "Mes tâches");
  await student.getByRole("link", { name: "Commencer", exact: false }).click();
  await expect(student.locator(".lr-test")).toBeVisible();
  await expect(student.locator(".lr-test")).not.toContainText("Explication");
  await answer(student, 0);
  await expect(student.locator("#contenu")).toContainText("Il faut davantage de réponses");
  await expect(student.locator("#contenu")).toContainText("Difficulté possible");
  await student.reload();
  await expect(student.locator("#contenu")).toContainText("Correction détaillée");

  await visit(teacher, "/teacher/dashboard", "Bonjour");
  await expect(teacher.locator(".nd-kpis")).toContainText(/1\s*\/\s*1/);
  await expect(teacher.getByRole("heading", { name: "Priorités pédagogiques" })).toBeVisible();
  await visit(teacher, "/teacher/mindmirror", "MindMirror");
  await expect(teacher.getByRole("button", { name: /Apprenant A,/ })).toBeVisible();
  expect(await teacher.locator(".nv-demo").count()).toBe(0);
  console.log("Normal mode browser: registration, login, QR and join, lesson, quiz edit/approval, response, feedback and analytics.");
}

async function demoWorkflow(teacher, student) {
  await authenticated(teacher, { email: "prof.fahm@example.com", password: demoPassword, role: "teacher" });
  await authenticated(student, { email: "eleve1.fahm@example.com", password: demoPassword, role: "student" });
  const [room] = await api(teacher, "/classrooms");
  const [lesson] = await api(teacher, "/classrooms/" + room.id + "/lessons");
  const quiz = await api(teacher, "/quizzes/" + lesson.quiz_id);
  await visit(student, "/student/tasks", "Mes tâches");
  await student.getByRole("link", { name: "Commencer" }).click();
  await expect(student.locator(".lr-test")).toBeVisible();
  for (const [index, item] of quiz.questions.entries()) {
    await expect(student.locator(".lr-kicker")).toContainText("Question " + (index + 1) + " sur");
    await answer(student, item.options.findIndex((choice) =>
      item.concept_code === "C_INDEXING" ? choice.misconception_code === "M_OFF_BY_ONE" : choice.is_correct),
    index === quiz.questions.length - 1);
  }
  const initialId = new URL(student.url()).searchParams.get("result");
  await expect(student.getByRole("link", { name: "Faire la vérification" })).toBeVisible();
  const confirmation = await api(student, "/attempts/" + initialId + "/confirmation");
  expect(quiz.questions.map((item) => item.id)).not.toContain(confirmation.question.id);
  await student.getByRole("link", { name: "Faire la vérification" }).click();
  await answer(student, 1);
  await expect(student.locator("#contenu")).toContainText("items indépendants");

  await visit(teacher, "/teacher/groups?lesson=" + lesson.id, "Groupes et remédiation");
  await teacher.getByRole("button", { name: "Calculer les groupes" }).click();
  const card = teacher.locator(".mm-group-card").filter({ hasText: "Décalage d'un (indices ou bornes)" });
  await expect(card).toHaveCount(1);
  await card.locator(".mm-group-trigger").click();
  await expect(card.locator(".mm-chips")).toContainText("Étudiant 01");
  await card.getByRole("button", { name: "Accepter" }).click();
  await card.getByRole("button", { name: "Générer le plan" }).click();
  await card.getByRole("button", { name: "Modifier le plan" }).click();
  await card.getByLabel("Objectif").fill("Reproduire un calcul des indices sur une liste nouvelle.");
  await card.getByRole("button", { name: "Enregistrer le plan" }).click();
  await card.getByLabel("J’ai relu le plan").check();
  await card.getByRole("button", { name: "Valider et affecter" }).click();
  await card.getByRole("button", { name: "Lancer le retest" }).click();
  await expect(card.getByRole("status")).toContainText("Retests programmés");

  await visit(student, "/student/tasks", "Mes tâches");
  await expect(student.getByRole("heading", { name: "Remédiations affectées" })).toBeVisible();
  await student.getByRole("link", { name: "Faire le retest" }).click();
  await expect(student.locator(".lr-test")).toBeVisible();
  await answer(student, 0);
  const retest = await api(student, "/attempts/" + new URL(student.url()).searchParams.get("result") + "/feedback");
  const seen = new Set(quiz.questions.map((item) => item.id));
  seen.add(confirmation.question.id);
  expect(seen.has(retest.questions[0].id)).toBe(false);
  seen.add(retest.questions[0].id);

  await visit(student, "/student/tasks", "Mes tâches");
  await expect(student.getByRole("link", { name: "Réviser", exact: true })).toHaveCount(0);
  await student.getByRole("button", { name: "À venir", exact: true }).click();
  await expect(student.locator("#contenu")).toContainText("Révision J+7");
  await teacher.getByRole("button", { name: "Simuler J+7" }).click();
  await expect(teacher.locator(".nv-demo").first()).toContainText("Simulation");
  await visit(student, "/student/tasks", "Mes tâches");
  await student.getByRole("link", { name: "Réviser", exact: true }).click();
  await answer(student, 0);
  const delayed = await api(student, "/attempts/" + new URL(student.url()).searchParams.get("result") + "/feedback");
  expect(seen.has(delayed.questions[0].id)).toBe(false);

  await visit(teacher, "/teacher/groups?lesson=" + lesson.id, "Groupes et remédiation");
  const comparison = await api(teacher, "/lessons/" + lesson.id + "/before-after");
  const indexes = comparison.concepts.find((item) => item.concept_code === "C_INDEXING");
  expect(indexes.immediate.attempts).toBeGreaterThan(0);
  expect(indexes.j7.attempts).toBeGreaterThan(0);
  await visit(teacher, "/teacher/mindmirror?lesson=" + lesson.id, "MindMirror");
  await expect(teacher.getByRole("button", { name: /Étudiant 01,/ })).toBeVisible();
  await teacher.getByRole("button", { name: /Étudiant 01,/ }).click();
  await expect(teacher.locator(".mm-panel")).toContainText("Étudiant 01");
  console.log("Demo browser: stored quiz, separate confirmation, real graph/group, plan edit, retest and simulated J+7.");
}

try {
  const teacher = await browserPage();
  const student = await browserPage();
  const persistenceEmail = process.env.NEURVIA_PERSISTENCE_EMAIL;
  if (persistenceEmail) {
    await authenticated(student, { email: persistenceEmail, password: testPassword, role: "student" });
    await visit(student, "/student/progress", "Ma progression");
    await expect(student.locator("#contenu")).toContainText("Indices et listes");
    await student.locator("#contenu").getByRole("link", { name: /Indices et listes/ }).click();
    await expect(student.getByRole("heading", { name: "Correction détaillée" })).toBeVisible();
    console.log("The normal-mode browser recovered a saved result after the FastAPI process restarted.");
  } else if (demo) await demoWorkflow(teacher, student);
  else await normalWorkflow(teacher, student);
  expect(errors).toEqual([]);
} finally {
  await browser.close();
}
