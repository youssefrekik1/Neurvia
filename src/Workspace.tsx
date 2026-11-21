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
import { logout } from "./login/auth";
import { api, errorMessage, type Schema, useGet } from "./lib/api";
import Mirror from "./mirror/Mirror";
import Learning from "./learning/Learning";
import QuestionBank from "./learning/QuestionBank";
import { Dashboard, Classes, SettingsPage, Help } from "./workspace/Dashboards";

const teacherLinks = [
  { slug: "dashboard", label: "Accueil", icon: Home },
  { slug: "classes", label: "Mes classes", icon: School },
  { slug: "lessons", label: "Séances & quiz", icon: BookOpen },
  { slug: "bank", label: "Banque pédagogique", icon: Library },
  { slug: "mindmirror", label: "MindMirror", icon: Network },
  { slug: "groups", label: "Groupes", icon: Users },
  { slug: "settings", label: "Paramètres", icon: Settings },
];
const studentLinks = [
  { slug: "dashboard", label: "Mon espace", icon: Home },
  { slug: "tasks", label: "Mes tâches", icon: ListChecks },
  { slug: "classes", label: "Mes classes", icon: School },
  { slug: "courses", label: "Mes cours", icon: Library },
  {
    slug: "progress",
    label: "Ma progression",
    icon: ChartNoAxesColumnIncreasing,
  },
  { slug: "help", label: "Aide", icon: CircleHelp },
];
export default function Workspace({ path }: { path: string }) {
  const router = useRouter();
  const [, role, page] = path.split("/");
  const validRoute = role === "teacher" || role === "student" || role === "join";
  const profileResource = useGet<Schema["Profile"]>(validRoute ? "/me" : "");
  const profile = profileResource.value;
  const roomResource = useGet<Schema["ClassroomView"][]>(profile ? "/classrooms" : "");
  const classrooms = roomResource.value ?? [];
  const [preferred, setPreferred] = useState("");
  const classroom = classrooms.some((c) => c.id === preferred) ? preferred : classrooms[0]?.id ?? "";
  const room = classrooms.find((entry) => entry.id === classroom);
  const [drawer, setDrawer] = useState(false);
  const [popover, setPopover] = useState("");
  const [failure, setFailure] = useState("");
  useEffect(() => {
    document.documentElement.dataset.motion =
      localStorage.getItem("neurvia.reduceMotion") === "true" ? "reduced" : "auto";
    const stored = localStorage.getItem("neurvia.classroom");
    if (stored) setPreferred(stored);
  }, []);
  useEffect(() => {
    if (!validRoute || role === "join" || profileResource.loading) return;
    if (profile && profile.role !== role) router.replace("/" + profile.role + "/dashboard");
    if (!profile && profileResource.error === "Authentification requise.") router.replace("/login");
  }, [role, router, profile, profileResource.loading, profileResource.error, validRoute]);
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
  if (!validRoute) return <Login />;
  if (profileResource.loading || roomResource.loading) return <p className="loading">Ouverture de votre espace…</p>;
  if (!profile && role === "join") return <Login joinCode={page} />;
  if (!profile || roomResource.error) return <p className="loading" role="alert">
    {profileResource.error ?? roomResource.error} <a href="/login">Connexion</a>
  </p>;
  if (role !== "join" && profile.role !== role) return null;
  const teacher = profile.role === "teacher";
  const links = teacher ? teacherLinks : studentLinks;
  const appRole = profile.role;
  function choose(value: string) {
    setPreferred(value);
    localStorage.setItem("neurvia.classroom", value);
  }
  let content;
  if (page === "dashboard")
    content = <Dashboard teacher={teacher} classroom={classroom} profile={profile} />;
  else if (page === "classes" || role === "join")
    content = <Classes classroom={classroom} choose={choose} teacher={teacher} classrooms={classrooms} joinCode={role === "join" ? page : undefined} />;
  else if (teacher && page === "settings") content = <SettingsPage />;
  else if (teacher && page === "bank") content = <QuestionBank />;
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
        <a href={"/" + appRole + "/dashboard"}>Retour à l’accueil</a>
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
        <a className="nv-brand" href={"/" + appRole + "/dashboard"}>
          <img src="/logo.svg" alt="" />
          Neurvia
        </a>
        <nav aria-label="Navigation principale">
          {links.map(({ slug, label, icon: Icon }) => (
            <a
              key={slug}
              href={"/" + appRole + "/" + slug}
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
              {!classrooms.length && <option value="">Aucune classe</option>}
              {classrooms.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
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
              <b className="nv-avatar">{profile.full_name.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase()}</b>
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
                  <strong>{profile.full_name}</strong>
                  <p>{teacher ? "Professeur" : "Étudiant"}{profile.is_synthetic ? " · Démonstration" : ""}</p>
                  <button
                    onClick={async () => {
                      try { await logout(); router.replace("/login"); } catch (error) { setFailure(errorMessage(error)); }
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
        {failure && <p role="status" className="nv-demo">{failure}</p>}
        {(room?.is_synthetic || profile.is_synthetic) && <footer className="nv-demo">
          Données fictives · Démonstration
          {teacher && profile.is_synthetic && <button type="button" className="lr-btn sm" onClick={async () => {
            try {
              const clock = await api<Schema["DemoClockView"]>("/demo/advance", "POST");
              setFailure("Simulation · " + new Date(clock.now).toLocaleDateString("fr-FR", { timeZone: "Africa/Tunis" }));
            } catch (error) { setFailure(errorMessage(error)); }
          }}>Simuler J+7</button>}
        </footer>}
      </div>
    </div>
  );
}
