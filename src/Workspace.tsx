"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Home,
  School,
  BookOpen,
  Network,
  Users,
  Settings,
  Bell,
  ChevronDown,
  Menu,
  LogOut,
  ListChecks,
  Library,
  ChartNoAxesColumnIncreasing,
  CircleHelp,
  X,
} from "lucide-react";
import Login from "./login/Login";
import { getRole, logout } from "./login/auth";
import Mirror from "./mirror/Mirror";
import Learning from "./learning/Learning";
import { Dashboard, Classes, SettingsPage, Help } from "./workspace/Dashboards";

const teacherLinks = [
  { slug: "dashboard", label: "Accueil", icon: Home },
  { slug: "classes", label: "Mes classes", icon: School },
  { slug: "lessons", label: "Séances & quiz", icon: BookOpen },
  { slug: "mindmirror", label: "MindMirror", icon: Network },
  { slug: "groups", label: "Groupes", icon: Users },
  { slug: "settings", label: "Paramètres", icon: Settings },
];
const studentLinks = [
  { slug: "dashboard", label: "Mon espace", icon: Home },
  { slug: "tasks", label: "Mes tâches", icon: ListChecks },
  { slug: "courses", label: "Mes cours", icon: Library },
  {
    slug: "progress",
    label: "Ma progression",
    icon: ChartNoAxesColumnIncreasing,
  },
  { slug: "help", label: "Aide", icon: CircleHelp },
];
export const classrooms = ["L1 Python · Groupe A", "L1 Python · Groupe B"];
export default function Workspace({ path }: { path: string }) {
  const router = useRouter();
  const [, role, page] = path.split("/");
  const [ready, setReady] = useState(false),
    [classroom, setClassroom] = useState(classrooms[0]);
  const [drawer, setDrawer] = useState(false),
    [popover, setPopover] = useState("");
  useEffect(() => {
    if (role === "student" || role === "teacher") {
      const active = getRole();
      if (active !== role) {
        location.replace(active ? "/" + active + "/dashboard" : "/login");
        return;
      }
    }
    document.documentElement.dataset.motion =
      localStorage.getItem("neurvia.reduceMotion") === "true"
        ? "reduced"
        : "auto";
    const stored = localStorage.getItem("neurvia.classroom");
    if (stored && classrooms.includes(stored)) setClassroom(stored);
    setReady(true);
  }, [role]);
  useEffect(() => {
    const close = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setDrawer(false);
        setPopover("");
      }
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, []);
  if (path === "/" || role === "login") return <Login />;
  if (!ready) return <p className="loading">Ouverture de votre espace…</p>;
  const teacher = role === "teacher",
    links = teacher ? teacherLinks : studentLinks;
  function choose(value: string) {
    setClassroom(value);
    localStorage.setItem("neurvia.classroom", value);
  }
  let content;
  if (page === "dashboard")
    content = <Dashboard teacher={teacher} classroom={classroom} />;
  else if (teacher && page === "classes")
    content = <Classes classroom={classroom} choose={choose} />;
  else if (teacher && page === "settings") content = <SettingsPage />;
  else if (!teacher && page === "help") content = <Help />;
  else if (teacher && ["mindmirror", "groups", "remediation"].includes(page))
    content = <Mirror path={path} classroom={classroom} />;
  else if (
    ["lessons", "quiz", "tasks", "courses", "progress", "feedback"].includes(
      page,
    )
  )
    content = <Learning path={path} classroom={classroom} />;
  else
    content = (
      <section>
        <h1>Page introuvable</h1>
        <a href={"/" + role + "/dashboard"}>Retour à l’accueil</a>
      </section>
    );
  return (
    <div className={"nv-shell " + (teacher ? "nv-teacher" : "nv-student")}>
      <a className="skip" href="#contenu">
        Aller au contenu
      </a>
      {drawer && (
        <button
          aria-label="Fermer le menu"
          className="scrim"
          onClick={() => setDrawer(false)}
        />
      )}
      <aside className={"nv-side " + (drawer ? "open" : "")}>
        <a className="nv-brand" href={"/" + role + "/dashboard"}>
          <img src="/logo.svg" alt="" />
          Neurvia
        </a>
        <nav aria-label="Navigation principale">
          {links.map(({ slug, label, icon: Icon }) => (
            <a
              key={slug}
              href={"/" + role + "/" + slug}
              aria-current={page === slug ? "page" : undefined}
            >
              <Icon size={18} />
              {label}
            </a>
          ))}
        </nav>
      </aside>
      <div className="nv-stage">
        <header className="nv-bar">
          <button
            className="mobile-menu"
            aria-label="Ouvrir le menu"
            onClick={() => setDrawer(true)}
          >
            <Menu />
          </button>
          <label className="nv-class">
            <Users size={17} />
            <select
              aria-label="Classe active"
              value={classroom}
              onChange={(e) => choose(e.target.value)}
            >
              {classrooms.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
            <ChevronDown size={14} />
          </label>
          <div className="nv-account">
            <button
              aria-label="Notifications"
              aria-expanded={popover === "news"}
              onClick={() => setPopover(popover === "news" ? "" : "news")}
            >
              <Bell size={19} />
            </button>
            <button
              aria-label="Mon compte"
              aria-expanded={popover === "user"}
              onClick={() => setPopover(popover === "user" ? "" : "user")}
            >
              <b className="nv-avatar">{teacher ? "BS" : "M"}</b>
              <ChevronDown size={14} />
            </button>
          </div>
          {popover && (
            <div className="nv-pop">
              <button
                className="nv-close"
                aria-label="Fermer"
                onClick={() => setPopover("")}
              >
                <X size={16} />
              </button>
              {popover === "news" ? (
                <>
                  <strong>Notifications</strong>
                  <p>Retrouvez vos activités dans votre espace.</p>
                  <a href={teacher ? "/teacher/groups" : "/student/tasks"}>
                    {teacher ? "Examiner les groupes" : "Voir mes tâches"} →
                  </a>
                </>
              ) : (
                <>
                  <strong>{teacher ? "Mme Ben Salem" : "Malek"}</strong>
                  <p>{teacher ? "Professeure" : "Étudiant"} · Démonstration</p>
                  <button
                    onClick={() => {
                      logout();
                      router.replace("/login");
                    }}
                  >
                    <LogOut size={15} /> Se déconnecter
                  </button>
                </>
              )}
            </div>
          )}
        </header>
        <main id="contenu" className="nv-content" key={classroom}>
          {content}
        </main>
        <footer className="nv-demo">
          Données fictives · Espace de démonstration
        </footer>
      </div>
    </div>
  );
}
