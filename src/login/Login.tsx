"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  ChartNoAxesColumnIncreasing,
  CircleHelp,
  Eye,
  EyeOff,
  GraduationCap,
  LockKeyhole,
  Mail,
  Menu,
  UserRound,
  UsersRound,
  X,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { login, register, type Role } from "./auth";
import { errorMessage, type Schema, useGet } from "../lib/api";
import "./login.css";

const information = {
  Fonctionnalités: [
    "Les professeurs préparent leurs séances, publient des quiz et explorent les réponses de leur classe avec MindMirror.",
    "Les étudiants retrouvent leurs cours, répondent aux quiz et suivent leur progression dans un espace personnel.",
  ],
  Établissements: [
    "Neurvia accompagne les établissements scolaires, les centres de formation et les universités.",
    "La démonstration vous invite à explorer une classe de première année en Python du point de vue du professeur ou de l’étudiant.",
  ],
  Tarifs: [
    "L’accès à cette démonstration est gratuit. Vous pouvez explorer les deux espaces sans abonnement.",
  ],
  "Aide et support": [
    "Pour entrer, choisissez Professeur ou Étudiant, puis sélectionnez « Se connecter ». Les champs e-mail et mot de passe sont facultatifs.",
    "Pour changer de rôle, déconnectez-vous depuis le menu de votre profil, puis choisissez votre autre espace.",
  ],
  "Mot de passe oublié ?": [
    "Vous pouvez accéder à la démonstration sans mot de passe. Choisissez votre rôle, puis sélectionnez « Se connecter ».",
  ],
  Google: [
    "La connexion Google sera disponible lorsque votre établissement aura activé ce service. Pour essayer la démonstration, choisissez votre rôle et sélectionnez « Se connecter ».",
  ],
  Microsoft: [
    "La connexion Microsoft sera disponible lorsque votre établissement aura activé ce service. Pour essayer la démonstration, choisissez votre rôle et sélectionnez « Se connecter ».",
  ],
  "Connexion établissement": [
    "Votre établissement pourra activer la connexion unique (SSO). Pour explorer la démonstration dès maintenant, choisissez votre rôle et sélectionnez « Se connecter ».",
  ],
  "À propos": [
    "Neurvia est une plateforme d’IA éducative qui aide les enseignants à accompagner chaque apprenant et les étudiants à comprendre leur progression.",
  ],
  "Conditions d’utilisation": [
    "Cette démonstration est destinée à l’exploration des parcours pédagogiques avec des données fictives. Les résultats illustrent des pistes à vérifier en séance.",
  ],
  "Politique de confidentialité": [
    "Le serveur vérifie vos identifiants et ouvre une session à durée limitée. Les mots de passe sont stockés sous forme hachée.",
  ],
  Contact: [
    "Pour une demande concernant votre classe ou votre accès, adressez-vous au référent numérique de votre établissement.",
    "Pour découvrir la plateforme, consultez « Aide et support » depuis le menu principal.",
  ],
};

type Topic = keyof typeof information;
const navigation = ["Fonctionnalités", "Établissements", "Tarifs"] as const;
const footer = [
  "À propos",
  "Conditions d’utilisation",
  "Politique de confidentialité",
  "Contact",
] as const;
const benefits = [
  {
    icon: GraduationCap,
    title: "Enseignez plus efficacement",
    description: "Gagnez du temps et personnalisez vos parcours.",
  },
  {
    icon: UsersRound,
    title: "Accompagnez chaque apprenant",
    description: "Un apprentissage plus personnalisé, inclusif et motivant.",
  },
  {
    icon: ChartNoAxesColumnIncreasing,
    title: "Suivez les progrès",
    description: "Des indicateurs clairs pour accompagner la réussite.",
  },
];

function InformationDialog({
  topic,
  close,
}: {
  topic: Topic;
  close: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);
  return (
    <dialog
      ref={dialog}
      className="nl-dialog"
      aria-labelledby="nl-dialog-title"
      onCancel={close}
      onClick={(event) => {
        if (event.target === dialog.current) close();
      }}
    >
      <div className="nl-dialog-content">
        <div className="nl-dialog-heading">
          <h2 id="nl-dialog-title">{topic}</h2>
          <button type="button" onClick={close} aria-label="Fermer">
            <X />
          </button>
        </div>
        {information[topic].map((paragraph) => (
          <p key={paragraph}>{paragraph}</p>
        ))}
        <button type="button" className="nl-primary" onClick={close}>
          Compris
        </button>
      </div>
    </dialog>
  );
}

export default function Login({ joinCode }: { joinCode?: string }) {
  const router = useRouter();
  const [role, setRole] = useState<Role>(joinCode ? "student" : "teacher");
  const [remember, setRemember] = useState(false);
  const [visiblePassword, setVisiblePassword] = useState(false);
  const [topic, setTopic] = useState<Topic | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  function openTopic(next: Topic) {
    setMenuOpen(false);
    setTopic(next);
  }
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState("");
  const chooseClass = creating && role === "student" && !joinCode;
  const catalog = useGet<Schema["RegistrationClass"][]>(chooseClass ? "/registration/classes" : "");
  const classes = catalog.value ?? [];
  const institutions = [...new Map(classes.map((entry) => [entry.institution_id, entry.institution_name]))];
  const [selectedInstitution, setInstitution] = useState("");
  const [classQuery, setClassQuery] = useState("");
  const institution = institutions.length === 1 ? institutions[0][0] : selectedInstitution;
  const visibleClasses = classes.filter((entry) => entry.institution_id === institution &&
    (entry.name + " " + entry.academic_year).toLocaleLowerCase("fr").includes(classQuery.trim().toLocaleLowerCase("fr")));
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email"));
    const password = String(form.get("password"));
    setBusy(true);
    setFailure("");
    try {
      if (creating) await register({
        email, password, full_name: String(form.get("full_name")), role,
        ...(chooseClass && classes.length ? { cohort_id: String(form.get("cohort")), institution_id: institution } : {}),
        ...(joinCode && role === "student" ? { join_code: joinCode } : {}),
      });
      const profile = await login(email, password, remember);
      router.push(joinCode && profile.role === "student" ? "/join/" + encodeURIComponent(joinCode) :
        "/" + profile.role + "/dashboard");
    } catch (e) {
      setFailure(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="neurvia-login">
      <header className="nl-header">
        <div className="nl-header-inner">
          <a href="/login" className="nl-brand" aria-label="Neurvia, accueil">
            <img src="/logo.svg" alt="" />
            Neurvia
          </a>
          <nav
            className={`nl-nav ${menuOpen ? "nl-nav-open" : ""}`}
            id="nl-nav"
            aria-label="Navigation principale"
          >
            <a className="nl-current" href="/login" aria-current="page">
              Accueil
            </a>
            {navigation.map((item) => (
              <button type="button" key={item} onClick={() => openTopic(item)}>
                {item}
              </button>
            ))}
          </nav>
          <button
            type="button"
            className="nl-help"
            aria-label="Aide et support"
            onClick={() => openTopic("Aide et support")}
          >
            <CircleHelp />
            <span>Aide et support</span>
          </button>
          <button
            type="button"
            className="nl-menu-button"
            aria-label={menuOpen ? "Fermer le menu" : "Ouvrir le menu"}
            aria-expanded={menuOpen}
            aria-controls="nl-nav"
            onClick={() => setMenuOpen(!menuOpen)}
          >
            {menuOpen ? <X /> : <Menu />}
          </button>
        </div>
      </header>
      <main className="nl-main">
        <section className="nl-intro" aria-labelledby="nl-welcome">
          <div className="nl-intro-copy">
            <h1 id="nl-welcome">
              Bienvenue sur <br />
              Neurvia
            </h1>
            <p className="nl-description">
              La plateforme d’IA éducative pensée pour les établissements
              scolaires, les centres de formation et les universités.
            </p>
            <ul className="nl-benefits">
              {benefits.map(({ icon: Icon, title, description }) => (
                <li key={title}>
                  <span className="nl-benefit-icon">
                    <Icon />
                  </span>
                  <div>
                    <h2>{title}</h2>
                    <p>{description}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
          <img
            className="nl-illustration"
            width="700"
            height="361"
            src="/login-assets/education.webp"
            alt=""
          />
        </section>
        <section className="nl-card" aria-labelledby="nl-connexion">
          <div
            className="nl-roles"
            role="group"
            aria-label="Choisissez votre rôle"
          >
            <button
              type="button"
              aria-pressed={role === "teacher"}
              onClick={() => setRole("teacher")}
            >
              <GraduationCap />
              Professeur
            </button>
            <button
              type="button"
              aria-pressed={role === "student"}
              onClick={() => setRole("student")}
            >
              <UserRound />
              Étudiant
            </button>
          </div>
          <h2 id="nl-connexion">{creating ? "Inscription" : "Connexion"}</h2>
          {joinCode && <p>Connectez-vous comme étudiant pour rejoindre la classe.</p>}
          <form method="post" onSubmit={submit}>
            {creating && <label className="nl-label">Nom complet
              <span className="nl-input"><UserRound /><input name="full_name" autoComplete="name" required /></span>
            </label>}
            {chooseClass && catalog.loading && <p role="status">Chargement des classes…</p>}
            {chooseClass && catalog.error && <p className="nl-notice" role="alert">{catalog.error}</p>}
            {chooseClass && classes.length > 0 && <div className="nl-enrollment">
              {institutions.length > 1 && <label className="nl-label" htmlFor="nl-institution">Établissement</label>}
              {institutions.length > 1 && <select id="nl-institution" className="nl-input" required value={institution}
                onChange={(event) => { setInstitution(event.target.value); setClassQuery(""); }}>
                <option value="">Choisir un établissement</option>
                {institutions.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
              </select>}
              {institution && <>
                <label className="nl-label" htmlFor="nl-class-search">Rechercher une classe</label>
                <div className="nl-input"><input id="nl-class-search" type="search" value={classQuery}
                  onChange={(event) => setClassQuery(event.target.value)} /></div>
                <label className="nl-label" htmlFor="nl-cohort">Classe</label>
                <select key={institution + ":" + classQuery} id="nl-cohort" className="nl-input" name="cohort" required defaultValue="">
                  <option value="">{visibleClasses.length ? "Choisir une classe" : "Aucune classe trouvée"}</option>
                  {visibleClasses.map((entry) => <option key={entry.id} value={entry.id}>
                    {entry.name} · {entry.academic_year}
                  </option>)}
                </select>
              </>}
            </div>}
            <label className="nl-label" htmlFor="nl-email">
              Adresse e-mail
            </label>
            <div className="nl-input">
              <Mail />
              <input
                id="nl-email"
                name="email"
                required
                type="email"
                autoComplete="email"
                placeholder="Entrez votre adresse e-mail"
              />
            </div>
            <label className="nl-label" htmlFor="nl-password">
              Mot de passe
            </label>
            <div className="nl-input">
              <LockKeyhole />
              <input
                id="nl-password"
                name="password"
                required
                minLength={creating ? 10 : 1}
                type={visiblePassword ? "text" : "password"}
                autoComplete={creating ? "new-password" : "current-password"}
                placeholder="Entrez votre mot de passe"
              />
              <button
                type="button"
                aria-label={
                  visiblePassword
                    ? "Masquer le mot de passe"
                    : "Afficher le mot de passe"
                }
                aria-pressed={visiblePassword}
                onClick={() => setVisiblePassword(!visiblePassword)}
              >
                {visiblePassword ? <EyeOff /> : <Eye />}
              </button>
            </div>
            <div className="nl-form-options">
              <label>
                <input
                  type="checkbox"
                  checked={remember}
                  onChange={(event) => setRemember(event.target.checked)}
                />
                Se souvenir de moi
              </label>
            </div>
            {failure && <p className="nl-notice" role="alert">{failure}</p>}
            <button type="submit" className="nl-primary"
              disabled={!hydrated || busy || (chooseClass && (catalog.loading || !!catalog.error))}>
              {busy ? "Connexion en cours…" : creating ? "Créer le compte" : "Se connecter"}
            </button>
          </form>
          <div className="nl-form-options">
            <button type="button" onClick={() => { setCreating(!creating); setFailure(""); }}>
              {creating ? "J’ai déjà un compte" : "Créer un compte"}
            </button>
          </div>
        </section>
      </main>
      <footer className="nl-footer">
        <small>
          © {new Date().getFullYear()} Neurvia. Tous droits réservés.
        </small>
        <nav aria-label="Informations">
          {footer.map((item) => (
            <button type="button" key={item} onClick={() => openTopic(item)}>
              {item}
            </button>
          ))}
        </nav>
      </footer>
      {topic && (
        <InformationDialog topic={topic} close={() => setTopic(null)} />
      )}
    </div>
  );
}
