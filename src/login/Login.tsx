"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  ChartNoAxesColumnIncreasing,
  CircleHelp,
  Eye,
  EyeOff,
  GraduationCap,
  Info,
  Landmark,
  LockKeyhole,
  Mail,
  Menu,
  UserRound,
  UsersRound,
  X,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { login, type Role } from "./auth";
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
    "Votre navigateur conserve le rôle choisi pour la session. L’option « Se souvenir de moi » conserve ce choix après la fermeture du navigateur. Les champs e-mail et mot de passe ne sont ni enregistrés ni transmis par la démonstration.",
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

function GoogleMark() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M21.8 12.23c0-.71-.06-1.39-.18-2.05H12v3.88h5.49a4.68 4.68 0 0 1-2.04 3.07v2.55h3.3c1.93-1.78 3.05-4.4 3.05-7.45Z"
      />
      <path
        fill="#34A853"
        d="M12 22c2.76 0 5.08-.91 6.77-2.48l-3.3-2.56c-.92.61-2.1.98-3.47.98-2.66 0-4.92-1.8-5.73-4.22H2.86v2.64A10.23 10.23 0 0 0 12 22Z"
      />
      <path
        fill="#FBBC05"
        d="M6.27 13.72a6.17 6.17 0 0 1 0-3.84V7.24H2.86a10.15 10.15 0 0 0 0 9.12l3.41-2.64Z"
      />
      <path
        fill="#EA4335"
        d="M12 5.66c1.5 0 2.83.52 3.89 1.52l2.91-2.91A9.8 9.8 0 0 0 12 1.6a10.22 10.22 0 0 0-9.14 5.64l3.41 2.64A6.09 6.09 0 0 1 12 5.66Z"
      />
    </svg>
  );
}

function MicrosoftMark() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path fill="#F25022" d="M1 1h10.5v10.5H1z" />
      <path fill="#7FBA00" d="M12.5 1H23v10.5H12.5z" />
      <path fill="#00A4EF" d="M1 12.5h10.5V23H1z" />
      <path fill="#FFB900" d="M12.5 12.5H23V23H12.5z" />
    </svg>
  );
}

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

export default function Login() {
  const router = useRouter();
  const [role, setRole] = useState<Role>("teacher");
  const [remember, setRemember] = useState(false);
  const [visiblePassword, setVisiblePassword] = useState(false);
  const [topic, setTopic] = useState<Topic | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  function openTopic(next: Topic) {
    setMenuOpen(false);
    setTopic(next);
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    login(role, remember);
    router.push("/" + role + "/dashboard");
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
          <h2 id="nl-connexion">Connexion</h2>
          <form onSubmit={submit} noValidate>
            <label className="nl-label" htmlFor="nl-email">
              Adresse e-mail
            </label>
            <div className="nl-input">
              <Mail />
              <input
                id="nl-email"
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
                type={visiblePassword ? "text" : "password"}
                autoComplete="current-password"
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
              <button
                type="button"
                onClick={() => openTopic("Mot de passe oublié ?")}
              >
                Mot de passe oublié ?
              </button>
            </div>
            <button type="submit" className="nl-primary">
              Se connecter
            </button>
          </form>
          <div className="nl-divider">Ou se connecter avec</div>
          <div className="nl-providers">
            <button type="button" onClick={() => openTopic("Google")}>
              <GoogleMark />
              Continuer avec Google
            </button>
            <button type="button" onClick={() => openTopic("Microsoft")}>
              <MicrosoftMark />
              Continuer avec Microsoft
            </button>
            <button
              type="button"
              onClick={() => openTopic("Connexion établissement")}
            >
              <Landmark />
              Continuer avec mon établissement (SSO)
            </button>
          </div>
          <div className="nl-notice">
            <Info />
            <p>
              <strong>Mode démonstration</strong> : choisissez Professeur ou
              Étudiant pour accéder à votre espace.
            </p>
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
