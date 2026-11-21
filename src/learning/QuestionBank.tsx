"use client";

import { useState } from "react";
import { api, errorMessage, refresh, type Schema, useGet } from "../lib/api";
import { levels, type Question } from "./bank";
import { QuestionForm } from "./Teacher";
import { Heading, Prompt } from "./ui";
import { Sources } from "./CourseDocuments";
import "./learning.css";

const roles: Record<Schema["QuestionRole"], string> = {
  initial: "Quiz initial", confirmation: "Confirmation",
  immediate_retest: "Retest immédiat", j7_retest: "Révision J+7",
};

export default function QuestionBank() {
  const bank = useGet<Schema["TeacherQuestion"][]>("/bank/questions");
  const taxonomy = useGet<Schema["ConceptView"][]>("/taxonomy");
  const [writing, setWriting] = useState(false);
  const [role, setRole] = useState<Schema["QuestionRole"]>("initial");
  const [target, setTarget] = useState("");
  const [review, setReview] = useState("");
  const [approved, setApproved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const concepts = taxonomy.value ?? [];
  const errors = new Map(concepts.flatMap((concept) => concept.misconceptions).map((item) => [item.code, item.label_fr]));

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setNotice("");
    try { await action(); refresh(); } catch (error) { setNotice(errorMessage(error)); }
    finally { setBusy(false); }
  }
  function save(value: Question) {
    if (busy) return;
    void run(async () => {
      const concept = concepts.find((item) => item.label_fr === value.concept);
      if (!concept) throw new Error("Sélectionnez un concept.");
      await api("/bank/questions", "POST", {
        concept_code: concept.code, stem: value.text, code: value.code || null,
        explanation: value.explanation, difficulty: levels.indexOf(value.level) + 1,
        role, target_misconception_code: role === "initial" ? null : target || null,
        options: value.options.map((text, index) => ({
          text, is_correct: index === value.correct,
          misconception_code: index === value.correct ? null : value.misconceptions[index] || null,
        })),
      } satisfies Schema["BankQuestionCreate"]);
      setWriting(false);
    });
  }
  return <div className="lr-workspace">
    <Heading title="Banque pédagogique" description="Relisez les items et préparez des variantes indépendantes." />
    <div className="lr-actions"><button className="lr-btn primary" disabled={!concepts.length || busy}
      onClick={() => { setWriting(!writing); setTarget(""); }}>Rédiger un item</button></div>
    {(notice || bank.error || taxonomy.error) && <p className="lr-error" role="alert">{notice || bank.error || taxonomy.error}</p>}
    {writing && <section className="lr-panel lr-pad lr-form">
      <label>Étape <select value={role} onChange={(event) => setRole(event.target.value as Schema["QuestionRole"])}>
        {Object.entries(roles).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select></label>
      {role !== "initial" && <label>Difficulté ciblée
        <select value={target} onChange={(event) => setTarget(event.target.value)}>
          <option value="">Sélectionner une difficulté</option>
          {[...errors].map(([code, label]) => <option key={code} value={code}>{label}</option>)}
        </select><small>Associez cette difficulté à un distracteur de l’item.</small>
      </label>}
      <QuestionForm taxonomy={concepts} onSave={save} onCancel={() => setWriting(false)}
        initial={{ id: "", text: "", concept: concepts[0]?.label_fr ?? "", options: ["", "", "", ""],
          correct: 0, explanation: "", misconceptions: ["", "", "", ""], source: "Professeur", level: levels[0] }} />
    </section>}
    {bank.loading && <p role="status">Chargement de la banque…</p>}
    <div className="lr-stack">{bank.value?.map((item) => <section className="lr-panel lr-pad" key={item.id}>
      <p className="lr-badge">{roles[item.role]} · {item.status === "validated" ? "Approuvé" : "Brouillon"}
        {item.source === "llm" && " · Généré depuis les documents"}
        {item.target_misconception_code && " · Cible : " + (errors.get(item.target_misconception_code) ?? "")}</p>
      <Prompt question={{ id: item.id, text: item.stem, code: item.code ?? undefined, options: [],
        correct: -1, concept: item.concept_code, explanation: "", misconceptions: [], source: "Banque", level: levels[0] }} />
      {review === item.id ? <>
        <ul>{item.options.map((option) => <li key={option.id}>{option.text}
          {option.is_correct ? " · Réponse correcte" : option.misconception_code ? " · " + errors.get(option.misconception_code) : ""}
        </li>)}</ul>
        <p>{item.explanation}</p>
        <div className="lr-docs"><Sources sources={item.source_pages ?? []} /></div>
        {item.status !== "validated" && <div className="lr-actions">
          <label className="lr-check"><input type="checkbox" checked={approved}
            onChange={(event) => setApproved(event.target.checked)} /> J’ai relu cet item</label>
          <button className="lr-btn primary" disabled={!approved || busy} onClick={() => void run(async () => {
            await api("/bank/questions/" + item.id + "/approve", "POST", { validated: true });
            setReview(""); setApproved(false);
          })}>Approuver l’item</button>
        </div>}
      </> : <button className="lr-btn sm" onClick={() => { setReview(item.id); setApproved(false); }}>Relire</button>}
    </section>)}</div>
  </div>;
}
