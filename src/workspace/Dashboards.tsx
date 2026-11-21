import Link from "next/link";
import { useEffect, useState } from "react";
import {
  ArrowRight,
  BookOpen,
  Braces,
  ChevronRight,
  ClipboardList,
  GraduationCap,
  Info,
  ShieldCheck,
  Target,
  Users,
} from "lucide-react";
import QRCode from "qrcode";
import { useMirrorData } from "../mirror/service";
import { dayLabel, feedbackHref, useLearningSummary } from "../learning/service";
import { api, errorMessage, refresh, type Schema, useGet } from "../lib/api";
import "./dashboard.css";
import "../learning/learning.css";
function Go({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link className="nd-go" href={href}>
      {children}
      <ArrowRight size={15} />
    </Link>
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
  profile,
}: {
  teacher: boolean;
  classroom: string;
  profile: Schema["Profile"];
}) {
  const summary = useLearningSummary(classroom, teacher);
  const mirror = useMirrorData(classroom, teacher);
  const dashboard = mirror.dashboard;
  const priority = dashboard?.priorities[0];
  const roster = useGet<Schema["Member"][]>(teacher && classroom ? "/classrooms/" + classroom + "/members" : "");
  const groupCount = mirror.groups.filter((group) => group.status === "suggested").length;
  const name = profile.full_name;
  if (!teacher)
    return (
      <div className="nd">
        <Heading
          title={"Bonjour " + name}
          sub="Voici ce qui compte pour ton apprentissage aujourd’hui."
        />
        {summary.error && <p role="alert">{summary.error}</p>}
        {summary.loading && <p role="status">Chargement des activités…</p>}
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
          <Go href={summary.priority?.href || "/student/tasks"}>
            {summary.priority ? "Commencer le quiz" : "Mes tâches"}
          </Go>
        </section>
        <div className="nd-studentcols">
          <section className="nd-card">
            <h2>Mes cours</h2>
            {!summary.lessons.length && <p>Aucun cours disponible.</p>}
            {summary.recentLessons[0] && <Link className="nd-course" href="/student/courses?course=python">
              <i><Braces size={19} /></i>
              <div><strong>{summary.recentLessons[0].subject}</strong><p>{summary.recentLessons[0].title}</p></div>
              <span>Ouvrir →</span>
            </Link>}
          </section>
          <section className="nd-card">
            <h2>Ma progression</h2>
            <strong>Quiz terminés cette semaine</strong>
            <progress
              value={summary.completedThisWeek}
              max={Math.max(1, summary.weeklyTarget)}
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
                <Link href={summary.verificationHref || "/student/progress"}>
                  Faire la vérification →
                </Link>
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
        title={"Bonjour, " + name}
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
              <h2>{priority?.label ?? "Préparer une première séance"}</h2>
            </div>
          </div>
          <div className="nd-signals">
            <span><Users /> {priority ? priority.affected_students + " étudiants concernés" : "Aucune erreur observée"}</span>
            {priority && <span><ShieldCheck /> {priority.corroborated_students} cas corroborés</span>}
          </div>
          <div className="nd-advice">
            <Info size={16} />
            <p>{priority ? "Hypothèse pédagogique basée sur les réponses au quiz." : "Publiez une séance pour recueillir des réponses."}</p>
            <Go href={mirror.selected ? "/teacher/mindmirror?lesson=" + mirror.selected.id : "/teacher/lessons/new"}>
              {mirror.selected ? "Voir les difficultés" : "Créer une séance"}
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
            <Link href={url} key={url}>
              <span />
              {title}
              <ChevronRight size={15} />
            </Link>
          ))}
        </section>
      </div>
      {mirror.error && <p role="alert">{mirror.error}</p>}
      {dashboard && dashboard.priorities.length > 0 && <section className="nd-card">
        <h2>Priorités pédagogiques</h2>
        <ol>{dashboard.priorities.map((item) => <li key={item.misconception_code}>
          {item.label} · {item.affected_students} étudiants · {item.corroborated_students} corroborés ·
          {" "}{Math.round(item.confident_wrong_share * 100)} % d’erreurs confiantes
        </li>)}</ol>
        <p>{dashboard.participation.insufficient_count} profils avec moins de quatre réponses.</p>
        {dashboard.insights.map((item) => <p key={item.kind}>
          <strong>{item.kind === "same_score_different_errors" ? "Même score, erreurs différentes" : "Scores différents, erreur commune"}</strong>
          {" · "}{item.labels.map((label, index) => label + " (" + item.scores[index] + ")").join(" et ")}
        </p>)}
      </section>}
      <div className="nd-kpis">
        <div>
          <i>
            <ClipboardList />
          </i>
          <section>
            <b>
              {dashboard?.participation.submitted_count ?? 0} <em>/ {roster.value?.length ?? 0}</em>
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
                ].map((h) => (
                  <th key={h}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {summary.recentLessons.slice(0, 5).map((s) => (
                <tr key={s.id}>
                  <td>
                    <Link href={"/teacher/lessons/" + s.id}>{s.title}</Link>
                  </td>
                  <td>{dayLabel(s.date)}</td>
                  <td>
                    {s.responses} / {roster.value?.length ?? 0}
                  </td>
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
export function Classes({ classroom, choose, teacher, classrooms, joinCode }: {
  classroom: string; choose: (v: string) => void; teacher: boolean;
  classrooms: Schema["ClassroomView"][]; joinCode?: string;
}) {
  const [query, setQuery] = useState("");
  const [name, setName] = useState("");
  const [code, setCode] = useState(joinCode ?? "");
  const [pseudonym, setPseudonym] = useState("");
  const [validHours, setValidHours] = useState(72);
  const [institution, setInstitution] = useState("");
  const [subject, setSubject] = useState("python_intro");
  const [otherSubject, setOtherSubject] = useState("");
  const institutions = useGet<Schema["InstitutionView"][]>(teacher ? "/institutions" : "").value ?? [];
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [qr, setQr] = useState("");
  const members = useGet<Schema["Member"][]>(teacher && classroom ? "/classrooms/" + classroom + "/members" : "");
  const room = classrooms.find((item) => item.id === classroom);
  const link = room?.join_path ? window.location.origin + room.join_path : "";
  useEffect(() => {
    let active = true;
    if (link) void QRCode.toDataURL(link, { width: 176 }).then((image) => { if (active) setQr(image); },
      () => { if (active) setQr(""); });
    return () => { active = false; };
  }, [link]);
  async function run(action: () => Promise<Schema["ClassroomView"]>, message: string) {
    setBusy(true);
    setNotice("");
    try { const result = await action(); refresh(); choose(result.id); setNotice(message); }
    catch (error) { setNotice(errorMessage(error)); }
    finally { setBusy(false); }
  }
  return <div className="nd lr-workspace">
    <Heading title="Mes classes" sub={teacher ? "Créez une classe et partagez son code." : "Rejoignez une classe avec le code de votre professeur."} />
    {notice && <p role="status">{notice}</p>}
    <section className="nd-card">
      {teacher ? <form className="lr-form" onSubmit={(event) => {
        event.preventDefault(); void run(() => api("/classrooms", "POST", { name, subject: subject === "other" ? otherSubject.trim() : subject, join_ttl_hours: validHours, institution_id: institution || null }),
          "Classe créée.");
      }}>
        <label>Nom de la classe<input value={name} onChange={(event) => setName(event.target.value)} required maxLength={120} /></label>
        <label>Matière
          <select value={subject} onChange={(event) => setSubject(event.target.value)}>
            <option value="python_intro">Algorithmique & Python</option>
            <option value="other">Autre matière</option>
          </select>
        </label>
        {subject === "other" && <label>Nom de la matière
          <input value={otherSubject} onChange={(event) => setOtherSubject(event.target.value)} required maxLength={100}
            placeholder="Ex. Bases de données" />
        </label>}
        {!!institutions.length && <label>Établissement
          <select value={institution} onChange={(event) => setInstitution(event.target.value)}>
            <option value="">Espace enseignant</option>
            {institutions.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </label>}
        <label>Validité du code (heures)<input type="number" min={1} max={720} value={validHours} required
          onChange={(event) => setValidHours(Number(event.target.value))} /></label>
        <button className="lr-btn primary" disabled={busy}>Créer la classe</button>
      </form> : <form className="lr-form" onSubmit={(event) => {
        event.preventDefault(); void run(() => api("/classrooms/join", "POST", { code, pseudonym: pseudonym || null }),
          "Classe rejointe.");
      }}>
        <label>Code de la classe<input value={code} onChange={(event) => setCode(event.target.value)} required /></label>
        <label>Pseudonyme (facultatif)<input value={pseudonym} onChange={(event) => setPseudonym(event.target.value)} /></label>
        <button className="lr-btn primary" disabled={busy}>Rejoindre la classe</button>
      </form>}
    </section>
    <div className="nd-classcards">{classrooms.map((item) =>
      <button className={"nd-card " + (item.id === classroom ? "active" : "")} key={item.id} onClick={() => choose(item.id)}>
        <GraduationCap /><strong>{item.name}</strong>
      </button>)}</div>
    {teacher && room && <>
      <section className="nd-card">
        <h2>Invitation · {room.name}</h2>
        <p>Code : <strong>{room.join_code}</strong></p>
        {room.join_expires_at && <p>Expire le {dayLabel(room.join_expires_at, true)}</p>}
        {link && <p><a href={link}>{link}</a></p>}
        {link && qr && <img src={qr} width={176} height={176} alt="QR d’adhésion à la classe" />}
        <button className="lr-btn" disabled={busy} onClick={() => void run(
          () => api("/classrooms/" + room.id + "/join-code", "POST", { join_ttl_hours: validHours }), "Code renouvelé.",
        )}>Renouveler le code</button>
      </section>
      <section className="nd-card">
        <h2>Étudiants · {room.name}</h2>
        <input placeholder="Rechercher un pseudonyme" aria-label="Rechercher un pseudonyme"
          value={query} onChange={(event) => setQuery(event.target.value)} />
        <div className="nd-roster">{members.value?.filter((item) => item.pseudonym.toLowerCase().includes(query.toLowerCase()))
          .map((item) => <a key={item.id} href={"/teacher/mindmirror?student=" + item.id}>
            <Users size={16} />{item.pseudonym}</a>)}</div>
        {members.error && <p role="alert">{members.error}</p>}
        {members.value?.length === 0 && <p>Aucun étudiant inscrit dans cette classe.</p>}
      </section>
    </>}
  </div>;
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
