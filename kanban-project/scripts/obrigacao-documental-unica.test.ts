/**
 * GUARDA — UMA OBRIGAÇÃO, UM NOME, UMA LINHA.
 * Rodar: npm run test:obrigacao-unica
 *
 * O DEFEITO
 * ---------
 * A regra GEN-CIVIL-NASC declara `requisitoNome = "Certidão de Nascimento"` e
 * `documentosAceitos = ["IT - NAS"]`, cujo tipo no Cadastro Mestre se chama
 * "Certidão de nascimento - Inteiro Teor". A tela exibia os dois rótulos como se
 * fossem duas obrigações da mesma pessoa.
 *
 * A REGRA
 * -------
 * Regra com UM documento aceito ⇒ o nome vem do Cadastro Mestre.
 * Regra com VÁRIOS aceitos (RG ou CNH) ⇒ o requisito nomeia a EXIGÊNCIA, e aí ele
 * é o rótulo correto: "Documento de identificação" não é o nome de nenhum tipo.
 *
 * Nenhuma identidade depende de texto.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  nomeCanonicoDaObrigacao, identidadeDaObrigacao, codigosAceitos,
} from '../src/lib/documentos/nome-canonico-obrigacao'
import { chaveDoAlvo } from '../src/lib/process-stage/estrutura-operacional-core'

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..')
const src = (p: string) => readFileSync(join(RAIZ, p), 'utf8')

let passou = 0, falhou = 0
const falhas: string[] = []
const ok = (nome: string, cond: boolean, extra = '') => {
  if (cond) { passou++; console.log(`  ✅ ${nome}${extra ? ` — ${extra}` : ''}`) }
  else { falhou++; falhas.push(nome); console.log(`  ❌ ${nome}${extra ? ` — ${extra}` : ''}`) }
}
const secao = (t: string) => console.log(`\n${t}`)

console.log('Obrigação documental — um nome, uma linha\n')

// Cadastro Mestre real (produção).
const MESTRE: Record<string, string> = {
  'IT - NAS': 'Certidão de nascimento - Inteiro Teor',
  'IT - CAS': 'Certidão de casamento - Inteiro Teor',
  'IT - OBI': 'Certidão de óbito - Inteiro Teor',
  'RG': 'RG',
  'CNH': 'CNH',
  'COMP-RES': 'Comprovante de Residência',
}
const nomePorCode = (c: string) => MESTRE[c] ?? null

// ── 1) Nascimento, casamento e óbito: nome canônico ────────────────────────
secao('1) Documento aceito ÚNICO ⇒ nome do Cadastro Mestre')

const nasc = nomeCanonicoDaObrigacao({
  documentosAceitos: ['IT - NAS'], requisitoNome: 'Certidão de Nascimento',
  itemCatalogoNome: 'Certidão de Nascimento - Inteiro Teor', nomePorCode,
})
ok('nascimento usa o nome canônico', nasc === 'Certidão de nascimento - Inteiro Teor', String(nasc))
ok('nascimento NÃO usa o requisitoNome da regra', nasc !== 'Certidão de Nascimento')

const cas = nomeCanonicoDaObrigacao({
  documentosAceitos: ['IT - CAS'], requisitoNome: 'Certidão de Casamento',
  itemCatalogoNome: null, nomePorCode,
})
ok('casamento usa o nome canônico (GEN-CIVIL-CAS)', cas === 'Certidão de casamento - Inteiro Teor', String(cas))

const obi = nomeCanonicoDaObrigacao({
  documentosAceitos: ['IT - OBI'], requisitoNome: 'Certidão de Óbito',
  itemCatalogoNome: null, nomePorCode,
})
ok('óbito usa o nome canônico (GEN-CIVIL-OBITO)', obi === 'Certidão de óbito - Inteiro Teor', String(obi))

// ── 2) Grupo alternativo: o requisito nomeia a exigência ───────────────────
secao('2) Vários aceitos ⇒ o requisito nomeia a EXIGÊNCIA')

const ident = nomeCanonicoDaObrigacao({
  documentosAceitos: ['RG', 'CNH'], requisitoNome: 'Documento de identificação',
  itemCatalogoNome: 'RG', nomePorCode,
})
ok('grupo RG/CNH mantém o rótulo do requisito', ident === 'Documento de identificação', String(ident))
ok('grupo alternativo NÃO é renomeado para um dos aceitos', ident !== 'RG' && ident !== 'CNH')

// ── 3) Degradação honesta ──────────────────────────────────────────────────
secao('3) Cadastro incompleto cai em cadastro, nunca no texto da regra')

const semMestre = nomeCanonicoDaObrigacao({
  documentosAceitos: ['XX - INEXISTENTE'], requisitoNome: 'Requisito digitado',
  itemCatalogoNome: 'Nome do Item do Catálogo', nomePorCode,
})
ok('código não cadastrado cai no ItemCatalogo (cadastro)', semMestre === 'Nome do Item do Catálogo', String(semMestre))
const semNada = nomeCanonicoDaObrigacao({
  documentosAceitos: ['XX'], requisitoNome: 'Requisito digitado', itemCatalogoNome: null, nomePorCode,
})
ok('sem item e sem tipo, o requisito é o último recurso (não fica vazio)', semNada === 'Requisito digitado')
ok('lista vazia usa o requisito (não há documento a nomear)', nomeCanonicoDaObrigacao({ documentosAceitos: [], requisitoNome: 'Exigência X', itemCatalogoNome: null, nomePorCode }) === 'Exigência X')
ok('documentosAceitos ausente não quebra', nomeCanonicoDaObrigacao({ documentosAceitos: null, requisitoNome: null, itemCatalogoNome: 'Item', nomePorCode }) === 'Item')
ok('codigosAceitos ignora lixo', JSON.stringify(codigosAceitos(['IT - NAS', '', '  ', null])) === JSON.stringify(['IT - NAS']))

// ── 4) Identidade por IDs, nunca por texto ─────────────────────────────────
secao('4) Identidade da obrigação')

const a = identidadeDaObrigacao({ processoId: 513, pessoaId: 2596, documentTypeId: 2, ciclo: 1 })
const b = identidadeDaObrigacao({ processoId: 513, pessoaId: 2596, documentTypeId: 2, ciclo: 1 })
ok('mesma obrigação ⇒ mesma identidade', a === b && a != null, String(a))
ok('pessoa diferente ⇒ identidade diferente', a !== identidadeDaObrigacao({ processoId: 513, pessoaId: 2597, documentTypeId: 2, ciclo: 1 }))
ok('tipo diferente ⇒ identidade diferente', a !== identidadeDaObrigacao({ processoId: 513, pessoaId: 2596, documentTypeId: 3, ciclo: 1 }))
ok('ciclo diferente ⇒ identidade diferente', a !== identidadeDaObrigacao({ processoId: 513, pessoaId: 2596, documentTypeId: 2, ciclo: 2 }))
ok('sem pessoa ou sem tipo não há identidade forjada', identidadeDaObrigacao({ processoId: 1, pessoaId: null, documentTypeId: 2 }) === null && identidadeDaObrigacao({ processoId: 1, pessoaId: 1, documentTypeId: null }) === null)
ok('a identidade não contém texto de requisito', !/[Cc]ertid/.test(String(a)))

// ── 5) Uma linha por obrigação (chave do alvo) ─────────────────────────────
secao('5) Necessidade e Documento não viram duas linhas')

// Passo escopado por documento, com o vínculo doc→necessidade resolvido:
const mapa = new Map<number, number>([[900, 77]])
ok('passo por NECESSIDADE tem chave da necessidade', chaveDoAlvo({ pessoaId: 5, necessidadeId: 77, documentoId: null }, mapa) === 'necessidade:77')
ok('passo por DOCUMENTO vinculado normaliza para a necessidade', chaveDoAlvo({ pessoaId: 5, necessidadeId: null, documentoId: 900 }, mapa) === 'necessidade:77')
ok('as duas origens colapsam na MESMA chave', chaveDoAlvo({ pessoaId: 5, necessidadeId: 77, documentoId: null }, mapa) === chaveDoAlvo({ pessoaId: 5, necessidadeId: null, documentoId: 900 }, mapa))
ok('documento SEM vínculo mantém chave própria (não inventa necessidade)', chaveDoAlvo({ pessoaId: 5, necessidadeId: null, documentoId: 901 }, mapa) === 'documento:901')

// ── 6) O código não voltou a nomear por requisito ──────────────────────────
secao('6) Guardas de código')

const ESTR = src('src/lib/process-stage/estrutura-operacional.ts')
ok('estrutura-operacional usa o resolvedor canônico', /nomeCanonicoDaObrigacao\(\{/.test(ESTR))
ok('não devolve mais o requisito do snapshot direto como título', !/if \(typeof r === "string" && r\.trim\(\)\) return r/.test(ESTR))
ok('o Documento é casado com a Necessidade por ID (pessoa + tipo)', /necPorPessoaETipo/.test(ESTR) && /d\.documentTypeId/.test(ESTR))
ok('o casamento não usa nome/texto', !/\.name\s*===|nome\s*===\s*d\./.test(ESTR.split('necPorPessoaETipo')[1]?.slice(0, 900) ?? ''))
ok('o select de Documento carrega documentTypeId', /select: \{ id: true, pessoaId: true, tipo: true, status: true, necessidadeId: true, documentTypeId: true \}/.test(ESTR))

const ROTA = src('src/app/api/processos/[processoId]/central-operacional/route.ts')
ok('a fila da Genealogia usa o resolvedor canônico', /nomeCanonicoDaObrigacao\(\{/.test(ROTA))
ok('a fila não rotula mais pelo requisito do snapshot', !/String\(\(snap as \{ requisito: unknown \}\)\.requisito\)/.test(ROTA))
ok('docType e docTypeLabel saem da mesma fonte', /docType: requisitoDe\(n\),\s*\n\s*docTypeLabel: requisitoDe\(n\),/.test(ROTA))

// ── 7) Contagem: uma obrigação conta uma vez ───────────────────────────────
secao('7) Contagem e progresso')

// A fila e o denominador da Genealogia vêm da MESMA coleção `necs` — uma
// necessidade, uma linha, uma unidade de progresso.
ok('a fila da Genealogia é montada a partir de necs (1 linha por necessidade)', /const queueV2: QueueRow\[\] = necs\.map\(/.test(ROTA))
ok('docsNaFase usa necs.length (mesma coleção da fila)', /docsNaFase: necs\.length/.test(ROTA))
ok('o progresso conta necessidades OBRIGATÓRIAS, não linhas de tela', /const obrig = necs\.filter\(\(n\) => n\.obrigatoriedade === "OBRIGATORIA"\)/.test(ROTA))

// simulação: 1 pessoa solteira ⇒ 1 obrigação de nascimento
const necsSolteira = [{ id: 77, pessoaId: 2596, obrigatoriedade: 'OBRIGATORIA', itemCatalogoId: 1, matrizSnapshot: { requisito: 'Certidão de Nascimento', documentosAceitos: ['IT - NAS'] } }]
const linhas = necsSolteira.map((n) => nomeCanonicoDaObrigacao({
  documentosAceitos: (n.matrizSnapshot as any).documentosAceitos,
  requisitoNome: (n.matrizSnapshot as any).requisito,
  itemCatalogoNome: 'Certidão de Nascimento - Inteiro Teor', nomePorCode,
}))
ok('pessoa solteira ⇒ exatamente 1 linha', linhas.length === 1)
ok('a linha é a certidão em inteiro teor', linhas[0] === 'Certidão de nascimento - Inteiro Teor', String(linhas[0]))
ok('não existe linha "Certidão de Nascimento" avulsa', !linhas.includes('Certidão de Nascimento'))

// ── Resultado ──────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(62)}`)
console.log(`Total: ${passou + falhou} | ✅ ${passou} | ❌ ${falhou}`)
if (falhou > 0) {
  console.log('\nFalhas:')
  for (const f of falhas) console.log(`  · ${f}`)
  process.exit(1)
}
console.log('O documento se chama pelo cadastro; o requisito nomeia a exigência.\n')
