// scripts/condicao-formas.test.ts
// ============================================================================
// GUARDA — Etapa "Formas" da Condição de Pagamento.
//
// Dois conceitos SEPARADOS (o campo único "Forma sugerida" acabou):
//   • Formas permitidas — N:N, multisseleção. Vazio = SEM RESTRIÇÃO.
//   • Forma padrão      — única, opcional, sugestão inicial da cobrança;
//                         obrigatoriamente entre as permitidas quando há restrição.
//
// (1) regras puras de seleção e da forma padrão
// (2) validação contra o cadastro (existe / ativa / pertence às permitidas)
// (3) runtime da cobrança: sugere a padrão, restringe às permitidas, mantém
//     TODAS as validações de compatibilidade da Forma
// (4) interface e edição
// (5) migração do dado legado + histórico preservado
// ============================================================================
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import {
  idUnico, selecaoFormasDoBody, eixosFormasPresentes, padraoValido, resolverFormas,
  formaPermitidaNaCondicao,
} from '../lib/financeiro/condicao-formas'
import { calcularCobranca, podeRecalcular } from '../lib/financeiro/charge-calculation-service'

const RAIZ = join(__dirname, '..')
let passou = 0, falhou = 0
const ok = (n: string, c: boolean) => { if (c) { passou++; console.log(`  ✓ ${n}`) } else { falhou++; console.log(`  ✗ ${n}`) } }
const sec = (t: string) => console.log(`\n${t}`)

// Cadastro real de formas (PIX, Transferência, Dinheiro, Débito, Boleto, Crédito).
const FORMAS = [
  { id: 1, name: 'PIX', ativo: true },
  { id: 2, name: 'Transferência Bancária', ativo: true },
  { id: 3, name: 'Dinheiro', ativo: true },
  { id: 4, name: 'Cartão de Débito', ativo: true },
  { id: 5, name: 'Boleto Bancário', ativo: true },
  { id: 6, name: 'Cartão de Crédito', ativo: true },
  { id: 9, name: 'Forma Descontinuada', ativo: false },
]
let chamadas = 0
const db = {
  formaPagamentoCadastro: {
    findMany: async ({ where }: { where: { id: { in: number[] } } }) => {
      chamadas++
      return FORMAS.filter((f) => where.id.in.includes(f.id))
    },
  },
} as never

const formaView = (over: Record<string, unknown> = {}) => ({
  id: 6, name: 'Cartão de Crédito', ativo: true, permiteParcelas: true, maxParcelas: 6,
  usoRecebimento: true, usoPagamento: true, moedasAceitas: [], aceitaEntrada: true,
  ...over,
}) as never

const condView = (over: Record<string, unknown> = {}) => ({
  id: 100, tipoPagamento: 'PARCELADO', parcelasPadrao: 1, parcelasMin: 1, parcelasMax: 12,
  aplicaA: 'RECEITA', politicaTaxas: 'IGNORAR', periodicidade: 'MENSAL', distribuicao: 'ULTIMA_AJUSTA',
  inicioCronograma: 'IMEDIATA', ...over,
}) as never

async function main() {
sec('1 — regras puras: permitidas (N:N) e padrão (única)')
{
  const s = selecaoFormasDoBody({ formasPermitidas: [1, 2, 3, 4, 5], formaPadraoId: 1 })
  ok('condição À vista permite PIX, Transferência, Dinheiro, Débito e Boleto', s.permitidas.length === 5)
  ok('forma padrão é uma só', s.padrao === 1)
  ok('uma forma permitida é válida', selecaoFormasDoBody({ formasPermitidas: [1] }).permitidas.length === 1)
  ok('nenhuma forma = sem restrição', selecaoFormasDoBody({ formasPermitidas: [] }).permitidas.length === 0)
  ok('não duplica formas', JSON.stringify(selecaoFormasDoBody({ formasPermitidas: [1, 1, 2] }).permitidas) === '[1,2]')
  ok('padrão recusa texto livre', idUnico('PIX') === null && idUnico('') === null)
  ok('aceita o nome novo da API', selecaoFormasDoBody({ formaPagamentoPermitidaIds: [1, 2], formaPagamentoPadraoId: 2 }).padrao === 2)
  ok('lê a coluna legada como padrão', selecaoFormasDoBody({ formaSugeridaId: 3 }).padrao === 3)

  const p = eixosFormasPresentes({ formasPermitidas: [] })
  ok('eixo presente e vazio ≠ ausente', p.permitidas === true && p.padrao === false)

  ok('padrão dentro das permitidas é válido', padraoValido([1, 2, 3], 1))
  ok('padrão fora das permitidas é inválido', !padraoValido([1, 2, 3], 6))
  ok('sem restrição, qualquer padrão vale', padraoValido([], 6))
  ok('sem padrão é sempre válido (opcional)', padraoValido([1, 2], null))
}

sec('2 — backend valida contra o cadastro (nunca confia no frontend)')
{
  chamadas = 0
  const r = await resolverFormas({ formasPermitidas: [1, 2, 3], formaPadraoId: 1 }, db)
  ok('seleção válida passa sem erro', r.erros.length === 0)
  ok('1 query só (sem N+1)', chamadas === 1)

  const inexistente = await resolverFormas({ formasPermitidas: [999] }, db)
  ok('ID inexistente é rejeitado', inexistente.erros.some((e) => e.campo === 'formasPermitidas' && e.mensagem.includes('inexistente')))

  const inativa = await resolverFormas({ formasPermitidas: [9] }, db)
  ok('forma inativa é rejeitada', inativa.erros.some((e) => e.mensagem.includes('inativa')))

  const padraoInativa = await resolverFormas({ formasPermitidas: [1], formaPadraoId: 9 }, db)
  ok('forma padrão inativa é rejeitada', padraoInativa.erros.some((e) => e.campo === 'formaPadraoId'))

  const padraoFora = await resolverFormas({ formasPermitidas: [1, 2], formaPadraoId: 6 }, db)
  ok('forma padrão fora das permitidas é rejeitada', padraoFora.erros.some((e) => e.campo === 'formaPadraoId' && e.mensagem.includes('entre as formas permitidas')))

  const padraoInexistente = await resolverFormas({ formaPadraoId: 999 }, db)
  ok('forma padrão inexistente é rejeitada', padraoInexistente.erros.some((e) => e.campo === 'formaPadraoId'))

  const semRestricao = await resolverFormas({ formasPermitidas: [], formaPadraoId: 6 }, db)
  ok('sem restrição, padrão pode ser qualquer forma ativa', semRestricao.erros.length === 0)

  chamadas = 0
  const nada = await resolverFormas({ formasPermitidas: [] }, db)
  ok('condição sem restrição de forma é válida', nada.erros.length === 0 && chamadas === 0)
}

sec('3 — runtime da cobrança: sugere a padrão, restringe às permitidas')
{
  ok('sem restrição, qualquer forma passa', formaPermitidaNaCondicao([], 6) && formaPermitidaNaCondicao(null, 6))
  ok('forma permitida passa', formaPermitidaNaCondicao([1, 2, 6], 6))
  ok('forma não permitida não passa', !formaPermitidaNaCondicao([1, 2], 6))

  const base = { aplicaComo: 'RECEBER' as const, valorBase: 1200, moeda: 'BRL', dataBase: new Date('2026-03-10') }

  // troca por outra forma permitida
  const permitida = calcularCobranca({ ...base, forma: formaView({ id: 1, name: 'PIX', permiteParcelas: false, maxParcelas: null }), condicao: condView({ formasPermitidasIds: [1, 2, 6], formaPadraoId: 1 }), nParcelas: 1 })
  ok('troca por outra forma permitida é aceita', permitida.ok)

  // forma fora das permitidas
  const negada = calcularCobranca({ ...base, forma: formaView({ id: 3, name: 'Dinheiro', permiteParcelas: false, maxParcelas: null }), condicao: condView({ formasPermitidasIds: [1, 2], formaPadraoId: 1 }), nParcelas: 1 })
  ok('forma não permitida é rejeitada', !negada.ok && negada.erros.some((e) => e.codigo === 'FORMA_NAO_PERMITIDA'))

  // permitida MAS incompatível com o parcelamento (limite da própria Forma)
  const incompativel = calcularCobranca({ ...base, forma: formaView({ id: 6, maxParcelas: 6 }), condicao: condView({ formasPermitidasIds: [6], formaPadraoId: 6, parcelasMax: 12 }), nParcelas: 12 })
  ok('permitida mas incompatível com 12x é rejeitada', !incompativel.ok && incompativel.erros.some((e) => e.codigo === 'FORMA_MAX_PARCELAS'))
  ok('a condição não torna válida uma forma incompatível', !incompativel.ok)

  // sem parcelamento: PIX em 3x continua barrado mesmo permitido
  const semParcelamento = calcularCobranca({ ...base, forma: formaView({ id: 1, name: 'PIX', permiteParcelas: false, maxParcelas: null }), condicao: condView({ formasPermitidasIds: [1] }), nParcelas: 3 })
  ok('forma sem parcelamento segue barrada', !semParcelamento.ok && semParcelamento.erros.some((e) => e.codigo === 'FORMA_SEM_PARCELAMENTO'))

  ok('cobrança confirmada não é recalculada', !podeRecalcular({ status: 'ABERTA', temPagamento: true }) && !podeRecalcular({ status: 'CONFIRMADA' }))
}

sec('4 — interface: dois campos, chips, padrão restrita às permitidas')
{
  const tabRaw = readFileSync(join(RAIZ, 'src/components/gerenciamentoComponents/CondicoesPagamentoTab.tsx'), 'utf8')
  const tab = tabRaw.split('\n').filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*') && !l.trim().startsWith('/*')).join('\n')

  ok('bloco "Compatibilidade com formas de pagamento"', tab.includes('Compatibilidade com formas de pagamento'))
  ok('Formas permitidas é multisseleção', /Campo label="Formas permitidas"[\s\S]{0,400}<MultiSelect/.test(tab))
  ok('Forma padrão é select único opcional', /Campo label="Forma padrão \(opcional\)"[\s\S]{0,300}<Select/.test(tab))
  ok('texto de apoio das permitidas', tab.includes('Selecione todas as formas que poderão ser usadas com esta condição.'))
  ok('texto de apoio da padrão', tab.includes('Será pré-selecionada na cobrança, mas poderá ser alterada por outra forma permitida.'))
  ok('vazio = sem restrição', tab.includes('qualquer forma ativa compatível'))
  ok('opções da padrão limitadas às permitidas', tab.includes('f.formasPermitidas.includes(x.id)'))
  ok('remover a padrão das permitidas limpa o campo', tab.includes("set('formaPadraoId', null)"))
  ok('não existe mais campo único de forma na Identificação', !/Campo label="Forma sugerida"/.test(tab))
  ok('edição hidrata a padrão do registro', tab.includes('c.formaPadraoId ?? c.formaSugeridaId'))
  ok('edição preserva os vínculos das permitidas', tab.includes('formasPermitidas: (c.formasPermitidas || [])'))
  ok('código automático continua imutável', tab.includes('codigo: _codigo'))

  const cobranca = readFileSync(join(RAIZ, 'src/components/financeiro/ReceitaCobrancaModal.tsx'), 'utf8')
  ok('cobrança lista só as formas permitidas', cobranca.includes('formasDisponiveis') && cobranca.includes('permitidas.includes(x.id)'))
  ok('cobrança pré-seleciona a forma padrão', cobranca.includes('condicao.formaPadraoId'))
  ok('aviso discreto quando a forma deixa de ser permitida', cobranca.includes('avisoForma'))
}

sec('5 — backend, compatibilidade e migração do dado legado')
{
  const route = readFileSync(join(RAIZ, 'src/app/api/gerenciamento/condicoes-pagamento/route.ts'), 'utf8')
  const put = readFileSync(join(RAIZ, 'src/app/api/gerenciamento/condicoes-pagamento/[id]/route.ts'), 'utf8')
  const campos = readFileSync(join(RAIZ, 'src/app/api/gerenciamento/condicoes-pagamento/campos.ts'), 'utf8')

  ok('POST valida formas antes de gravar', route.includes('resolverFormas') && route.includes('formas.erros.length'))
  ok('PUT valida formas antes de gravar', put.includes('resolverFormas'))
  ok('PUT limpa padrão que saiu das permitidas', put.includes('padraoValido') && put.includes('padraoFinal = null'))
  ok('PUT parcial não apaga vínculos não declarados', put.includes('presentesFormas.permitidas ? formas.selecao.permitidas : null'))
  ok('retorno detalhado traz nome/código/ativo da forma', route.includes('INCLUDE_FORMAS') && put.includes('INCLUDE_FORMAS'))
  const lib = readFileSync(join(RAIZ, 'lib/financeiro/condicao-formas.ts'), 'utf8')
  ok('INCLUDE_FORMAS devolve id, code, name e ativo', /forma: \{ select: \{ id: true, code: true, name: true, ativo: true/.test(lib))
  ok('padrão aceita o nome novo da API sem quebrar o legado', campos.includes('b.formaPadraoId ?? b.formaPagamentoPadraoId ?? b.formaSugeridaId'))
  ok('código nunca é regenerado na edição', put.includes('codigo: atual.codigo'))

  const cfg = readFileSync(join(RAIZ, 'lib/financeiro/financial-configuration-service.ts'), 'utf8')
  ok('configuração da cobrança expõe formaPadraoId', cfg.includes('formaPadraoId: c.formaSugeridaId'))
  const runtime = readFileSync(join(RAIZ, 'lib/financeiro/charge-runtime.ts'), 'utf8')
  ok('runtime carrega permitidas e padrão', runtime.includes('formasPermitidasIds') && runtime.includes('formaPadraoId'))

  const sql = readFileSync(join(RAIZ, 'prisma/migrations/20260803000000_taxa_aplicabilidade_relacional/migration.sql'), 'utf8')
  ok('migração da forma legada existe', sql.includes('INSERT INTO "CondicaoPagamentoForma"') && sql.includes('formaSugeridaId'))
  ok('migração é idempotente', sql.includes('ON CONFLICT ("condicaoId", "formaId") DO NOTHING'))
  ok('dado legado NÃO é apagado', !/UPDATE "CondicaoPagamento"[\s\S]*formaSugeridaId/.test(sql) && !/DROP COLUMN/i.test(sql))
  ok('só migra forma que existe no cadastro', sql.includes('JOIN "FormaPagamentoCadastro"'))

  const schema = readFileSync(join(RAIZ, 'prisma/schema.prisma'), 'utf8')
  ok('N:N das formas permitidas preservado', schema.includes('model CondicaoPagamentoForma {') && schema.includes('@@unique([condicaoId, formaId])'))
  ok('coluna da forma padrão preservada', schema.includes('formaSugeridaId Int?'))
  ok('migration existe no disco', existsSync(join(RAIZ, 'prisma/migrations/20260803000000_taxa_aplicabilidade_relacional/migration.sql')))
}

console.log(`\n${'='.repeat(60)}`)
console.log(`Condição — Formas permitidas + Forma padrão: ${passou} passaram, ${falhou} falharam`)
console.log('='.repeat(60))
if (falhou > 0) process.exit(1)
}

main().catch((e) => { console.error(e); process.exit(1) })
