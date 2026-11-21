import { useEffect, useState } from "react";
import {
  ArrowRight,
  BookOpen,
  Braces,
  ChevronRight,
  ClipboardList,
  Clock3,
  GraduationCap,
  Info,
  ShieldCheck,
  Sigma,
  Target,
  Users,
  Waypoints,
} from "lucide-react";
import {
  getClassRoster,
  getRoster,
  useSuggestedGroupCount,
} from "../mirror/service";
import {
  dayLabel,
  feedbackHref,
  useLearningSummary,
} from "../learning/service";
import "./dashboard.css";
const classOptions = ["L1 Python · Groupe A", "L1 Python · Groupe B"];
const courseRows = [
  { name: "Algorithmique & Python", unit: "Boucles et indices", icon: Braces },
  { name: "Mathématiques", unit: "Suites arithmétiques", icon: Sigma },
  { name: "Réseaux", unit: "Les couches du modèle OSI", icon: Waypoints },
];
function Go({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a className="nd-go" href={href}>
      {children}
      <ArrowRight size={15} />
    </a>
  );
}
function Heading({ title, sub }: { title: string; sub: string }) {
  return (
    <div className="nd-heading">
      <h1>{title}</h1>
      <p>{sub}</p>
    </div>
  );
}
export function Dashboard({
  teacher,
  classroom,
}: {
  teacher: boolean;
  classroom: string;
}) {
  const summary = useLearningSummary(classroom),
    groupCount = useSuggestedGroupCount(classroom),
    roster = getClassRoster(classroom);
  const active = roster.length > 0;
  if (!teacher)
    return (
      <div className="nd">
        <Heading
          title="Bonjour Malek"
          sub="Voici ce qui compte pour ton apprentissage aujourd’hui."
        />
        <section className="nd-studentpriority">
          <div>
            <small>Ta priorité du jour</small>
            <h2>
              {summary.priority
                ? "Quiz — " + summary.priority.title
                : "Aucune tâche disponible"}
            </h2>
            {summary.priority && (
              <p>
                {summary.priority.count} questions sur le cours d’aujourd’hui.
                Vérifie ce que tu as compris.
              </p>
            )}
          </div>
          {summary.priority && (
            <span>
              <Clock3 size={15} /> 8 min
            </span>
          )}
          <Go href={summary.priority?.href || "/student/tasks"}>
            {summary.priority ? "Commencer le quiz" : "Mes tâches"}
          </Go>
        </section>
        <div className="nd-studentcols">
          <section className="nd-card">
            <h2>Mes cours</h2>
            {!summary.lessons.length && <p>Aucun cours disponible.</p>}
            {courseRows.map(
              ({ name, unit, icon: Icon }, i) =>
                summary.lessons.some((l) => l.subject === name) && (
                  <a
                    key={name}
                    className="nd-course"
                    href={
                      "/student/courses?course=" +
                      ["python", "math", "network"][i]
                    }
                  >
                    <i>
                      <Icon size={19} />
                    </i>
                    <div>
                      <strong>{name}</strong>
                      <p>Dernière leçon · {unit}</p>
                    </div>
                    <span>Ouvrir →</span>
                  </a>
                ),
            )}
          </section>
          <section className="nd-card">
            <h2>Ma progression</h2>
            <strong>Quiz terminés cette semaine</strong>
            <progress
              value={summary.completedThisWeek}
              max={summary.weeklyTarget}
            />
            <p>
              {summary.completedThisWeek} quiz sur {summary.weeklyTarget}
            </p>
            {summary.suspected ? (
              <div className="nd-review">
                <strong>À revoir · {summary.reviewTopic}</strong>
                <p>
                  Une question de vérification permet de préciser une difficulté
                  possible.
                </p>
                <a href={summary.verificationHref || "/student/progress"}>
                  Faire la vérification →
                </a>
              </div>
            ) : (
              <p>Aucune vérification en attente.</p>
            )}
          </section>
        </div>
        <section className="nd-card">
          <h2>Dernière activité</h2>
          <a
            className="nd-line"
            href={
              summary.latestAttempt
                ? feedbackHref(summary.latestAttempt.id)
                : "/student/progress"
            }
          >
            <BookOpen size={19} />
            {summary.latestAttempt
              ? summary.latestAttempt.title +
                " · " +
                summary.latestAttempt.score +
                " / " +
                summary.latestAttempt.total
              : "Consulter mes résultats"}
            <ChevronRight size={16} />
          </a>
        </section>
      </div>
    );
  return (
    <div className="nd">
      <Heading
        title="Bonjour, Mme Ben Salem"
        sub="Voici l’état de votre classe aujourd’hui."
      />
      <div className="nd-hero">
        <section className="nd-card nd-priority">
          <div className="nd-topic">
            <i>
              <Target size={32} />
            </i>
            <div>
              <span>Préparer le prochain cours</span>
              <h2>
                {active
                  ? "Bornes des boucles Python"
                  : "Préparer une première séance"}
              </h2>
            </div>
          </div>
          <div className="nd-signals">
            <span>
              <Users /> {active ? "7 étudiants concernés" : "Aucune réponse"}
            </span>
            {active && (
              <>
                <span>
                  <ShieldCheck /> 2 cas corroborés
                </span>
                <span>
                  <Info /> Autres difficultés à vérifier
                </span>
              </>
            )}
          </div>
          <div className="nd-advice">
            <Info size={16} />
            <p>
              {active
                ? "Il s’agit d’une hypothèse de difficulté basée sur les réponses au quiz. Une vérification en séance est recommandée."
                : "Créez une séance pour recueillir les premières réponses."}
            </p>
            <Go
              href={
                active
                  ? "/teacher/mindmirror?lesson=boucles-indices"
                  : "/teacher/lessons/new"
              }
            >
              {active ? "Voir les difficultés" : "Créer une séance"}
            </Go>
          </div>
        </section>
        <section className="nd-card nd-todo">
          <h2>À faire maintenant</h2>
          {[
            ["Valider le quiz de la séance", "/teacher/quiz"],
            ["Examiner les groupes proposés", "/teacher/groups"],
            [
              "Préparer une intervention de 10 min",
              "/teacher/groups?view=plan",
            ],
          ].map(([title, url]) => (
            <a href={url} key={url}>
              <span />
              {title}
              <ChevronRight size={15} />
            </a>
          ))}
        </section>
      </div>
      <div className="nd-kpis">
        <div>
          <i>
            <ClipboardList />
          </i>
          <section>
            <b>
              {summary.lessons.find((l) => l.id === "boucles-indices")
                ?.responses || 0}{" "}
              <em>/ {roster.length}</em>
            </b>
            <p>Réponses reçues</p>
          </section>
        </div>
        <div>
          <i>
            <Users />
          </i>
          <section>
            <b>{groupCount}</b>
            <p>Groupes suggérés</p>
          </section>
        </div>
      </div>
      <section className="nd-card">
        <h2>Mes séances récentes</h2>
        <div className="nd-scroll">
          <table>
            <thead>
              <tr>
                {[
                  "Séance",
                  "Date",
                  "Réponses",
                  "Principale difficulté",
                  "Évolution de la classe",
                ].map((h) => (
                  <th key={h}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {summary.recentLessons.slice(0, 5).map((s, i) => (
                <tr key={s.id}>
                  <td>
                    <a href={"/teacher/lessons/" + s.id}>{s.title}</a>
                  </td>
                  <td>{dayLabel(s.date)}</td>
                  <td>
                    {s.responses} / {roster.length}
                  </td>
                  <td>
                    <span className={"nd-tag tone" + (i % 3)}>
                      {s.difficulty}
                    </span>
                  </td>
                  <td>{s.trend}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!summary.recentLessons.length && (
          <p>Aucune séance dans cette classe.</p>
        )}
      </section>
    </div>
  );
}
export function Classes({
  classroom,
  choose,
}: {
  classroom: string;
  choose: (v: string) => void;
}) {
  const [query, setQuery] = useState("");
  const students = getRoster(classroom);
  return (
    <div className="nd">
      <Heading
        title="Mes classes"
        sub="Consultez les membres de vos groupes de TD."
      />
      <div className="nd-classcards">
        {classOptions.map((c) => (
          <button
            className={"nd-card " + (c === classroom ? "active" : "")}
            key={c}
            onClick={() => choose(c)}
          >
            <GraduationCap />
            <strong>{c}</strong>
            <span>{getRoster(c).length} étudiants</span>
          </button>
        ))}
      </div>
      <section className="nd-card">
        <h2>Étudiants · {classroom}</h2>
        <input
          placeholder="Rechercher un identifiant"
          aria-label="Rechercher un identifiant"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="nd-roster">
          {students
            .filter((id) => id.toLowerCase().includes(query.toLowerCase()))
            .map((id) => (
              <a key={id} href={"/teacher/mindmirror?student=" + id}>
                <Users size={16} />
                {id}
              </a>
            ))}
        </div>
        {!students.length && <p>Aucun étudiant inscrit dans cette classe.</p>}
      </section>
    </div>
  );
}
export function SettingsPage() {
  const [motion, setMotion] = useState(false);
  useEffect(
    () => setMotion(localStorage.getItem("neurvia.reduceMotion") === "true"),
    [],
  );
  return (
    <div className="nd">
      <Heading
        title="Paramètres"
        sub="Personnalisez votre espace professeur."
      />
      <section className="nd-card">
        <h2>Accessibilité</h2>
        <label>
          <input
            type="checkbox"
            checked={motion}
            onChange={(e) => {
              setMotion(e.target.checked);
              localStorage.setItem(
                "neurvia.reduceMotion",
                String(e.target.checked),
              );
              document.documentElement.dataset.motion = e.target.checked
                ? "reduced"
                : "auto";
            }}
          />{" "}
          Réduire les animations de l’interface
        </label>
      </section>
    </div>
  );
}
export function Help() {
  return (
    <div className="nd">
      <Heading
        title="Aide"
        sub="Retrouve les réponses aux questions fréquentes."
      />
      <section className="nd-card">
        {[
          [
            "Où trouver mon prochain quiz ?",
            "Ouvre Mes tâches, puis choisis le quiz disponible pour ta classe.",
          ],
          [
            "Pourquoi indiquer ma certitude ?",
            "Elle aide ton professeur à choisir les notions à vérifier. Une réponse seule donne un premier indice.",
          ],
          [
            "Quand faire la révision ?",
            "Après le retest immédiat, une nouvelle activité est prévue sept jours plus tard.",
          ],
        ].map(([q, a]) => (
          <details key={q}>
            <summary>{q}</summary>
            <p>{a}</p>
          </details>
        ))}
      </section>
    </div>
  );
}
