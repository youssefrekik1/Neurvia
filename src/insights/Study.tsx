"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ArrowRight, BookOpen, Brain, Check, Flame, HelpCircle, MessageCircle, Send, Sparkles, Target } from "lucide-react";
import { COACH_STUDENT, CONCEPTS, KEY_IDEAS, MISCONCEPTIONS, REVIEW, TARGET, conceptByCode, type Concept } from "../demo/data";
import "./insights.css";

const pct = (v: number) => Math.round(v * 100) + " %";
const SHAKY = 0.6;

/** Gap rule: walk down shaky prerequisites from the target and return the deepest one. */
export function findGap(target: string): { gap: Concept; path: Concept[] } {
  let best: { depth: number; path: Concept[] } = { depth: 0, path: [conceptByCode[target]] };
  const walk = (code: string, path: Concept[]) => {
    for (const pre of conceptByCode[code].prereqs) {
      const concept = conceptByCode[pre];
      if (concept.mastery >= SHAKY) continue;
      const next = [...path, concept];
      const better = next.length > best.path.length
        || (next.length === best.path.length && concept.mastery < best.path[best.path.length - 1].mastery);
      if (better) best = { depth: next.length, path: next };
      walk(pre, next);
    }
  };
  walk(target, [conceptByCode[target]]);
  return { gap: best.path[best.path.length - 1], path: best.path };
}

function depthOf(code: string): number {
  const c = conceptByCode[code];
  return c.prereqs.length ? 1 + Math.max(...c.prereqs.map(depthOf)) : 0;
}

function ConceptMap({ selected, choose, highlight }: { selected: string; choose: (c: string) => void; highlight: Set<string> }) {
  const layout = useMemo(() => {
    const layers: Record<number, string[]> = {};
    CONCEPTS.forEach((c) => { (layers[depthOf(c.code)] ??= []).push(c.code); });
    const pos: Record<string, { x: number; y: number }> = {};
    const depths = Object.keys(layers).map(Number);
    depths.forEach((d) => layers[d].forEach((code, i) => {
      pos[code] = { x: 70 + d * (760 / Math.max(1, depths.length - 1)), y: 60 + (i + 0.5) * (300 / layers[d].length) - 20 };
    }));
    return pos;
  }, []);
  const color = (m: number) => (m >= 0.8 ? "#16a34a" : m >= SHAKY ? "#65a30d" : m >= 0.4 ? "#f59e0b" : "#dc2626");
  return (
    <svg className="ni-map" viewBox="0 0 900 360" role="img" aria-label="Carte des notions et de leurs prérequis">
      <defs><marker id="arrow" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0L10,5L0,10z" fill="#9aa8bb" /></marker></defs>
      {CONCEPTS.flatMap((c) => c.prereqs.map((p) => {
        const a = layout[p], b = layout[c.code];
        const hot = highlight.has(p) && highlight.has(c.code);
        return <path key={p + c.code} d={`M${a.x + 58},${a.y} C${a.x + 120},${a.y} ${b.x - 120},${b.y} ${b.x - 62},${b.y}`}
          className={hot ? "ni-edge hot" : "ni-edge"} markerEnd="url(#arrow)" />;
      }))}
      {CONCEPTS.map((c) => {
        const p = layout[c.code];
        return (
          <g key={c.code} transform={`translate(${p.x},${p.y})`} className={"ni-node" + (selected === c.code ? " sel" : "") + (highlight.has(c.code) ? " hot" : "")}
            onClick={() => choose(c.code)} role="button" tabIndex={0} onKeyDown={(e) => e.key === "Enter" && choose(c.code)}>
            <rect x={-60} y={-26} width={120} height={52} rx={10} />
            <rect x={-50} y={12} width={100} height={5} rx={2} fill="#e6ebf2" />
            <rect x={-50 + c.low * 100} y={12} width={(c.high - c.low) * 100} height={5} rx={2} fill={color(c.mastery)} opacity={0.35} />
            <rect x={-50} y={12} width={c.mastery * 100} height={5} rx={2} fill={color(c.mastery)} />
            <text y={-6} textAnchor="middle">{c.name.length > 19 ? c.name.slice(0, 18) + "…" : c.name}</text>
            <text y={6} textAnchor="middle" className="ni-nodepct">{pct(c.mastery)}</text>
          </g>
        );
      })}
    </svg>
  );
}

export function StudyPath() {
  const [selected, setSelected] = useState(TARGET);
  const [why, setWhy] = useState(false);
  const { gap, path } = findGap(TARGET);
  const highlight = new Set(path.map((c) => c.code));
  const concept = conceptByCode[selected];
  const misconceptions = MISCONCEPTIONS.filter((m) => m.concept === selected);
  return (
    <div className="ni">
      <div className="ni-heading">
        <div><h1>Mon parcours · Bases de données</h1><p>Ce que tu maîtrises, ce qui bloque, et pourquoi Neurvia te propose cette étape.</p></div>
        <span className="ni-streak"><Flame size={16} /> {COACH_STUDENT.streak} jours d’affilée</span>
      </div>

      <section className="ni-card ni-next">
        <div>
          <small><Target size={14} /> Prochaine étape recommandée</small>
          <h2>Revoir « {gap.name} » avant « {conceptByCode[TARGET].name} »</h2>
          <p>Ta difficulté sur les jointures vient probablement d’un prérequis : {path.map((c) => c.name).join(" ← ")}.</p>
          <div className="ni-row">
            <Link className="ni-primary" href="/student/explain">Explique-le en 3 minutes <ArrowRight size={15} /></Link>
            <button type="button" className="ni-ghost" aria-expanded={why} onClick={() => setWhy(!why)}><HelpCircle size={15} /> Pourquoi ?</button>
          </div>
        </div>
        {why && (
          <ul className="ni-why ni-fade">
            <li><b>Lacune</b> « {gap.name} » est à {pct(gap.mastery)} et la notion visée en dépend.</li>
            <li><b>Plateau</b> Les quiz sur « Associations et cardinalités » ne progressent plus depuis 11 jours : on change de format.</li>
            <li><b>Incertitude</b> Fourchette de {pct(gap.low)} à {pct(gap.high)} : une session lèvera le doute.</li>
            <li><b>Objectif</b> Examen de Bases de données dans 12 jours : l’algèbre relationnelle y compte pour 30 %.</li>
            <li><b>Fatigue</b> Tu as déjà fait 2 sessions aujourd’hui : on te propose 10 minutes, pas plus.</li>
          </ul>
        )}
      </section>

      <section className="ni-card">
        <header className="ni-row"><h2>Carte des notions</h2><small className="ni-sub">La barre claire est la fourchette d’estimation à 80 %. Le chemin en couleur mène à ta lacune.</small></header>
        <ConceptMap selected={selected} choose={setSelected} highlight={highlight} />
        <div className="ni-detail">
          <div>
            <small>{concept.chapter}</small>
            <h3>{concept.name}</h3>
            <p>Maîtrise estimée {pct(concept.mastery)} (entre {pct(concept.low)} et {pct(concept.high)}). Source : <BookOpen size={13} /> {concept.source}</p>
            {concept.prereqs.length > 0 && <p>S’appuie sur : {concept.prereqs.map((p) => conceptByCode[p].name).join(", ")}</p>}
          </div>
          {misconceptions.map((m) => <p key={m.code} className="ni-mis"><strong>Piège fréquent : {m.label}</strong>{m.fix}</p>)}
        </div>
      </section>

      <section className="ni-card">
        <h2>Révisions espacées</h2>
        <ul className="ni-review">
          {REVIEW.map((r) => (
            <li key={r.concept}>
              <span className={r.due === 0 ? "ni-due now" : "ni-due"}>{r.due === 0 ? "Aujourd’hui" : "Dans " + r.due + " j"}</span>
              <div><strong>{conceptByCode[r.concept].name}</strong><p>{r.reason}</p></div>
              {r.due === 0 && <Link className="ni-small" href={r.reason.includes("Explique") ? "/student/explain" : "/student/coach"}>Réviser</Link>}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

type Message = { from: "me" | "coach"; text: string; sources?: string[]; chips?: string[] };

function coachReply(question: string): Message {
  const q = question.toLowerCase();
  if (q.includes("trompe") || q.includes("erreur") || q.includes("faux")) {
    return { from: "coach", text: "D’après tes 5 derniers quiz de Bases de données, tes deux erreurs les plus fréquentes :\n\n1. **Lire la cardinalité du mauvais côté** (4 fois) : dans CLIENT (1,1) — passe — (0,n) COMMANDE, tu as compris « un client passe une seule commande ». La cardinalité se lit côté entité : un client passe 0 à n commandes.\n2. **Clé étrangère placée côté 1** (3 fois) : pour une association 1,n, c’est COMMANDE qui reçoit #id_client.\n\nLa première est la plus urgente : tu as répondu « très sûr » 3 fois sur 4.", sources: ["BD-Cours-1.pdf · p. 50", "BD-cours-2.pdf · p. 11"], chips: ["Donne-moi un exercice sur les cardinalités", "Explique-moi la clé étrangère"] };
  }
  if (q.includes("exercice") || q.includes("entraîn") || q.includes("cardinalit")) {
    return { from: "coach", text: "Lis ce schéma :\n\n```\nÉTUDIANT (0,n) —— s’inscrit —— (1,n) MODULE\n```\n\n1. Un étudiant peut-il ne s’inscrire à aucun module ?\n2. Comment traduis-tu cette association en tables ?\n\nRéponds-moi et je te dis où se trouve le piège.", sources: ["BD-Cours-1.pdf · p. 50", "BD-cours-2.pdf · p. 16"], chips: ["Oui, et on crée une table INSCRIPTION", "Je ne sais pas"] };
  }
  if (q.includes("inscription") || q.includes("oui")) {
    return { from: "coach", text: "Exactement ! Le minimum 0 côté ÉTUDIANT signifie qu’il peut n’avoir aucun module. Et comme l’association est **n,n**, elle devient une table à part :\n\n```\nINSCRIPTION(#id_etudiant, #id_module)\n```\n\nSa clé primaire est le couple des deux clés étrangères. Ta maîtrise des cardinalités passe de 38 % à 47 %.", chips: ["Et pour une association 1,n ?", "Qu’est-ce que je dois réviser ensuite ?"] };
  }
  if (q.includes("étrangère") || q.includes("etrangere") || q.includes("1,n") || q.includes("clé")) {
    return { from: "coach", text: "Pour une association **1,n**, on ne crée pas de table : la clé de l’entité côté 1 « migre » dans la table côté n.\n\n```\nCLIENT(id_client, nom, ville)\nCOMMANDE(id_commande, date, #id_client)\n```\n\nRègle mnémotechnique : la clé étrangère va là où il y a le « n ».", sources: ["BD-cours-2.pdf · p. 11-14"], chips: ["Donne-moi un exercice", "Qu’est-ce que je dois réviser ensuite ?"] };
  }
  if (q.includes("jointure") || q.includes("join")) {
    return { from: "coach", text: "Une jointure combine deux relations en gardant les lignes qui vérifient une condition, en général **clé étrangère = clé primaire** :\n\n```\nCLIENT ⋈ CLIENT.id_client = COMMANDE.id_client COMMANDE\n```\n\nSans cette condition, tu obtiens le produit cartésien : chaque client associé à chaque commande.", sources: ["BD-Cours-4.pdf · p. 56-58"], chips: ["Donne-moi un exercice", "Qu’est-ce que je me trompe le plus ?"] };
  }
  if (q.includes("fourier") || q.includes("signal") || q.includes("a0") || q.includes("a₀")) {
    return { from: "coach", text: "Dans ton cours manuscrit de Mathématiques du signal, une série de Fourier écrit un signal 2π-périodique comme une somme de cosinus et de sinus.\n\nLe premier coefficient est la **valeur moyenne** du signal :\n\n```\na₀ = 1/(2π) ∫₀^{2π} f(x) dx\n```\n\nPiège fréquent : oublier le facteur 1/(2π). Et si f est paire, tous les bₙ sont nuls.", sources: ["Chapitre-1.pdf (manuscrit) · p. 1"], chips: ["Qu’est-ce que je dois réviser ensuite ?"] };
  }
  if (q.includes("réviser") || q.includes("ensuite") || q.includes("quoi faire") || q.includes("on y va")) {
    return { from: "coach", text: "Pour progresser sur les **jointures**, la notion de ton prochain examen, il faut d’abord consolider les cardinalités et le passage au relationnel. Je te propose 10 minutes : un « Explique-le » sur les cardinalités, puis 3 questions de vérification.", sources: ["BD-Cours-1.pdf · p. 50"], chips: ["D’accord, on y va", "Explique-moi les jointures"] };
  }
  return { from: "coach", text: "Je réponds à partir de tes supports de cours (Bases de données et Mathématiques du signal). Je peux t’expliquer une notion, te montrer tes erreurs fréquentes ou te proposer un exercice adapté à ton niveau.", chips: ["Qu’est-ce que je me trompe le plus ?", "Explique-moi les jointures", "Explique-moi les séries de Fourier"] };
}

function Rich({ text }: { text: string }) {
  return <>{text.split(/```\n?/).map((part, i) => i % 2
    ? <pre key={i}><code>{part.trimEnd()}</code></pre>
    : <p key={i}>{part.split(/\*\*/).map((s, j) => (j % 2 ? <strong key={j}>{s}</strong> : s))}</p>)}</>;
}

export function Coach() {
  const [messages, setMessages] = useState<Message[]>([{
    from: "coach", text: `Salut ${COACH_STUDENT.name.split(" ")[0]} ! Je suis ton coach Neurvia. Je connais tes cours et tes résultats. Par quoi on commence ?`,
    chips: ["Qu’est-ce que je me trompe le plus ?", "Explique-moi les jointures", "Explique-moi les séries de Fourier"],
  }]);
  const [draft, setDraft] = useState("");
  const [thinking, setThinking] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [messages, thinking]);
  function ask(text: string) {
    if (!text.trim() || thinking) return;
    setMessages((m) => [...m, { from: "me", text }]);
    setDraft(""); setThinking(true);
    setTimeout(() => { setMessages((m) => [...m, coachReply(text)]); setThinking(false); }, 900 + Math.min(700, text.length * 12));
  }
  const last = messages[messages.length - 1];
  return (
    <div className="ni">
      <div className="ni-heading"><div><h1>Coach IA</h1><p>Il répond à partir de tes supports de cours, cite ses sources et connaît tes erreurs fréquentes.</p></div></div>
      <section className="ni-card ni-chat">
        <div className="ni-msgs" aria-live="polite">
          {messages.map((m, i) => (
            <div key={i} className={"ni-msg " + m.from + " ni-fade"}>
              {m.from === "coach" && <i><Sparkles size={15} /></i>}
              <div>
                <Rich text={m.text} />
                {m.sources && <div className="ni-src">{m.sources.map((s) => <span key={s}><BookOpen size={12} /> {s}</span>)}</div>}
              </div>
            </div>
          ))}
          {thinking && <div className="ni-msg coach"><i><Sparkles size={15} /></i><div className="ni-typing"><i /><i /><i /></div></div>}
          <div ref={end} />
        </div>
        {!thinking && last.chips && <div className="ni-chips">{last.chips.map((c) => <button type="button" key={c} onClick={() => ask(c)}>{c}</button>)}</div>}
        <form className="ni-input" onSubmit={(e) => { e.preventDefault(); ask(draft); }}>
          <MessageCircle size={17} />
          <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Pose ta question… (ex. je ne comprends pas les cardinalités)" aria-label="Message" />
          <button type="submit" aria-label="Envoyer" disabled={!draft.trim() || thinking}><Send size={16} /></button>
        </form>
      </section>
    </div>
  );
}

export function ExplainBack() {
  const options = Object.keys(KEY_IDEAS);
  const [code, setCode] = useState("C_CARD");
  const [text, setText] = useState("");
  const [checked, setChecked] = useState(false);
  const ideas = KEY_IDEAS[code];
  const lower = text.toLowerCase();
  const covered = ideas.map((idea) => idea.words.some((w) => lower.includes(w)));
  const score = covered.filter(Boolean).length;
  return (
    <div className="ni">
      <div className="ni-heading"><div><h1>Explique-le</h1><p>Explique la notion avec tes mots, comme à un camarade. Expliquer, c’est la meilleure façon de vérifier qu’on a compris.</p></div></div>
      <section className="ni-card ni-explain">
        <div className="ni-seg" role="group" aria-label="Notion">
          {options.map((o) => <button type="button" key={o} aria-pressed={o === code} onClick={() => { setCode(o); setChecked(false); setText(""); }}>{conceptByCode[o].name}</button>)}
        </div>
        <label>
          <span><Brain size={16} /> Explique « {conceptByCode[code].name} »</span>
          <textarea rows={7} value={text} onChange={(e) => { setText(e.target.value); setChecked(false); }}
            placeholder="Par exemple : une cardinalité est un couple (min, max) qui indique…" />
        </label>
        <div className="ni-row">
          <button type="button" className="ni-primary" disabled={text.trim().length < 20} onClick={() => setChecked(true)}>Vérifier mon explication</button>
          <small className="ni-sub">{text.trim().split(/\s+/).filter(Boolean).length} mots</small>
        </div>
        {checked && (
          <div className="ni-result ni-fade">
            <div className="ni-score"><b>{score}/{ideas.length}</b><span>idées clés couvertes</span></div>
            <ul>
              {ideas.map((idea, i) => (
                <li key={idea.idea} className={covered[i] ? "ok" : "miss"}>
                  {covered[i] ? <Check size={15} /> : <HelpCircle size={15} />} {idea.idea}
                  {!covered[i] && <small> · à ajouter ({conceptByCode[code].source})</small>}
                </li>
              ))}
            </ul>
            <p>{score === ideas.length
              ? "Excellent, ton explication est complète. Cette notion revient dans 6 jours pour consolider."
              : score >= ideas.length / 2
                ? "Bonne base. Ajoute les idées manquantes, puis réessaie : c’est souvent là que se cachent les erreurs."
                : "C’est un début. Relis la page indiquée, puis explique de nouveau. Le coach peut t’aider."}</p>
            {score < ideas.length && <Link className="ni-ghost" href="/student/coach">Demander au coach <ArrowRight size={14} /></Link>}
          </div>
        )}
      </section>
    </div>
  );
}
