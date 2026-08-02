// scripts/condicao-aplicabilidade.test.ts
// ============================================================================
// GUARDA — Etapa "Aplicabilidade e vigência" da Condição de Pagamento.
//
// Regra da entrega: nada é digitado. Moeda, País, Modalidade e Serviço só podem
// ser SELECIONADOS entre registros do cadastro real; a seleção é persistida por
// RELACIONAMENTO (não como string com vírgulas); vazio = sem restrição.
// Perfil e Canal saíram da interface e do payload (colunas preservadas).
//
// (1) seleção pura: múltiplos, sem texto livre, sem duplicidade, remoção
// (2) validação contra o cadastro: id inexistente e registro inativo
// (3) vigência e faixa de valor
// (4) estrutura: UI só selecionável, blocos, Perfil/Canal ausentes, código auto
// (5) compatibilidade: projeção legada + migration aditiva
// ============================================================================
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import {
  idsSelecionados, selecaoDoBody, eixosPresentes, validarAplicabilidade, vinculosParaCriar,
  resolverAplicabilidade,
} from '../lib/financeiro/condicao-aplicabilidade'
import { validar } from '../src/app/api/gerenciamento/condicoes-pagamento/campos'

const RAIZ = join(__dirname, '..')
let passou = 0, falhou = 0
const ok = (n: string, c: boolean) => { if (c) { passou++; console.log(`  ✓ ${n}`) } else { falhou++; console.log(`  ✗ ${n}`) } }
const sec = (t: string) => console.log(`\n${t}`)

// ── stub do Prisma: 4 queries (uma por cadastro), nunca N+1 ────────────────
let chamadas = 0
const CADASTRO = {
  moedas: [{ id: 1, code: 'BRL', ativo: true }, { id: 2, code: 'EUR', ativo: true }, { id: 3, code: 'JPY', ativo: false }],
  paises: [{ id: 10, countryKey: 'italia', ativo: true }, { id: 11, countryKey: 'espanha', ativo: true }, { id: 12, countryKey: 'polonia', ativo: false }],
  modalidades: [{ id: 20, modalityKey: 'materno', ativo: true }, { id: 21, modalityKey: 'judicial', ativo: true }],
  servicos: [{ id: 30, ativo: true }, { id: 31, ativo: true }, { id: 32, ativo: false }],
}
const seletor = <T extends { id: number }>(fonte: T[]) => ({
  findMany: async ({ where }: { where: { id: { in: number[] } } }) => {
    chamadas++
    return fonte.filter((r) => where.id.in.includes(r.id))
  },
})
const db = {
  moedaCadastro: seletor(CADASTRO.moedas),
  catalogoPais: seletor(CADASTRO.paises),
  modalidadePais: seletor(CADASTRO.modalidades),
  servicoProduto: seletor(CADASTRO.servicos),
} as never

async function main() {
sec('1 — seleção: múltipla, só id, sem duplicidade')
{
  ok('seleciona múltiplas moedas', JSON.stringify(idsSelecionados([1, 2])) === '[1,2]')
  ok('seleciona múltiplos países', JSON.stringify(idsSelecionados([10, 11])) === '[10,11]')
  ok('seleciona múltiplos serviços', JSON.stringify(idsSelecionados([30, 31])) === '[30,31]')
  ok('não duplica valores', JSON.stringify(idsSelecionados([1, 1, 2, 2, 1])) === '[1,2]')

  // texto livre é o que a etapa antiga aceitava — agora é ignorado por construção
  ok('recusa string com vírgulas (texto livre)', JSON.stringify(idsSelecionados('BRL, EUR' as unknown)) === '[]')
  ok('recusa item de texto não numérico', JSON.stringify(idsSelecionados(['BRL', 'EUR'])) === '[]')
  ok('recusa id não inteiro/negativo', JSON.stringify(idsSelecionados([1.5, -2, 0, 3])) === '[3]')

  // "remover chip" = a lista volta sem o id (o componente só devolve a lista nova)
  const depoisDeRemover = [1, 2].filter((x) => x !== 1)
  ok('remover chip tira só aquele id', JSON.stringify(idsSelecionados(depoisDeRemover)) === '[2]')

  const s = selecaoDoBody({ moedasIds: [1, 2], paisesIds: [10], modalidadesIds: [20], servicosIds: [30, 31] })
  ok('selecaoDoBody lê os 4 eixos por id', s.moedas.length === 2 && s.paises.length === 1 && s.modalidades.length === 1 && s.servicos.length === 2)
  ok('array de texto legado não é entrada de escrita', selecaoDoBody({ moedasPermitidas: ['BRL'], paises: ['italia'] }).moedas.length === 0)

  const p = eixosPresentes({ moedasIds: [] })
  ok('eixo presente e vazio ≠ eixo ausente', p.moedas === true && p.paises === false)

  const v = vinculosParaCriar({ moedas: [1], paises: [], modalidades: [], servicos: [30] })
  ok('vazio = sem restrição (não cria vínculo)', v.paisesPermitidos === undefined && v.modalidadesPermitidas === undefined)
  ok('selecionado vira vínculo real', JSON.stringify(v.moedasVinculadas) === '{"create":[{"moedaId":1}]}' && v.servicosPermitidos !== undefined)
}

sec('2 — backend valida contra o cadastro (nunca confia no frontend)')
{
  chamadas = 0
  const r = await resolverAplicabilidade({ moedasIds: [1, 2], paisesIds: [10], modalidadesIds: [20], servicosIds: [30] }, db)
  ok('seleção válida passa sem erro', r.erros.length === 0)
  ok('sem N+1: 1 query por cadastro', chamadas === 4)
  ok('projeta moedas por code', JSON.stringify(r.projecao.moedasPermitidas) === '["BRL","EUR"]')
  ok('projeta países por countryKey', JSON.stringify(r.projecao.paises) === '["italia"]')
  ok('projeta modalidades por modalityKey', JSON.stringify(r.projecao.modalidades) === '["materno"]')
  ok('projeta serviços por id', JSON.stringify(r.projecao.servicos) === '[30]')

  const inexistente = await resolverAplicabilidade({ moedasIds: [999] }, db)
  ok('ID inexistente é rejeitado', inexistente.erros.some((e) => e.campo === 'moedas' && e.mensagem.includes('inexistente')))

  const paisInexistente = await resolverAplicabilidade({ paisesIds: [777] }, db)
  ok('país inexistente é rejeitado', paisInexistente.erros.length === 1)

  const inativa = await resolverAplicabilidade({ moedasIds: [3] }, db)
  ok('moeda inativa é rejeitada', inativa.erros.some((e) => e.mensagem.includes('inativo')))

  const servicoInativo = await resolverAplicabilidade({ servicosIds: [32] }, db)
  ok('serviço inativo é rejeitado', servicoInativo.erros.some((e) => e.mensagem.includes('inativo')))

  chamadas = 0
  const vazio = await resolverAplicabilidade({ moedasIds: [], paisesIds: [], modalidadesIds: [], servicosIds: [] }, db)
  ok('vazio = sem restrição (sem erro)', vazio.erros.length === 0)
  ok('vazio não consulta o banco', chamadas === 0)
  ok('vazio projeta arrays vazios', vazio.projecao.moedasPermitidas.length === 0 && vazio.projecao.paises.length === 0)
}

sec('3 — vigência e faixa de valor')
{
  ok('sem datas = válida (imediata + indeterminada)', validar({ name: 'C' }).length === 0)
  ok('só início = vigência indeterminada', validar({ name: 'C', vigenciaInicio: '2026-01-01' }).length === 0)
  ok('só fim = válida imediatamente', validar({ name: 'C', vigenciaFim: '2026-12-31' }).length === 0)
  const invertida = validar({ name: 'C', vigenciaInicio: '2026-06-01', vigenciaFim: '2026-01-01' })
  ok('data final anterior à inicial é rejeitada', invertida.some((e) => e.campo === 'vigenciaFim'))

  ok('faixa vazia é válida', validar({ name: 'C' }).every((e) => !e.campo.startsWith('valor')))
  ok('mínimo negativo é rejeitado', validar({ name: 'C', valorMinimo: -1 }).some((e) => e.campo === 'valorMinimo'))
  const faixa = validar({ name: 'C', valorMinimo: 500, valorMaximo: 100 })
  ok('máximo menor que o mínimo é rejeitado', faixa.some((e) => e.campo === 'valorMaximo'))
  ok('máximo ≥ mínimo é aceito', validar({ name: 'C', valorMinimo: 100, valorMaximo: 500 }).length === 0)
  ok('regra pura espelhada em validarAplicabilidade', validarAplicabilidade({ valorMinimo: 500, valorMaximo: 100 }).length === 1)
}

sec('4 — interface: apenas selecionável, blocos, sem Perfil/Canal')
{
  const tabRaw = readFileSync(join(RAIZ, 'src/components/gerenciamentoComponents/CondicoesPagamentoTab.tsx'), 'utf8')
  const tab = tabRaw.split('\n').filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*') && !l.trim().startsWith('/*')).join('\n')

  ok('moedas usam MultiSelect', tab.includes('Moedas permitidas') && tab.includes('MultiSelect'))
  ok('países usam MultiSelect', tab.includes('Países permitidos'))
  ok('serviços usam MultiSelect', tab.includes('Serviços permitidos'))
  ok('modalidades usam MultiSelect', tab.includes('Modalidades permitidas'))

  // impedir digitação livre: nenhum campo "(vírgula)" nem split(',') na etapa
  ok('sem campos "(vírgula)"', !tab.includes('(vírgula)'))
  ok('sem parsing de texto por vírgula', !tab.includes("split(',')"))

  ok('Perfil ausente da interface', !/label="Perfil"/.test(tab))
  ok('Canal ausente da interface', !/label="Canal"/.test(tab))
  ok('Perfil fora do estado do formulário', !/\bperfil:/.test(tab))
  ok('Canal fora do estado do formulário', !/\bcanal:/.test(tab))

  ok('bloco 1 — Direção e vigência', tab.includes('Direção e vigência') && tab.includes('Aplica a') && tab.includes('Válida a partir de') && tab.includes('Válida até'))
  ok('bloco 2 — Restrições financeiras', tab.includes('Restrições financeiras') && tab.includes('Valor mínimo') && tab.includes('Valor máximo'))
  ok('bloco 3 — Restrições operacionais', tab.includes('Restrições operacionais'))

  ok('seleção enviada por ID', tab.includes('moedasIds') && tab.includes('paisesIds') && tab.includes('modalidadesIds') && tab.includes('servicosIds'))
  ok('edição hidrata dos vínculos reais', tab.includes('moedasVinculadas') && tab.includes('paisesPermitidos') && tab.includes('servicosPermitidos'))

  // Código automático
  ok('código não é editável', /Campo label="Código"[\s\S]{0,300}readOnly/.test(tab))
  ok('criação mostra "Gerado automaticamente ao salvar"', tab.includes('Gerado automaticamente ao salvar'))
  ok('código não vai no payload', tab.includes('codigo: _codigo'))

  const ui = readFileSync(join(RAIZ, 'src/components/gerenciamentoComponents/pagamentoUI.tsx'), 'utf8')
  ok('MultiSelect existe no shell', ui.includes('export function MultiSelect'))
  // A busca do MultiSelect é OPT-IN (`busca`) e filtra apenas a lista de opções
  // — nunca cria valor. A Condição não a ativa: aqui nada é digitado.
  ok('MultiSelect só filtra a lista quando busca={true}', ui.includes('busca = false') && ui.includes('if (!busca || !q) return opcoes'))
  ok('Condição não ativa busca em nenhum seletor', !/<MultiSelect[\s\S]{0,400}?\bbusca\b/.test(tabRaw))
  ok('MultiSelect abre lista de opções', ui.includes('role="listbox"') && ui.includes('aria-multiselectable'))
  ok('MultiSelect fecha ao clicar fora', ui.includes("addEventListener('mousedown', fora)") && ui.includes('contains(alvo)'))
  ok('MultiSelect funciona por teclado', ui.includes("'ArrowDown'") && ui.includes("'Escape'") && ui.includes("e.key === 'Enter'"))
  ok('MultiSelect exibe chips removíveis', ui.includes('Remover ${o.label}'))
  ok('MultiSelect não duplica', ui.includes('selecionados.includes(oid)'))
  ok('MultiSelect respeita o tema escuro', ui.includes('bg-zinc-900') && ui.includes('OURO'))
}

sec('5 — backend, compatibilidade e migration aditiva')
{
  const route = readFileSync(join(RAIZ, 'src/app/api/gerenciamento/condicoes-pagamento/route.ts'), 'utf8')
  const put = readFileSync(join(RAIZ, 'src/app/api/gerenciamento/condicoes-pagamento/[id]/route.ts'), 'utf8')
  const campos = readFileSync(join(RAIZ, 'src/app/api/gerenciamento/condicoes-pagamento/campos.ts'), 'utf8')

  ok('GET carrega os cadastros dos multiselects', route.includes('moedaCadastro') && route.includes('catalogoPais') && route.includes('modalidadePais'))
  ok('GET usa relações reais do Prisma', route.includes('INCLUDE_APLICABILIDADE'))
  ok('POST valida ids antes de gravar', route.includes('resolverAplicabilidade') && route.includes('aplic.erros.length'))
  ok('POST grava vínculos reais', route.includes('vinculosParaCriar'))
  ok('PUT valida ids antes de gravar', put.includes('resolverAplicabilidade'))
  ok('PUT regrava só os eixos declarados', put.includes('eixosPresentes') && put.includes('regravarVinculos'))

  ok('código gerado pelo serviço central', route.includes('gerarCodigoPublico') && route.includes("'PAYMENT_TERM'"))
  ok('nova versão herda o código (não regenera)', route.includes('anteriorTinhaCodigo'))
  ok('edição preserva o código existente', put.includes('codigo: atual.codigo') && !put.includes('colunas.codigo'))
  ok('campos.ts não aceita código do body', !campos.includes('codigo: b.codigo'))

  // compatibilidade: os arrays legados continuam gravados como PROJEÇÃO
  ok('POST grava a projeção legada', route.includes('aplic.projecao'))
  ok('PUT grava a projeção legada', put.includes('projecao.moedasPermitidas'))
  const motor = readFileSync(join(RAIZ, 'lib/financeiro/condicao-pagamento.ts'), 'utf8')
  ok('motor de cálculo intacto (lê os arrays)', motor.includes('c.moedasPermitidas') && motor.includes('c.modalidades'))

  const dir = join(RAIZ, 'prisma/migrations-arquivo/20260802000000_condicao_aplicabilidade_relacional/migration.sql')
  ok('migration aditiva existe', existsSync(dir))
  const sql = readFileSync(dir, 'utf8')
  ok('migration não é destrutiva', !/DROP\s+(TABLE|COLUMN)/i.test(sql) && !/DELETE\s+FROM/i.test(sql) && !/TRUNCATE/i.test(sql))
  ok('migration é idempotente', (sql.match(/IF NOT EXISTS/g) || []).length >= 8 && sql.includes('DO NOTHING'))
  ok('backfill só converte o que casa com o cadastro', sql.includes('JOIN "MoedaCadastro"') && sql.includes('JOIN "CatalogoPais"'))
  ok('colunas legadas preservadas', !/ALTER TABLE "CondicaoPagamento" DROP/i.test(sql))

  const schema = readFileSync(join(RAIZ, 'prisma/schema.prisma'), 'utf8')
  ok('4 tabelas de vínculo no schema', ['CondicaoPagamentoMoeda', 'CondicaoPagamentoPais', 'CondicaoPagamentoModalidade', 'CondicaoPagamentoServico'].every((m) => schema.includes(`model ${m} {`)))
  ok('perfil/canal preservados no schema', schema.includes('perfil   String? @db.VarChar(60)') && schema.includes('canal    String? @db.VarChar(60)'))
  ok('Modalidade tem entidade própria (mantida)', schema.includes('model ModalidadePais {'))
}

console.log(`\n${'='.repeat(60)}`)
console.log(`Condição — Aplicabilidade relacional: ${passou} passaram, ${falhou} falharam`)
console.log('='.repeat(60))
if (falhou > 0) process.exit(1)
}

main().catch((e) => { console.error(e); process.exit(1) })
