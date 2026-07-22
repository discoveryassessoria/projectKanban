/**
 * cambio-confidence-guard — provider Confidence + integração de câmbio. Puro + estrutural.
 * Rodar: npx tsx scripts/cambio-confidence-guard.test.ts
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { extrairValorVenda, hashPayload, ConfidenceExchangeProvider, MODALIDADE_OFICIAL, ORIGEM_AUTOMATICA } from '../lib/cambio/confidence-provider'

const RAIZ = join(__dirname, '..')
let ok = 0, fail = 0; const F: string[] = []
const T = (n: string, c: boolean) => { if (c) { ok++; console.log(`  ✅ ${n}`) } else { fail++; F.push(n); console.log(`  ❌ ${n}`) } }
const src = (p: string) => readFileSync(join(RAIZ, p), 'utf8')

console.log('\nParser/validação do provider')
{
  T('EUR extrai venda de lista', extrairValorVenda({ cotacoes: [{ moeda: 'EUR', venda: 6.12 }] }, 'EUR').valor === 6.12)
  T('USD extrai venda de mapa', extrairValorVenda({ USD: { sell: 5.4 } }, 'USD').valor === 5.4)
  T('string "6,12" normaliza', extrairValorVenda([{ currency: 'EUR', valor: '6,12' }], 'EUR').valor === 6.12)
  T('zero rejeitado (valor null)', extrairValorVenda([{ moeda: 'EUR', venda: 0 }], 'EUR').valor === null)
  T('moeda ausente → null', extrairValorVenda([{ moeda: 'GBP', venda: 7 }], 'EUR').valor === null)
  T('payload vazio → null', extrairValorVenda(null, 'EUR').valor === null)
  T('dataReferencia lida', extrairValorVenda({ data: '2026-07-22', EUR: { venda: 6.1 } }, 'EUR').dataRef === '2026-07-22')
}

console.log('\nHash idempotente')
{
  T('mesmo payload → mesmo hash', hashPayload({ a: 1, b: 2 }) === hashPayload({ a: 1, b: 2 }))
  T('payload diferente → hash diferente (revisão)', hashPayload({ a: 1 }) !== hashPayload({ a: 2 }))
}

console.log('\nProvider LIVE (endpoint público do widget) — estrutura correta, sem inventar')
{
  ;(async () => {
    T('modalidade oficial = Câmbio final (VET) transf. internacional', MODALIDADE_OFICIAL === 'transferencia_internacional_vet')
    T('origem CONFIDENCE_AUTOMATICO', ORIGEM_AUTOMATICA === 'CONFIDENCE_AUTOMATICO')

    console.log('\nGuardas estruturais')
    const provSrc = src('lib/cambio/confidence-provider.ts')
    T('não usa BCE/BancoCentral/awesomeapi como fallback', !/bcb|bancocentral|awesomeapi|economia\.awesomeapi|ptax/i.test(provSrc))
    T('endpoint real do widget (moedas-operacionais/{id}/cotacao)', /v2\/moedas-operacionais\/\$\{MOEDA_ID\[moeda\]\}\/cotacao\?cidade-id=/.test(provSrc))
    T('header auth (token público do widget)', /auth: CONFIDENCE_AUTH/.test(provSrc))
    T('preço = base × (1 + IOF/100), tarifa à parte (auditável)', /venda\.valor \* \(1 \+ iof \/ 100\)/.test(provSrc))
    T('IDs remessa EUR=85 USD=34', /EUR.*'85'/.test(provSrc) && /USD.*'34'/.test(provSrc))
    T('rejeita venda.valor ausente/<=0 (não inventa/zero)', /venda\.valor > 0/.test(provSrc) && /INCONSISTENTE/.test(provSrc))
    const svc = src('src/lib/cambio/servico-cambio.ts')
    T('serviço usa trava de concorrência (advisory lock)', /pg_try_advisory_lock/.test(svc))
    T('reprocessa SEM_CAMBIO após EUR válido', /euroValido[\s\S]*reprocessarSemCambio/.test(svc))
    T('reprocessamento usa mecanismos oficiais', svc.includes('reprocessarPendenciasFinanceiras') && svc.includes('processarRequerenteAdicionado'))
    T('EUR e USD independentes (loop por moeda, try isolado)', /for \(const moeda of MOEDAS\)/.test(svc))
    T('persistência idempotente por payloadHash', /payloadHash: r\.payloadHash/.test(svc) && /findFirst/.test(svc))
    T('revisão auditável (substituiId, sem apagar)', svc.includes('substituiId') && !/\.delete\(/.test(svc))
    T('espelha no campo legado ativo/taxa (motor lê)', /ativo: true/.test(svc) && /taxa: r\.valor/.test(svc))
    const cron = src('src/app/api/cron/cambio/route.ts')
    T('cron protegido (CRON_SECRET ou header vercel-cron)', cron.includes('CRON_SECRET') && cron.includes('x-vercel-cron'))
    const atualizar = src('src/app/api/gerenciamento/cambio/atualizar-agora/route.ts')
    T('“Atualizar agora” usa o MESMO serviço (não paralelo)', atualizar.includes('atualizarCotacoesConfidence'))
    // Câmbio na Home virou componente DISCRETO da barra superior (todas as telas),
    // no lugar do card grande — ver src/components/cambio/cambio-mini.tsx.
    const card = src('src/components/cambio/cambio-mini.tsx')
    T('componente lê só o snapshot do banco (não Confidence)', card.includes('/api/cambio/snapshot') && !/confidencecambio/i.test(card))
    T('componente clicável → histórico /cambio', card.includes('href="/cambio"'))
    const header = src('src/components/header-bar.tsx')
    T('câmbio discreto na barra superior de todas as telas', header.includes('<CambioMini />'))
    const vjson = JSON.parse(src('vercel.json'))
    T('vercel.json tem cron diário p/ /api/cron/cambio', Array.isArray(vjson.crons) && vjson.crons.some((c: any) => c.path === '/api/cron/cambio'))

    console.log(`\n${'='.repeat(56)}`)
    console.log(`Câmbio Confidence: ${ok} passaram, ${fail} falharam`)
    if (F.length) console.log('Falhas:\n  - ' + F.join('\n  - '))
    console.log('='.repeat(56))
    if (fail > 0) process.exit(1)
  })()
}
