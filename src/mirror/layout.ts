import { initialGroups, similarity, students } from "./service";
import type { Student } from "./service";

export type Point = { x: number; y: number };
export type Star = Point & { student: Student; color: string; cluster: number };
export type Connection = { a: Star; b: Star; weight: number };
const anchor: Record<string, Point> = {
  A01: { x: 106, y: 347 },
  A02: { x: 677, y: 78 },
  A03: { x: 277, y: 147 },
  A04: { x: 670, y: 156 },
  A05: { x: 672, y: 405 },
  A06: { x: 201, y: 380 },
  A07: { x: 151, y: 131 },
  A08: { x: 778, y: 116 },
  A09: { x: 296, y: 356 },
  A10: { x: 373, y: 250 },
  A11: { x: 542, y: 95 },
  A12: { x: 518, y: 364 },
  A13: { x: 383, y: 88 },
  A14: { x: 746, y: 229 },
  A15: { x: 196, y: 221 },
  A16: { x: 241, y: 284 },
  A17: { x: 562, y: 273 },
  A18: { x: 102, y: 183 },
  A19: { x: 793, y: 349 },
  A20: { x: 590, y: 420 },
  A21: { x: 461, y: 417 },
  A22: { x: 447, y: 181 },
};

// Deterministic force relaxation keeps the same analytical cluster in the
// same region on repeat visits. Anchors set the initial astronomical framing.
function makeLayout() {
  const stars: Star[] = students.map((student) => {
    const cluster = initialGroups.findIndex((group) =>
      group.members.includes(student.id),
    );
    return {
      student,
      ...anchor[student.id],
      cluster,
      color: initialGroups[cluster]?.color ?? "#b4d8e9",
    };
  });
  const edges: Connection[] = [];
  for (let i = 0; i < stars.length; i++) {
    const a = stars[i];
    const options = stars
      .slice(i + 1)
      .map((b) => ({ a, b, weight: similarity(a.student, b.student) }))
      .filter((edge) => edge.weight >= 0.5)
      .sort(
        (l, r) =>
          Math.hypot(a.x - l.b.x, a.y - l.b.y) -
          Math.hypot(a.x - r.b.x, a.y - r.b.y),
      );
    edges.push(...options.slice(0, 2));
  }
  for (let iteration = 0; iteration < 95; iteration++) {
    const forces = stars.map((star) => ({
      x: (anchor[star.student.id].x - star.x) * 0.22,
      y: (anchor[star.student.id].y - star.y) * 0.22,
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
      const a = stars.indexOf(edge.a),
        b = stars.indexOf(edge.b);
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
export const model = makeLayout();
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
  const idx = Number(star.student.id.slice(1));
  return star.student.concepts.map((score, j) => {
    const angle = (j / 4) * Math.PI * 2 + idx * 2.34 + random(j + idx) * 0.45;
    const length = (selected ? 58 : 20) + random(idx * 3 + j) * 32;
    return {
      x: star.x + Math.cos(angle) * length,
      y: star.y + Math.sin(angle) * length,
      score,
    };
  });
}
