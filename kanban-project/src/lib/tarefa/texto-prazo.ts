// src/lib/tarefa/texto-prazo.ts
// ============================================================================
// O TEXTO DO PRAZO DA TAREFA — UMA função para TODA coluna "Prazo" (Torre › Tarefas, Operação). PURO, sem Prisma.
//
// A coluna Prazo mostra SEMPRE o prazo da TAREFA (a certidão), UMA vez só:
//   · "Iniciar até 10/10"            (o rótulo canônico já traz a data — nada se acrescenta)
//   · "Vence em 5 dias · 05/10"      (o rótulo não traz a data — entra UMA vez, dia/mês, no fuso operacional)
//   · "Atrasada há 2 dias · 28/09"
//   · "Sem prazo"                    (a tarefa não tem prazo)
// NUNCA o prazo do passo / acompanhamento / regra temporal (isso é outra pergunta e mora no painel da tarefa) e NUNCA a data
// repetida ("Iniciar até 10/10 · 10/10/2026" era o defeito: rótulo + data por extenso numa segunda linha).
// A entrada é só `dataPrazo` e `rotuloDoPrazo` (ambos da TAREFA, da régua canônica `estadoTemporal`): esta função não recebe
// campo de passo — não há como o prazo do passo entrar aqui.
// ============================================================================
import { FUSO_OPERACIONAL } from '@/lib/operacional/tempo-operacional'

export interface PrazoDaTarefa {
  /** `Tarefa.dataPrazo` (ISO) ou `null` = sem prazo. */
  dataPrazo: string | null
  /** A frase canônica do prazo (`estadoTemporal().rotulo`). */
  rotuloDoPrazo: string
}

/** "10/10" — dia/mês no fuso operacional (America/Sao_Paulo), nunca no do navegador. */
export function diaMesDoPrazo(iso: string | null): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleDateString('pt-BR', { timeZone: FUSO_OPERACIONAL, day: '2-digit', month: '2-digit' })
}

export function textoPrazoDaTarefa(l: PrazoDaTarefa): string {
  const rotulo = (l.rotuloDoPrazo ?? '').trim()
  const data = diaMesDoPrazo(l.dataPrazo)
  if (!data) return rotulo || 'Sem prazo'
  if (!rotulo) return data
  return rotulo.includes(data) ? rotulo : `${rotulo} · ${data}`
}
