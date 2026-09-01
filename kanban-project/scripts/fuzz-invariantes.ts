// scripts/fuzz-invariantes.ts
// ============================================================================
// SEQUÊNCIAS ALEATÓRIAS DE COMANDOS, INVARIANTES CONFERIDAS APÓS CADA UM.
//
//   npx tsx scripts/fuzz-invariantes.ts                    12 sementes
//   npx tsx scripts/fuzz-invariantes.ts --sementes=40
//   npx tsx scripts/fuzz-invariantes.ts --semente=7        reproduz UMA
//
// ─── POR QUE FUZZ, SE JÁ EXISTEM TESTES ─────────────────────────────────────
// Os testes verificam as sequências que alguém pensou em escrever. Os defeitos que
// custaram caro neste sistema não estavam nelas: passo 1 "em execução" com 2 a 4
// concluídos à frente apareceu de uma ordem de comandos que ninguém tinha imaginado.
// O fuzz não sabe o que procura — ele sorteia a ordem e cobra as invariantes depois
// de CADA comando, que é onde a contradição aparece antes de virar dado.
//
// ─── DETERMINÍSTICO ─────────────────────────────────────────────────────────
// O gerador é semeado. Quando uma sequência quebra, ela é impressa e roda igual de
// novo com `--semente=N`: o defeito fica reproduzível em vez de virar história.
// ============================================================================
import { PrismaClient } from '@prisma/client'
import { abrirTentativa, garantirTentativa, tentativasDoPasso, MOTIVOS_DE_TENTATIVA } from '../src/services/execucao-do-passo'
import { transicionarPassoTx, ativarProximoPassoTx, reabrirPassoTx } from '../src/services/task-step-sync'
import { liberadosPor, descendentes, ESTADOS_CUMPRIDOS, type PassoComDependencia } from '../src/services/dependencias-do-passo'
import { congelarVersaoVigente, publicarNovaVersao, definicaoHistoricaDoPasso } from '../src/services/versao-publicada'

const prisma = new PrismaClient()
const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=')[1]
const SEMENTES = Number(arg('sementes') ?? 12)
const SO_ESSA = arg('semente') ? Number(arg('semente')) : null
const M = 'FZ'

/** Gerador semeado — mesma semente, mesma sequência, sempre. */
function rng(semente: number) {
  let s = semente >>> 0 || 1
  return () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296 }
}

const COMANDOS = ['INICIAR', 'CONCLUIR', 'REABRIR', 'BLOQUEAR', 'DESBLOQUEAR', 'ABRIR_TENTATIVA', 'ATIVAR_PROXIMO', 'PUBLICAR_V2', 'CANCELAR'] as const
type Comando = (typeof COMANDOS)[number]

interface Violacao { invariante: string; detalhe: string }

/**
 * AS INVARIANTES — o que precisa continuar verdadeiro depois de QUALQUER comando.
 * Cada uma corresponde a uma classe de falha que já custou caro.
 */
async function conferir(stepIds: number[], instanciaId: number): Promise<Violacao[]> {
  const v: Violacao[] = []

  for (const id of stepIds) {
    const tentativas = await tentativasDoPasso(id)

    // INV-A: uma vigente por passo. (O banco garante; conferimos que garante mesmo.)
    const vigentes = tentativas.filter((t) => t.supersededAt == null)
    if (vigentes.length > 1) v.push({ invariante: 'INV-A uma tentativa vigente', detalhe: `passo ${id} tem ${vigentes.length}` })

    // INV-B: toda etapa tocada tem tentativa.
    if (tentativas.length === 0) v.push({ invariante: 'INV-B etapa sem tentativa', detalhe: `passo ${id}` })

    // INV-C: HISTÓRICO APPEND-ONLY — tentativa substituída que estava concluída
    // continua com o fim dela. Foi a perda disso que fez a execução deixar de ter
    // acontecido.
    for (const t of tentativas) {
      if (t.supersededAt != null && t.status === 'CONCLUIDO' && t.completedAt == null) {
        v.push({ invariante: 'INV-C histórico append-only', detalhe: `tentativa ${t.id} concluída sem completedAt` })
      }
    }

    // INV-D: sequência sem buraco e sem repetição.
    const seqs = tentativas.map((t) => t.sequencia).sort((a, b) => a - b)
    if (seqs.some((s, i) => s !== i + 1)) {
      v.push({ invariante: 'INV-D sequência contínua', detalhe: `passo ${id}: ${seqs.join(',')}` })
    }
  }

  const passos = await prisma.phaseWorkflowStepInstance.findMany({
    where: { id: { in: stepIds } },
    select: { id: true, stepKey: true, ordem: true, status: true, completedAt: true, dependeDeStepKeys: true },
  })
  const grafo: PassoComDependencia[] = passos.map((p) => ({
    id: p.id, stepKey: p.stepKey, ordem: p.ordem, status: p.status,
    dependeDeStepKeys: Array.isArray(p.dependeDeStepKeys) ? (p.dependeDeStepKeys as string[]) : null,
  }))
  const cumpridas = new Set(grafo.filter((p) => ESTADOS_CUMPRIDOS.has(p.status)).map((p) => p.stepKey))

  // INV-E: SUCESSOR NÃO ESTÁ EM EXECUÇÃO COM DEPENDÊNCIA ABERTA.
  // É a forma exata do defeito do Abellan: passo 1 aberto com os seguintes adiante.
  for (const p of grafo) {
    if (p.status !== 'EM_ANDAMENTO' && p.status !== 'DISPONIVEL') continue
    const abertas = (p.dependeDeStepKeys ?? []).filter((d) => !cumpridas.has(d))
    if (abertas.length > 0) {
      v.push({ invariante: 'INV-E sucessor com dependência aberta', detalhe: `${p.stepKey} (${p.status}) depende de ${abertas.join(',')}` })
    }
  }

  // INV-F: passo CONCLUIDO tem completedAt. Estado sem data é estado sem dono.
  for (const p of passos) {
    if (p.status === 'CONCLUIDO' && p.completedAt == null) {
      v.push({ invariante: 'INV-F concluído tem data', detalhe: `passo ${p.id}` })
    }
  }

  // INV-G: a configuração histórica continua resolvível — publicar não pendura o
  // ponteiro de quem já estava executando.
  for (const id of stepIds) {
    const h = await definicaoHistoricaDoPasso(id)
    if (!h) v.push({ invariante: 'INV-G configuração histórica resolvível', detalhe: `passo ${id} perdeu a definição da versão` })
  }

  // INV-H: no máximo uma tarefa VIVA por etapa. Concluída, cancelada e supersedida
  // não disputam: elas são registro do que houve, não trabalho pendente.
  const tarefas = await prisma.tarefa.findMany({
    where: {
      workflowStepInstanceId: { in: stepIds },
      statusTarefa: { notIn: ['CONCLUIDO_RECEBIDO', 'CONCLUIDO_NAO_POSSUI', 'CANCELADA', 'SUPERSEDIDA'] },
    },
    select: { id: true, workflowStepInstanceId: true },
  })
  const porPasso = new Map<number, number>()
  for (const t of tarefas) {
    const k = t.workflowStepInstanceId!
    porPasso.set(k, (porPasso.get(k) ?? 0) + 1)
  }
  for (const [passoId, n] of porPasso) {
    if (n > 1) v.push({ invariante: 'INV-H uma tarefa viva por etapa', detalhe: `passo ${passoId}: ${n}` })
  }

  void instanciaId
  return v
}

async function limpar() {
  const procs = await prisma.processo.findMany({ where: { nome: { startsWith: M } }, select: { id: true, arvoreId: true } })
  const ids = procs.map((p) => p.id)
  await prisma.tarefa.deleteMany({ where: { processoId: { in: ids } } })
  await prisma.phaseWorkflowStepInstance.deleteMany({ where: { processoId: { in: ids } } })
  await prisma.phaseWorkflowInstance.deleteMany({ where: { processoId: { in: ids } } })
  await prisma.processo.deleteMany({ where: { id: { in: ids } } })
  for (const p of procs) if (p.arvoreId) await prisma.arvore.deleteMany({ where: { id: p.arvoreId } })
  const wf = await prisma.phaseInternalWorkflow.findUnique({ where: { wfUid: `${M}::wf` }, select: { id: true } })
  if (wf) {
    await prisma.phaseInternalWorkflowVersao.deleteMany({ where: { workflowId: wf.id } })
    await prisma.phaseInternalWorkflow.delete({ where: { id: wf.id } })
  }
  await prisma.catalogoFase.deleteMany({ where: { phaseKey: 'fz_fase' } })
}

/** Um roteiro em losango: B e C dependem de A; D depende de B e C; E é independente. */
const ROTEIRO = [
  { key: 'a', deps: [] as string[] },
  { key: 'b', deps: ['a'] },
  { key: 'c', deps: ['a'] },
  { key: 'd', deps: ['b', 'c'] },
  { key: 'e', deps: [] },
]

async function rodada(semente: number): Promise<{ violacoes: Violacao[]; sequencia: string[] }> {
  const r = rng(semente)
  await limpar()

  await prisma.catalogoFase.create({ data: { phaseKey: 'fz_fase', label: 'Fuzz', escopo: 'PROCESSO', efeitosPermitidos: ['COMPLETE_STEP', 'REGISTER_ONLY'] } })
  const wf = await prisma.phaseInternalWorkflow.create({
    data: {
      wfUid: `${M}::wf`, phaseKey: 'fz_fase', name: 'Fuzz', versao: 1, execucao: 'SEQUENCIAL',
      passos: { create: ROTEIRO.map((p, i) => ({ key: p.key, label: p.key.toUpperCase(), ordem: i + 1, cardinalidade: 'PROCESSO', createsTask: true, required: true, slaDays: 1, dependeDe: p.deps, executorKey: 'padrao' })) },
    },
    select: { id: true, passos: { select: { id: true, key: true } } },
  })
  await congelarVersaoVigente(wf.id, 'CRIACAO')

  const arv = await prisma.arvore.create({ data: { nome: `${M} árvore` }, select: { id: true } })
  const proc = await prisma.processo.create({
    data: { nome: `${M} processo`, arvoreId: arv.id, workflowRuntime: 'v2', faseAtualKey: 'fz_fase' },
    select: { id: true },
  })
  const inst = await prisma.phaseWorkflowInstance.create({
    data: { processoId: proc.id, faseMacroKey: 'fz_fase', ciclo: 1, status: 'ATIVO', workflowDefinitionId: wf.id, workflowVersion: 1, chaveIdempotencia: `${M}-i` },
    select: { id: true },
  })

  const ids: number[] = []
  for (const [i, p] of ROTEIRO.entries()) {
    const si = await prisma.phaseWorkflowStepInstance.create({
      data: {
        workflowInstanceId: inst.id, processoId: proc.id, faseMacroKey: 'fz_fase', ciclo: 1,
        stepKey: p.key, ordem: i + 1, tipo: 'HUMANO', obrigatorio: true, geraTarefa: true,
        status: p.deps.length ? 'PENDENTE' : 'DISPONIVEL',
        dependeDeStepKeys: p.deps as never,
        stepDefinitionId: wf.passos.find((x) => x.key === p.key)!.id, stepDefinitionVersion: 1,
        chaveIdempotencia: `${M}-${p.key}`,
      },
      select: { id: true },
    })
    await garantirTentativa(si.id, { motivo: MOTIVOS_DE_TENTATIVA.ABERTURA, status: p.deps.length ? 'PENDENTE' : 'DISPONIVEL' })
    ids.push(si.id)
  }

  const sequencia: string[] = []
  const opts = (n: number) => ({ correlationId: `fz${semente}-${n}`, causationId: `fz${semente}-${n}`, ciclo: 1, processoId: proc.id, workflowInstanceId: inst.id, origem: 'SYNC' as const, usuarioId: null, operacao: `fuzz-${n}` })

  for (let passo = 0; passo < 24; passo++) {
    const cmd: Comando = COMANDOS[Math.floor(r() * COMANDOS.length)]
    const alvo = ids[Math.floor(r() * ids.length)]
    sequencia.push(`${cmd}#${alvo}`)
    try {
      await prisma.$transaction(async (tx) => {
        switch (cmd) {
          case 'INICIAR': await transicionarPassoTx(tx, alvo, 'EM_ANDAMENTO', opts(passo)); break
          case 'CONCLUIR': await transicionarPassoTx(tx, alvo, 'CONCLUIDO', { ...opts(passo), extra: { completedAt: new Date() } }); break
          case 'BLOQUEAR': await transicionarPassoTx(tx, alvo, 'BLOQUEADO', opts(passo)); break
          case 'DESBLOQUEAR': await transicionarPassoTx(tx, alvo, 'DISPONIVEL', opts(passo)); break
          case 'CANCELAR': await transicionarPassoTx(tx, alvo, 'CANCELADO', opts(passo)); break
          case 'REABRIR': await reabrirPassoTx(tx, alvo, 'EM_ANDAMENTO', opts(passo)); break
          case 'ABRIR_TENTATIVA': {
            const p = await tx.phaseWorkflowStepInstance.findUnique({ where: { id: alvo }, select: { status: true } })
            await abrirTentativa({ stepInstanceId: alvo, motivo: MOTIVOS_DE_TENTATIVA.CORRECAO, status: p!.status, chaveIdempotencia: `fz${semente}|${passo}|${alvo}` }, tx)
            break
          }
          case 'ATIVAR_PROXIMO': {
            const p = await tx.phaseWorkflowStepInstance.findUnique({ where: { id: alvo }, select: { ordem: true } })
            await ativarProximoPassoTx(tx, { workflowInstanceId: inst.id, ordemConcluida: p!.ordem }, opts(passo))
            break
          }
          case 'PUBLICAR_V2': {
            await publicarNovaVersao(wf.id, tx)
            await congelarVersaoVigente(wf.id, 'PUBLICACAO', tx)
            break
          }
        }
      }, { timeout: 20_000 })
    } catch {
      // COMANDO RECUSADO É COMPORTAMENTO, NÃO FALHA. A máquina de estados existe para
      // recusar transição inválida; o que o fuzz cobra é que a recusa não deixe
      // resíduo — e é isso que as invariantes conferem logo abaixo.
      sequencia[sequencia.length - 1] += '(recusado)'
    }

    const violacoes = await conferir(ids, inst.id)
    if (violacoes.length) return { violacoes, sequencia }
  }
  return { violacoes: [], sequencia }
}

async function main() {
  const sementes = SO_ESSA != null ? [SO_ESSA] : Array.from({ length: SEMENTES }, (_, i) => i + 1)
  console.log(`FUZZ DE INVARIANTES — ${sementes.length} semente(s), 24 comandos cada\n`)
  let quebrou = 0
  for (const s of sementes) {
    const { violacoes, sequencia } = await rodada(s)
    if (violacoes.length === 0) {
      console.log(`  ✅ semente ${String(s).padStart(3)} — 24 comandos, invariantes intactas`)
    } else {
      quebrou++
      console.log(`  ❌ semente ${s} QUEBROU`)
      for (const v of violacoes) console.log(`       ${v.invariante}: ${v.detalhe}`)
      console.log(`       sequência: ${sequencia.join(' → ')}`)
      console.log(`       reproduzir: npx tsx scripts/fuzz-invariantes.ts --semente=${s}`)
    }
  }
  await limpar()
  console.log(`\n${quebrou === 0 ? '✅ PASSOU' : '❌ FALHOU'}: ${sementes.length - quebrou}/${sementes.length} sementes sem violação`)
  await prisma.$disconnect()
  process.exit(quebrou ? 1 : 0)
}

void main()
