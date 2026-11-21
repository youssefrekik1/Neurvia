import { useEffect, useMemo, useRef, useState } from "react";
import { Crosshair, Info, Maximize, Minus, Plus, Users, X } from "lucide-react";
import { curve, makeLayout, satellites, sky } from "./layout";
import type { Point } from "./layout";
import type { Schema } from "../lib/api";
import type { Group, Student } from "./service";

type Props = {
  selected: string | null;
  focus: number;
  groups: Group[];
  students: Student[];
  links: Schema["GraphEdge"][];
  groupMode: boolean;
  activeGroup: string;
  onGroup: (id: string) => void;
  onSelect: (student: Student) => void;
};
const origin = { x: 0, y: 0, k: 1 };
const center = { x: 450, y: 250 };
const hues = ["#70caff", "#f5c879", "#c499ff", "#b4d8e9"];

export default function Constellation({
  selected,
  focus,
  groups,
  students,
  links,
  activeGroup,
  groupMode,
  onSelect,
  onGroup,
}: Props) {
  const [camera, setCamera] = useState(origin);
  const [edges, setEdges] = useState(true);
  const [legend, setLegend] = useState(false);
  const [reduced, setReduced] = useState(
    () =>
      localStorage.getItem("neurvia.reduceMotion") === "true" ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  const [dragging, setDragging] = useState(false);
  const drag = useRef<Point | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const model = useMemo(() => makeLayout(students, groups, links), [students, groups, links]);
  const selectedStar = model.stars.find((s) => s.student.id === selected);
  const selectedMembers =
    groups.find((g) => g.id === activeGroup)?.members ?? [];
  const selectStar = (student: Student) => {
    const group = groups.find((g) => g.members.includes(student.id));
    if (groupMode && group) onGroup(group.id);
    else onSelect(student);
  };
  function recenter() {
    if (selectedStar)
      setCamera({
        k: 1.24,
        x: center.x - selectedStar.x * 1.24,
        y: center.y - selectedStar.y * 1.24,
      });
  }
  useEffect(() => {
    if (focus > 0 && selectedStar)
      setCamera({
        k: 1.22,
        x: center.x - selectedStar.x * 1.22,
        y: center.y - selectedStar.y * 1.22,
      });
  }, [focus, selectedStar]);
  function zoom(factor: number, anchor = center) {
    setCamera((c) => {
      const k = Math.max(0.7, Math.min(3.5, c.k * factor));
      return {
        k,
        x: anchor.x - ((anchor.x - c.x) * k) / c.k,
        y: anchor.y - ((anchor.y - c.y) * k) / c.k,
      };
    });
  }
  function point(clientX: number, clientY: number) {
    const matrix = svgRef.current?.getScreenCTM();
    return matrix
      ? new DOMPoint(clientX, clientY).matrixTransform(matrix.inverse())
      : center;
  }
  useEffect(() => {
    const element = svgRef.current;
    if (!element) return;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      zoom(e.deltaY < 0 ? 1.09 : 1 / 1.09, point(e.clientX, e.clientY));
    };
    element.addEventListener("wheel", wheel, { passive: false });
    return () => element.removeEventListener("wheel", wheel);
  }, []);
  return (
    <div className="mm-sky">
      <svg
        ref={svgRef}
        className="mm-map"
        viewBox="0 0 900 500"
        role="group"
        aria-label={`Constellation interactive. ${students.length} étudiants. Utilisez Tab pour sélectionner un profil.`}
        onPointerDown={(event) => {
          if (
            event.button !== 0 ||
            (event.target as Element).closest("[role=button]")
          )
            return;
          drag.current = point(event.clientX, event.clientY);
          event.currentTarget.setPointerCapture(event.pointerId);
          setDragging(true);
        }}
        onPointerMove={(event) => {
          if (!drag.current) return;
          const p = point(event.clientX, event.clientY);
          const dx = p.x - drag.current.x,
            dy = p.y - drag.current.y;
          setCamera((c) => ({ ...c, x: c.x + dx, y: c.y + dy }));
          drag.current = p;
        }}
        onPointerUp={() => {
          drag.current = null;
          setDragging(false);
        }}
        onPointerCancel={() => {
          drag.current = null;
          setDragging(false);
        }}
        style={{ cursor: dragging ? "grabbing" : "grab" }}
      >
        <defs>
          {hues.map((hue, i) => (
            <radialGradient id={"mm-glow" + i} key={hue}>
              <stop offset="0" stopColor="#fff" />
              <stop offset=".09" stopColor={hue} stopOpacity=".96" />
              <stop offset=".22" stopColor={hue} stopOpacity=".68" />
              <stop offset=".45" stopColor={hue} stopOpacity=".25" />
              <stop offset="1" stopColor={hue} stopOpacity="0" />
            </radialGradient>
          ))}
          <radialGradient id="mm-bluemist">
            <stop stopColor="#295780" stopOpacity=".25" />
            <stop offset="1" stopColor="#254167" stopOpacity="0" />
          </radialGradient>
        </defs>
        <g aria-hidden="true">
          {sky.map((s, i) => (
            <circle
              key={i}
              cx={s.x}
              cy={s.y}
              r={s.r}
              fill={i % 7 === 0 ? "#d4b8ff" : "#bddeff"}
              opacity={s.opacity}
            />
          ))}
        </g>
        <g
          style={{
            transform:
              "translate(" +
              camera.x +
              "px," +
              camera.y +
              "px) scale(" +
              camera.k +
              ")",
            transition:
              dragging || reduced ? "none" : "transform 330ms ease-out",
          }}
        >
          <ellipse
            cx="410"
            cy="245"
            rx="320"
            ry="180"
            fill="url(#mm-bluemist)"
          />
          {edges &&
            model.edges.map(({ a, b, weight, provisional }, index) => {
              const related =
                a.student.id === selected || b.student.id === selected;
              const dim = groupMode && !selectedMembers.includes(a.student.id);
              return (
                <path
                  key={a.student.id + b.student.id}
                  d={curve(a, b, index % 2 ? 0.15 : -0.12)}
                  fill="none"
                  stroke={a.color}
                  opacity={dim ? 0.11 : related ? 0.76 : 0.19 + weight * 0.13}
                  strokeWidth={related ? 1.1 : 0.8}
                  strokeDasharray={provisional ? "4 3" : undefined}
                />
              );
            })}
          {model.stars.map((star) => {
            const { student, x, y, cluster, color } = star;
            const selectedNode = !groupMode && student.id === selected;
            const measured = student.mastery !== null;
            const luminosity = 0.38 + (student.mastery ?? 0) * 0.006;
            const glow = "url(#mm-glow" + (cluster < 0 ? 3 : cluster % hues.length) + ")";
            const hub = cluster >= 0 && groups[cluster]?.members[0] === student.id;
            const radius =
              (hub ? 22 : 9) * luminosity + (selectedNode ? 26 : 0);
            return (
              <g
                key={student.id}
                opacity={
                  groupMode && !selectedMembers.includes(student.id) ? 0.34 : 1
                }
              >
                {measured &&
                  satellites(star, selectedNode).map((s, i) => {
                    const tint = selectedNode
                      ? s.score! >= 80
                        ? "#90e3c8"
                        : s.score! < 50
                          ? "#f5a6ac"
                          : "#ffda98"
                      : color;
                    return (
                      <g key={i}>
                        <title>
                          {student.label +
                            " · " +
                            s.label +
                            " · " +
                            s.score +
                            " %"}
                        </title>
                        {edges && (
                          <path
                            d={curve(star, s, i % 2 ? 0.2 : -0.17)}
                            fill="none"
                            stroke={color}
                            strokeWidth={selectedNode ? 1 : 0.7}
                            opacity={selectedNode ? 0.66 : hub ? 0.41 : 0.23}
                          />
                        )}
                        <circle
                          cx={s.x}
                          cy={s.y}
                          r={selectedNode ? 6 : hub ? 4.2 : 2.4}
                          fill={glow}
                        />
                        <circle
                          cx={s.x}
                          cy={s.y}
                          r={selectedNode ? 2.3 : hub ? 1.7 : 1}
                          fill={tint}
                          opacity={selectedNode ? 1 : 0.75}
                        />
                      </g>
                    );
                  })}
                <g
                  role="button"
                  tabIndex={0}
                  aria-label={
                    student.label +
                    ", " +
                    (measured
                      ? "réussite au quiz " + student.mastery + " %"
                      : "en attente de réponse")
                  }
                  className="mm-star"
                  onClick={() => selectStar(student)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      selectStar(student);
                    }
                  }}
                >
                  <title>
                    {student.label +
                      " · " +
                      (measured
                        ? student.mastery + " % de réussite au quiz"
                        : "Données insuffisantes")}
                  </title>
                  <circle cx={x} cy={y} r="15" fill="transparent" />
                  {measured ? (
                    <>
                      {(hub || selectedNode) && (
                        <circle
                          cx={x}
                          cy={y}
                          r={radius * 2.4}
                          fill={glow}
                          opacity=".34"
                        />
                      )}
                      <circle
                        cx={x}
                        cy={y}
                        r={radius}
                        fill={glow}
                        opacity={luminosity}
                      />
                      <circle
                        cx={x}
                        cy={y}
                        r={selectedNode ? 7 : hub ? 5.4 : 2.8}
                        fill={color}
                        opacity={luminosity}
                      />
                      <circle
                        cx={x}
                        cy={y}
                        r={selectedNode ? 4.6 : hub ? 3.65 : 1.7}
                        fill="#f5fdff"
                        opacity={luminosity}
                      />
                    </>
                  ) : (
                    <circle
                      cx={x}
                      cy={y}
                      r="3.6"
                      fill="#172a40"
                      stroke="#a9bece"
                      strokeWidth="1.2"
                      strokeDasharray="2 1.1"
                    />
                  )}
                  <circle
                    className="mm-node-ring"
                    cx={x}
                    cy={y}
                    r={selectedNode ? 16 : 10}
                    fill="none"
                    stroke="#e4f8ff"
                    strokeWidth="1.3"
                    opacity={selectedNode ? 1 : 0}
                  />
                  <g
                    className={
                      "mm-node-name" + (selectedNode ? " is-selected" : "")
                    }
                    transform={"translate(" + (x + 8) + "," + (y - 34) + ")"}
                  >
                    <rect
                      x="0"
                      y="-8"
                      width="39"
                      height="22"
                      rx="5"
                      fill="#132944"
                      stroke="#819eb8"
                      strokeWidth=".8"
                    />
                    <text
                      x="19.5"
                      y="7"
                      fill="#f8fcff"
                      fontSize="12"
                      fontWeight="600"
                      textAnchor="middle"
                    >
                      {student.label}
                    </text>
                  </g>
                </g>
              </g>
            );
          })}
        </g>
      </svg>
      <div className="mm-camera">
        {[
          { label: "Zoom avant", icon: Plus, action: () => zoom(1.23) },
          { label: "Zoom arrière", icon: Minus, action: () => zoom(1 / 1.23) },
          {
            label: "Réinitialiser la caméra",
            icon: Maximize,
            action: () => setCamera(origin),
          },
          {
            label: "Centrer l’étudiant sélectionné",
            icon: Crosshair,
            action: recenter,
            disabled: !selectedStar || groupMode,
          },
        ].map(({ label, icon: Icon, action, disabled }) => (
          <button
            title={label}
            aria-label={label}
            key={label}
            onClick={action}
            disabled={disabled}
          >
            <Icon size={17} />
          </button>
        ))}
      </div>
      <button
        className="mm-legend-toggle mm-glass"
        onClick={() => setLegend(!legend)}
        aria-expanded={legend}
      >
        Légende <Info size={14} />
      </button>
      {legend && (
        <section className="mm-legend">
          <div>
            <strong>Lire la constellation</strong>
            <button
              aria-label="Fermer la légende"
              onClick={() => setLegend(false)}
            >
              <X size={16} />
            </button>
          </div>
          <p>
            L’éclat indique la réussite au quiz au quiz. Les points creux
            signalent une absence de réponse.
          </p>
          <p>
            Les étoiles reliées partagent des erreurs. Leurs petits satellites
            représentent les notions évaluées.
          </p>
          <label>
            <input
              type="checkbox"
              checked={reduced}
              onChange={(e) => {
                setReduced(e.target.checked);
                localStorage.setItem(
                  "neurvia.reduceMotion",
                  String(e.target.checked),
                );
                document.documentElement.dataset.motion = e.target.checked
                  ? "reduced"
                  : "auto";
              }}
            />{" "}
            Réduire les mouvements
          </label>
        </section>
      )}
      <div className="mm-sky-footer">
        <div className="mm-glass mm-counter">
          <Users size={15} />
          <span>{students.length} étudiants</span>
          <i />
          <span>
            {groups.filter((g) => g.status !== "rejected").length} groupes
          </span>
        </div>
        <button
          className="mm-glass mm-connections"
          role="switch"
          aria-checked={edges}
          aria-label="Afficher les connexions"
          onClick={() => setEdges(!edges)}
        >
          Connexions <span className={"mm-switch " + (edges ? "on" : "")} />
        </button>
      </div>
    </div>
  );
}
