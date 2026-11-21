import type { Metadata } from "next";
import "./base.css";
export const metadata: Metadata = {
  title: "Neurvia · Espace pédagogique",
  description: "Classes, séances et suivi pédagogique",
  icons: { icon: "/logo.svg" },
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="fr">
      <body>{children}</body>
    </html>
  );
}
