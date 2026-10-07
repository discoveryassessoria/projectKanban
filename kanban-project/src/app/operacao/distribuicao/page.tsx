// src/app/operacao/distribuicao/page.tsx
//
// LEI DA TORRE (L4): só a aba Tarefas da Torre atribui, transfere ou redistribui
// responsável. "Distribuição de tarefas" deixou de ser uma tela própria — esta rota
// só REDIRECIONA para a Torre (o link antigo/marcadores continuam funcionando).

import { redirect } from "next/navigation"

export default function DistribuicaoPage() {
  redirect("/torre?aba=tarefas")
}
