import { useState } from "react";
import {
  ArrowRight,
  Check,
  CheckCheck,
  ChevronDown,
  Clock3,
  ListChecks,
  Pencil,
  Users,
  X,
} from "lucide-react";
import { groupEvidence, students, updateGroup } from "./service";
import type { Group, Plan } from "./service";

const statusNames = {
  suggested: "Proposé",
  accepted: "Accepté",
  rejected: "Refusé",
};
const fields: { key: keyof Plan; label: string; time: string }[] = [
  { key: "objectif", label: "Objectif", time: "1 min" },
  { key: "exemple", label: "Exemple", time: "2 min" },
  { key: "contreExemple", label: "Contre-exemple", time: "1 min" },
  { key: "exercice", label: "Exercice guidé", time: "4 min" },
  { key: "verification", label: "Question de vérification", time: "2 min" },
];

export function GroupActions({
  group,
  classroom,
  compact = false,
}: {
  group: Group;
  classroom: string;
  compact?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [membership, setMembership] = useState(group.members);
  const [message, setMessage] = useState("");
  const change = (
    patch: Parameters<typeof updateGroup>[2],
    feedback: string,
  ) => {
    updateGroup(classroom, group.id, patch);
    setMessage(feedback);
  };
  return (
    <div className="mm-group-actions">
      <div className="mm-actions-row">
        {group.status !== "accepted" && (
          <button
            className="mm-primary"
            onClick={() =>
              change(
                { status: "accepted" },
                "Groupe accepté. Le plan est disponible pour relecture.",
              )
            }
          >
            <Check size={15} />
            Accepter
          </button>
        )}
        <button
          className="mm-outline"
          onClick={() => {
            setMembership(group.members);
            setEditing(!editing);
            setMessage("");
          }}
          aria-expanded={editing}
        >
          <Pencil size={14} />
          Modifier
        </button>
        {group.status !== "rejected" && (
          <button
            className="mm-text-action"
            onClick={() => {
              change(
                { status: "rejected", validated: false },
                "Suggestion refusée.",
              );
              setEditing(false);
            }}
          >
            <X size={15} />
            Refuser
          </button>
        )}
      </div>
      {editing && (
        <form
          className="mm-members"
          onSubmit={(e) => {
            e.preventDefault();
            if (!membership.length) return;
            change(
              { members: [...membership].sort(), validated: false },
              "Composition du groupe enregistrée.",
            );
            setEditing(false);
          }}
        >
          <fieldset>
            <legend>Composition du groupe</legend>
            <div>
              {students.map((s) => (
                <label key={s.id}>
                  <input
                    type="checkbox"
                    checked={membership.includes(s.id)}
                    onChange={(e) =>
                      setMembership(
                        e.target.checked
                          ? [...membership, s.id]
                          : membership.filter((id) => id !== s.id),
                      )
                    }
                  />
                  {s.id}
                </label>
              ))}
            </div>
          </fieldset>
          <div className="mm-actions-row">
            <button className="mm-primary" disabled={!membership.length}>
              Enregistrer ({membership.length})
            </button>
            <button
              type="button"
              className="mm-text-action"
              onClick={() => setEditing(false)}
            >
              Annuler
            </button>
          </div>
        </form>
      )}
      <p role="status" className="mm-feedback">
        {message}
      </p>
      {compact && group.status === "accepted" && (
        <a
          className="mm-outline mm-full"
          href={"/teacher/groups?group=" + group.id + "&view=plan"}
        >
          <ListChecks size={16} />
          Ouvrir le plan de 10 min
        </a>
      )}
    </div>
  );
}

function Intervention({
  group,
  classroom,
}: {
  group: Group;
  classroom: string;
}) {
  const [editing, setEditing] = useState(false);
  const [plan, setPlan] = useState(group.plan);
  return (
    <section className="mm-plan">
      <div className="mm-plan-heading">
        <div>
          <span className="mm-soft-label">
            <Clock3 size={14} />
            10 minutes
          </span>
          <h3>Plan de remédiation</h3>
        </div>
        <span
          className={
            "mm-status " + (group.validated ? "accepted" : "suggested")
          }
        >
          {group.validated ? "Validé" : "À valider"}
        </span>
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          updateGroup(classroom, group.id, { plan, validated: false });
          setEditing(false);
        }}
      >
        <div className="mm-plan-fields">
          {fields.map((field) => (
            <div key={field.key}>
              <div className="mm-plan-label">
                <label htmlFor={"mm-" + group.id + "-" + field.key}>
                  {field.label}
                </label>
                <small>{field.time}</small>
              </div>
              {editing ? (
                <textarea
                  id={"mm-" + group.id + "-" + field.key}
                  required
                  value={plan[field.key]}
                  onChange={(e) =>
                    setPlan({ ...plan, [field.key]: e.target.value })
                  }
                />
              ) : (
                <p>{group.plan[field.key]}</p>
              )}
            </div>
          ))}
        </div>
        {editing ? (
          <div className="mm-actions-row">
            <button
              className="mm-primary"
              disabled={Object.values(plan).some((v) => !v.trim())}
            >
              Enregistrer le plan
            </button>
            <button
              type="button"
              className="mm-outline"
              onClick={() => setEditing(false)}
            >
              Annuler
            </button>
          </div>
        ) : (
          <div className="mm-actions-row">
            <button
              className="mm-outline"
              type="button"
              onClick={() => {
                setPlan(group.plan);
                setEditing(true);
              }}
            >
              <Pencil size={14} />
              Modifier le plan
            </button>
            {!group.validated && (
              <button
                className="mm-primary"
                type="button"
                onClick={() =>
                  updateGroup(classroom, group.id, { validated: true })
                }
              >
                <CheckCheck size={16} />
                Valider le plan
              </button>
            )}
          </div>
        )}
      </form>
    </section>
  );
}

export default function Groups({
  groups,
  classroom,
}: {
  groups: Group[];
  classroom: string;
}) {
  const params = new URLSearchParams(window.location.search);
  const requested = params.get("group");
  const [expanded, setExpanded] = useState<string | null>(
    groups.find((g) => g.id === requested)?.id ??
      (params.get("view") === "plan"
        ? (groups.find((g) => g.status === "accepted")?.id ?? groups[0]?.id)
        : null),
  );
  const [filter, setFilter] = useState("all");
  const list = groups.filter((g) => filter === "all" || g.status === filter);
  return (
    <div className="mm mm-groups-page">
      <header className="mm-heading">
        <div>
          <h1>Groupes et remédiation</h1>
          <p>
            Examinez les difficultés communes et préparez une intervention
            ciblée.
          </p>
        </div>
      </header>
      <div className="mm-groups-top">
        <h2>Groupes de la classe</h2>
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          aria-label="Filtrer les groupes"
        >
          <option value="all">Tous les statuts</option>
          <option value="suggested">Proposés</option>
          <option value="accepted">Acceptés</option>
          <option value="rejected">Refusés</option>
        </select>
      </div>
      {!list.length && (
        <div className="mm-empty">
          Aucun groupe à afficher pour cette sélection.
        </div>
      )}
      <div className="mm-group-list">
        {list.map((group) => {
          const open = expanded === group.id;
          return (
            <article className="mm-group-card" key={group.id}>
              <button
                className="mm-group-trigger"
                aria-expanded={open}
                onClick={() => setExpanded(open ? null : group.id)}
              >
                <span className={"mm-group-icon " + group.id}>
                  <Users size={21} />
                </span>
                <span className="mm-group-title">
                  <strong>{group.name}</strong>
                  <small>{group.difficulty}</small>
                </span>
                <span className="mm-member-n">
                  {group.members.length} étudiants
                </span>
                <span className={"mm-status " + group.status}>
                  {statusNames[group.status]}
                </span>
                <ChevronDown
                  size={17}
                  style={{ transform: open ? "rotate(180deg)" : "" }}
                />
              </button>
              <div className="mm-group-summary">
                <span>{group.reason}</span>
                <span>{groupEvidence(group)}</span>
              </div>
              {open && (
                <div className="mm-group-body">
                  {requested === group.id &&
                    params.get("student") &&
                    group.members.includes(params.get("student")!) && (
                      <p className="mm-student-note">
                        Remédiation de {params.get("student")} ·{" "}
                        {group.difficulty}
                      </p>
                    )}
                  <h3>Membres du groupe</h3>
                  <p className="mm-chips">
                    {group.members.map((id) => (
                      <a href={"/teacher/mindmirror?student=" + id} key={id}>
                        {id}
                      </a>
                    ))}
                  </p>
                  <GroupActions classroom={classroom} group={group} />
                  {group.status === "accepted" ? (
                    <Intervention
                      key={group.id}
                      group={group}
                      classroom={classroom}
                    />
                  ) : (
                    <p className="mm-muted">
                      Acceptez le groupe pour consulter et valider son plan de
                      remédiation de 10 minutes.
                    </p>
                  )}
                </div>
              )}
            </article>
          );
        })}
      </div>
      <a className="mm-return-link" href="/teacher/mindmirror">
        Ouvrir MindMirror <ArrowRight size={15} />
      </a>
    </div>
  );
}

export function GroupPanel({
  group,
  classroom,
}: {
  group: Group;
  classroom: string;
}) {
  return (
    <aside className="mm-panel mm-group-panel">
      <div className="mm-panel-heading">
        <span className={"mm-group-icon " + group.id}>
          <Users size={24} />
        </span>
        <div>
          <h2>{group.name}</h2>
          <small>
            {group.members.length} étudiants · {statusNames[group.status]}
          </small>
        </div>
      </div>
      <div className="mm-panel-inner">
        <h3>Difficulté commune</h3>
        <p>{group.difficulty}</p>
        <h3>Pourquoi ce groupe ?</h3>
        <p>{group.reason}</p>
        <div className="mm-observation">
          <strong>Niveau de preuve</strong>
          <span>{groupEvidence(group)}</span>
        </div>
        <h3>Étudiants concernés</h3>
        <p className="mm-chips">
          {group.members.map((id) => (
            <a href={"/teacher/mindmirror?student=" + id} key={id}>
              {id}
            </a>
          ))}
        </p>
        <GroupActions
          key={group.id}
          group={group}
          classroom={classroom}
          compact
        />
      </div>
    </aside>
  );
}
