export const levels = ["Essentiel", "Intermédiaire", "Approfondi"] as const;
export type Level = (typeof levels)[number];
export type Question = {
  id: string;
  text: string;
  code?: string;
  options: string[];
  optionIds?: string[];
  correct: number;
  concept: string;
  conceptCode?: string;
  explanation: string;
  misconceptions: string[];
  source: "Banque" | "IA" | "Professeur";
  level: Level;
};
