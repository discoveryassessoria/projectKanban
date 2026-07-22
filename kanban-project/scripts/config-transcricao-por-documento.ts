/**
 * config-transcricao-por-documento.ts — CONFIGURA o preço da Transcrição como
 * estratégia "Por unidade" + unidade "Documento" + valor unitário (default EUR 321).
 *
 * É a MESMA capacidade genérica da tela (nenhuma lógica especial de Transcrição no
 * runtime): este script só grava a COMBINAÇÃO na linha de preço existente.
 *
 * IDEMPOTENTE: se a linha já estiver assim, não altera. Guarda de identidade: só
 * age sobre a config cujo mestre casa "Transcri…". NÃO cria linhas novas — ajusta
 * as existentes (VENDA por padrão; ajustável).
 *
 * Rodar (com credenciais de PRODUÇÃO no ambiente):
 *   PRISMA_DATABASE_URL=... DIRECT_DATABASE_URL=... \
 *     npx tsx scripts/config-transcricao-por-documento.ts [--apply] [--valor=321] [--natureza=VENDA]
 * Sem --apply faz DRY-RUN (só mostra o que faria).
 */
import { PrismaClient } from '@prisma/client'
import { estrategiaDoModo, ESTRATEGIA } from '../lib/financeiro/modo-calculo'
import { normalizarUnidade } from '../lib/financeiro/unidade-cobranca'

const arg = (k: string, d?: string) => {
  const hit = process.argv.find((a) => a.startsWith(`--${k}=`))
  return hit ? hit.split('=').slice(1).join('=') : d
}
const APPLY = process.argv.includes('--apply')
const VALOR = Number(arg('valor', '321'))
const NATUREZA = (arg('natureza', 'VENDA') || 'VENDA').toUpperCase() as 'VENDA' | 'CUSTO'
const UNIDADE = normalizarUnidade('DOCUMENTO')! // 'DOCUMENTO'
const MODO = ESTRATEGIA.POR_UNIDADE // 'per_unit'

async function main() {
  const prisma = new PrismaClient()
  try {
    const cfgs = await prisma.produtoFinanceiro.findMany({
      where: {
        OR: [
          { itemCatalogo: { name: { contains: 'ranscri', mode: 'insensitive' } } },
          { honorario: { name: { contains: 'ranscri', mode: 'insensitive' } } },
          { tipoDocumento: { name: { contains: 'ranscri', mode: 'insensitive' } } },
        ],
      },
      select: { id: true, itemCatalogo: { select: { name: true } }, honorario: { select: { name: true } }, tipoDocumento: { select: { name: true } } },
    })
    if (cfgs.length === 0) { console.log('Nenhuma Configuração Financeira de Transcrição encontrada.'); return }

    for (const c of cfgs) {
      const nome = c.itemCatalogo?.name ?? c.honorario?.name ?? c.tipoDocumento?.name ?? `config ${c.id}`
      const linhas = await prisma.tabelaValor.findMany({
        where: { configuracaoFinanceiraItemId: c.id, natureza: NATUREZA as any, arquivado: false },
        select: { id: true, valor: true, valorBase: true, valorAdicional: true, modoCalculo: true, unidade: true },
      })
      if (linhas.length === 0) { console.log(`• ${nome}: sem linha ${NATUREZA} ativa — pulando (crie o preço na tela).`); continue }

      for (const ln of linhas) {
        const jaOk = estrategiaDoModo(ln.modoCalculo) === 'unitario'
          && normalizarUnidade(ln.unidade) === UNIDADE
          && ln.valorBase == null && ln.valorAdicional == null
          && Number(ln.valor) === VALOR
        if (jaOk) { console.log(`• ${nome} (linha ${ln.id}): já configurada (Por unidade · Documento · ${VALOR}).`); continue }
        console.log(`• ${nome} (linha ${ln.id}): ${estrategiaDoModo(ln.modoCalculo)}/${ln.unidade ?? '—'}/${String(ln.valor)} → unitario/DOCUMENTO/${VALOR}`)
        if (APPLY) {
          await prisma.tabelaValor.update({
            where: { id: ln.id },
            data: { modoCalculo: MODO, unidade: UNIDADE, valor: VALOR as any, valorBase: null, valorAdicional: null, quantidadeMinima: null, quantidadeMaxima: null },
          })
          console.log(`  ✔ aplicado.`)
        }
      }
    }
    console.log(APPLY ? '\nConcluído (--apply).' : '\nDRY-RUN. Rode com --apply para gravar.')
  } finally {
    await prisma.$disconnect()
  }
}
main().catch((e) => { console.error(String(e)); process.exit(1) })
