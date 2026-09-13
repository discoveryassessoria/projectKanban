// src/lib/confirmar-exclusao-processo.ts
//
// Preview + confirmação do DELETE de Processo — usado pelos dois pontos de
// entrada reais da ação (lista de processos e modal de detalhes) para não
// duplicar o aviso em dois textos que podem divergir. O preview é sempre
// calculado no servidor (`GET .../impacto-exclusao`); esta função nunca
// decide sozinha se a exclusão é permitida — só mostra o que o backend
// calculou e devolve a confirmação do operador. O DELETE efetivo revalida
// tudo de novo no servidor, dentro de transação.
interface ImpactoExclusaoProcesso {
  podeExcluir: boolean
  tarefas: number
  necessidades: number
  passos: number
  anexos: number
  solicitacoes: number
  fatosProtegidos: { descricao: string }[]
}

export async function confirmarExclusaoProcesso(
  processoId: number,
  nomeProcesso: string,
): Promise<boolean> {
  let preview: ImpactoExclusaoProcesso | null = null

  try {
    const res = await fetch(`/api/processos/${processoId}/impacto-exclusao`)
    if (res.ok) preview = await res.json()
  } catch {
    // Preview indisponível (rede) — segue para a confirmação genérica abaixo;
    // o DELETE efetivo ainda recusa no servidor se houver fato protegido.
  }

  if (preview && !preview.podeExcluir) {
    alert(
      `Não é possível excluir "${nomeProcesso}".\n\n` +
        `Este processo tem fato(s) financeiro(s) já materializado(s):\n` +
        preview.fatosProtegidos.map((f) => `• ${f.descricao}`).join("\n"),
    )
    return false
  }

  const detalhes = preview
    ? `Serão removidos: ${preview.tarefas} tarefa(s), ${preview.necessidades} necessidade(s) documental(is), ` +
      `${preview.passos} passo(s) de workflow, ${preview.anexos} anexo(s), ${preview.solicitacoes} solicitação(ões).\n` +
      `Nenhum fato financeiro materializado será atingido.\n\n`
    : ""

  return window.confirm(
    `Tem certeza que deseja excluir o processo "${nomeProcesso}"?\n\n${detalhes}Esta ação não pode ser desfeita.`,
  )
}
