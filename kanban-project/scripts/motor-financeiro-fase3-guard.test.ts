// scripts/motor-financeiro-fase3-guard.test.ts
// GUARDA estrutural — Fase 3: rota admin da data de corte (permissão exclusiva
// opt-in, flag, dry-run obrigatório, confirmação explícita, auditoria, rollback
// sem apagar histórico) + conciliação flag-gated + permissão registrada.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PERMISSOES, PERMISSOES_OPT_IN } from '../src/lib/permissoes'

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

console.log(`\n${'='.repeat(60)}`)
console.log(`Motor Financeiro V3 · Fase 3 (guard): ${passou} passaram, ${falhou} falharam`)
console.log('='.repeat(60))
if (falhou > 0) process.exit(1)
