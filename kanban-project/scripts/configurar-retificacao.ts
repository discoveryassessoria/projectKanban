// scripts/configurar-retificacao.ts
// ============================================================================
// DÁ CONTEÚDO OPERACIONAL AOS SEIS PASSOS DA RETIFICAÇÃO DE REGISTROS.
//
//   npx tsx scripts/configurar-retificacao.ts              SOMENTE LEITURA
//   npx tsx scripts/configurar-retificacao.ts --execute
//
// ─── O PROBLEMA ─────────────────────────────────────────────────────────────
// Os seis passos existem publicados, ativos, numa fase que JÁ RODA (2 instâncias),
// e não têm ação, campo, checklist nem subtarefa. O executor deles resolve para o
// painel declarativo — que desenha exatamente o que estiver cadastrado. Cadastro
// vazio, painel vazio: o operador abre a etapa e não tem o que fazer, nem como
// concluí-la.
//
// ─── DE ONDE VEM O CONTEÚDO ─────────────────────────────────────────────────
// Nada aqui é invenção. Cada peça sai de uma fonte já existente no domínio:
//
//   modo judicial|administrativa  → `RetificacaoPacote.tipo`, vocabulário fechado
//                                   que o modelo já declara.
//   exigência                     → `RetificacaoPacote.status = "em_exigencia"`,
//                                   estado que o domínio já prevê.
//   averbação                     → `EmissaoRetificada` e o passo homônimo da
//                                   Emissão Documental Retificada.
//   os seis passos                → `RetificacaoPacote.workflow` diz "6 passos
//                                   RET_STEPS", e o componente legado
//                                   `ProcessoRetificacao.tsx` lista os mesmos seis,
//                                   com outras chaves e assumindo-se "mockup".
//
// ─── O QUE NÃO É FEITO AQUI, DE PROPÓSITO ───────────────────────────────────
// · NÃO se cria campo para dado que já tem dono. O órgão que recebe a retificação
//   pertence a Órgãos e Organizações; o executor declarativo ainda não sabe
//   REFERENCIAR uma organização, e criar um campo de texto "cartório" seria a
//   segunda fonte que este trabalho inteiro existe para desfazer. Fica registrado
//   como lacuna, não preenchido com texto solto.
// · NÃO se decide necessidade de retificação. A fase não tem competência para
//   `GO_RETIFICATION` — isso é da Análise Documental, e o motor já recusa.
// · NÃO PUBLICA. Isto grava RASCUNHO. Os processos em andamento continuam na versão
//   que registraram até alguém publicar, com a prévia na frente.
// ============================================================================
import { PrismaClient } from "@prisma/client"

import { CONFIGURACAO } from "./_configuracao-retificacao"

const prisma = new PrismaClient()
const EXECUTAR = process.argv.includes("--execute")
const FASE = "retificacao_registros"

/** O conteúdo de cada passo, derivado do domínio existente. */
async function main() {
  console.log(EXECUTAR ? "CONFIGURAÇÃO DA RETIFICAÇÃO — APLICANDO\n" : "CONFIGURAÇÃO DA RETIFICAÇÃO — SOMENTE LEITURA (use --execute)\n")

  const wf = await prisma.phaseInternalWorkflow.findFirst({
    where: { phaseKey: FASE, arquivado: false },
    select: { id: true, name: true, versao: true, passos: { select: { id: true, key: true, label: true, executorKey: true, acoes: { select: { id: true } }, campos: { select: { id: true } } } } },
  })
  if (!wf) { console.log("workflow da Retificação não encontrado"); return }
  console.log(`wf#${wf.id} "${wf.name}" v${wf.versao}\n`)

  let tocados = 0
  for (const passo of wf.passos) {
    const cfg = CONFIGURACAO[passo.key]
    if (!cfg) { console.log(`  · ${passo.key} — sem configuração declarada aqui, intocado`); continue }
    const jaTem = passo.acoes.length > 0 || passo.campos.length > 0
    if (jaTem) { console.log(`  · ${passo.key} — JÁ configurado (${passo.acoes.length} ações, ${passo.campos.length} campos), intocado`); continue }

    console.log(`  ${EXECUTAR ? "✔" : "→"} ${passo.key.padEnd(32)} ${cfg.campos.length} campo(s) · ${cfg.acoes.length} ação(ões) · ${(cfg.checkItens ?? []).length} conferência(s) · ${(cfg.requisitos ?? []).length} requisito(s) · depende de ${cfg.dependeDe.length}`)
    if (!EXECUTAR) { tocados++; continue }

    await prisma.$transaction(async (tx) => {
      // O EXECUTOR VIRA EXPLÍCITO. Ele já resolvia para o painel declarativo pela
      // chave; declarar remove a dependência de uma resolução implícita.
      await tx.phaseInternalWorkflowStep.update({
        where: { id: passo.id },
        data: { executorKey: "padrao", dependeDe: cfg.dependeDe as never },
      })
      for (const [i, c] of cfg.campos.entries()) {
        const campo = await tx.stepField.create({
          data: {
            stepId: passo.id, key: c.key, label: c.label, tipo: c.tipo,
            obrigatorio: !!c.obrigatorio, ajuda: c.ajuda ?? null, ordem: i + 1, ativo: true,
          },
          select: { id: true },
        })
        if (c.opcoes?.length) {
          await tx.stepFieldOption.createMany({
            data: c.opcoes.map((o, j) => ({ fieldId: campo.id, key: o.key, label: o.label, ordem: j + 1, ativo: true })),
          })
        }
      }
      await tx.stepAction.createMany({
        data: cfg.acoes.map((a, i) => ({
          stepId: passo.id, key: a.key, label: a.label, effectKey: a.effectKey,
          descricao: a.descricao, ordem: i + 1, ativo: true,
          requerCampos: (a.requerCampos ?? []) as never,
        })),
      })
      if (cfg.checkItens?.length) {
        await tx.stepChecklistItem.createMany({
          data: cfg.checkItens.map((k, i) => ({
            stepId: passo.id, key: k.key, label: k.label, obrigatorio: k.obrigatorio !== false, ordem: i + 1, ativo: true,
          })),
        })
      }
      if (cfg.requisitos?.length) {
        await tx.stepRequirement.createMany({
          data: cfg.requisitos.map((r, i) => ({
            stepId: passo.id, key: r.key, label: r.label, tipo: r.tipo,
            alvoKey: r.alvoKey ?? null, acaoKey: r.acaoKey ?? null, ordem: i + 1,
            obrigatorio: true, ativo: true, minimo: 1, momento: "AO_CONCLUIR",
          })),
        })
      }
    }, { maxWait: 20_000, timeout: 120_000 })
    tocados++
  }

  if (EXECUTAR && tocados > 0) {
    const { marcarRascunho } = await import("../src/services/publicacao-de-workflow")
    await marcarRascunho(wf.id, null)
    await prisma.logAuditoria.create({
      data: {
        acao: "WORKFLOW_DRAFT_SAVED", entidade: "PhaseInternalWorkflow", entidadeId: wf.id,
        descricao: `Configuração operacional dos ${tocados} passos da Retificação gravada como RASCUNHO. Os processos em andamento continuam na v${wf.versao}; nada muda para eles até a publicação.`,
        detalhes: { passos: Object.keys(CONFIGURACAO) } as never,
        usuarioId: null,
      },
    }).catch(() => null)
  }

  console.log(`\n${"═".repeat(74)}`)
  console.log(`${tocados} passo(s) ${EXECUTAR ? "configurados" : "seriam configurados"}`)
  console.log("O cadastro NÃO foi publicado: publicar é decisão do administrador, com a prévia na frente.")
  if (!EXECUTAR) console.log("\nNada foi alterado. Para aplicar: --execute")
}

void main().catch((e) => { console.error(e); process.exitCode = 1 }).finally(() => prisma.$disconnect())
