// scripts/guard-atributo-cadastral.test.ts
//
// FICHA NÃO É REFERÊNCIA — e a distinção não pode virar porta dos fundos.
//
// O guard de referências casa nome de campo com conceito mestre e acusa todo `String`.
// Ele acerta na maioria e erra numa classe inteira: campo de FICHA. `OrgaoProtocolo.moeda`
// ("moeda praticada pela entidade") fica ao lado de `idioma` e `horario`, e nenhuma
// decisão do sistema depende dele.
//
// Este arquivo prova as duas metades: que a ficha declarada passa, e que a regra
// continua pegando tudo o que pegava antes.
//
//   npx tsx scripts/guard-atributo-cadastral.test.ts

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { analisarSchema, type AtributoCadastral, type Excecao } from '../lib/arquitetura/referencias-estruturais'

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..')

let ok = 0
const falhas: string[] = []
function check(nome: string, cond: boolean, extra?: string) {
  if (cond) { ok++; console.log(`  ✅ ${nome}`) }
  else { falhas.push(nome); console.log(`  ❌ ${nome}${extra ? ` — ${extra}` : ''}`) }
}

/** Schema mínimo, escrito à mão: o teste é da REGRA, não do schema de produção. */
const schema = (corpo: string) => `model Alvo {\n  id Int @id\n${corpo}\n}\n`

console.log('\nA FICHA DECLARADA PASSA')
const soTexto = schema('  moeda String?')
check('sem declaração, campo de conceito mestre é acusado',
  analisarSchema(soTexto).length === 1)
check('declarado como atributo cadastral, deixa de ser acusado',
  analisarSchema(soTexto, [], [{ alvo: 'Alvo.moeda', motivo: 'ficha' }]).length === 0)

console.log('\nA REGRA CONTINUA PEGANDO O QUE PEGAVA')
check('outro campo do mesmo modelo continua sendo acusado',
  analisarSchema(schema('  moeda String?\n  pais String?'), [], [{ alvo: 'Alvo.moeda', motivo: 'ficha' }]).length === 1)
check('o MESMO nome em OUTRO modelo continua sendo acusado',
  analisarSchema(`${schema('  moeda String?')}model Outro {\n  id Int @id\n  moeda String?\n}\n`,
    [], [{ alvo: 'Alvo.moeda', motivo: 'ficha' }]).length === 1)
check('declaração vazia não isenta ninguém',
  analisarSchema(soTexto, [], []).length === 1)

console.log('\nA DECLARAÇÃO COBRA UM PREÇO — E ESSE PREÇO É NOVO')
// Ficha e FK juntas são duas fontes para o mesmo fato. Antes desta regra, uma exceção
// comum deixaria a dupla fonte passar calada; agora ela é violação.
const fichaEfk = analisarSchema(schema('  moeda String?\n  moedaId Int?'),
  [], [{ alvo: 'Alvo.moeda', motivo: 'ficha' }])
check('declarar ficha E ter a FK do conceito é violação', fichaEfk.length === 1)
check('e a violação explica a escolha, em vez de só acusar',
  /ou o campo é ficha \(e a FK sobra\), ou é referência \(e o texto sai\)/.test(fichaEfk[0]?.detalhe ?? ''),
  fichaEfk[0]?.detalhe)
check('como EXCEÇÃO comum, a mesma dupla fonte passava calada',
  analisarSchema(schema('  moeda String?\n  moedaId Int?'),
    [{ alvo: 'Alvo.moeda', motivo: 'x' } as Excecao], []).length === 0)

console.log('\nO CASO REAL: OrgaoProtocolo.moeda')
const real = readFileSync(join(RAIZ, 'prisma/schema.prisma'), 'utf8')
const guard = readFileSync(join(RAIZ, 'scripts/arquitetura-referencias.test.ts'), 'utf8')

check('está declarado como atributo cadastral, e não como dívida',
  /const ATRIBUTOS_CADASTRAIS: AtributoCadastral\[\][\s\S]{0,400}alvo: 'OrgaoProtocolo\.moeda'/.test(guard))
check('e NÃO está no inventário de dívidas',
  !/EXCECOES_SCHEMA[\s\S]*?alvo: 'OrgaoProtocolo\.moeda'[\s\S]*?const ATRIBUTOS_CADASTRAIS/.test(guard))
check('o motivo registra que a auditoria não achou leitor',
  /NENHUM leitor no sistema/.test(guard))

const bloco = real.slice(real.indexOf('model OrgaoProtocolo {'), real.indexOf('\n}', real.indexOf('model OrgaoProtocolo {')))
check('o modelo NÃO tem moedaId — ficha e vínculo não convivem', !/\bmoedaId\b/.test(bloco))
check('o campo continua String?, com o valor que sempre teve', /moeda\s+String\?/.test(bloco))

// A ficha real, aplicada ao schema real: nenhum achado.
const semDeclarar = analisarSchema(real, []).filter((a) => a.onde === 'OrgaoProtocolo.moeda')
const declarando = analisarSchema(real, [], [{ alvo: 'OrgaoProtocolo.moeda', motivo: 'ficha' }])
  .filter((a) => a.onde === 'OrgaoProtocolo.moeda')
check('no schema REAL: acusado sem a declaração, aceito com ela',
  semDeclarar.length === 1 && declarando.length === 0)

console.log('\nO CAMPO FINANCEIRO CONTINUA SENDO DÍVIDA')
// A distinção só vale para ficha. Moeda numa célula de planilha É valor financeiro.
check('PlanilhaCelulaOverride.moeda segue no inventário de dívidas, com destino',
  /alvo: 'PlanilhaCelulaOverride\.moeda'[\s\S]{0,240}moedaId → MoedaCadastro/.test(guard))
check('e o motivo distingue explicitamente os dois casos',
  /diferente de[\s\S]{0,80}OrgaoProtocolo\.moeda, que é ficha/.test(guard))

console.log(`\n${falhas.length === 0 ? '✅ PASSOU' : '❌ FALHOU'}: ${ok} ok, ${falhas.length} falhas`)
if (falhas.length) { falhas.forEach((f) => console.log(`   · ${f}`)); process.exitCode = 1 }
