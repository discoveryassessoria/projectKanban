// scripts/cadastro-mestre-guard.test.ts
// ============================================================================
// GUARDA do Cadastro Mestre Financeiro: camada compartilhada de consulta
// (paginação/busca/ordenação/ativo, retrocompatível) e auditoria/histórico
// (reusa LogAuditoria). Puro: lógica de consulta + presença nos cadastros.
// ============================================================================
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { parseConsulta, filtroBusca, filtroAtivo, ordenacao, meta } from '../lib/gerenciamento/consulta'
import { diffCampos } from '../lib/gerenciamento/auditoria'

const RAIZ = join(__dirname, '..')
let passou = 0, falhou = 0
const ok = (n: string, c: boolean) => { if (c) { passou++; console.log(`  ✓ ${n}`) } else { falhou++; console.log(`  ✗ ${n}`) } }
const secao = (t: string) => console.log(`\n${t}`)
const sp = (s: string) => new URLSearchParams(s)

// ── consulta (retrocompatível) ──────────────────────────────────────────────
secao('Camada de consulta')
{
  const vazio = parseConsulta(sp(''))
  ok('sem params: sem paginação (take undefined)', vazio.take === undefined && vazio.skip === undefined)
  ok('sem params: sem busca', vazio.q === null)
  ok('meta sem paginação → paginado=false', meta(12, vazio).paginado === false && meta(12, vazio).total === 12)

  const pag = parseConsulta(sp('page=2&limit=10'))
  ok('paginação: take=10', pag.take === 10)
  ok('paginação: skip=10 (página 2)', pag.skip === 10)
  ok('meta paginada: totalPages', meta(25, pag).totalPages === 3 && meta(25, pag).paginado === true)
  ok('limite teto 500', parseConsulta(sp('limit=99999')).take === 500)

  const busca = parseConsulta(sp('q=nascimento'))
  ok('busca lida', busca.q === 'nascimento')
  const w = filtroBusca(busca.q, ['name', 'code']) as { OR?: unknown[] }
  ok('filtroBusca gera OR contains', Array.isArray(w.OR) && w.OR.length === 2)
  ok('filtroBusca vazio quando sem termo', Object.keys(filtroBusca(null, ['name'])).length === 0)

  ok('filtroAtivo=true', JSON.stringify(filtroAtivo(parseConsulta(sp('ativo=true')))) === '{"ativo":true}')
  ok('filtroAtivo ausente', Object.keys(filtroAtivo(parseConsulta(sp('')))).length === 0)

  const c = parseConsulta(sp('sort=name&order=desc'))
  ok('ordenacao respeita permitido', JSON.stringify(ordenacao(c, ['name'], [{ id: 'asc' }])) === '[{"name":"desc"}]')
  ok('ordenacao rejeita campo não permitido → padrão', JSON.stringify(ordenacao(parseConsulta(sp('sort=hack')), ['name'], [{ id: 'asc' }])) === '[{"id":"asc"}]')
}

// ── auditoria ───────────────────────────────────────────────────────────────
secao('Camada de auditoria (diff)')
{
  const d = diffCampos({ nome: 'A', valor: 1, rel: { x: 1 } }, { nome: 'B', valor: 1, rel: { x: 2 } })
  ok('detecta campo alterado', d.nome && d.nome.de === 'A' && d.nome.para === 'B')
  ok('ignora campo igual', !('valor' in d))
  ok('ignora objetos aninhados', !('rel' in d))
}

// ── presença nos cadastros ──────────────────────────────────────────────────
secao('Integração nos cadastros mestre')
{
  ok('helper de consulta existe', existsSync(join(RAIZ, 'lib/gerenciamento/consulta.ts')))
  ok('helper de auditoria existe (reusa LogAuditoria)', existsSync(join(RAIZ, 'lib/gerenciamento/auditoria.ts')))
  const aud = readFileSync(join(RAIZ, 'lib/gerenciamento/auditoria.ts'), 'utf8')
  ok('auditoria grava em LogAuditoria', aud.includes('prisma.logAuditoria.create'))
  ok('auditoria é fail-safe', /catch[\s\S]{0,80}operação seguiu/.test(aud))

  ok('rota de histórico reutilizável existe', existsSync(join(RAIZ, 'src/app/api/gerenciamento/historico/route.ts')))

  // consulta server-side nos GET
  const comConsulta = ['catalogo-mestre', 'tipos-documento', 'aplicabilidade-economica']
  for (const d of comConsulta) {
    const src = readFileSync(join(RAIZ, `src/app/api/gerenciamento/${d}/route.ts`), 'utf8')
    ok(`${d}: GET usa parseConsulta`, src.includes('parseConsulta('))
    ok(`${d}: GET anexa meta (retrocompatível)`, src.includes('meta: meta(') || src.includes('meta(total'))
  }

  // auditoria nas mutations dos 6 cadastros
  const cadastros: Array<[string, string]> = [
    ['catalogo-mestre', 'ItemCatalogo'],
    ['tipos-documento', 'TipoDocumentoCadastro'],
    ['tabela-valores', 'TabelaValor'],
    ['condicoes-pagamento', 'CondicaoPagamento'],
    ['formas-pagamento', 'FormaPagamentoCadastro'],
    ['taxas-pagamento', 'TaxaPagamento'],
    ['aplicabilidade-economica', 'PhaseEconomicRule'],
  ]
  for (const [d, ent] of cadastros) {
    const raiz = readFileSync(join(RAIZ, `src/app/api/gerenciamento/${d}/route.ts`), 'utf8')
    const idp = join(RAIZ, `src/app/api/gerenciamento/${d}/[id]/route.ts`)
    const id = existsSync(idp) ? readFileSync(idp, 'utf8') : ''
    const junto = raiz + id
    ok(`${d}: registra auditoria`, junto.includes('registrarAuditoria('))
    ok(`${d}: auditoria referencia a entidade ${ent}`, junto.includes(`entidade: '${ent}'`))
  }
}

console.log(`\n${'='.repeat(60)}`)
console.log(`Cadastro Mestre: ${passou} passaram, ${falhou} falharam`)
console.log('='.repeat(60))
if (falhou > 0) process.exit(1)
