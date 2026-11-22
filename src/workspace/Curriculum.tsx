"use client";

import { useState, type FormEvent } from "react";
import { BookOpen, GraduationCap, Plus } from "lucide-react";
import { api, errorMessage, refresh, type Schema, useGet } from "../lib/api";

const BUILTIN = "Algorithmique & Python";

function useRun() {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  async function run(action: () => Promise<unknown>, message: string) {
    setBusy(true);
    setNotice("");
    try { await action(); refresh(); setNotice(message); }
    catch (error) { setNotice(errorMessage(error)); }
    finally { setBusy(false); }
  }
  return { busy, notice, run };
}

function ClassPicker({ cohorts, selected, onChange }: {
  cohorts: Schema["CohortView"][]; selected: string[]; onChange: (ids: string[]) => void;
}) {
  if (!cohorts.length) return <p>Créez d’abord une classe.</p>;
  return <div className="lr-checks">{cohorts.map((cohort) =>
    <label className="lr-check" key={cohort.id}>
      <input type="checkbox" checked={selected.includes(cohort.id)}
        onChange={(event) => onChange(event.target.checked ? [...selected, cohort.id]
          : selected.filter((id) => id !== cohort.id))} />
      {cohort.name}
    </label>)}</div>;
}

function SubjectCard({ subject, cohorts, busy, run }: {
  subject: Schema["SubjectView"]; cohorts: Schema["CohortView"][]; busy: boolean;
  run: (action: () => Promise<unknown>, message: string) => Promise<void>;
}) {
  const taught = subject.courses.map((course) => course.cohort_id);
  const [selected, setSelected] = useState(taught);
  const changed = selected.length !== taught.length || selected.some((id) => !taught.includes(id));
  return <section className="nd-card">
    <h2><BookOpen size={18} /> {subject.name}</h2>
    {subject.courses.length ? <ul className="nd-courses">{subject.courses.map((course) =>
      <li key={course.classroom_id}><strong>{course.cohort_name}</strong> · {course.student_count} étudiant(s) ·{" "}
        {course.lesson_count} séance(s)</li>)}</ul> : <p>Aucune classe pour le moment.</p>}
    <fieldset className="lr-form">
      <legend>Classes où j’enseigne cette matière</legend>
      <ClassPicker cohorts={cohorts} selected={selected} onChange={setSelected} />
      <button className="lr-btn" disabled={busy || !changed}
        onClick={() => void run(() => api("/subjects/" + subject.id + "/cohorts", "PUT", { cohort_ids: selected }),
          "Classes de « " + subject.name + " » mises à jour.")}>Enregistrer les classes</button>
    </fieldset>
  </section>;
}

/** Teacher view: the subjects they teach, the classes for each, and the classes of the school. */
export function TeacherCurriculum() {
  const subjects = useGet<Schema["SubjectView"][]>("/subjects");
  const cohortList = useGet<Schema["CohortView"][]>("/me/cohorts");
  const cohorts = cohortList.value ?? [];
  const { busy, notice, run } = useRun();
  const [choice, setChoice] = useState(BUILTIN);
  const [other, setOther] = useState("");
  const [classes, setClasses] = useState<string[]>([]);
  const [cohortName, setCohortName] = useState("");

  function addSubject(event: FormEvent) {
    event.preventDefault();
    const name = choice === "other" ? other.trim() : choice;
    void run(async () => {
      await api("/subjects", "POST", { name, cohort_ids: classes });
      setOther(""); setClasses([]);
    }, "Matière « " + name + " » ajoutée.");
  }
  function addCohort(event: FormEvent) {
    event.preventDefault();
    void run(async () => { await api("/cohorts", "POST", { name: cohortName.trim() }); setCohortName(""); },
      "Classe « " + cohortName.trim() + " » créée.");
  }

  return <>
    {notice && <p role="status">{notice}</p>}
    {(subjects.error || cohortList.error) && <p role="alert" className="lr-error">{subjects.error || cohortList.error}</p>}
    {subjects.value?.map((subject) =>
      <SubjectCard key={subject.id + ":" + subject.courses.map((c) => c.cohort_id).join()} subject={subject}
        cohorts={cohorts} busy={busy} run={run} />)}
    {subjects.value?.length === 0 && <p>Vous n’avez pas encore de matière. Ajoutez celles que vous enseignez.</p>}
    <section className="nd-card">
      <h2><Plus size={18} /> Ajouter une matière</h2>
      <form className="lr-form" onSubmit={addSubject}>
        <label>Matière
          <select value={choice} onChange={(event) => setChoice(event.target.value)}>
            <option value={BUILTIN}>{BUILTIN}</option>
            <option value="other">Autre matière</option>
          </select>
        </label>
        {choice === "other" && <label>Nom de la matière
          <input value={other} onChange={(event) => setOther(event.target.value)} required maxLength={100}
            placeholder="Ex. Bases de données" />
        </label>}
        <fieldset><legend>Classes concernées</legend>
          <ClassPicker cohorts={cohorts} selected={classes} onChange={setClasses} />
        </fieldset>
        <button className="lr-btn primary" disabled={busy}>Ajouter la matière</button>
      </form>
    </section>
    <section className="nd-card">
      <h2><GraduationCap size={18} /> Classes</h2>
      <p>Les étudiants choisissent leur classe à l’inscription. Ils suivent automatiquement les matières qui y sont
        enseignées.</p>
      <ul className="nd-courses">{cohorts.map((cohort) => <li key={cohort.id}>{cohort.name}</li>)}</ul>
      <form className="lr-form" onSubmit={addCohort}>
        <label>Nouvelle classe<input value={cohortName} onChange={(event) => setCohortName(event.target.value)}
          required maxLength={120} placeholder="Ex. L2 Informatique A" /></label>
        <button className="lr-btn" disabled={busy}>Créer la classe</button>
      </form>
    </section>
  </>;
}

/** Student view: their class, or a choice of class when they have none yet. */
export function StudentClass() {
  const mine = useGet<Schema["CohortView"] | null>("/me/cohort");
  const cohorts = useGet<Schema["CohortView"][]>(mine.value === null ? "/cohorts" : "");
  const [selected, setSelected] = useState("");
  const { busy, notice, run } = useRun();
  if (mine.loading) return <p role="status">Chargement…</p>;
  return <section className="nd-card">
    {notice && <p role="status">{notice}</p>}
    {mine.value ? <>
      <h2><GraduationCap size={18} /> {mine.value.name}</h2>
      <p>Vous suivez automatiquement les matières enseignées dans votre classe.</p>
    </> : <form className="lr-form" onSubmit={(event) => {
      event.preventDefault();
      void run(() => api("/me/cohort", "POST", { cohort_id: selected }), "Classe choisie.");
    }}>
      <h2>Choisissez votre classe</h2>
      <label>Classe
        <select value={selected} onChange={(event) => setSelected(event.target.value)} required>
          <option value="">Sélectionner…</option>
          {cohorts.value?.map((cohort) => <option key={cohort.id} value={cohort.id}>{cohort.name}</option>)}
        </select>
      </label>
      <button className="lr-btn primary" disabled={busy || !selected}>Confirmer ma classe</button>
    </form>}
  </section>;
}
