// src/services/motor-da-retificacao.ts
//
// QUAL MOTOR CONDUZ A RETIFICAÇÃO — e a garantia de que é um só.
//
// ─── O PROBLEMA ─────────────────────────────────────────────────────────────
// A Retificação tem duas implementações vivas ao mesmo tempo:
//
//   LEGADO   `ProcessoRetificacao.tsx` + duas rotas próprias. Máquina de estados
//            dentro do `RetificacaoPacote` (`currentStep` + `workflow` em JSON), com
//            os seis passos escritos no código. Ao validar o último pacote, chama
//            `concluirFaseBespokeEAvancar`.
//
//   CANÔNICO O Workflow Interno da fase, com os seis passos em CADASTRO — campos,
//            ações, requisitos, conferência — executados pelo painel declarativo.
//
// O que torna a convivência inaceitável não é a duplicação de tela: é que
// `concluirFaseBespokeEAvancar` chama `concluirWorkflowInternoDaFase`, que CONCLUI À
// FORÇA todos os passos obrigatórios da instância ativa — sem requisito, sem campo
// preenchido, sem ação escolhida — e depois avança a fase macro. Ou seja: o motor
// legado consegue dar por feito, em silêncio, o trabalho que o motor canônico está
// pedindo. As duas telas mostram estados diferentes do mesmo processo, e a que
// "ganha" é a que alguém abriu por último.
//
// ─── A REGRA ────────────────────────────────────────────────────────────────
// Enquanto a Retificação não estiver PUBLICADA com cadastro operacional, o legado
// continua sendo o motor — ele é o que existe, e desligá-lo agora deixaria a fase sem
// nenhum. No momento em que a publicação acontecer, o legado se recusa.
//
// A troca é automática e não tem data marcada: quem decide é o ato de publicar.

import { prisma } from "@/src/lib/prisma"
import { lerVersaoPublicada } from "@/src/services/versao-publicada"

export const FASE_RETIFICACAO = "retificacao_registros"

export interface MotorVigente {
  /** `true` quando os passos publicados têm o que executar. */
  canonico: boolean
  versaoPublicada: number | null
  passosComCadastro: number
  motivo: string
}

/**
 * O motor canônico assumiu?
 *
 * A pergunta é sobre a versão PUBLICADA, não sobre o rascunho: rascunho é trabalho em
 * andamento e não pode desligar nada. E é sobre CADASTRO OPERACIONAL, não sobre o
 * passo existir — os seis existiam vazios há meses, e passo vazio não conduz nada.
 */
export async function motorVigenteDaRetificacao(): Promise<MotorVigente> {
  const wf = await prisma.phaseInternalWorkflow.findFirst({
    where: { phaseKey: FASE_RETIFICACAO, arquivado: false, active: true },
    select: { id: true, versao: true },
  })
  if (!wf) {
    return { canonico: false, versaoPublicada: null, passosComCadastro: 0,
      motivo: "não há Workflow Interno ativo para a fase." }
  }

  // LÊ PELA PORTA da versão publicada, não pela tabela: quem sabe o formato do
  // congelamento é ela, e duplicar a leitura aqui criaria um segundo leitor para
  // divergir no dia em que o formato mudasse.
  const publicada = await lerVersaoPublicada(wf.id, wf.versao)
  if (!publicada) {
    return { canonico: false, versaoPublicada: null, passosComCadastro: 0,
      motivo: `o workflow está na v${wf.versao} e essa versão não foi publicada.` }
  }

  // A CONTA É SOBRE A VERSÃO CONGELADA. Ler o cadastro vivo responderia sobre o
  // rascunho — e o rascunho não conduz processo nenhum.
  const comCadastro = (publicada.passos ?? []).filter((p) => {
    const n = (v: unknown) => (Array.isArray(v) ? v.length : 0)
    return n(p.acoes) > 0 || n(p.campos) > 0 || n(p.checkItens) > 0 || n(p.subtarefas) > 0
  }).length

  return comCadastro > 0
    ? { canonico: true, versaoPublicada: publicada.versao, passosComCadastro: comCadastro,
        motivo: `a v${publicada.versao} está publicada com ${comCadastro} passo(s) com cadastro operacional.` }
    : { canonico: false, versaoPublicada: publicada.versao, passosComCadastro: 0,
        motivo: `a v${publicada.versao} está publicada, mas nenhum passo tem cadastro operacional.` }
}

export const RECUSA_LEGADO = "MOTOR_CANONICO_ASSUMIU"

/**
 * Recusa a operação legada quando o motor canônico assumiu. Devolve `null` quando o
 * caminho legado continua sendo o válido.
 */
export async function recusarSeCanonicoAssumiu(): Promise<{ erro: string; mensagem: string } | null> {
  const m = await motorVigenteDaRetificacao()
  if (!m.canonico) return null
  return {
    erro: RECUSA_LEGADO,
    mensagem:
      `A Retificação passou a ser conduzida pelo Workflow Interno da fase — ${m.motivo} ` +
      `Esta tela é a anterior a isso e foi desligada para que os dois não deem ordens ao mesmo processo. ` +
      `Use a Central Operacional da etapa.`,
  }
}
