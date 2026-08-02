/**
 * GUARDA — base oficial de Órgãos e Organizações.
 * Rodar: npm run test:orgaos
 *
 * O que este teste trava (tudo puro, sem banco):
 *  1. a base declarada é internamente consistente (sem duplicidade, sem
 *     categoria inexistente, toda organização classificada);
 *  2. cobertura mínima do negócio: os países e os tipos de entidade que a
 *     operação de cidadania usa todo dia;
 *  3. nomenclatura OFICIAL — nada de rótulo genérico ou placeholder;
 *  4. nenhum dado de contato fabricado (telefone/e-mail/CEP não são semeados);
 *  5. o código público é ORG1, ORG2… gerado pelo serviço central e imutável;
 *  6. o cadastro nasce ATIVO e sem preço/contrato/vínculo de processo.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CATEGORIAS, ORGANIZACOES, validarBase } from '../prisma/dados-orgaos-organizacoes'
import { formatarCodigo, escopoDe } from '../lib/codigos/code-patterns'
import { CODE_REGISTRY } from '../lib/codigos/entity-registry'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const ler = (p: string) => readFileSync(join(ROOT, p), 'utf8')

let passed = 0, failed = 0
const falhas: string[] = []
const ok = (cond: boolean, nome: string) => {
  if (cond) { passed++; console.log(`  ✅ ${nome}`) }
  else { failed++; falhas.push(nome); console.log(`  ❌ ${nome}`) }
}

// ═══════════ 1) CONSISTÊNCIA DA BASE ═══════════
console.log('\n1) Base declarada é consistente')
const problemas = validarBase()
ok(problemas.length === 0, `sem duplicidade / categoria órfã / registro sem classificação (${problemas.join('; ') || 'ok'})`)
ok(CATEGORIAS.length >= 39, `pelo menos as 39 categorias pedidas (${CATEGORIAS.length})`)
ok(ORGANIZACOES.length >= 100, `base extensa de organizações (${ORGANIZACOES.length})`)
ok(new Set(CATEGORIAS.map((c) => c.ordem)).size === CATEGORIAS.length, 'cada categoria tem ordem própria (listagem estável)')

// ═══════════ 2) COBERTURA DO NEGÓCIO ═══════════
console.log('\n2) Cobertura do negócio de cidadania')
const paises = new Set(ORGANIZACOES.map((o) => o.country))
for (const p of ['Espanha', 'Portugal', 'Itália', 'Brasil', 'Paraguai', 'Argentina', 'Alemanha', 'França', 'Estados Unidos']) {
  ok(paises.has(p), `país coberto: ${p}`)
}
const porCategoria = (code: string) => ORGANIZACOES.filter((o) => o.categorias.includes(code))
for (const [code, minimo] of [
  ['consulados', 10], ['embaixadas', 3], ['registros-civis', 8], ['tribunais', 8],
  ['ministerios', 8], ['prefeituras', 10], ['arquivos-nacionais', 4], ['arquivos-historicos', 8],
  ['imigracao', 3], ['transportadoras', 5], ['apostilamento', 3], ['justica', 5],
] as const) {
  ok(porCategoria(code).length >= minimo, `categoria "${code}" com base real (${porCategoria(code).length} ≥ ${minimo})`)
}
const consuladosNoBrasil = porCategoria('consulados').filter((o) => o.country === 'Brasil')
ok(consuladosNoBrasil.length >= 10, `consulados estrangeiros no Brasil — onde o protocolo acontece (${consuladosNoBrasil.length})`)

// ═══════════ 3) NOMENCLATURA OFICIAL ═══════════
console.log('\n3) Nomenclatura oficial, sem placeholder')
const suspeitos = /exemplo|teste|test|lorem|fictic|dummy|placeholder|xxx|aaa|n\/a|sample/i
ok(!ORGANIZACOES.some((o) => suspeitos.test(o.name)), 'nenhum nome de organização com marca de dado fabricado')
ok(!CATEGORIAS.some((c) => suspeitos.test(c.nome)), 'nenhuma categoria com marca de dado fabricado')
ok(ORGANIZACOES.every((o) => o.name.trim().length >= 6), 'todo nome oficial é completo (nada de sigla solta)')
// nome oficial na língua do país — amostras verificáveis
ok(ORGANIZACOES.some((o) => o.name === 'Instituto dos Registos e do Notariado'), 'Portugal: IRN pelo nome oficial')
ok(ORGANIZACOES.some((o) => o.name === "Ministero dell'Interno"), 'Itália: Ministero dell\'Interno em italiano')
ok(ORGANIZACOES.some((o) => o.name === 'Registro Civil Central'), 'Espanha: Registro Civil Central')
ok(ORGANIZACOES.some((o) => o.name === 'Conselho Nacional de Justiça'), 'Brasil: CNJ pelo nome oficial')
ok(ORGANIZACOES.some((o) => o.name === 'U.S. Citizenship and Immigration Services'), 'EUA: USCIS pelo nome oficial')
ok(ORGANIZACOES.some((o) => o.name === "Service Central d'État Civil"), 'França: SCEC pelo nome oficial')
ok(ORGANIZACOES.some((o) => o.name === 'Bundesverwaltungsamt'), 'Alemanha: BVA pelo nome oficial')

// ═══════════ 4) NADA DE CONTATO FABRICADO ═══════════
console.log('\n4) Contato não é inventado')
const dados = ler('prisma/dados-orgaos-organizacoes.ts')
ok(!/telefone:/.test(dados), 'a base não semeia telefone (o escritório preenche o que usa)')
ok(!/\bemail:/.test(dados), 'a base não semeia e-mail')
ok(!/\bcep:/.test(dados), 'a base não semeia CEP')
ok(!/endereco:/.test(dados), 'a base não semeia endereço')
ok(!/responsavel:/.test(dados), 'a base não semeia responsável')
const sites = ORGANIZACOES.map((o) => o.site).filter((s): s is string => !!s)
ok(sites.every((s) => s.startsWith('https://')), `todo site declarado é https (${sites.length} sites)`)

// ═══════════ 5) CÓDIGO PÚBLICO ═══════════
console.log('\n5) Código automático ORG1, ORG2, ORG3…')
ok(formatarCodigo('ORGANIZATION', 1) === 'ORG1', 'primeiro código = ORG1')
ok(formatarCodigo('ORGANIZATION', 2) === 'ORG2', 'segundo código = ORG2')
ok(formatarCodigo('ORGANIZATION', 130) === 'ORG130', 'sem zeros à esquerda')
ok(escopoDe('ORGANIZATION') === 'ORG', 'sequência própria no escopo ORG')
ok(
  CODE_REGISTRY.OrgaoProtocolo?.entidade === 'ORGANIZATION' && CODE_REGISTRY.OrgaoProtocolo?.campo === 'publicCode',
  'OrgaoProtocolo registrado no CODE_REGISTRY (geração automática no create)',
)
const rotaOrg = ler('src/app/api/gerenciamento/orgaos-protocolo/route.ts')
const rotaOrgId = ler('src/app/api/gerenciamento/orgaos-protocolo/[id]/route.ts')
ok(!/publicCode:\s*(b\.|String)/.test(rotaOrg), 'POST não aceita código público do cliente')
// o PUT só LÊ publicCode (select e mensagem de colisão) — nunca o grava
const dataDoUpdate = rotaOrgId.split('orgaoProtocolo.update(')[1]?.split('})')[0] ?? ''
ok(!/publicCode/.test(dataDoUpdate), 'PUT nunca reescreve o código público')

// ═══════════ 6) ANTI-DUPLICIDADE E ESTADO INICIAL ═══════════
console.log('\n6) Sem duplicidade, tudo ativo, só cadastro mestre')
ok(/@@unique\(\[name, country\]\)/.test(ler('prisma/schema.prisma')), 'banco garante nome oficial + país únicos')
ok(/Já existe uma organização com este nome neste país/.test(rotaOrg), 'POST recusa duplicata com mensagem clara')
ok(/Já existe uma organização com este nome neste país/.test(rotaOrgId), 'PUT recusa colisão ao renomear')
const seed = ler('prisma/seed-orgaos-organizacoes.ts')
ok(/ativo: true/.test(seed), 'todo registro nasce ATIVO')
const seedSemComentario = seed.replace(/^\s*\/\/[^\n]*$/gm, '')
ok(!/preco|contrato|processoId|tabelaValor/i.test(seedSemComentario), 'o seed não cria preço, contrato nem vínculo com processo')
ok(/findFirst\(\{\s*where: \{ name: o\.name, country: o\.country \}/.test(seed), 'idempotência pela chave natural (nome + país)')
ok(/atualValor === null \|\| atualValor === undefined \|\| atualValor === ''/.test(seed), 'seed só COMPLETA campo vazio — nunca sobrescreve edição manual')
ok(/protocolos > 0/.test(rotaOrgId), 'organização com protocolo no histórico é inativada, não apagada')

console.log(`\n${passed} passaram, ${failed} falharam`)
if (failed > 0) { console.log('FALHAS: ' + falhas.join('; ')); process.exit(1) }
console.log('Base oficial de Órgãos e Organizações: validada ✅')
