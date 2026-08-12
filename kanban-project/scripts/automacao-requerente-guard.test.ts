/**
 * automacao-requerente-guard — INFRAESTRUTURA de automação financeira por requerente.
 * Rodar: npx tsx scripts/automacao-requerente-guard.test.ts
 *
 * Cobre a LÓGICA PURA (transição, ordenação determinística, classificação, valor via
 * motor, chave per-requerente) + GUARDAS ESTRUTURAIS (resolver oficial, sem findFirst,
 * dispatcher conectado, rotas emitem só na transição, itemização/vínculos).
 * Cenários que exigem banco (concorrência real, retry do outbox end-to-end) rodam na
 * integração/produção; aqui garantimos as invariantes verificáveis sem banco.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ehRequerente, houveTransicaoParaRequerente } from '../lib/genealogia/requerente-flag'
import { ordenarRequerentes, classificarRequerente, valorDoRequerente, chaveIdempotenciaRequerente } from '../lib/financeiro/classificacao-requerente'

const RAIZ = join(__dirname, '..')
let passed = 0, failed = 0
const falhas: string[] = []
const ok = (n: string, c: boolean) => { if (c) { passed++; console.log(`  ✅ ${n}`) } else { failed++; falhas.push(n); console.log(`  ❌ ${n}`) } }
const src = (p: string) => readFileSync(join(RAIZ, p), 'utf8')

console.log('\nFonte única do flag requerente (vocabulário unificado)')
{
  ok('"sim" é requerente', ehRequerente('sim'))
  ok('"maior" é requerente', ehRequerente('maior'))
  ok('"menor" é requerente', ehRequerente('menor'))
  ok('case-insensitive', ehRequerente('SIM'))
  ok('"nao" não é', !ehRequerente('nao'))
  ok('vazio/null não é', !ehRequerente('') && !ehRequerente(null) && !ehRequerente(undefined))
  ok('desconhecido não é', !ehRequerente('talvez'))
}

console.log('\nTransição publica evento SÓ em não→requerente')
{
  ok('nao → sim = transição', houveTransicaoParaRequerente('nao', 'sim'))
  ok('null → maior = transição', houveTransicaoParaRequerente(null, 'maior'))
  ok('sim → sim NÃO é transição (re-save)', !houveTransicaoParaRequerente('sim', 'sim'))
  ok('maior → menor NÃO é transição (ambos requerentes)', !houveTransicaoParaRequerente('maior', 'menor'))
  ok('nao → nao NÃO é transição (edição de dados)', !houveTransicaoParaRequerente('nao', 'nao'))
  ok('sim → nao NÃO é transição (saída, não entrada)', !houveTransicaoParaRequerente('sim', 'nao'))
}

console.log('\nOrdenação determinística e persistente (nunca visual/alfabética)')
{
  // fora de ordem de entrada; ordena por createdAt asc, depois id asc
  const lista = [
    { pessoaId: 30, createdAt: '2026-03-01T10:00:00Z' },
    { pessoaId: 10, createdAt: '2026-01-01T10:00:00Z' },
    { pessoaId: 20, createdAt: '2026-02-01T10:00:00Z' },
  ]
  const ord = ordenarRequerentes(lista)
  ok('ordena por createdAt (10,20,30)', JSON.stringify(ord) === JSON.stringify([10, 20, 30]))
  // empate de createdAt → desempata por id estável
  const empate = ordenarRequerentes([{ pessoaId: 9, createdAt: '2026-01-01' }, { pessoaId: 3, createdAt: '2026-01-01' }])
  ok('empate de data desempata por id', JSON.stringify(empate) === JSON.stringify([3, 9]))
  // reprodutível: mesma entrada embaralhada → mesmo resultado
  const a = ordenarRequerentes([...lista].reverse())
  ok('reprodutível independente da ordem de entrada', JSON.stringify(a) === JSON.stringify([10, 20, 30]))
}

console.log('\nClassificação primeiro/adicional')
{
  const ord = [10, 20, 30]
  ok('primeiro = posição 1', JSON.stringify(classificarRequerente(10, ord)) === JSON.stringify({ posicao: 1, classificacao: 'primeiro' }))
  ok('segundo = adicional', classificarRequerente(20, ord)?.classificacao === 'adicional' && classificarRequerente(20, ord)?.posicao === 2)
  ok('terceiro = adicional', classificarRequerente(30, ord)?.classificacao === 'adicional' && classificarRequerente(30, ord)?.posicao === 3)
  ok('fora da lista = null', classificarRequerente(99, ord) === null)
}

console.log('\nValor individual pelo MOTOR (marginal): 1º=base, adicional=adicional')
{
  const linha = { modoCalculo: 'first_additional', valor: 2800, valorBase: 2800, valorAdicional: 1800 }
  ok('posição 1 → valorBase (2800)', valorDoRequerente(1, linha).total === 2800)
  ok('posição 2 → valorAdicional (1800)', valorDoRequerente(2, linha).total === 1800)
  ok('posição 3 → valorAdicional (1800)', valorDoRequerente(3, linha).total === 1800)
  // por unidade simples (sem base/adic): cada requerente = valor unitário
  const unit = { modoCalculo: 'per_unit', valor: 321, valorBase: null, valorAdicional: null }
  ok('por unidade: cada requerente = valor', valorDoRequerente(1, unit).total === 321 && valorDoRequerente(2, unit).total === 321)
}

console.log('\nChave de idempotência POR REQUERENTE (processo+config+regra+requerente)')
{
  const k1 = chaveIdempotenciaRequerente({ processoId: 5, configId: 7, ruleId: 9, pessoaId: 100 })
  const k2 = chaveIdempotenciaRequerente({ processoId: 5, configId: 7, ruleId: 9, pessoaId: 200 })
  ok('requerentes diferentes → chaves diferentes', k1 !== k2)
  ok('mesmo requerente → chave estável', k1 === chaveIdempotenciaRequerente({ processoId: 5, configId: 7, ruleId: 9, pessoaId: 100 }))
  ok('inclui processo/config/regra/requerente', k1.includes('5') && k1.includes('cfg:7') && k1.includes('rule:9') && k1.includes('req:100'))
}

console.log('\nGuardas estruturais (arquitetura)')
{
  const exec = src('src/lib/motor/executor.ts')
  ok('executor tem processarRequerenteAdicionado', exec.includes('export async function processarRequerenteAdicionado'))
  ok('usa RESOLVER OFICIAL (resolverPrecoPorConfigDB)', /processarRequerenteAdicionado[\s\S]*resolverPrecoPorConfigDB/.test(exec))
  ok('NÃO usa findFirst de tabelaValor no motor por requerente', !/processarRequerenteAdicionado[\s\S]*tabelaValor\.findFirst/.test(exec))
  ok('calcula pelo motor (valorDoRequerente)', exec.includes('valorDoRequerente('))
  ok('itemiza: popula ReceitaRequerente', /requerentes:\s*\{\s*create/.test(exec))
  ok('vincula personId do requerente', /personId:\s*evt\.pessoaId/.test(exec))
  ok('idempotência per-requerente (MotorArtefato.automaticKey)', exec.includes('automaticKey: akey') && exec.includes('chaveIdempotenciaRequerente'))
  ok('trata conflito de tabelas (aborta + pendência)', /preco\.conflito[\s\S]*CONFLITO_PRECO/.test(exec))
  ok('trata ausência de preço (pendência, sem zero)', /!preco\.ok[\s\S]*registrarPendencia/.test(exec))
  ok('P2002 → idempotente (não duplica)', /P2002[\s\S]*inalterado/.test(exec))

  // GUARD anti-dupla-cobrança no honorário AGREGADO legado (aditivo, genérico)
  ok('legado tem guard anti-dupla-cobrança (person_added)', /aplicarHonorariosPorRequerente[\s\S]*phaseAutomationRule\.findFirst[\s\S]*trigger: 'person_added'[\s\S]*aplicavel: false/.test(exec))
  ok('guard seleciona por tipoProcessoId (metadados oficiais)', /superseder[\s\S]*tipoProcessoId: proc\.tipoProcessoMotorId/.test(exec))
  ok('guard NÃO remove histórico (só deixa de criar)', !/superseder[\s\S]{0,400}\.delete\(/.test(exec))

  const disp = src('src/services/outbox-dispatcher.ts')
  ok('dispatcher processa requerente.adicionado', disp.includes('"requerente.adicionado"') && disp.includes('processarRequerenteAdicionado'))
  // A asserção antiga exigia `tipos = [` literal e o código é
  // `const tipos = opts?.tipos ?? [` — o guard acusava um defeito que não existia.
  // Guard que mente sobre código correto é pior que guard nenhum: ensina a ignorar
  // a suíte. O que importa é o tipo estar na lista DEFAULT, não a sintaxe dela.
  //
  // 06/08/2026 — o guard voltou a mentir pelo MESMO motivo: a default deixou de
  // ser um literal e passou a ser `[...TIPOS_DRENADOS]`, então recortar até o
  // primeiro `]` devolvia o spread, nunca os tipos. A asserção agora verifica os
  // dois fatos que de fato importam, cada um onde ele mora: o tipo está declarado
  // em TIPOS_DRENADOS, e TIPOS_DRENADOS é a lista usada por padrão.
  const declarados = disp.slice(disp.indexOf('export const TIPOS_DRENADOS'), disp.indexOf('as const', disp.indexOf('export const TIPOS_DRENADOS')))
  ok('requerente.adicionado declarado em TIPOS_DRENADOS', declarados.includes('"requerente.adicionado"'))
  ok('TIPOS_DRENADOS é a lista drenada por padrão', /opts\?\.tipos \?\? \[\.\.\.TIPOS_DRENADOS\]/.test(disp))

  const emit = src('src/services/genealogia/emitir-evento-requerente.ts')
  ok('evento publicado via DomainOutbox (não HTTP direto)', emit.includes('domainOutbox.create') && emit.includes("tipo: TIPO_EVENTO_REQUERENTE"))
  ok('payload com campos do domínio', /processoId[\s\S]*pessoaId[\s\S]*servicoId[\s\S]*faseId[\s\S]*nacionalidade[\s\S]*actorId/.test(emit))
  ok('dedup por chaveIdempotencia', emit.includes('chaveIdempotencia: chave'))

  // A EMISSÃO SAIU DAS ROTAS (09/08/2026). Elas eram donas de um efeito de negócio,
  // e por isso entrar pela tela e entrar pelo serviço davam estados finais diferentes.
  // O que se exige aqui agora é o oposto do que se exigia antes: que a rota NÃO emita
  // e delegue ao serviço canônico. Ver `test:guard-porta-requerente`.
  const put = src('src/app/api/pessoas/[id]/route.ts')
  ok('PUT age só na transição', put.includes('houveTransicaoParaRequerente') && /houveTransicao[\s\S]*registrarTransicaoParaRequerenteTx/.test(put))
  ok('PUT registra na MESMA transação da atualização', /\$transaction[\s\S]*pessoa\.update[\s\S]*registrarTransicaoParaRequerenteTx/.test(put))
  ok('PUT não conhece a DomainOutbox', !put.includes('enfileirarEventoRequerente') && !put.includes('processarOutbox'))
  const post = src('src/app/api/pessoas/route.ts')
  ok('POST não emite — a Pessoa nunca nasce requerente por lá', !post.includes('emitirEDrenar') && !post.includes('enfileirarEventoRequerente'))

  const vinc = src('lib/genealogia/vincular-requerente.ts')
  ok('o serviço canônico é o dono da emissão', /enfileirarEventoRequerente\(tx,/.test(vinc))
}

console.log(`\n${'='.repeat(60)}`)
console.log(`Automação por requerente: ${passed} passaram, ${failed} falharam`)
if (falhas.length) console.log('Falhas:\n  - ' + falhas.join('\n  - '))
console.log('='.repeat(60))
if (failed > 0) process.exit(1)
