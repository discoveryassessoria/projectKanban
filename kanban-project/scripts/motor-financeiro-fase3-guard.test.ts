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

console.log('\nSubstituição das telas — nav, bloqueio legado')
{
  // Nota: o hub standalone /financeiro/v3 (abas Obrigações/Conciliação/
  // Divergências/Auditoria/Data de corte) foi descontinuado — Financeiro V3
  // passou a viver dentro do processo (aba "Financeiro" → ProcessoFinanceiroShell).
  // /financeiro/v3 hoje só redireciona para /processos; não há mais item de nav
  // próprio, então os checks de "hub" e de nav ficaram moot e foram removidos.
  const nav = R('src/components/bitrix-sidebar.tsx')
  ok('legado permanece no nav (Financeiro Geral corporativo)', /url: "\/financeiro"/.test(nav))

  delete process.env.FINANCEIRO_LEGADO_ESCRITA_BLOQUEADA
  ok('bloqueio de escrita legado desligado por padrão', !legadoEscritaBloqueada())
  process.env.FINANCEIRO_LEGADO_ESCRITA_BLOQUEADA = '1'
  ok('bloqueio ligável por flag de ambiente', legadoEscritaBloqueada())
  delete process.env.FINANCEIRO_LEGADO_ESCRITA_BLOQUEADA

  ok('guard aplicado na criação de cobrança (legado)', /guardLegadoEscrita/.test(R('src/app/api/financeiro/receitas/[id]/cobrancas/route.ts')))
  ok('guard aplicado no registro de pagamento (legado)', /guardLegadoEscrita/.test(R('src/app/api/financeiro/cobrancas/[id]/pagamentos/route.ts')))
}

console.log('\nFinanceiro V3 no processo + sweep do guard legado')
{
  // ProcessoFinanceiroV3.tsx foi renomeado para ProcessoFinanceiroShell.tsx
  // (mesmo papel: shell da aba Financeiro dentro do processo, sub-abas Visão
  // Geral/Receitas/Custos/Extrato/Timeline).
  const comp = R('src/components/financeiro/v3/ProcessoFinanceiroShell.tsx')
  ok('processo V3 é alimentado pela rota do Ledger', /\/api\/financeiro\/v3\/processo\//.test(comp))
  ok('processo V3 exibe timeline financeira com comprovantes', /Timeline financeira/.test(comp) && /comprovante/.test(comp))

  // Distribuição por requerente e responsável pelo pagamento migraram para o
  // detalhe da Receita (ver detalhe-receita-rico), não ficam mais no shell.
  const detalhe = R('src/components/financeiro/v3/ReceitaDetalheView.tsx')
  ok('detalhe da Receita exibe distribuição entre requerentes e responsável', /Distribuição entre requerentes/.test(detalhe) && /Responsável/.test(detalhe))

  // Ocorrências (pagamento/estorno) são registradas por componentes V3
  // dedicados; nenhum componente V3 escreve nas rotas legadas.
  const dirV3Comp = 'src/components/financeiro/v3'
  const arquivosV3 = require('node:fs').readdirSync(join(process.cwd(), dirV3Comp)).filter((f: string) => f.endsWith('.tsx'))
  const fontesV3 = arquivosV3.map((f: string) => R(`${dirV3Comp}/${f}`)).join('\n')
  ok('componentes V3 registram ocorrências pela rota V3 (não legado)', /\/api\/financeiro\/v3\/ocorrencias/.test(fontesV3) && !/\/api\/financeiro\/cobrancas/.test(fontesV3) && !/\/api\/financeiro\/parcelas/.test(fontesV3))

  const modal = R('src/components/kanban/atividade-details-modal.tsx')
  ok('modal do processo usa Financeiro V3 (ProcessoFinanceiroShell) sob permissão financeiro.ver', /<ProcessoFinanceiroShell\b/.test(modal) && /pode\('financeiro\.ver'\)/.test(modal))

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
