import React from "react";
import type { Metadata } from "next";
import { Inter, Geist_Mono } from "next/font/google";
import "./globals.css";
import { SidebarWrapper } from "@/src/components/sidebar-wrapper";
import { Providers } from "@/src/components/providers";
import { Toaster } from "@/components/ui/toaster";
import { SpeedInsights } from '@vercel/speed-insights/next';

// IDENTIDADE BITRIX (14-15/09/2026): Inter é a fonte mais próxima, sem ter o
// arquivo real do Bitrix — mantém o nome de variável `--font-geist-sans` pra
// não precisar tocar globals.css/`--font-sans` nem nenhum consumidor.
const geistSans = Inter({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Grupo Discovery | Sistema de Gestão de Projetos",
  description: "Sistema Kanban para gestão de tarefas e projetos do Grupo Discovery",
  icons: {
    icon: "/vercel.png", // Caminho do novo ícone
  },
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
      suppressHydrationWarning
      >
        <Providers>
          <SidebarWrapper>
            {children}
          </SidebarWrapper>
            <Toaster />
        </Providers>
        <SpeedInsights />
      </body>
    </html>
  );
}