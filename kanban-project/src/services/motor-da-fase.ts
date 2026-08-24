// src/services/motor-da-fase.ts
//
// QUAL MOTOR CONDUZ CADA FASE — e a garantia de que é um só.
//
// ─── O PROBLEMA ─────────────────────────────────────────────────────────────
// SEIS fases têm duas implementações vivas ao mesmo tempo:
//
//   LEGADO   Uma tela por fase — `ProcessoAnalise`, `ProcessoTraducao`,
//            `ProcessoApostilamento`, `ProcessoEmissaoRetificada` e `ProcessoFaseFinal`
//            — cada uma com máquina de estados própria em JSON e os passos escritos no
//            código. Ao terminar, chamam `concluirFaseBespokeEAvancar`.
//            (A da Retificação foi removida em 24/08/2026, depois de a fase migrar.)
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
// Medido em 24/08/2026: `analise_documental` (5/5 passos com cadastro, 3 instâncias
// rodadas) e `emissao_documental` (5/5, 6 instâncias) estavam nessa situação — o
// motor canônico já era o dono e o atalho continuava aberto.
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
 * O motor canônico assumiu ESTA FASE?
 *
 * ─── O QUE ESTA PERGUNTA APRENDEU ───────────────────────────────────────────
 * A primeira versão derivava a resposta da existência de cadastro publicado: "os
 * passos têm ação e campo, logo o motor assumiu". Parece razoável e está errado.
 *
 * Medido em produção: `analise_documental` tinha 5/5 passos com cadastro publicado,
 * 15 tentativas e ZERO ações canônicas executadas — o cadastro existia, a operação
 * nunca migrou. Quem conduz a Análise é a tela anterior. A derivação teria desligado
 * uma fase que estava funcionando.
 *
 * Trocar de motor é DECISÃO, tomada quando a operação estiver pronta, e por isso mora
 * no cadastro da fase. Mas a decisão sozinha também não basta: declarar sem cadastro
 * publicado deixaria a fase sem motor NENHUM. Exigem-se as duas coisas.
 *
 * A resposta é por FASE e é dado, não lista: nenhuma fase está escrita aqui.
 */
export async function motorVigenteDaFase(phaseKey: string): Promise<MotorVigente> {
  const fase = await prisma.catalogoFase.findFirst({
    where: { phaseKey },
    select: { conduzidaPeloWorkflowInterno: true },
  })
  // A DECISÃO VEM PRIMEIRO. Sem ela, o caminho anterior continua sendo o válido —
  // mesmo que o cadastro esteja pronto e publicado há meses.
  if (!fase?.conduzidaPeloWorkflowInterno) {
    return { canonico: false, versaoPublicada: null, passosComCadastro: 0,
      motivo: "o cadastro da fase ainda não declara que o Workflow Interno a conduz." }
  }

  const wf = await prisma.phaseInternalWorkflow.findFirst({
    where: { phaseKey, arquivado: false, active: true },
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

  // A DECISÃO JÁ FOI TOMADA; falta o cadastro existir de fato. Declarar sem publicar
  // deixaria a fase sem motor nenhum — o anterior recusando e o novo sem o que fazer.
  return comCadastro > 0
    ? { canonico: true, versaoPublicada: publicada.versao, passosComCadastro: comCadastro,
        motivo: `o cadastro da fase declara o Workflow Interno como condutor, e a v${publicada.versao} está publicada com ${comCadastro} passo(s) com cadastro operacional.` }
    : { canonico: false, versaoPublicada: publicada.versao, passosComCadastro: 0,
        motivo: `a fase declara o Workflow Interno como condutor, mas a v${publicada.versao} publicada não tem passo com cadastro operacional — o caminho anterior segue valendo para não deixar a fase sem motor.` }
}

export const RECUSA_LEGADO = "MOTOR_CANONICO_ASSUMIU"

/**
 * Recusa a operação legada quando o motor canônico assumiu a fase. Devolve `null`
 * quando o caminho legado continua sendo o válido — que é o caso de toda fase cujos
 * passos publicados ainda estão vazios.
 */
export async function recusarSeCanonicoAssumiu(
  phaseKey: string,
): Promise<{ erro: string; mensagem: string } | null> {
  const m = await motorVigenteDaFase(phaseKey)
  if (!m.canonico) return null
  return {
    erro: RECUSA_LEGADO,
    mensagem:
      `Esta fase passou a ser conduzida pelo Workflow Interno — ${m.motivo} ` +
      `Esta tela é a anterior a isso e foi desligada para que os dois não deem ordens ao mesmo processo. ` +
      `Use a Central Operacional da etapa.`,
  }
}

/** Compatibilidade com quem já perguntava só pela Retificação. */
export const motorVigenteDaRetificacao = () => motorVigenteDaFase(FASE_RETIFICACAO)
