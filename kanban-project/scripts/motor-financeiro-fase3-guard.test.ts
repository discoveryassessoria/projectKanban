// scripts/motor-financeiro-fase3-guard.test.ts
// GUARDA estrutural — Fase 3: rota admin da data de corte (permissão exclusiva
// opt-in, flag, dry-run obrigatório, confirmação explícita, auditoria, rollback
// sem apagar histórico) + conciliação flag-gated + permissão registrada.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PERMISSOES, PERMISSOES_OPT_IN } from '../src/lib/permissoes'
import { legadoEscritaBloqueada } from '../lib/financeiro/legado-guard'

let passou = 0, falhou = 0
const ok = (n: string, c: boolean) => { if (c) { passou++; console.log(`  ✓ ${n}`) } else { falhou++; console.log(`  ✗ ${n}`) } }
const R = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')

console.log('\nPermissão exclusiva (opt-in)')
{
  ok('financeiro.dataCorte existe no catálogo', 'financeiro.dataCorte' in PERMISSOES)
  ok('financeiro.dataCorte é OPT-IN (fora dos perfis padrão; admin recebe por tipo)', PERMISSOES_OPT_IN.has('financeiro.dataCorte'))
}

console.log('\nRota data-corte — regras')
{
  const rota = R('src/app/api/financeiro/v3/data-corte/route.ts')
  ok('protegida pela permissão exclusiva', /verificarPermissao\(req, 'financeiro\.dataCorte'\)/.test(rota))
  ok('flag-gated (dataCorte)', /flagAtiva\('dataCorte'/.test(rota))
  ok('dry-run por padrão (executar !== true)', /executar !== true/.test(rota))
  ok('execução real exige confirmação explícita', /EXECUTAR CORTE/.test(rota) && /confirmacao/.test(rota))
  ok('rollback operacional por flag + confirmação', /rollback === true/.test(rota) && /REVERTER CORTE/.test(rota))
  ok('auditoria completa (auditarCorte em todos os modos)', (rota.match(/auditarCorte/g) || []).length >= 3)
}

console.log('\nServiço de corte — idempotência e histórico')
{
  const svc = R('lib/financeiro/corte/data-corte-service.ts')
  ok('idempotente (ignora abertura ATIVA não revertida)', /revertidoEm/.test(svc) && /abertasAtivas/.test(svc))
  ok('rollback é ESTORNO append-only (não apaga entries/marcador)', /lancEstorno/.test(svc) && /revertidoEm: new Date\(\)/.test(svc) && !/deleteMany|\.delete\(/.test(svc))
  ok('resumo traz divergências e itens ignorados', /divergencias/.test(svc) && /ignoradas/.test(svc))
  ok('reconciliação do espelho evita dupla contagem', /RECONCILIA_ESPELHO/.test(svc) && /lancReconciliacaoCorte/.test(svc))
}

console.log('\nConciliação — flag-gated e sem resolução silenciosa')
{
  const rota = R('src/app/api/financeiro/v3/conciliacao/route.ts')
  ok('conciliação é flag-gated', /flagAtiva\('conciliacao'/.test(rota))
  const svc = R('lib/financeiro/conciliacao/conciliacao-service.ts')
  ok('conciliar é dry-run por padrão (aplicar === true persiste)', /aplicar === true/.test(svc))
  ok('importação idempotente por identificador', /findUnique\(\{ where: \{ identificadorTransacao/.test(svc))
  const m = R('lib/financeiro/conciliacao/matching.ts')
  ok('divergência nunca silenciosa (DIVERGENTE explícito)', /DIVERGENTE/.test(m) && /SEM_CORRESPONDENCIA/.test(m))
}

console.log('\nSubstituição das telas — nav, bloqueio legado, telas V3')
{
  const nav = R('src/components/bitrix-sidebar.tsx')
  ok('nav tem item Financeiro V3 (/financeiro/v3)', /Financeiro V3/.test(nav) && /\/financeiro\/v3/.test(nav))
  ok('legado permanece no nav (fallback temporário)', /url: "\/financeiro"/.test(nav))

  delete process.env.FINANCEIRO_LEGADO_ESCRITA_BLOQUEADA
  ok('bloqueio de escrita legado desligado por padrão', !legadoEscritaBloqueada())
  process.env.FINANCEIRO_LEGADO_ESCRITA_BLOQUEADA = '1'
  ok('bloqueio ligável por flag de ambiente', legadoEscritaBloqueada())
  delete process.env.FINANCEIRO_LEGADO_ESCRITA_BLOQUEADA

  ok('guard aplicado na criação de cobrança (legado)', /guardLegadoEscrita/.test(R('src/app/api/financeiro/receitas/[id]/cobrancas/route.ts')))
  ok('guard aplicado no registro de pagamento (legado)', /guardLegadoEscrita/.test(R('src/app/api/financeiro/cobrancas/[id]/pagamentos/route.ts')))
  ok('guard aplicado no lançamento de parcela (legado)', /guardLegadoEscrita/.test(R('src/app/api/financeiro/parcelas/[id]/lancamento/route.ts')))

  const hub = R('src/app/financeiro/v3/page.tsx')
  ok('hub V3 tem as telas mínimas (abas)', /Visão geral/.test(hub) && /Obrigações/.test(hub) && /Conciliação/.test(hub) && /Divergências/.test(hub) && /Auditoria/.test(hub) && /Data de corte/.test(hub))
  ok('hub V3 consome as rotas do Ledger', /financeiro\/v3\/resumo/.test(hub) && /financeiro\/v3\/obrigacoes/.test(hub) && /financeiro\/v3\/divergencias/.test(hub))
}

console.log('\nFinanceiro V3 no processo + sweep do guard legado')
{
  const comp = R('src/components/financeiro/v3/ProcessoFinanceiroV3.tsx')
  ok('processo V3 é alimentado pela rota do Ledger', /\/api\/financeiro\/v3\/processo\//.test(comp))
  ok('processo V3 registra ocorrências pela rota V3 (não legado)', /\/api\/financeiro\/v3\/ocorrencias/.test(comp) && !/\/api\/financeiro\/cobrancas/.test(comp))
  ok('processo V3 exibe distribuição/responsáveis/timeline/comprovantes', /Distribuição por requerente/.test(comp) && /Responsáveis contratuais/.test(comp) && /Timeline financeira/.test(comp) && /comprovante/.test(comp))
  const modal = R('src/components/kanban/atividade-details-modal.tsx')
  ok('modal do processo troca V3×legado por flag (fallback)', /financeiroV3Ativo \? \(/.test(modal) && /ProcessoFinanceiroV3/.test(modal) && /<ProcessoFinanceiro\b/.test(modal))

  // sweep: todos os writes de api/financeiro (não-v3) guardados, exceto simular
  const dir = 'src/app/api/financeiro'
  const walk = (d: string): string[] => require('node:fs').readdirSync(join(process.cwd(), d), { withFileTypes: true }).flatMap((e: any) => e.isDirectory() ? walk(`${d}/${e.name}`) : (e.name === 'route.ts' ? [`${d}/${e.name}`] : []))
  const rotas = walk(dir).filter((f) => !f.includes('/v3/'))
  const escreve = (s: string) => /export async function (POST|PATCH|PUT|DELETE)/.test(s)
  // desprotegido = escreve, sem guard, não é simulação e NÃO está já desativado (405)
  const desprotegidos = rotas.filter((f) => { const s = R(f); return escreve(s) && !/guardLegadoEscrita/.test(s) && !f.includes('/simular/') && !/status: 405/.test(s) })
  ok(`writes legados guardados (exceto simular e já-405) — desprotegidos: ${desprotegidos.length ? desprotegidos.join(', ') : '0'}`, desprotegidos.length === 0)
}

console.log(`\n${'='.repeat(60)}`)
console.log(`Motor Financeiro V3 · Fase 3 (guard): ${passou} passaram, ${falhou} falharam`)
console.log('='.repeat(60))
if (falhou > 0) process.exit(1)
