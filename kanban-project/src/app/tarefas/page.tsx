// src/app/tarefas/page.tsx
//
// LEI DA TORRE (L4): só a aba Tarefas da Torre atribui, transfere ou redistribui
// responsável. "Tarefas e Projetos" deixou de ser uma tela própria — esta rota só
// REDIRECIONA para a Torre (o link antigo/marcadores continuam funcionando).

import { redirect } from "next/navigation"

export default function TarefasEProjetosPage() {
  redirect("/torre?aba=tarefas")
}
