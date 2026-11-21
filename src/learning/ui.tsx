import { ArrowLeft, BookOpen, ChevronRight } from "lucide-react";
import type { ReactNode } from "react";
import { type Question } from "./bank";

export function Heading({
  title,
  description,
  back,
  action,
}: {
  title: string;
  description?: string;
  back?: [string, string];
  action?: ReactNode;
}) {
  return (
    <header className="lr-heading">
      {back && (
        <a className="lr-back" href={back[0]}>
          <ArrowLeft size={15} />
          {back[1]}
        </a>
      )}
      <div className="lr-heading-row">
        <div>
          <h1>{title}</h1>
          {description && <p>{description}</p>}
        </div>
        {action}
      </div>
    </header>
  );
}
export function Empty({
  title,
  children,
  action,
}: {
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <section className="lr-panel lr-empty">
      <span className="lr-symbol">
        <BookOpen size={22} />
      </span>
      <h2>{title}</h2>
      {children && <p>{children}</p>}
      {action}
    </section>
  );
}
export function Stepper({ step }: { step: number }) {
  return (
    <ol className="lr-steps" aria-label="Étapes de préparation">
      {["Séance", "Paramètres", "Questions", "Publication"].map((name, i) => (
        <li
          key={name}
          className={i === step ? "current" : i < step ? "past" : ""}
          aria-current={i === step ? "step" : undefined}
        >
          <span>{i + 1}</span>
          {name}
          {i !== 3 && <ChevronRight size={14} />}
        </li>
      ))}
    </ol>
  );
}
export function Prompt({ question }: { question: Question }) {
  const [prompt, ...code] = question.text.split("\n");
  return (
    <>
      <h2 className="lr-question-title">{prompt}</h2>
      {code.length > 0 && (
        <pre className="lr-code">
          <code>{code.join("\n")}</code>
        </pre>
      )}
    </>
  );
}
export function ProgressBar({
  value,
  label,
}: {
  value: number;
  label: string;
}) {
  return (
    <div
      className="lr-meter"
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(value)}
    >
      <span style={{ width: Math.min(100, Math.max(0, value)) + "%" }} />
    </div>
  );
}
