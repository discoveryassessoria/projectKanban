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
import { CATEGORIAS, BASE_COMPLETA as ORGANIZACOES, COMUNI, FORNECEDORES, funcoesDe, validarBase } from '../prisma/dados-orgaos-organizacoes'
import { chaveDeNome, normalizarIdentificacaoFiscal, similaridade, unirFuncoes } from '../src/services/organizacao-identidade'
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
ok(ORGANIZACOES.length >= 200, `base extensa de organizações (${ORGANIZACOES.length})`)
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
  ['ministerios', 8], ['comuni', 100], ['arquivos-nacionais', 4], ['arquivos-historicos', 8],
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
ok(/Esta organização já existe/.test(rotaOrg), 'POST avisa que a organização já existe (e acrescenta função)')
ok(/Já existe uma organização com este nome neste país/.test(rotaOrgId), 'PUT recusa colisão ao renomear')
const seed = ler('prisma/seed-orgaos-organizacoes.ts')
ok(/ativo: true/.test(seed), 'todo registro nasce ATIVO')
const seedSemComentario = seed.replace(/^\s*\/\/[^\n]*$/gm, '')
ok(!/preco|contrato|processoId|tabelaValor/i.test(seedSemComentario), 'o seed não cria preço, contrato nem vínculo com processo')
ok(/resolverOrganizacao\(prisma, \{/.test(seed), 'idempotência pela resolução de identidade (fiscal → nome+país → fantasia+país)')
ok(/atualValor === null \|\| atualValor === undefined \|\| atualValor === ''/.test(seed), 'seed só COMPLETA campo vazio — nunca sobrescreve edição manual')
ok(/protocolos > 0/.test(rotaOrgId), 'organização com protocolo no histórico é inativada, não apagada')




// ═══════════ 7) COMUNI ITALIANOS POR REGIÃO ═══════════
console.log('\n7) Comuni italianos — todas as regiões')
const REGIOES_ITALIA = [
  'Abruzzo', 'Basilicata', 'Calabria', 'Campania', 'Emilia-Romagna', 'Friuli-Venezia Giulia', 'Lazio',
  'Liguria', 'Lombardia', 'Marche', 'Molise', 'Piemonte', 'Puglia', 'Sardegna', 'Sicilia', 'Toscana',
  'Trentino-Alto Adige', 'Umbria', "Valle d'Aosta", 'Veneto',
]
const regioesCobertas = new Set(COMUNI.map((c) => c.regiao))
for (const r of REGIOES_ITALIA) ok(regioesCobertas.has(r), `região coberta: ${r}`)
ok(regioesCobertas.size === 20, `exatamente as 20 regiões italianas (${regioesCobertas.size})`)
ok(COMUNI.length >= 107, `capoluoghi + alta demanda (${COMUNI.length} comuni)`)
ok(COMUNI.filter((c) => c.capitalRegional).length >= 20, 'toda capital regional presente')
ok(COMUNI.filter((c) => c.capitalProvincial).length >= 100, 'capitais provinciais presentes')
ok(COMUNI.every((c) => c.regiao && c.provincia && /^[A-Z]{2}$/.test(c.sigla)), 'todo comune tem região, província e sigla')
const chavesComuni = COMUNI.map((c) => `${c.nome}|${c.provincia}`)
ok(new Set(chavesComuni).size === chavesComuni.length, 'nenhum comune declarado duas vezes')
const comuniOrg = ORGANIZACOES.filter((o) => o.type === 'comune')
ok(comuniOrg.every((o) => o.name.startsWith('Comune di ')), 'nome oficial em italiano: "Comune di X"')
ok(comuniOrg.every((o) => o.country === 'Itália' && !!o.state && !!o.provincia), 'país, região e província vinculados')
ok(comuniOrg.every((o) => o.categorias.includes('comuni')), 'todo comune é classificado como Comune')
ok(comuniOrg.every((o) => funcoesDe(o).includes('ORGAO') && funcoesDe(o).includes('FORNECEDOR')),
  'todo comune é Órgão E Fornecedor (emite ato mediante emolumento) — um cadastro, duas funções')

// ═══════════ 8) FORNECEDORES REAIS, SEM CADASTRO PARALELO ═══════════
console.log('\n8) Fornecedores no MESMO cadastro')
for (const nome of ['DHL Express', 'FedEx Express', 'Jadlog Logística', 'Banco do Brasil S.A.', 'Wise Payments Limited',
  'Microsoft Corporation', 'Amazon Web Services, Inc.', 'Certisign Certificadora Digital S.A.']) {
  ok(FORNECEDORES.some((f) => f.name === nome), `fornecedor real cadastrado: ${nome}`)
}
ok(FORNECEDORES.every((f) => funcoesDe(f).includes('FORNECEDOR')), 'todo fornecedor tem a função FORNECEDOR')
ok(ORGANIZACOES.filter((o) => funcoesDe(o).includes('FORNECEDOR')).length >= 200,
  'órgãos que geram taxa/custa/emolumento também são fornecedores')
const dadosSrc = ler('prisma/dados-orgaos-organizacoes.ts')
ok(!/identificacaoFiscal:/.test(dadosSrc), 'nenhum CNPJ/VAT fabricado na base')
ok(!/chavePix:|agencia:|\bconta:/.test(dadosSrc), 'nenhum dado bancário fabricado na base')
ok(!/contatoFinanceiro:/.test(dadosSrc), 'nenhum contato financeiro fabricado na base')
// profissionais sem nome real ficam como CATEGORIA, prontos para cadastro depois
for (const c of ['tradutores', 'advogados', 'despachantes', 'genealogistas', 'pesquisadores', 'correspondentes']) {
  ok(CATEGORIAS.some((x) => x.code === c), `categoria pronta para cadastro posterior: ${c}`)
  ok(!ORGANIZACOES.some((o) => o.categorias.includes(c)), `nenhum profissional inventado em "${c}"`)
}

// ═══════════ 9) ORGANIZAÇÃO ÚNICA (arquitetura permanente) ═══════════
console.log('\n9) Uma organização = um registro, N funções')
ok(normalizarIdentificacaoFiscal('12.345.678/0001-90') === '12345678000190', 'CNPJ com e sem máscara é a MESMA identidade')
ok(normalizarIdentificacaoFiscal('  ') === null, 'identificação vazia não vira chave')
ok(chaveDeNome('Comune di Roma') === chaveDeNome('COMUNE DI ROMA'), 'comparação ignora caixa')
ok(chaveDeNome('Instituto dos Registos e do Notariado') === chaveDeNome('Instituto de Registos e Notariado'),
  'comparação ignora preposições e conectivos')
ok(similaridade('DHL Express', 'DHL Express Brasil') >= 0.8, 'detecta variação de nome comercial')
ok(similaridade('Comune di Roma', 'Comune di Milano') < 0.8, 'comuni diferentes não são confundidos')
ok(JSON.stringify(unirFuncoes(['ORGAO'], ['FORNECEDOR'])) === JSON.stringify(['ORGAO', 'FORNECEDOR']),
  'acrescentar função nunca remove a que já existia')
ok(JSON.stringify(unirFuncoes(['ORGAO', 'FORNECEDOR'], ['ORGAO'])) === JSON.stringify(['ORGAO', 'FORNECEDOR']),
  'reaplicar função é idempotente')

const servicoSrc = ler('src/services/organizacao-identidade.ts')
ok(/como: 'identificacao-fiscal'/.test(servicoSrc) && /como: 'nome-oficial-pais'/.test(servicoSrc) && /como: 'nome-fantasia-pais'/.test(servicoSrc),
  'resolução segue a ordem obrigatória (id → fiscal → nome+país → fantasia+país)')
const rotaPost = ler('src/app/api/gerenciamento/orgaos-protocolo/route.ts')
ok(/resolverOrganizacao/.test(rotaPost), 'POST resolve a identidade antes de criar')
ok(/ACRESCENTAR_FUNCAO/.test(rotaPost), 'organização existente ACRESCENTA função em vez de duplicar')
ok(/detectarDuplicidade/.test(rotaPost), 'POST detecta parecidas antes de criar entidade nova')
ok(/detectarDuplicidade/.test(ler('src/app/api/gerenciamento/orgaos-protocolo/[id]/route.ts')), 'edição também é protegida contra duplicidade')
ok(!!ler('src/app/api/gerenciamento/orgaos-protocolo/verificar/route.ts'), 'existe verificação de duplicidade para a tela')
const seedSrc = ler('prisma/seed-orgaos-organizacoes.ts')
ok(/resolverOrganizacao/.test(seedSrc) && /unirFuncoes/.test(seedSrc), 'seed também passa pela identidade única e soma funções')
const schema = ler('prisma/schema.prisma')
ok(/identificacaoFiscal\s+String\?\s+@unique/.test(schema), 'banco garante identificação fiscal única')
ok(/enum FuncaoOrganizacao/.test(schema), 'funções são enum do banco, não texto solto')
ok(/funcoes\s+FuncaoOrganizacao\[\]/.test(schema), 'a organização carrega N funções no próprio registro')

console.log(`\n${passed} passaram, ${failed} falharam`)
if (failed > 0) { console.log('FALHAS: ' + falhas.join('; ')); process.exit(1) }
console.log('Órgãos e Organizações — base oficial e organização única: validadas ✅')
