// F3.3 — Escrita legada de custo marcável como só-leitura. O guard é flag-gated
// (FINANCEIRO_LEGADO_ESCRITA_BLOQUEADA), aditivo: sem a flag nada muda; com a flag,
// as rotas de escrita legada de custo recusam (423). Prova o comportamento + a COBERTURA
// (todas as rotas de escrita legada de custo chamam o guard).
import { readFileSync } from 'node:fs'
import { guardLegadoEscrita, legadoEscritaBloqueada } from '@/lib/financeiro/legado-guard'

let ok = 0, fail = 0
const chk = (c: boolean, m: string) => { if (c) { ok++; console.log('  ✅', m) } else { fail++; console.log('  ❌', m) } }

const ROTAS_ESCRITA_LEGADO_CUSTO = [
  'src/app/api/processos/[processoId]/outros-custos/route.ts',
  'src/app/api/outros-custos/[id]/route.ts',
  'src/app/api/outros-custos/[id]/pagamentos/route.ts',
  'src/app/api/pagamentos-outro-custo/[id]/route.ts',
  'src/app/api/financeiro/custos/[id]/estornar/route.ts',
  'src/app/api/financeiro/custos/[id]/cancelar/route.ts',
]

async function main() {
  // comportamento: desligado por padrão
  delete process.env.FINANCEIRO_LEGADO_ESCRITA_BLOQUEADA
  chk(legadoEscritaBloqueada() === false, 'padrão: legado NÃO bloqueado (nada muda até o corte)')
  chk(guardLegadoEscrita() === null, 'guard retorna null quando desligado (fluxo segue)')

  // ligado: bloqueia com 423
  process.env.FINANCEIRO_LEGADO_ESCRITA_BLOQUEADA = '1'
  chk(legadoEscritaBloqueada() === true, 'flag liga o bloqueio')
  const r = guardLegadoEscrita()
  chk(r != null && r.status === 423, `guard retorna 423 quando ligado (${r?.status})`)
  delete process.env.FINANCEIRO_LEGADO_ESCRITA_BLOQUEADA

  // cobertura: toda rota de escrita legada de custo chama o guard
  for (const rota of ROTAS_ESCRITA_LEGADO_CUSTO) {
    const src = readFileSync(rota, 'utf8')
    chk(src.includes('guardLegadoEscrita()'), `guard presente em ${rota.replace('src/app/api/', '')}`)
  }

  console.log(`\n${ok} passaram, ${fail} falharam`)
  process.exit(fail ? 1 : 0)
}
main().catch((e) => { console.error(e); process.exit(1) })
