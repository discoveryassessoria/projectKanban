// CRIAR EM: src/app/financas/layout.tsx

import { Metadata } from "next"

export const metadata: Metadata = {
  title: "Finanças | Grupo Discovery",
  description: "Gestão financeira da empresa",
}

export default function FinancasLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="flex-1 p-6">
      {children}
    </div>
  )
}