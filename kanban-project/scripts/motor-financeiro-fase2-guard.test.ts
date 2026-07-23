// scripts/motor-financeiro-fase2-guard.test.ts
// GUARDA estrutural — Motor Financeiro V3 · Fase 2: feature flags (independentes,
// Preview+admin), fallback ao legado sempre disponível, e invariantes de código
// (excedente nunca silencioso, rotas flag-gated, dual-write intocado).
import { flagAtiva, flagsV3 } from '../lib/financeiro/flags'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

let passou = 0, falhou = 0
const ok = (n: string, c: boolean) => { if (c) { passou++; console.log(`  ✓ ${n}`) } else { falhou++; console.log(`  ✗ ${n}`) } }
const sec = (t: string) => console.log(`\n${t}`)
const R = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')
const limparEnv = () => { for (const k of Object.keys(process.env)) if (k.startsWith('FINANCEIRO_V3_') || k === 'VERCEL_ENV') delete process.env[k] }

sec('Feature flags — independentes, env explícita, Preview+admin')
{
  limparEnv()
  ok('sem env / sem usuário → tudo desligado (exceto fallback)', !flagAtiva('posicaoRead') && !flagAtiva('ocorrencias') && !flagAtiva('extras') && !flagAtiva('projecoes'))
  ok('fallback ao legado é o padrão seguro (ligado)', flagAtiva('fallbackLegado'))

  process.env.FINANCEIRO_V3_POSICAO = '1'
  ok('env liga SÓ a flag correspondente (independência)', flagAtiva('posicaoRead') && !flagAtiva('ocorrencias'))
  delete process.env.FINANCEIRO_V3_POSICAO

  process.env.VERCEL_ENV = 'preview'
  ok('Preview + não-admin → desligado', !flagAtiva('ocorrencias', { tipo: 'operador' }))
  ok('Preview + admin (tipo) → ligado', flagAtiva('ocorrencias', { tipo: 'admin' }))
  ok('Preview + permissão granular → ligado', flagAtiva('extras', { permissoes: ['financeiro.motor_v3'] }))
  ok('Preview + isAdmin → ligado', flagAtiva('posicaoRead', { isAdmin: true }))
  process.env.VERCEL_ENV = 'production'
  ok('Produção + admin, SEM env → desligado (só env liga em prod)', !flagAtiva('ocorrencias', { tipo: 'admin' }))

  process.env.FINANCEIRO_V3_FALLBACK_LEGADO = '0'
  ok('fallback pode ser explicitamente desligado', !flagAtiva('fallbackLegado'))
  delete process.env.FINANCEIRO_V3_FALLBACK_LEGADO
  limparEnv()
  ok('flagsV3 devolve as 5 flags', Object.keys(flagsV3()).length === 5)
}

sec('Invariantes de código — excedente explícito, rotas gated, legado intocado')
{
  const oc = R('lib/financeiro/ocorrencias/ocorrencia-service.ts')
  ok('excedente NUNCA silencioso: vira CreditoFinanceiro explícito', /excedente > 0/.test(oc) && /creditoFinanceiro\.create/.test(oc))
  ok('ocorrência é transacional ($transaction)', /prisma\.\$transaction/.test(oc))
  ok('ocorrência é idempotente (idempotencyKey)', /idempotencyKey/.test(oc) && /findUnique\(\{ where: \{ idempotencyKey/.test(oc))
  ok('pagador externo usa ParteExterna (sem Pessoa sombra)', /parteExterna\.create/.test(oc))

  const pos = R('src/app/api/financeiro/v3/posicao/route.ts')
  ok('rota posição é flag-gated + sinaliza fallback', /flagAtiva\('posicaoRead'/.test(pos) && /fallbackLegado: true/.test(pos))
  const ocr = R('src/app/api/financeiro/v3/ocorrencias/route.ts')
  ok('rota ocorrências é flag-gated', /flagAtiva\('ocorrencias'/.test(ocr))
  const ext = R('src/app/api/financeiro/v3/lancamentos-extras/route.ts')
  ok('rota lançamentos-extras é flag-gated', /flagAtiva\('extras'/.test(ext))

  const dw = R('lib/financeiro/dual-write.ts')
  ok('dual-write permanece best-effort (não lança)', /catch/.test(dw))

  const posSvc = R('lib/financeiro/leitura/posicao-service.ts')
  ok('leitura detecta divergência replay × projeção', /consistente/.test(posSvc) && /saldoReplay/.test(posSvc))
  ok('leitura usa código operacional REC (sem CTR)', /codigoOperacional/.test(posSvc) && !/\bCTR-/.test(posSvc))
}

console.log(`\n${'='.repeat(60)}`)
console.log(`Motor Financeiro V3 · Fase 2 (guard): ${passou} passaram, ${falhou} falharam`)
console.log('='.repeat(60))
if (falhou > 0) process.exit(1)
