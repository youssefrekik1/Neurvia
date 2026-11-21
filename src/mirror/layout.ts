import type { Group, Student } from "./service";
import type { Schema } from "../lib/api";

export type Point = { x: number; y: number };
export type Star = Point & { student: Student; color: string; cluster: number; index: number };
export type Connection = { a: Star; b: Star; weight: number; provisional: boolean };

export function makeLayout(students: Student[], groups: Group[], links: Schema["GraphEdge"][]) {
  const anchors = students.map((_, index) => ({
    x: 85 + random(index + 17) * 730,
    y: 70 + random(index + 210) * 365,
  }));
  const stars: Star[] = students.map((student, index) => {
    const cluster = groups.findIndex((group) => group.status !== "rejected" && group.members.includes(student.id));
    return { student, ...anchors[index], index, cluster, color: groups[cluster]?.color ?? "#b4d8e9" };
  });
  const byId = new Map(stars.map((star) => [star.student.id, star]));
  const edges: Connection[] = links.flatMap((link) => {
    const a = byId.get(link.source), b = byId.get(link.target);
    return a && b ? [{ a, b, weight: link.similarity, provisional: link.provisional }] : [];
  });
  for (let iteration = 0; iteration < 95; iteration++) {
    const forces = stars.map((star) => ({
      x: (anchors[star.index].x - star.x) * 0.22,
      y: (anchors[star.index].y - star.y) * 0.22,
    }));
    for (let i = 0; i < stars.length; i++)
      for (let j = i + 1; j < stars.length; j++) {
        const dx = stars[i].x - stars[j].x,
          dy = stars[i].y - stars[j].y;
        const distance = Math.max(1, Math.hypot(dx, dy)),
          repulsion = 12000 / distance ** 2;
        forces[i].x += (dx / distance) * repulsion;
        forces[i].y += (dy / distance) * repulsion;
        forces[j].x -= (dx / distance) * repulsion;
        forces[j].y -= (dy / distance) * repulsion;
      }
    for (const edge of edges) {
      const dx = edge.b.x - edge.a.x,
        dy = edge.b.y - edge.a.y;
      const distance = Math.max(1, Math.hypot(dx, dy)),
        spring = (distance - 96) * edge.weight * 0.024;
      const a = edge.a.index, b = edge.b.index;
      forces[a].x += (dx / distance) * spring;
      forces[a].y += (dy / distance) * spring;
      forces[b].x -= (dx / distance) * spring;
      forces[b].y -= (dy / distance) * spring;
    }
    stars.forEach((star, i) => {
      star.x += forces[i].x * 0.2;
      star.y += forces[i].y * 0.2;
    });
  }
  return { stars, edges };
}
export function curve(a: Point, b: Point, bend: number) {
  const cx = (a.x + b.x) / 2 - (b.y - a.y) * bend;
  const cy = (a.y + b.y) / 2 + (b.x - a.x) * bend;
  return "M " + a.x + " " + a.y + " Q " + cx + " " + cy + " " + b.x + " " + b.y;
}
function random(seed: number) {
  const n = Math.sin(seed * 78.233 + 43.5453) * 43758.5453;
  return n - Math.floor(n);
}
export const sky = Array.from({ length: 420 }, (_, i) => ({
  x: random(i + 6) * 900,
  y: random(i + 1200) * 500,
  r: 0.24 + 0.85 * random(i + 19) ** 6,
  opacity: 0.13 + random(i + 471) * 0.47,
}));
export function satellites(star: Star, selected: boolean) {
  const idx = star.index;
  return star.student.concepts.map(({ score, label }, j) => {
    const angle = (j / star.student.concepts.length) * Math.PI * 2 + idx * 2.34 + random(j + idx) * 0.45;
    const length = (selected ? 58 : 20) + random(idx * 3 + j) * 32;
    return {
      x: star.x + Math.cos(angle) * length,
      y: star.y + Math.sin(angle) * length,
      score, label,
    };
  });
}
