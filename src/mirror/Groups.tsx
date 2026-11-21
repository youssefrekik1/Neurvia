"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import { ArrowRight, Check, ChevronDown, Clock3, Pencil, Users, X } from "lucide-react";
import { api, errorMessage, refresh, type Schema, useGet } from "../lib/api";
import type { Group, Student } from "./service";

const statuses: Record<Group["status"], string> = {
  suggested: "Proposé", accepted: "Accepté", modified: "Modifié", rejected: "Refusé",
};
const stages = ["initial", "immediate", "j7"] as const;
const groupLink = (lessonId: string, groupId: string) =>
  "/teacher/groups?lesson=" + lessonId + "&group=" + groupId;

function canPlan(group: Group) {
  return group.status === "accepted" || group.status === "modified";
}

function Members({ group, students, lessonId }: { group: Group; students: Student[]; lessonId: string }) {
  const names = new Map(students.map((student) => [student.id, student.label]));
  return <p className="mm-chips">
    {group.members.map((id) => <a href={"/teacher/mindmirror?lesson=" + lessonId + "&student=" + id} key={id}>
      {names.get(id) ?? "Étudiant"}</a>)}
  </p>;
}

export function GroupActions({ group, students }: { group: Group; students: Student[] }) {
  const [editing, setEditing] = useState(false);
  const [members, setMembers] = useState(group.members);
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const assigned = group.intervention?.status === "assigned";

  async function change(action: Schema["GroupUpdate"]["action"]) {
    setMessage("");
    setBusy(true);
    try {
      await api("/groups/" + group.id, "PATCH", {
        action, ...(action === "modify" ? { student_ids: members } : {}), reason: reason || null,
      } satisfies Schema["GroupUpdate"]);
      setEditing(false);
      refresh();
    } catch (error) { setMessage(errorMessage(error)); }
    finally { setBusy(false); }
  }

  if (assigned) return <p className="mm-muted">Groupe affecté à une intervention.</p>;
  return <div className="mm-group-actions">
    <div className="mm-actions-row">
      {!canPlan(group) && <button className="mm-primary" disabled={busy} onClick={() => void change("accept")}>
        <Check size={15} /> Accepter
      </button>}
      <button className="mm-outline" disabled={busy} aria-expanded={editing}
        onClick={() => { setMembers(group.members); setEditing(!editing); }}>
        <Pencil size={14} /> Modifier
      </button>
      {group.status !== "rejected" && <button className="mm-text-action" disabled={busy}
        onClick={() => void change("reject")}><X size={15} /> Refuser</button>}
    </div>
    <label className="mm-plan-label">Motif de la décision (facultatif)
      <input value={reason} onChange={(event) => setReason(event.target.value)} />
    </label>
    {editing && <form className="mm-members" onSubmit={(event) => { event.preventDefault(); void change("modify"); }}>
      <fieldset><legend>Composition du groupe</legend>
        <div>{students.map((student) => <label key={student.id}>
          <input type="checkbox" checked={members.includes(student.id)} onChange={(event) =>
            setMembers(event.target.checked ? [...members, student.id] : members.filter((id) => id !== student.id))} />
          {student.label}
        </label>)}</div>
      </fieldset>
      <button className="mm-primary" disabled={!members.length || busy}>Enregistrer ({members.length})</button>
    </form>}
    {message && <p className="mm-feedback" role="alert">{message}</p>}
  </div>;
}

function Intervention({ group, lessonId }: { group: Group; lessonId: string }) {
  const plan = group.intervention;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Schema["RemediationPlan"]>();
  const [approved, setApproved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function run(action: () => Promise<string | void>) {
    setBusy(true);
    setMessage("");
    try { setMessage(await action() ?? ""); refresh(); }
    catch (error) { setMessage(errorMessage(error)); }
    finally { setBusy(false); }
  }
  const fields = [["title", "Titre"], ["objective", "Objectif"], ["example", "Exemple"],
    ["counter_example", "Contre-exemple"], ["explanation", "Explication"], ["check_question", "Question de vérification"]] as const;
  return <section className="mm-plan">
    <div className="mm-plan-heading">
      <div><span className="mm-soft-label"><Clock3 size={14} /> 10 minutes</span>
        <h3>Plan de remédiation</h3></div>
      {plan && <span className={"mm-status " + (plan.status === "assigned" ? "accepted" : "suggested")}>
        {plan.status === "assigned" ? "Affecté" : "À valider"}
      </span>}
    </div>
    {!plan ? <button className="mm-primary" disabled={busy}
      onClick={() => void run(async () => { await api("/groups/" + group.id + "/remediation", "POST"); })}>
      {busy ? "Génération en cours…" : "Générer le plan"}
    </button> : <form onSubmit={(event: FormEvent) => {
      event.preventDefault();
      if (draft) void run(async () => {
        await api("/interventions/" + plan.id, "PATCH", { plan: draft }); setEditing(false);
      });
    }}>
      {plan.used_fallback && <p className="mm-muted">Modèle de plan utilisé en secours.</p>}
      <div className="mm-plan-fields">
        {fields.map(([key, title]) => <div key={key}>
          <label className="mm-plan-label" htmlFor={group.id + "-" + key}>{title}</label>
          {editing && draft ? <textarea id={group.id + "-" + key} required value={draft[key]}
            onChange={(event) => setDraft({ ...draft, [key]: event.target.value })} /> : <p>{plan.plan[key]}</p>}
        </div>)}
        {(draft && editing ? draft : plan.plan).steps.map((step, index) => <div key={step.start_min}>
          <label className="mm-plan-label" htmlFor={group.id + "-step-" + index}>
            {step.start_min}–{step.end_min} min
          </label>
          {editing && draft ? <textarea id={group.id + "-step-" + index} required value={step.action}
            onChange={(event) => setDraft({ ...draft, steps: draft.steps.map((item, i) =>
              i === index ? { ...item, action: event.target.value } : item) })} /> : <p>{step.action}</p>}
        </div>)}
      </div>
      {editing ? <div className="mm-actions-row">
        <button className="mm-primary" disabled={busy}>Enregistrer le plan</button>
        <button type="button" className="mm-outline" onClick={() => setEditing(false)}>Annuler</button>
      </div> : plan.status !== "assigned" ? <div className="mm-actions-row">
        <button type="button" className="mm-outline" onClick={() => { setDraft(plan.plan); setEditing(true); }}>
          <Pencil size={14} /> Modifier le plan
        </button>
        <label><input type="checkbox" checked={approved} onChange={(event) => setApproved(event.target.checked)} />
          J’ai relu le plan
        </label>
        <button type="button" className="mm-primary" disabled={!approved || busy}
          onClick={() => void run(async () => {
            await api("/interventions/" + plan.id + "/assign", "POST", { validated: true });
          })}>Valider et affecter</button>
      </div> : <div className="mm-actions-row">
        <button type="button" className="mm-primary" disabled={busy}
          onClick={() => void run(async () => {
            const result = await api<Schema["ScheduleResult"]>("/lessons/" + lessonId + "/retest", "POST", { intervention_id: plan.id });
            return result.schedules.some((item) => item.status === "skipped")
              ? "Certains retests attendent une variante approuvée." : "Retests programmés.";
          })}>Lancer le retest</button>
        <button type="button" className="mm-outline" disabled={busy} onClick={() => void run(async () => {
          const result = await api<Schema["ScheduleResult"]>("/lessons/" + lessonId + "/j7/schedule", "POST");
          return result.schedules.some((item) => item.status === "skipped") ? "Variante J+7 manquante dans la banque." :
            result.schedules.length + " suivis J+7 enregistrés.";
        })}>Vérifier les suivis J+7</button>
      </div>}
    </form>}
    {message && <p className="mm-feedback" role="status">{message}</p>}
  </section>;
}

function BeforeAfter({ lessonId }: { lessonId: string }) {
  const resource = useGet<Schema["BeforeAfter"]>("/lessons/" + lessonId + "/before-after");
  const taxonomy = useGet<Schema["ConceptView"][]>("/taxonomy");
  const counts = (cell: Schema["Counts"]) => cell.attempts ? cell.correct + " / " + cell.attempts : "—";
  return <section className="mm-plan">
    <h2>Avant / après</h2>
    {resource.error && <p role="alert">{resource.error}</p>}
    {resource.value && <>
      <p>Réponses correctes par étape. Les dénominateurs correspondent aux réponses reçues.</p>
      <div className="nd-scroll"><table>
        <thead><tr><th>Notion</th><th>Initial</th><th>Retest</th><th>J+7</th></tr></thead>
        <tbody>{resource.value.concepts.map((item) => <tr key={item.concept_code}>
          <th>{taxonomy.value?.find((concept) => concept.code === item.concept_code)?.label_fr ?? item.concept_code}</th>
          {stages.map((stage) => <td key={stage}>{counts(item[stage])}</td>)}
        </tr>)}</tbody>
      </table></div>
      {(resource.value.error_counts ?? []).map((item) => <p key={item.group_id}>
        {taxonomy.value?.flatMap((c) => c.misconceptions).find((error) => error.code === item.misconception_code)?.label_fr ?? item.misconception_code}
        {" · Élèves avec l’erreur parmi ceux évalués : "}
        {stages.map((stage, index) => ["Initial ", "Retest ", "J+7 "][index] + counts(item[stage])).join(" · ")}
      </p>)}
    </>}
  </section>;
}

export default function Groups({ groups, students, lessonId, selector }: {
  groups: Group[]; students: Student[]; lessonId: string; selector: ReactNode;
}) {
  const requested = new URLSearchParams(window.location.search).get("group");
  const [expanded, setExpanded] = useState(requested);
  const [failure, setFailure] = useState("");
  const [busy, setBusy] = useState(false);
  return <div className="mm mm-groups-page">
    <header className="mm-heading"><div><h1>Groupes et remédiation</h1>
      <p>Examinez les difficultés communes et préparez une intervention ciblée.</p></div>{selector}
    </header>
    <div className="mm-groups-top"><h2>Groupes de la classe</h2>
      {lessonId && <button className="mm-primary" disabled={busy} onClick={async () => {
        setBusy(true); setFailure("");
        try { await api("/lessons/" + lessonId + "/groups/suggest", "POST"); refresh(); }
        catch (error) { setFailure(errorMessage(error)); }
        finally { setBusy(false); }
      }}>{busy ? "Calcul en cours…" : "Calculer les groupes"}</button>}
    </div>
    {failure && <p role="alert">{failure}</p>}
    {!groups.length && <div className="mm-empty">Aucun groupe proposé pour cette séance.</div>}
    <div className="mm-group-list">
      {groups.map((group) => <article className="mm-group-card" key={group.id}>
        <button className="mm-group-trigger" aria-expanded={expanded === group.id}
          onClick={() => setExpanded(expanded === group.id ? null : group.id)}>
          <span className="mm-group-icon"><Users size={21} /></span>
          <span className="mm-group-title"><strong>{group.name}</strong></span>
          <span className="mm-member-n">{group.members.length} étudiants</span>
          <span className={"mm-status " + group.status}>{statuses[group.status]}</span>
          <ChevronDown size={17} />
        </button>
        <div className="mm-group-summary"><span>{group.reason}</span>
          <span>{group.confidence === "provisional" ? "Provisoire" : "Difficulté corroborée"}</span></div>
        {expanded === group.id && <div className="mm-group-body">
          <h3>Membres du groupe</h3><Members group={group} students={students} lessonId={lessonId} />
          <GroupActions group={group} students={students} />
          {canPlan(group) && <Intervention group={group} lessonId={lessonId} />}
        </div>}
      </article>)}
    </div>
    {lessonId && <BeforeAfter lessonId={lessonId} />}
    <a className="mm-return-link" href={"/teacher/mindmirror?lesson=" + lessonId}>Ouvrir MindMirror <ArrowRight size={15} /></a>
  </div>;
}

export function GroupPanel({ group, students, lessonId }: { group: Group; students: Student[]; lessonId: string }) {
  return <aside className="mm-panel mm-group-panel">
    <div className="mm-panel-heading"><span className="mm-group-icon"><Users size={24} /></span>
      <div><h2>{group.name}</h2><small>{group.members.length} étudiants · {statuses[group.status]}</small></div>
    </div>
    <div className="mm-panel-inner">
      <h3>Pourquoi ce groupe ?</h3><p>{group.reason}</p>
      <Members group={group} students={students} lessonId={lessonId} />
      <GroupActions group={group} students={students} />
      <a className="mm-outline mm-full" href={groupLink(lessonId, group.id)}>Ouvrir la remédiation</a>
    </div>
  </aside>;
}
