// scripts/reparar-passo-duplicado.ts
// ============================================================================
// DUAS INSTÂNCIAS DO MESMO PASSO PARA A MESMA OBRIGAÇÃO.
//
//   npx tsx scripts/reparar-passo-duplicado.ts                  SOMENTE LEITURA
//   npx tsx scripts/reparar-passo-duplicado.ts --processo 523
//   npx tsx scripts/reparar-passo-duplicado.ts --manter 1552 --execute
//
// ─── O QUE ACONTECEU ────────────────────────────────────────────────────────
// Dois materializadores criavam o mesmo passo com chaves de idempotência em
// FORMATOS diferentes:
//
//   wfi300|stepdef243|stepkeylocalizar_registro|stepv1|c2|doc2111|nec190
//   matdoc|localizar_registro|nec190|c2
//
// O do workflow publicado convergia com o documental; o documental só procurava
// pela própria string. Quem rodasse depois criava o segundo passo. É a mesma
// família da duplicidade de TAREFA (duas chaves, e quem procura numa nunca acha
// a outra) — agora no nível do PASSO.
//
// O código já não produz mais duplicata. Este script trata o que ficou gravado.
//
// ─── POR QUE NÃO EXISTE MAIS CRITÉRIO AUTOMÁTICO ────────────────────────────
// Este script escolhia sozinho: sobrevivia "o passo mais adiantado", por status.
// O dry-run do processo 523 mostrou por que isso não pode ser regra.
//
// Status não é evidência. Um passo pode estar CONCLUIDO por engano — concluído
// por quem não devia, ou concluído porque a tela ofereceu o passo errado — e o
// trabalho de verdade estar no outro. Escolher pelo status descarta, sem
// perguntar, justamente o registro que carrega a execução; e como o efeito é
// SUPERSEDIR, o gate da fase abre e a tarefa do responsável encerra junto.
//
// Aqui o script LÊ e MOSTRA A EVIDÊNCIA de cada candidato — eventos de workflow,
// início, conclusão, quem concluiu, tarefas ancoradas — e para. Quem decide qual
// passo representa o trabalho real é uma pessoa, e ela diz isso com `--manter`.
//
// ─── O QUE ELE FAZ, E O QUE NÃO FAZ ─────────────────────────────────────────
// SUPERSEDE as sobras — nunca apaga. `SUPERSEDIDO` é o estado que o domínio já
// usa para "saiu do fluxo sem ter sido cancelado por alguém": o registro
// permanece, o histórico permanece, e o gate deixa de esperar por ele.
//
// A TAREFA ancorada num descartado é reancorada no escolhido — senão a fila
// ficaria apontando para um passo que saiu do fluxo.
//
// NÃO conclui passo, não avança fase, não cria nada, não apaga nada.
// ============================================================================
import { prisma } from '../lib/prisma'

const EXECUTAR = process.argv.includes('--execute')
const iProc = process.argv.indexOf('--processo')
const PROCESSO = iProc >= 0 ? Number(process.argv[iProc + 1]) : null
/**
 * OS PASSOS QUE DEVEM SOBREVIVER — decisão humana, um id por grupo duplicado.
 *
 *   --manter 1552            um grupo
 *   --manter 1552,2087       vários
 *
 * Sem isto o script não escreve nada, mesmo com `--execute`: não existe escolha
 * por omissão quando a escolha errada encerra o trabalho de alguém.
 */
const iManter = process.argv.indexOf('--manter')
const MANTER = new Set(
  iManter >= 0
    ? String(process.argv[iManter + 1] ?? '').split(',').map((x) => Number(x.trim())).filter((x) => Number.isInteger(x) && x > 0)
    : [],
)

async function main() {
  console.log(EXECUTAR ? 'REPARO — APLICANDO\n' : 'REPARO — SOMENTE LEITURA (use --execute para aplicar)\n')

  const passos = await prisma.phaseWorkflowStepInstance.findMany({
    where: {
      status: { notIn: ['SUPERSEDIDO', 'CANCELADO'] },
      ...(PROCESSO ? { processoId: PROCESSO } : {}),
    },
    select: {
      id: true, processoId: true, workflowInstanceId: true, ciclo: true, stepKey: true,
      necessidadeId: true, documentoId: true, status: true, chaveIdempotencia: true,
      stepDefinitionId: true,
      // A EVIDÊNCIA. É por ela que uma pessoa decide qual passo carrega o
      // trabalho real — status sozinho não distingue "concluído" de "concluído
      // por engano", e é justamente essa diferença que decide o caso.
      startedAt: true, completedAt: true, metadata: true, createdAt: true, updatedAt: true,
      tarefas: { select: { id: true, statusTarefa: true, responsavelId: true, dataInicio: true } },
    },
    orderBy: { id: 'asc' },
  })

  // A IDENTIDADE LÓGICA do passo: instância + ciclo + stepKey + OBRIGAÇÃO.
  // A obrigação vence o documento (o documento é onde ela se materializa), pela
  // mesma razão que na identidade da tarefa.
  const grupos = new Map<string, typeof passos>()
  for (const p of passos) {
    const obrigacao =
      p.necessidadeId != null ? `nec${p.necessidadeId}`
      : p.documentoId != null ? `doc${p.documentoId}`
      : null
    // Passo administrativo de fase não tem obrigação — e é único por construção.
    if (obrigacao == null) continue
    const k = `wfi${p.workflowInstanceId}|c${p.ciclo}|${p.stepKey}|${obrigacao}`
    const arr = grupos.get(k) ?? []
    arr.push(p)
    grupos.set(k, arr)
  }

  const duplicados = [...grupos.entries()].filter(([, arr]) => arr.length > 1)
  if (duplicados.length === 0) {
    console.log('Nenhuma duplicidade de passo encontrada.')
    return
  }

  let supersedidos = 0
  let tarefasReancoradas = 0

  // OS EVENTOS DE WORKFLOW de cada candidato — a prova de que um passo foi
  // mesmo executado, e não apenas nasceu e ficou parado.
  const idsDuplicados = duplicados.flatMap(([, arr]) => arr.map((p) => p.id))
  const eventos = await prisma.workflowEvento.findMany({
    where: { entityType: 'step_instance', entityId: { in: idsDuplicados } },
    select: { entityId: true, tipo: true, criadoEm: true },
    orderBy: { criadoEm: 'asc' },
  })
  const eventosPorPasso = new Map<number, typeof eventos>()
  for (const e of eventos) {
    if (e.entityId == null) continue
    const arr = eventosPorPasso.get(e.entityId) ?? []
    arr.push(e)
    eventosPorPasso.set(e.entityId, arr)
  }

  let semDecisao = 0

  for (const [chave, arr] of duplicados) {
    console.log(`\n${chave}`)
    for (const p of arr) {
      const evs = eventosPorPasso.get(p.id) ?? []
      const meta = (p.metadata ?? null) as { operacao?: { completedById?: number | null } } | null
      const quemConcluiu = meta?.operacao?.completedById ?? null
      console.log(`  passo #${p.id} · ${p.status}`)
      console.log(`      chave ......... ${p.chaveIdempotencia}`)
      console.log(`      alvo .......... nec=${p.necessidadeId ?? '—'} doc=${p.documentoId ?? '—'} stepDef=${p.stepDefinitionId ?? '—'}`)
      console.log(`      execução ...... iniciado=${p.startedAt?.toISOString() ?? '—'} concluído=${p.completedAt?.toISOString() ?? '—'} por=${quemConcluiu ?? '—'}`)
      console.log(`      eventos ....... ${evs.length === 0 ? 'NENHUM — este passo nunca foi tocado' : evs.map((e) => `${e.tipo}@${e.criadoEm.toISOString().slice(11, 19)}`).join(' · ')}`)
      console.log(`      tarefas ....... ${p.tarefas.length === 0 ? 'nenhuma' : p.tarefas.map((t) => `#${t.id} ${t.statusTarefa}${t.responsavelId ? ` resp=${t.responsavelId}` : ''}`).join(' · ')}`)
    }

    const escolhido = arr.find((p) => MANTER.has(p.id))
    if (!escolhido) {
      semDecisao++
      console.log(`  ⚠ SEM DECISÃO — informe qual passo representa o trabalho real:`)
      console.log(`      --manter ${arr.map((p) => p.id).join(' | ')}`)
      continue
    }
    const sobrevive = escolhido
    const sobra = arr.filter((p) => p.id !== sobrevive.id)
    console.log(`  → escolhido: MANTER #${sobrevive.id} · SUPERSEDER ${sobra.map((p) => `#${p.id}`).join(', ')}`)

    if (!EXECUTAR) continue

    await prisma.$transaction(async (tx) => {
      for (const s of sobra) {
        // A TAREFA ancorada no descartado passa para o sobrevivente ANTES de ele
        // sair do fluxo: uma tarefa apontando para passo supersedido é
        // exatamente o tipo de ponteiro morto que a fila não sabe explicar.
        const reancoradas = await tx.tarefa.updateMany({
          where: { workflowStepInstanceId: s.id },
          data: { workflowStepInstanceId: sobrevive.id },
        })
        tarefasReancoradas += reancoradas.count

        await tx.phaseWorkflowStepInstance.update({
          where: { id: s.id },
          data: { status: 'SUPERSEDIDO' },
        })
        supersedidos++

        await tx.logAuditoria.create({
          data: {
            acao: 'PASSO_DUPLICADO_SUPERSEDIDO',
            entidade: 'PhaseWorkflowStepInstance',
            entidadeId: s.id,
            descricao:
              `Passo duplicado da mesma obrigação supersedido em favor de #${sobrevive.id} ` +
              `(${s.status} → SUPERSEDIDO). Chaves em formatos diferentes: "${s.chaveIdempotencia}" ` +
              `× "${sobrevive.chaveIdempotencia}".`,
            detalhes: {
              identidade: chave,
              supersedido: { id: s.id, status: s.status, chave: s.chaveIdempotencia },
              sobrevivente: { id: sobrevive.id, status: sobrevive.status, chave: sobrevive.chaveIdempotencia },
              tarefasReancoradas: reancoradas.count,
            },
          },
        })
      }
    })
  }

  console.log(`\n${'═'.repeat(70)}`)
  console.log(`Grupos duplicados: ${duplicados.length} · sem decisão: ${semDecisao}`)
  if (EXECUTAR) {
    console.log(`Passos supersedidos: ${supersedidos} · Tarefas reancoradas: ${tarefasReancoradas}`)
    if (semDecisao > 0) {
      console.log(`${semDecisao} grupo(s) NÃO foram tocados — falta \`--manter\`. Escolher por status`)
      console.log('descartaria, sem perguntar, o passo que pode carregar a execução real.')
    }
  } else {
    console.log('Nada foi alterado. Para aplicar: --manter <idQueFica> --execute')
  }
}

void main().finally(() => prisma.$disconnect())
