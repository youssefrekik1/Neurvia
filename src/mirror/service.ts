"use client";

import { type Schema, useGet } from "../lib/api";

export type Student = {
  id: string;
  label: string;
  mastery: number | null;
  correct: number;
  answered: number;
  concepts: { label: string; score: number }[];
  errors: string[];
  corroborated: boolean;
};
export type Group = {
  id: string; name: string; difficulty: string; reason: string; color: string;
  members: string[]; status: Schema["GroupStatus"]; confidence: Schema["GroupConfidence"];
  intervention?: Schema["InterventionView"] | null;
};
const colors = ["#70caff", "#f5c879", "#c499ff", "#b4d8e9"];

export function useMirrorData(classroom: string, teacher = true, requested?: string | null) {
  const lessons = useGet<Schema["LessonView"][]>(classroom && teacher ? "/classrooms/" + classroom + "/lessons" : "");
  const taxonomy = useGet<Schema["ConceptView"][]>(classroom && teacher ? "/taxonomy" : "");
  const available = lessons.value?.filter((lesson) => lesson.status !== "draft") ?? [];
  const selected = available.find((lesson) => lesson.id === requested) ?? available[0];
  const root = selected ? "/lessons/" + selected.id : "";
  const graph = useGet<Schema["Graph"]>(root ? root + "/graph" : "");
  const dashboard = useGet<Schema["Dashboard"]>(root ? root + "/dashboard" : "");
  const label = (code: string) => taxonomy.value?.flatMap((concept) => concept.misconceptions)
    .find((error) => error.code === code)?.label_fr ?? code;
  const students = graph.value?.nodes.map((node): Student => ({
    id: node.id, label: node.label, mastery: node.percent_correct == null ? null : Math.round(100 * node.percent_correct),
    correct: node.correct_count ?? 0, answered: node.answered_count ?? 0,
    concepts: Object.entries(node.concept_rates ?? {}).map(([code, ratio]) => ({
      label: taxonomy.value?.find((concept) => concept.code === code)?.label_fr ?? code,
      score: Math.round(ratio * 100),
    })),
    errors: (node.misconception_codes ?? []).map(label), corroborated: node.diagnosis_quality === "corroborated",
  })) ?? [];
  const groups = graph.value?.groups.map((group, index): Group => ({
    id: group.id, members: group.student_ids, name: group.label, difficulty: label(group.main_misconception_code),
    reason: group.evidence_summary, confidence: group.confidence_label, status: group.status,
    color: colors[index % colors.length], intervention: group.intervention,
  })) ?? [];
  return { students, groups, edges: graph.value?.edges ?? [], dashboard: dashboard.value,
    selected, available, root, error: lessons.error ?? graph.error ?? dashboard.error ?? taxonomy.error,
    loading: lessons.loading || taxonomy.loading || graph.loading || dashboard.loading,
  };
}
export function studentDifficulty(student: Student) {
  return student.errors.join(" · ") || (student.mastery === null ? "En attente de réponses" : "Aucune difficulté repérée");
}
