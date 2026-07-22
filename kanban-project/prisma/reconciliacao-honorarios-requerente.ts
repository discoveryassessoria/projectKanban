/**
 * reconciliacao-honorarios-requerente.ts — RECONCILIAÇÃO SEGURA dos honorários por
 * requerente para processos JÁ EXISTENTES (migração do agregado → itemizado).
 *
 * DRY-RUN por padrão: apenas RELATA. Nunca converte automaticamente, nunca apaga
 * lançamentos, nunca gera duplicidade. Compara processo / serviço / requerentes /
 * natureza / origem e detecta o lançamento AGREGADO legado coexistente (não o toca).
 * Com --execute usa EXCLUSIVAMENTE o motor oficial (processarRequerenteAdicionado),
 * que é idempotente (MotorArtefato.automaticKey per-requerente) — só cria o que falta.
 *
 * Rodar (credenciais de PROD no ambiente):
 *   PRISMA_DATABASE_URL=... DIRECT_DATABASE_URL=... \
 *     npx tsx prisma/reconciliacao-honorarios-requerente.ts [--execute] [--processo=ID] [--json]
 */
import { PrismaClient } from '@prisma/client'
import { processarRequerenteAdicionado } from '../src/lib/motor/executor'
import { ehRequerente, REQUERENTE_VALORES } from '../lib/genealogia/requerente-flag'
import { ordenarRequerentes, classificarRequerente, chaveIdempotenciaRequerente } from '../lib/financeiro/classificacao-requerente'

const EXECUTE = process.argv.includes('--execute')
const JSON_OUT = process.argv.includes('--json')
const procArg = process.argv.find((a) => a.startsWith('--processo='))
const soProcesso = procArg ? Number(procArg.split('=')[1]) : null

async function main() {
  const prisma = new PrismaClient()
  const relatorio: any = { modo: EXECUTE ? 'EXECUTE' : 'DRY-RUN', regras: 0, processos: 0, requerentesElegiveis: 0, faltantes: 0, jaExistentes: 0, agregadosLegado: 0, criados: 0, pendencias: 0, itens: [] as any[] }
  try {
    // Automações person_added financeiras ativas — definem o universo (tipoProcesso + fase).
    const regras = await prisma.phaseAutomationRule.findMany({
      where: { kind: 'financial', trigger: 'person_added', active: true, arquivado: false, configItemId: { not: null } },
      select: { id: true, tipoProcessoId: true, phaseKey: true, configItemId: true },
    })
    relatorio.regras = regras.length
    if (regras.length === 0) {
      finalizar(relatorio, 'Nenhuma automação person_added ativa — nada a reconciliar (infra dormente).')
      return
    }

    const vistos = new Set<number>()
    for (const r of regras) {
      const processos = await prisma.processo.findMany({
        where: { tipoProcessoMotorId: r.tipoProcessoId, faseAtualKey: r.phaseKey, ...(soProcesso ? { id: soProcesso } : {}), arvoreId: { not: null } },
        select: { id: true, arvoreId: true },
      })
      for (const p of processos) {
        if (vistos.has(p.id)) continue
        vistos.add(p.id); relatorio.processos++

        const reqs = await prisma.pessoa.findMany({ where: { arvoreId: p.arvoreId!, requerente: { in: [...REQUERENTE_VALORES] } }, select: { id: true, nome: true, createdAt: true, requerente: true } })
        const ordenados = ordenarRequerentes(reqs.map((x) => ({ pessoaId: x.id, createdAt: x.createdAt })))

        // Agregado legado (não tocar) — só relata coexistência.
        const legado = await prisma.motorArtefato.findFirst({ where: { automaticKey: { in: [`${p.id}::honorario_por_requerente::VENDA`, `${p.id}::honorario_cidadania_italiana::VENDA`] }, status: 'active' }, select: { id: true, targetId: true } })
        if (legado) relatorio.agregadosLegado++

        for (const req of reqs) {
          if (!ehRequerente(req.requerente)) continue
          relatorio.requerentesElegiveis++
          const cls = classificarRequerente(req.id, ordenados)
          const akey = chaveIdempotenciaRequerente({ processoId: p.id, configId: r.configItemId!, ruleId: r.id, pessoaId: req.id })
          const existe = await prisma.motorArtefato.findFirst({ where: { automaticKey: akey }, select: { id: true } })
          if (existe) { relatorio.jaExistentes++; continue }
          relatorio.faltantes++
          relatorio.itens.push({ processoId: p.id, pessoaId: req.id, nome: req.nome, classificacao: cls?.classificacao, posicao: cls?.posicao, agregadoLegadoPresente: !!legado })
        }

        // EXECUÇÃO explícita: só cria o que falta, via motor idempotente. Nunca apaga o legado.
        if (EXECUTE) {
          for (const req of reqs) {
            if (!ehRequerente(req.requerente)) continue
            const rres = await processarRequerenteAdicionado({ processoId: p.id, pessoaId: req.id })
            relatorio.criados += rres.criados
            relatorio.pendencias += rres.pendencias
          }
        }
      }
    }
    finalizar(relatorio, EXECUTE ? 'Execução concluída (idempotente; legado preservado).' : 'DRY-RUN. Revise os faltantes; rode com --execute para criar apenas os ausentes.')
  } finally {
    await prisma.$disconnect()
  }
}

function finalizar(rel: any, nota: string) {
  if (JSON_OUT) { console.log(JSON.stringify({ ...rel, nota }, null, 2)); return }
  console.log(`\n=== Reconciliação honorários por requerente (${rel.modo}) ===`)
  console.log(`Regras person_added: ${rel.regras} | Processos: ${rel.processos} | Requerentes elegíveis: ${rel.requerentesElegiveis}`)
  console.log(`Faltantes: ${rel.faltantes} | Já existentes: ${rel.jaExistentes} | Agregados legado (preservados): ${rel.agregadosLegado}`)
  if (EXECUTE) console.log(`Criados: ${rel.criados} | Pendências: ${rel.pendencias}`)
  if (rel.itens.length) { console.log('\nFaltantes:'); for (const i of rel.itens.slice(0, 100)) console.log(`  • proc ${i.processoId} · req ${i.pessoaId} (${i.nome}) → ${i.classificacao} #${i.posicao}${i.agregadoLegadoPresente ? ' [tem agregado legado]' : ''}`) }
  console.log(`\n${nota}`)
}

main().catch((e) => { console.error(String(e)); process.exit(1) })
