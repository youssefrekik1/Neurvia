"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle, ArrowRight, Check, Clock, Flame, Lightbulb, Network, RefreshCw, Sparkles, TrendingUp, Users, X,
} from "lucide-react";
import { BEFORE_AFTER, CONCEPTS, MISCONCEPTIONS, STUDENTS, WEEKLY, conceptByCode, type StudentRow } from "../demo/data";
import "./insights.css";

const pct = (value: number) => Math.round(value * 100) + " %";

function heat(value: number) {
  if (value < 0.35) return "ni-h0";
  if (value < 0.5) return "ni-h1";
  if (value < 0.65) return "ni-h2";
  if (value < 0.8) return "ni-h3";
  return "ni-h4";
}

const BRIEFING = [
  "Cette semaine, la maîtrise moyenne de la classe est passée de 55 % à 63 % (+8 points), portée par la remédiation sur le passage au modèle relationnel.",
  "Point d’attention : « Jointure et division » reste la notion la plus fragile (27 %). L’analyse des prérequis montre que la cause est en amont : 11 étudiants lisent encore les cardinalités du mauvais côté, dont 7 avec une forte confiance.",
  "En Mathématiques du signal, le chapitre manuscrit sur les séries de Fourier a été transcrit et validé : 3 questions sur le calcul de a₀ sont prêtes à relire.",
  "3 étudiants montrent des signes de décrochage (aucune activité depuis 6 jours ou plus). Une session courte de 5 minutes leur est proposée.",
  "Recommandation : commencez la prochaine séance par 10 minutes sur les cardinalités avec le groupe « Lecture des cardinalités », puis programmez le retest jeudi.",
];

type Action = { id: string; title: string; detail: string; cta: string; done: string; icon: typeof Users };
const ACTIONS: Action[] = [
  { id: "group", icon: Users, title: "Former le groupe « Lecture des cardinalités »", detail: "11 étudiants · erreur confirmée par une variante indépendante", cta: "Créer le groupe", done: "Groupe créé, plan de remédiation prêt à relire" },
  { id: "retest", icon: RefreshCw, title: "Programmer le retest ciblé", detail: "3 questions générées depuis BD-Cours-1.pdf p. 50, à relire avant publication", cta: "Relire et programmer", done: "Retest programmé jeudi 9 h, suivi J+7 activé" },
  { id: "nudge", icon: Flame, title: "Relancer 3 étudiants en décrochage", detail: "Session courte de 5 minutes sur une notion déjà réussie", cta: "Envoyer la relance", done: "Relance envoyée, message bienveillant et sans note" },
  { id: "prep", icon: Lightbulb, title: "Préparer la séance « Jointures »", detail: "Plan suggéré : cardinalités et clés étrangères d’abord, puis jointure", cta: "Voir le plan", done: "Plan ajouté à vos séances en brouillon" },
];

function Briefing() {
  const [shown, setShown] = useState(0);
  const [run, setRun] = useState(0);
  useEffect(() => {
    setShown(0);
    const timer = setInterval(() => setShown((value) => {
      if (value >= BRIEFING.length) { clearInterval(timer); return value; }
      return value + 1;
    }), 650);
    return () => clearInterval(timer);
  }, [run]);
  return (
    <section className="ni-card ni-briefing">
      <header>
        <h2><Sparkles size={18} /> Briefing IA de la semaine</h2>
        <button type="button" className="ni-ghost" onClick={() => setRun(run + 1)}><RefreshCw size={14} /> Régénérer</button>
      </header>
      <ol>
        {BRIEFING.slice(0, shown).map((line) => <li key={line} className="ni-fade">{line}</li>)}
        {shown < BRIEFING.length && <li className="ni-typing" aria-label="Analyse en cours"><i /><i /><i /></li>}
      </ol>
      <small>Généré à partir de 412 réponses et de 5 quiz · chaque chiffre vient des données de la classe.</small>
    </section>
  );
}

function Sparkline({ values, max = 100 }: { values: number[]; max?: number }) {
  const points = values.map((value, index) => `${(index / (values.length - 1)) * 100},${30 - (value / max) * 28}`).join(" ");
  return <svg viewBox="0 0 100 32" className="ni-spark" preserveAspectRatio="none" aria-hidden><polyline points={points} /></svg>;
}

function StudentPanel({ student, close }: { student: StudentRow; close: () => void }) {
  const weakest = [...CONCEPTS].sort((a, b) => student.mastery[a.code] - student.mastery[b.code]).slice(0, 3);
  const mis = MISCONCEPTIONS.find((m) => m.code === student.mainMisconception);
  return (
    <aside className="ni-drawer" role="dialog" aria-label={"Profil de " + student.name}>
      <header>
        <div><small>{student.pseudonym}</small><h2>{student.name}</h2></div>
        <button type="button" aria-label="Fermer" onClick={close}><X size={18} /></button>
      </header>
      <div className="ni-mini">
        <div><b>{pct(Object.values(student.mastery).reduce((a, b) => a + b, 0) / CONCEPTS.length)}</b><small>maîtrise</small></div>
        <div><b className={student.trend >= 0 ? "ni-up" : "ni-down"}>{student.trend >= 0 ? "+" : ""}{student.trend}</b><small>pts / 7 j</small></div>
        <div><b>{student.lastActive === 0 ? "auj." : student.lastActive + " j"}</b><small>dernière activité</small></div>
      </div>
      <h3>Notions les plus fragiles</h3>
      {weakest.map((concept) => (
        <div className="ni-bar" key={concept.code}>
          <span>{concept.name}</span><meter min={0} max={1} value={student.mastery[concept.code]} /><b>{pct(student.mastery[concept.code])}</b>
        </div>
      ))}
      {mis && <>
        <h3>Erreur de raisonnement probable</h3>
        <p className="ni-mis"><strong>{mis.label}</strong>{mis.fix}</p>
      </>}
      <h3>Action suggérée</h3>
      <p>{student.engagement < 0.32
        ? "Proposer une session courte sur une notion réussie pour relancer la motivation, avant de revenir aux difficultés."
        : `Ajouter au groupe de remédiation « ${conceptByCode[weakest[0].code].name} » et vérifier au retest.`}</p>
    </aside>
  );
}

export default function Cockpit() {
  const [done, setDone] = useState<Record<string, boolean>>({});
  const [toast, setToast] = useState("");
  const [selected, setSelected] = useState<StudentRow | null>(null);
  const [sort, setSort] = useState<"risk" | "name">("risk");
  const average = (code: string) => STUDENTS.reduce((sum, s) => sum + s.mastery[code], 0) / STUDENTS.length;
  const drifting = STUDENTS.filter((s) => s.engagement < 0.32);
  const rows = useMemo(() => {
    const score = (s: StudentRow) => Object.values(s.mastery).reduce((a, b) => a + b, 0);
    return [...STUDENTS].sort(sort === "risk" ? (a, b) => score(a) - score(b) : (a, b) => a.name.localeCompare(b.name));
  }, [sort]);
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(""), 3200); return () => clearTimeout(t); }, [toast]);
  const maxMis = Math.max(...MISCONCEPTIONS.map((m) => m.students));

  return (
    <div className="ni">
      <div className="ni-heading">
        <div>
          <h1>Pilotage de la classe</h1>
          <p>L2 Informatique A · Bases de données · 24 étudiants · semaine 5</p>
        </div>
        <div className="ni-row">
          <Link className="ni-ghost" href="/teacher/groups"><Users size={15} /> Groupes de remédiation</Link>
          <Link className="ni-primary" href="/teacher/mindmirror"><Network size={15} /> Ouvrir MindMirror <ArrowRight size={15} /></Link>
        </div>
      </div>

      <div className="ni-kpis">
        <div><small>Maîtrise moyenne</small><b>{WEEKLY[WEEKLY.length - 1].mastery} %</b><span className="ni-up"><TrendingUp size={13} /> +8 pts</span><Sparkline values={WEEKLY.map((w) => w.mastery)} /></div>
        <div><small>Participation aux quiz</small><b>88 %</b><span className="ni-up">+9 pts</span><Sparkline values={WEEKLY.map((w) => w.participation)} /></div>
        <div><small>Effet de la remédiation</small><b>+37 pts</b><span>retest, maintenu à J+7</span></div>
        <div className="ni-warn"><small>Risque de décrochage</small><b>{drifting.length}</b><span>étudiants inactifs ≥ 6 j</span></div>
      </div>

      <div className="ni-grid2">
        <Briefing />
        <section className="ni-card">
          <h2>Actions recommandées</h2>
          <ul className="ni-actions">
            {ACTIONS.map((action) => {
              const Icon = action.icon;
              return (
                <li key={action.id} className={done[action.id] ? "done" : ""}>
                  <i>{done[action.id] ? <Check size={17} /> : <Icon size={17} />}</i>
                  <div><strong>{action.title}</strong><p>{done[action.id] ? action.done : action.detail}</p></div>
                  {!done[action.id] && <button type="button" className="ni-small" onClick={() => {
                    setDone({ ...done, [action.id]: true }); setToast(action.done);
                  }}>{action.cta}</button>}
                </li>
              );
            })}
          </ul>
        </section>
      </div>

      <section className="ni-card">
        <header className="ni-row">
          <h2>Carte de chaleur · maîtrise par notion</h2>
          <div className="ni-seg" role="group" aria-label="Trier">
            <button type="button" aria-pressed={sort === "risk"} onClick={() => setSort("risk")}>Priorité</button>
            <button type="button" aria-pressed={sort === "name"} onClick={() => setSort("name")}>Nom</button>
          </div>
        </header>
        <p className="ni-sub">Cliquez sur un étudiant pour voir son profil, ses erreurs probables et l’action suggérée.</p>
        <div className="ni-heatwrap">
          <table className="ni-heat">
            <thead><tr><th />{CONCEPTS.map((c) => <th key={c.code} title={c.name}><span>{c.name}</span></th>)}</tr></thead>
            <tbody>
              <tr className="ni-avg"><th>Moyenne classe</th>{CONCEPTS.map((c) => <td key={c.code} className={heat(average(c.code))}>{Math.round(average(c.code) * 100)}</td>)}</tr>
              {rows.map((student) => (
                <tr key={student.id}>
                  <th><button type="button" onClick={() => setSelected(student)}>
                    {student.name}{student.engagement < 0.32 && <Clock size={12} aria-label="inactif" />}
                  </button></th>
                  {CONCEPTS.map((c) => <td key={c.code} className={heat(student.mastery[c.code])} title={`${student.name} · ${c.name} : ${pct(student.mastery[c.code])}`} />)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="ni-legend"><span className="ni-h0" />&lt; 35 %<span className="ni-h1" />50 %<span className="ni-h2" />65 %<span className="ni-h3" />80 %<span className="ni-h4" />maîtrisé</div>
      </section>

      <div className="ni-grid2">
        <section className="ni-card">
          <h2>Erreurs de raisonnement de la classe</h2>
          <ul className="ni-mislist">
            {MISCONCEPTIONS.map((m) => (
              <li key={m.code}>
                <div><strong>{m.label}</strong><small>{conceptByCode[m.concept].name} · ex. <code>{m.example}</code></small></div>
                <div className="ni-misbar"><span style={{ width: (m.students / maxMis) * 100 + "%" }} /><span className="conf" style={{ width: (m.confident / maxMis) * 100 + "%" }} /></div>
                <b>{m.students}</b>
              </li>
            ))}
          </ul>
          <p className="ni-sub"><span className="ni-dot conf" /> dont réponses fausses données avec forte confiance : la priorité, car l’étudiant ne sait pas qu’il se trompe.</p>
        </section>
        <section className="ni-card">
          <h2>Impact de la remédiation</h2>
          <div className="ni-impact">
            {BEFORE_AFTER.map((row) => (
              <div key={row.label}>
                <strong>{row.label}</strong>
                <div className="ni-bars">
                  <span style={{ width: row.before + "%" }} className="b">{row.before} %</span>
                  <span style={{ width: row.after + "%" }} className="a">{row.after} %</span>
                  <span style={{ width: row.j7 + "%" }} className="j">{row.j7} %</span>
                </div>
              </div>
            ))}
          </div>
          <div className="ni-legend"><span className="b" />Avant<span className="a" />Retest<span className="j" />J+7</div>
        </section>
      </div>

      <section className="ni-card ni-drift">
        <h2><AlertTriangle size={18} /> Signaux de décrochage</h2>
        <div className="ni-driftlist">
          {drifting.map((s) => (
            <button type="button" key={s.id} onClick={() => setSelected(s)}>
              <b className="nv-avatar">{s.name[0]}</b>
              <div><strong>{s.name}</strong><small>Inactif depuis {s.lastActive} jours · engagement {pct(s.engagement)}</small></div>
              <ArrowRight size={15} />
            </button>
          ))}
        </div>
      </section>

      {selected && <><button type="button" className="ni-scrim" aria-label="Fermer" onClick={() => setSelected(null)} /><StudentPanel student={selected} close={() => setSelected(null)} /></>}
      {toast && <p className="ni-toast" role="status"><Check size={15} /> {toast}</p>}
    </div>
  );
}
