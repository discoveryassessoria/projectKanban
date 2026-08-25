// Financeiro deixou de ser módulo global — acesso antigo redireciona para os
// Processos — a rota canônica da lista é /kanban (o Financeiro vive dentro do processo, na aba "Financeiro").
import { redirect } from "next/navigation"
export default function Page() { redirect("/kanban") }
