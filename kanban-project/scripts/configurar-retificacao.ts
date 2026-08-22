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
/**
 * A FASE PRECISA ADMITIR O EFEITO. `efeitosPermitidos` foi congelado antes de
 * `REGISTER_PROTOCOL` existir, e uma lista gravada não sabe do que veio depois. O
 * efeito é de competência GERAL — protocolar registra um fato, não decide nada —,
 * então acrescentá-lo não amplia o que a Retificação pode DECIDIR.
 */
async function admitirEfeitoDeProtocolo(dryRun: boolean): Promise<string | null> {
  const fase = await prisma.catalogoFase.findFirst({
    where: { phaseKey: FASE }, select: { id: true, efeitosPermitidos: true },
  })
  if (!fase) return null
  const atuais = Array.isArray(fase.efeitosPermitidos) ? (fase.efeitosPermitidos as string[]) : []
  if (atuais.includes("REGISTER_PROTOCOL")) return null
  if (!dryRun) {
    await prisma.catalogoFase.update({
      where: { id: fase.id },
      data: { efeitosPermitidos: [...atuais, "REGISTER_PROTOCOL"] as never },
    })
  }
  return `FASE ${FASE}: efeitosPermitidos += REGISTER_PROTOCOL`
}

/**
 * CONVERGÊNCIA ADITIVA de um passo já configurado.
 *
 * Acrescenta campo, opção, ação, conferência e requisito que faltam; corrige o efeito
 * e os campos exigidos de uma ação que mudou. NUNCA apaga: o que está lá e não está
 * declarado aqui pode ter sido posto por quem administra, e este script não é dono
 * disso.
 */
async function convergir(
  stepId: number, stepKey: string, cfg: (typeof CONFIGURACAO)[string], dryRun: boolean,
): Promise<string[]> {
  const linhas: string[] = []
  const [campos, acoes, itens, reqs] = await Promise.all([
    prisma.stepField.findMany({ where: { stepId }, select: { id: true, key: true, tipo: true, opcoes: true, obrigatorio: true, ordem: true } }),
    prisma.stepAction.findMany({ where: { stepId }, select: { id: true, key: true, effectKey: true, requerCampos: true } }),
    prisma.stepChecklistItem.findMany({ where: { stepId }, select: { key: true } }),
    prisma.stepRequirement.findMany({ where: { stepId }, select: { key: true } }),
  ])
  const maiorOrdem = Math.max(0, ...campos.map((c) => c.ordem))

  for (const [i, c] of cfg.campos.entries()) {
    const atual = campos.find((x) => x.key === c.key)
    const ponteiro = c.referencia ? { referencia: c.referencia } : null
    if (!atual) {
      linhas.push(`+ CAMPO ${c.key} (${c.tipo}${c.referencia ? ` → ${c.referencia}` : ""})`)
      if (!dryRun) {
        const novo = await prisma.stepField.create({
          data: {
            stepId, key: c.key, label: c.label, tipo: c.tipo, obrigatorio: !!c.obrigatorio,
            ajuda: c.ajuda ?? null, ordem: maiorOrdem + i + 1, ativo: true,
            ...(ponteiro ? { opcoes: ponteiro as never } : {}),
          },
          select: { id: true },
        })
        if (c.opcoes?.length) {
          await prisma.stepFieldOption.createMany({
            data: c.opcoes.map((o, j) => ({ fieldId: novo.id, key: o.key, label: o.label, ordem: j + 1, ativo: true })),
          })
        }
      }
      continue
    }
    // O ALVO da referência pode ter mudado — é atributo do campo, não conteúdo novo.
    const alvoAtual = JSON.stringify(atual.opcoes ?? null)
    if (ponteiro && alvoAtual !== JSON.stringify(ponteiro)) {
      linhas.push(`~ CAMPO ${c.key}: alvo de referência → ${c.referencia}`)
      if (!dryRun) await prisma.stepField.update({ where: { id: atual.id }, data: { tipo: c.tipo, opcoes: ponteiro as never } })
    }
  }

  for (const a of cfg.acoes) {
    const atual = acoes.find((x) => x.key === a.key)
    if (!atual) {
      linhas.push(`+ AÇÃO ${a.key} (${a.effectKey})`)
      if (!dryRun) {
        await prisma.stepAction.create({
          data: { stepId, key: a.key, label: a.label, effectKey: a.effectKey, descricao: a.descricao,
            ordem: acoes.length + 1, ativo: true, requerCampos: (a.requerCampos ?? []) as never },
        })
      }
      continue
    }
    const exigeAgora = JSON.stringify(a.requerCampos ?? [])
    const exigeAntes = JSON.stringify(Array.isArray(atual.requerCampos) ? atual.requerCampos : [])
    if (atual.effectKey !== a.effectKey || exigeAntes !== exigeAgora) {
      linhas.push(`~ AÇÃO ${a.key}: ${atual.effectKey} → ${a.effectKey}${exigeAntes !== exigeAgora ? `, exige ${exigeAgora}` : ""}`)
      if (!dryRun) {
        await prisma.stepAction.update({
          where: { id: atual.id },
          data: { effectKey: a.effectKey, descricao: a.descricao, requerCampos: (a.requerCampos ?? []) as never },
        })
      }
    }
  }

  for (const [i, k] of (cfg.checkItens ?? []).entries()) {
    if (itens.some((x) => x.key === k.key)) continue
    linhas.push(`+ CHECKLIST ${k.key}`)
    if (!dryRun) {
      await prisma.stepChecklistItem.create({
        data: { stepId, key: k.key, label: k.label, obrigatorio: k.obrigatorio !== false, ordem: itens.length + i + 1, ativo: true },
      })
    }
  }

  for (const [i, r] of (cfg.requisitos ?? []).entries()) {
    if (reqs.some((x) => x.key === r.key)) continue
    linhas.push(`+ REQUISITO ${r.key} (${r.tipo})`)
    if (!dryRun) {
      await prisma.stepRequirement.create({
        data: { stepId, key: r.key, label: r.label, tipo: r.tipo, alvoKey: r.alvoKey ?? null,
          acaoKey: r.acaoKey ?? null, ordem: reqs.length + i + 1, obrigatorio: true, ativo: true,
          minimo: 1, momento: "AO_CONCLUIR" },
      })
    }
  }

  void stepKey
  return linhas
}

async function main() {
  console.log(EXECUTAR ? "CONFIGURAÇÃO DA RETIFICAÇÃO — APLICANDO\n" : "CONFIGURAÇÃO DA RETIFICAÇÃO — SOMENTE LEITURA (use --execute)\n")

  const wf = await prisma.phaseInternalWorkflow.findFirst({
    where: { phaseKey: FASE, arquivado: false },
    select: { id: true, name: true, versao: true, passos: { select: { id: true, key: true, label: true, executorKey: true, acoes: { select: { id: true } }, campos: { select: { id: true } } } } },
  })
  if (!wf) { console.log("workflow da Retificação não encontrado"); return }
  console.log(`wf#${wf.id} "${wf.name}" v${wf.versao}\n`)

  const efeitoAdmitido = await admitirEfeitoDeProtocolo(!EXECUTAR)
  if (efeitoAdmitido) console.log(`  ${EXECUTAR ? "✔" : "·"} ${efeitoAdmitido}\n`)

  let tocados = 0
  for (const passo of wf.passos) {
    const cfg = CONFIGURACAO[passo.key]
    if (!cfg) { console.log(`  · ${passo.key} — sem configuração declarada aqui, intocado`); continue }
    const jaTem = passo.acoes.length > 0 || passo.campos.length > 0
    if (jaTem) {
      // JÁ CONFIGURADO: em vez de pular, CONVERGE — acrescenta o que falta e corrige o
      // que divergiu, sem apagar nada. É o que permite esta configuração evoluir sem
      // que a segunda passada destrua o que a primeira deixou (ou o que alguém editou
      // à mão depois dela).
      const conv = await convergir(passo.id, passo.key, cfg, !EXECUTAR)
      if (conv.length === 0) { console.log(`  · ${passo.key} — já convergido, nada a fazer`) }
      else {
        console.log(`  ${EXECUTAR ? "✔" : "→"} ${passo.key}`)
        conv.forEach((l) => console.log(`      ${l}`))
        tocados++
      }
      continue
    }

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
            // O ALVO DA REFERÊNCIA mora no mesmo ponteiro que `{ catalogo: "canais" }`
            // já usava. Uma coluna a menos dizendo a mesma coisa.
            ...(c.referencia ? { opcoes: { referencia: c.referencia } as never } : {}),
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
