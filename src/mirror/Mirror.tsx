"use client";

import { useState, type ReactNode } from "react";
import { api, errorMessage, type Schema } from "../lib/api";
import {
  ArrowRight,
  BookOpen,
  CalendarDays,
  Check,
  ChevronRight,
  Info,
  List,
  Network,
  Search,
  Target,
  UserRound,
  Users,
  X,
} from "lucide-react";
import Constellation from "./Constellation";
import Groups, { GroupPanel } from "./Groups";
import { studentDifficulty, useMirrorData } from "./service";
import type { Group, Student } from "./service";
import "./mirror.css";

const recommendation =
  "Une difficulté possible a été observée. Prévoir une question de vérification avant une activité ciblée.";

function StudentPanel({
  student,
  classroom,
  lessonId,
  group,
  onClose,
}: {
  student: Student;
  classroom: string;
  lessonId: string;
  group?: Group;
  onClose: () => void;
}) {
  const [tab, setTab] = useState("Profil");
  const [assistance, setAssistance] = useState<Schema["DifficultyAssistance"]>();
  const [assistanceError, setAssistanceError] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const measured = student.mastery !== null;
  async function analyze() {
    setAnalyzing(true);
    setAssistanceError("");
    try {
      setAssistance(await api<Schema["DifficultyAssistance"]>(
        `/lessons/${lessonId}/members/${student.id}/difficulty-assistance`, "POST",
      ));
    } catch (error) {
      setAssistanceError(errorMessage(error));
    } finally {
      setAnalyzing(false);
    }
  }
  return (
    <aside className="mm-panel">
      <header className="mm-panel-heading">
        <span className="mm-person">
          <UserRound size={26} strokeWidth={1.65} />
        </span>
        <div>
          <h2>{student.label}</h2>
          <small>Étudiant(e)</small>
        </div>
        <button
          aria-label="Fermer le profil"
          className="mm-close"
          onClick={onClose}
        >
          <X size={17} />
        </button>
      </header>
      <div className="mm-tabs" role="group" aria-label="Détails de l’étudiant">
        {["Profil", "Difficultés", "Historique"].map((t) => (
          <button key={t} onClick={() => setTab(t)} aria-pressed={t === tab}>
            {t}
          </button>
        ))}
      </div>
      <div className="mm-panel-inner">
        {tab === "Profil" && (
          <>
            <div className="mm-mastery">
              <strong>Réussite au quiz</strong>
              <div>
                <progress
                  max="100"
                  value={student.mastery ?? 0}
                  aria-label="Réussite au quiz"
                />
                <b>{measured ? student.mastery + " %" : "—"}</b>
              </div>
            </div>
            <h3>Notions clés</h3>
            <ul className="mm-concepts">
              {student.concepts.map(({ label: name, score }) => {
                return (
                  <li key={name}>
                    <span
                      className={
                        "mm-dot " +
                        (score === null
                          ? "neutral"
                          : score >= 80
                            ? "green"
                            : score < 50
                              ? "red"
                              : "amber")
                      }
                    />
                    {name}
                    <span>{score === null ? "—" : score + " %"}</span>
                  </li>
                );
              })}
            </ul>
            <div className="mm-observation">
              <Info size={16} />
              <div>
                <strong>
                  {student.errors.length
                    ? "Difficulté principale"
                    : "Observation"}
                </strong>
                <span>{studentDifficulty(student)}</span>
              </div>
            </div>
          </>
        )}
        {tab === "Difficultés" && (
          <>
            <h3>
              {student.corroborated
                ? "Difficulté corroborée"
                : "Difficulté à vérifier"}
            </h3>
            <p>{studentDifficulty(student)}</p>
            {student.errors.length > 0 ? (
              <>
                <div className="mm-evidence">
                  <span
                    className={
                      "mm-status " +
                      (student.corroborated ? "accepted" : "suggested")
                    }
                  >
                    {student.corroborated
                      ? "Erreur répétée sur plusieurs items"
                      : "Hypothèse"}
                  </span>
                  <p>
                    {student.corroborated
                      ? "Des items indépendants ont fait ressortir la même erreur."
                      : "Les réponses suggèrent cette difficulté. Elle reste à vérifier."}
                  </p>
                </div>
                <h3>Action recommandée</h3>
                <p>
                  {student.corroborated
                    ? "Proposer un exercice guidé, puis vérifier le transfert sur un nouvel exemple."
                    : recommendation}
                </p>
              </>
            ) : (
              <p>
                {measured
                  ? "Poursuivre les activités de la séance."
                  : "Recueillir une première réponse avant de proposer une intervention."}
              </p>
            )}
          </>
        )}
        {tab === "Difficultés" && measured && (
          <section className="mm-evidence">
            <h3>Analyse assistée par Gemini</h3>
            <button type="button" className="lr-btn sm" disabled={analyzing} onClick={analyze}>
              {analyzing ? "Analyse en cours…" : "Analyser les réponses"}
            </button>
            {assistanceError && <p role="alert">{assistanceError}</p>}
            {assistance && (
              <>
                <p>
                  {assistance.model
                    ? "Hypothèses à vérifier à partir des réponses du quiz."
                    : "Aucune analyse disponible pour ces réponses."}
                </p>
                {(assistance.evidence ?? []).map((item, index) => (
                  <div key={index}>
                    <strong>{item.misconception_label ?? "Éléments insuffisants"}</strong>
                    <p>{item.question}</p>
                    <p>
                      Réponse choisie « {item.selected_option} » · Confiance {
                        { sure: "forte", medium: "moyenne", unsure: "faible" }[item.confidence]
                      } · Objectif {item.objective}
                    </p>
                    {item.rationale && <p>{item.rationale}</p>}
                  </div>
                ))}
              </>
            )}
          </section>
        )}
        {tab === "Historique" && (
          <>
            <h3>Éléments observés</h3>
            <p className="mm-muted">{classroom}</p>
            {measured ? (
              <div className="mm-history">
                {student.corroborated && (
                  <div>
                    <i />
                    <strong>Observations sur des items indépendants</strong>
                    <p>Nouvel exercice · difficulté corroborée</p>
                  </div>
                )}
                <div>
                  <i />
                  <strong>{classroom}</strong>
                  <p>Quiz de séance · {student.correct} bonnes réponses sur {student.answered}</p>
                </div>
                <div>
                  <i />
                  <strong>Réussite au quiz</strong>
                  <p>Synthèse des notions évaluées · {student.mastery} %</p>
                </div>
              </div>
            ) : (
              <p>Aucune tentative enregistrée pour cette séance.</p>
            )}
          </>
        )}
      </div>
      <footer className="mm-panel-footer">
        {group ? (
          <a
            className="mm-primary mm-full"
            href={
              "/teacher/groups?group=" +
              group.id +
              "&lesson=" + lessonId + "&student=" +
              student.id +
              "&view=plan"
            }
          >
            <BookOpen size={16} />
            Voir la remédiation
          </a>
        ) : (
          <a className="mm-outline mm-full" href="/teacher/lessons">
            <BookOpen size={16} />
            Consulter les séances
          </a>
        )}
      </footer>
    </aside>
  );
}

function ClassroomMirror({ data, selector }: {
  data: ReturnType<typeof useMirrorData>; selector: ReactNode;
}) {
  const { students: roster, groups, edges, selected: lesson, dashboard } = data;
  const lessonId = lesson?.id ?? "";
  const classroom = lesson?.title ?? "";
  const requested = new URLSearchParams(window.location.search).get("student");
  const [selected, setSelected] = useState<string | null>(
    roster.find((s) => s.id === requested)?.id ?? null,
  );
  const [groupMode, setGroupMode] = useState(false);
  const [activeGroup, setActiveGroup] = useState(groups[0]?.id ?? "");
  const [focus, setFocus] = useState(0);
  const [list, setList] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const student = roster.find((s) => s.id === selected);
  const group = groups.find((g) => g.id === activeGroup);
  const studentGroup = groups.find(
    (g) => selected && g.members.includes(selected),
  );
  const matches = roster.filter((s) =>
    s.label.toLowerCase().includes(query.trim().toLowerCase()),
  );
  const select = (s: Student) => {
    setSelected(s.id);
    setGroupMode(false);
    setSearchOpen(false);
    setQuery("");
    setFocus((i) => i + 1);
  };
  const report = groups.find((g) => g.status !== "rejected");
  return (
    <div className="mm mm-view">
      <header className="mm-heading">
        <div>
          <h1>MindMirror</h1>
          <p>
            Vue de la compréhension de la classe et des difficultés communes.
          </p>
        </div>
        {selector}
        {roster.length > 0 && (
          <div
            className="mm-segment"
            aria-label="Mode de visualisation"
            role="group"
          >
            <button
              aria-pressed={!groupMode}
              onClick={() => setGroupMode(false)}
            >
              Vue classe
            </button>
            <button
              aria-pressed={groupMode}
              onClick={() => {
                setGroupMode(true);
                setSearchOpen(false);
                setQuery("");
                setList(false);
              }}
            >
              Vue groupes
            </button>
          </div>
        )}
      </header>
      {!roster.length ? (
        <div className="mm-empty">
          <Network size={26} />
          <h2>La constellation est en attente de réponses</h2>
          <p>
            Publiez un quiz dans cette classe pour commencer à suivre les
            notions évaluées.
          </p>
          <a className="mm-outline" href="/teacher/lessons/new">
            Préparer une séance <ArrowRight size={15} />
          </a>
        </div>
      ) : (
        <>
          <div
            className={"mm-grid " + (!groupMode && !student ? "mm-wide" : "")}
          >
            <section
              className="mm-graph-column"
              aria-label="Visualisation de la classe"
            >
              <div className="mm-graph-toolbar">
                <span className="mm-session">
                  <span />
                  {lesson?.title}
                </span>
                <div className="mm-graph-tools">
                  <button
                    aria-label="Rechercher un étudiant"
                    aria-expanded={searchOpen}
                    title="Rechercher un étudiant"
                    onClick={() => {
                      setSearchOpen(!searchOpen);
                      setQuery("");
                    }}
                  >
                    <Search size={15} />
                  </button>
                  <button
                    aria-label={
                      list
                        ? "Afficher la constellation"
                        : "Afficher la liste des étudiants"
                    }
                    title={
                      list
                        ? "Afficher la constellation"
                        : "Afficher la liste des étudiants"
                    }
                    aria-pressed={list}
                    onClick={() => {
                      setList(!list);
                      setGroupMode(false);
                      setSearchOpen(false);
                      setQuery("");
                    }}
                  >
                    {list ? <Network size={15} /> : <List size={15} />}
                  </button>
                </div>
                {searchOpen && (
                  <div className="mm-search">
                    <div>
                      <Search size={15} />
                      <input
                        autoFocus
                        placeholder="Rechercher un étudiant…"
                        aria-label="Identifiant étudiant"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Escape") setSearchOpen(false);
                          if (e.key === "Enter" && matches.length === 1)
                            select(matches[0]);
                        }}
                      />
                      <button
                        aria-label="Fermer la recherche"
                        onClick={() => setSearchOpen(false)}
                      >
                        <X size={15} />
                      </button>
                    </div>
                    <ul>
                      {matches.map((s) => (
                        <li key={s.id}>
                          <button onClick={() => select(s)}>
                            {s.label}
                            <small>
                              {s.mastery === null
                                ? "Sans réponse"
                                : s.mastery + " %"}
                            </small>
                          </button>
                        </li>
                      ))}
                    </ul>
                    {!matches.length && <small>Aucun étudiant trouvé.</small>}
                  </div>
                )}
              </div>
              {groupMode && (
                <div
                  className="mm-group-picks"
                  role="group"
                  aria-label="Sélectionner un groupe"
                >
                  {groups.map((g) => (
                    <button
                      aria-pressed={g.id === activeGroup}
                      title={
                        g.name +
                        " · " +
                        g.status
                          .replace("rejected", "refusé")
                          .replace("accepted", "accepté")
                          .replace("suggested", "proposé")
                      }
                      onClick={() => setActiveGroup(g.id)}
                      key={g.id}
                    >
                      <i style={{ background: g.color }} />
                      {g.name.replace("Groupe ", "")}
                      {activeGroup === g.id && <Check size={12} />}
                    </button>
                  ))}
                </div>
              )}
              {list ? (
                <div className="mm-student-list">
                  <div className="mm-list-head">
                    <span>Étudiant</span>
                    <span>Réussite au quiz</span>
                  </div>
                  {roster.map((s) => (
                    <button
                      key={s.id}
                      className={selected === s.id ? "active" : ""}
                      onClick={() => select(s)}
                    >
                      <span>
                        <UserRound size={15} />
                        {s.label}
                      </span>
                      <span>
                        {s.mastery === null ? "Sans réponse" : s.mastery + " %"}
                        <ChevronRight size={13} />
                      </span>
                    </button>
                  ))}
                </div>
              ) : (
                <Constellation
                  selected={selected}
                  students={roster}
                  links={edges}
                  focus={focus}
                  groups={groups}
                  groupMode={groupMode}
                  activeGroup={activeGroup}
                  onGroup={setActiveGroup}
                  onSelect={select}
                />
              )}
            </section>
            {groupMode && group ? (
              <GroupPanel group={group} students={roster} lessonId={lessonId} />
            ) : (
              student && (
                <StudentPanel
                  key={lessonId + ":" + student.id}
                  student={student}
                  classroom={classroom}
                  lessonId={lessonId}
                  group={studentGroup}
                  onClose={() => setSelected(null)}
                />
              )
            )}
          </div>
          <section className="mm-context">
            <div className="mm-takeaway">
              <span className="mm-target">
                <Target size={24} />
              </span>
              <div>
                <h2>À retenir</h2>
                {dashboard?.priorities.length ? dashboard.priorities.map((priority) => <p key={priority.misconception_code}>
                  {priority.label} · {priority.affected_students} étudiants concernés · {priority.corroborated_students} cas corroborés
                </p>) : <p>Aucune erreur associée à une notion dans cette séance.</p>}
              </div>
            </div>
            <div className="mm-context-actions">
              <h2>Actions suggérées</h2>
              <div>
                <a className="mm-outline" href={"/teacher/groups?lesson=" + lessonId + (report ? "&group=" + report.id : "")}>
                  <Users size={16} /> Voir les groupes
                </a>
                <a className="mm-primary" href="/teacher/lessons/new">
                  <CalendarDays size={16} />
                  Préparer une séance
                </a>
              </div>
            </div>
          </section>
        </>
      )}
    </div>
  );
}

export default function Mirror({ path, classroom }: { path: string; classroom: string }) {
  const params = new URLSearchParams(window.location.search);
  const data = useMirrorData(classroom, true, params.get("lesson"));
  const isGraph = path.startsWith("/teacher/mindmirror");
  const selector = data.available.length > 0 && <label>Séance
    <select aria-label="Séance" value={data.selected?.id ?? ""} onChange={(event) =>
      window.location.assign((isGraph ? "/teacher/mindmirror" : "/teacher/groups") + "?lesson=" + event.target.value)}>
      {data.available.map((lesson) => <option value={lesson.id} key={lesson.id}>{lesson.title}</option>)}
    </select>
  </label>;
  if (data.loading) return <p role="status">Chargement des réponses…</p>;
  if (data.error) return <p role="alert">{data.error}</p>;
  return isGraph ? <ClassroomMirror key={data.selected?.id ?? classroom} data={data} selector={selector} /> :
    <Groups key={data.selected?.id ?? classroom} groups={data.groups} students={data.students}
      lessonId={data.selected?.id ?? ""} selector={selector} />;
}
