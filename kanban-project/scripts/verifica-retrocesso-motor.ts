// scripts/verifica-retrocesso-motor.ts
// ============================================================================
// O QUE FICOU NO BANCO DEPOIS DO CICLO — a contraprova do E2E.
//
//   npx tsx scripts/verifica-retrocesso-motor.ts <palco.json>
//
// A Central mostra a fase ATUAL: quando o processo avança, o roteiro documental da
// fase anterior sai da tela. Isso é correto e é justamente por isso que a tela não
// pode ser a única testemunha de que nada se perdeu. Aqui a pergunta é feita ao
// banco, depois de o navegador ter feito o trabalho:
//
//   • as etapas continuam sendo as MESMAS (mesmos ids), nenhuma recriada;
//   • o que estava concluído continua concluído;
//   • a fase seguinte reencontrou o trabalho parcial da visita anterior;
//   • nada duplicou: documento, necessidade, tarefa, instância, passo.
//
// SOMENTE LEITURA.
// ============================================================================
import { readFileSync } from 'node:fs'
import { prisma } from '../lib/prisma'

const palco = JSON.parse(readFileSync(process.argv[2], 'utf8'))

let ok = 0
const falhas: string[] = []
const check = (nome: string, cond: boolean, extra?: string) => {
  if (cond) { ok++; console.log(`  ✅ ${nome}`) }
  else { falhas.push(nome); console.log(`  ❌ ${nome}${extra ? ` — ${extra}` : ''}`) }
}

async function main() {
  const pid: number = palco.processoId
  const proc = await prisma.processo.findUnique({ where: { id: pid }, select: { faseAtualKey: true } })

  console.log('\nA) O processo terminou na fase seguinte')
  check('a fase persistida é a seguinte', proc?.faseAtualKey === palco.faseSeguinte, String(proc?.faseAtualKey))

  console.log('\nB) O trabalho documental da fase anterior continua íntegro')
  const passosDoc = async (documentoId: number) =>
    prisma.phaseWorkflowStepInstance.findMany({
      where: { processoId: pid, documentoId, status: { notIn: ['CANCELADO', 'SUPERSEDIDO'] } },
      orderBy: [{ ciclo: 'asc' }, { ordem: 'asc' }],
      select: { id: true, ciclo: true, stepKey: true, status: true },
    })
  const pendente = await passosDoc(palco.documentoPendenteId)
  const concluido = await passosDoc(palco.documentoConcluidoId)
  const doCicloAtual = (ps: typeof pendente) => {
    const c = Math.max(...ps.map((p) => p.ciclo))
    return ps.filter((p) => p.ciclo === c)
  }
  const pendenteAgora = doCicloAtual(pendente)
  check('a certidão que estava em 4/5 fechou em 5/5',
    pendenteAgora.every((p) => ['CONCLUIDO', 'DISPENSADO'].includes(p.status)),
    JSON.stringify(pendenteAgora.map((p) => p.status)))
  const concluidoAgora = doCicloAtual(concluido)
  check('a certidão da visita anterior continua 5/5 na visita atual (herdada, não refeita)',
    concluidoAgora.length === 5 && concluidoAgora.every((p) => p.status === 'CONCLUIDO'),
    JSON.stringify(concluidoAgora.map((p) => p.status)))
  const herdados = await prisma.phaseWorkflowStepInstance.count({
    where: { processoId: pid, documentoId: palco.documentoConcluidoId, metadata: { path: ['reentrada', 'status'], equals: 'CONCLUIDO' } },
  })
  check('e a herança está registrada em cada passo', herdados === 5, String(herdados))

  console.log('\nC) A fase seguinte reencontrou o trabalho parcial')
  const instB = await prisma.phaseWorkflowInstance.findFirst({
    where: { processoId: pid, faseMacroKey: palco.faseSeguinte }, orderBy: { ciclo: 'desc' }, select: { id: true, ciclo: true },
  })
  const passosB = await prisma.phaseWorkflowStepInstance.findMany({
    where: { workflowInstanceId: instB!.id, status: { notIn: ['CANCELADO', 'SUPERSEDIDO'] } },
    orderBy: { ordem: 'asc' }, select: { status: true },
  })
  const feitosB = passosB.filter((p) => ['CONCLUIDO', 'DISPENSADO'].includes(p.status)).length
  check(`a fase seguinte continua com ${palco.passosConcluidosEmB} de ${palco.passosTotaisEmB} — não zerou e não completou sozinha`,
    feitosB === palco.passosConcluidosEmB, `${feitosB}/${passosB.length}`)
  check('e ainda tem o que fazer (o motor não a deu por concluída)',
    passosB.some((p) => !['CONCLUIDO', 'DISPENSADO'].includes(p.status)))

  console.log('\nD) Nada duplicou')
  const necs = await prisma.necessidadeDocumental.count({ where: { processoId: pid } })
  const docs = await prisma.documento.count({ where: { necessidade: { processoId: pid } } })
  check('duas obrigações documentais, nem uma a mais', necs === 2, String(necs))
  check('dois documentos, nem um a mais', docs === 2, String(docs))
  const dupPassos = await prisma.$queryRawUnsafe<Array<{ n: number }>>(
    `SELECT COUNT(*)::int AS n FROM (
       SELECT "workflowInstanceId", "stepKey", COALESCE("documentoId",0), COALESCE("necessidadeId",0)
         FROM "PhaseWorkflowStepInstance"
        WHERE "processoId" = ${pid} AND status NOT IN ('CANCELADO','SUPERSEDIDO')
        GROUP BY 1,2,3,4 HAVING COUNT(*) > 1) x`,
  )
  check('nenhum passo duplicado na mesma instância/unidade', Number(dupPassos[0]?.n ?? 0) === 0, JSON.stringify(dupPassos))
  const TERMINAIS = ['CONCLUIDO_RECEBIDO', 'CONCLUIDO_NAO_POSSUI', 'CANCELADA', 'SUPERSEDIDA'] as const
  const vivas = await prisma.tarefa.groupBy({
    by: ['documentoId', 'necessidadeId', 'faseMacroKey'],
    where: { processoId: pid, statusTarefa: { notIn: [...TERMINAIS] } },
    _count: { _all: true },
  })
  check('nenhuma unidade com duas tarefas vivas', vivas.every((g) => g._count._all === 1),
    JSON.stringify(vivas.map((g) => g._count._all)))

  console.log('\nE) O histórico conta a viagem inteira')
  const logs = await prisma.phaseAdvanceLog.findMany({
    where: { processoId: pid, resultado: { in: ['MOVIDO', 'AVANCADO'] } },
    orderBy: { id: 'asc' }, select: { faseAtual: true, fasePretendida: true, resultado: true, origem: true },
  })
  const rota = logs.map((l) => `${l.faseAtual}→${l.fasePretendida}`)
  check('as três transições reais estão registradas', rota.length >= 3, JSON.stringify(rota))
  check('a segunda ida à fase seguinte não foi bloqueada por idempotência',
    rota.filter((r) => r === `${palco.faseAtual}→${palco.faseSeguinte}`).length === 2, JSON.stringify(rota))
  check('a movimentação manual está distinguível do avanço do motor',
    logs.some((l) => l.resultado === 'MOVIDO') && logs.some((l) => l.resultado === 'AVANCADO'),
    JSON.stringify(logs.map((l) => `${l.resultado}/${l.origem}`)))

  console.log(`\n${falhas.length === 0 ? '✅ PASSOU' : '❌ FALHOU'}: ${ok} ok, ${falhas.length} falhas`)
  if (falhas.length) for (const f of falhas) console.log(`  · ${f}`)
  process.exit(falhas.length ? 1 : 0)
}

void main().finally(() => prisma.$disconnect())
