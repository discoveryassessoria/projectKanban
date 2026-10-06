// scripts/operacao-ordem-por-evento.test.ts
// A ORDEM DAS CERTIDÕES É POR EVENTO: nascimento → casamento → óbito. Sempre. (A Operação da Daniela mostrava nascimento, óbito, casamento.)
import { readFileSync } from 'node:fs'
import { agruparDentroDaFamilia, agruparPorFamilia, agruparPorOrgao, ordenarPorEvento } from '../src/components/operacao/operacao-v3-derivacoes'

let passou = 0, falhou = 0
const ok = (n: string, c: boolean, extra = '') => { if (c) { passou++; console.log(`  ✅ ${n}${extra ? ` — ${extra}` : ''}`) } else { falhou++; console.log(`  ❌ ${n}${extra ? ` — ${extra}` : ''}`) } }

let id = 0
const linha = (categoriaDoc: 'NASCIMENTO' | 'CASAMENTO' | 'OBITO' | null, pessoaId: number, numeroLinhagem: number | null, extra: Record<string, unknown> = {}) =>
  ({ taskId: ++id, categoriaDoc, pessoaId, pessoaNome: `Pessoa ${pessoaId}`, numeroLinhagem, origem: 'CERTIDAO', faseMacroKey: 'genealogia', terceiroNome: null, titulo: categoriaDoc ?? 'outro', ...extra }) as never
const cats = (g: { linhas: Array<{ categoriaDoc: string | null }> }) => g.linhas.map((l) => l.categoriaDoc).join('>')

// A ordem em que o banco/a fila entregam NÃO é a ordem do evento: óbito, nascimento, casamento (e uma "outra" no meio).
const entrada = [linha('OBITO', 1, 2), linha(null, 1, 2), linha('NASCIMENTO', 1, 2), linha('CASAMENTO', 1, 2)]
const porPessoa = agruparDentroDaFamilia(entrada, 'pessoa')
ok('por pessoa: nascimento → casamento → óbito → (outra)', porPessoa.length === 1 && cats(porPessoa[0]) === 'NASCIMENTO>CASAMENTO>OBITO>', cats(porPessoa[0]))

const duas = agruparDentroDaFamilia([linha('OBITO', 2, 3), linha('CASAMENTO', 2, 3), linha('NASCIMENTO', 2, 3), linha('OBITO', 1, 2), linha('NASCIMENTO', 1, 2)], 'pessoa')
ok('a geração continua mandando (G2 antes de G3) e, dentro de cada pessoa, a ordem do evento', duas.map((g) => `${g.titulo}:${cats(g)}`).join(' | ') === 'Pessoa 1:NASCIMENTO>OBITO | Pessoa 2:NASCIMENTO>CASAMENTO>OBITO', duas.map((g) => `${g.titulo}:${cats(g)}`).join(' | '))

const porOrgao = agruparDentroDaFamilia([linha('OBITO', 1, 2, { terceiroNome: 'Cartório X' }), linha('NASCIMENTO', 1, 2, { terceiroNome: 'Cartório X' }), linha('CASAMENTO', 1, 2, { terceiroNome: 'Cartório X' })], 'orgao')
ok('por órgão também segue nascimento → casamento → óbito', cats(porOrgao[0]) === 'NASCIMENTO>CASAMENTO>OBITO', cats(porOrgao[0]))

const semNumero = agruparDentroDaFamilia([linha('OBITO', 5, null), linha('NASCIMENTO', 5, null), linha('NASCIMENTO', 1, 2)], 'pessoa')
ok('quem não tem número de linhagem vai ao fim, sem sumir, e também em ordem de evento', semNumero.map((g) => g.titulo).join() === 'Pessoa 1,Pessoa 5' && cats(semNumero[1]) === 'NASCIMENTO>OBITO')

// A aba FEITO (e Aguardando, Acompanhamento, Fila): a lista da família também sai por evento — era a que mostrava casamento, nascimento, óbito.
const feito = agruparPorFamilia([
  linha('CASAMENTO', 1, 1, { familiaNome: 'Sanchez Dias' }), linha('NASCIMENTO', 1, 1, { familiaNome: 'Sanchez Dias' }), linha('OBITO', 1, 1, { familiaNome: 'Sanchez Dias' }),
  linha('OBITO', 2, 2, { familiaNome: 'Sanchez Dias' }), linha('CASAMENTO', 2, 2, { familiaNome: 'Sanchez Dias' }), linha('NASCIMENTO', 2, 2, { familiaNome: 'Sanchez Dias' }),
])
ok('por família (Feito etc.): G1 inteira — nascimento, casamento, óbito — e depois G2 na mesma ordem', feito.length === 1 && feito[0].linhas.map((l) => `${l.numeroLinhagem}${String(l.categoriaDoc)[0]}`).join(' ') === '1N 1C 1O 2N 2C 2O', feito[0].linhas.map((l) => `${l.numeroLinhagem}${String(l.categoriaDoc)[0]}`).join(' '))
ok('por órgão (Aguardando agrupado por órgão) também', agruparPorOrgao([linha('OBITO', 1, 1, { terceiroNome: 'Cartório Y' }), linha('CASAMENTO', 1, 1, { terceiroNome: 'Cartório Y' }), linha('NASCIMENTO', 1, 1, { terceiroNome: 'Cartório Y' })])[0].linhas.map((l) => l.categoriaDoc).join('>') === 'NASCIMENTO>CASAMENTO>OBITO')
ok('a mesma pessoa nunca se separa por causa da ordem (duas pessoas na mesma geração ficam cada uma inteira)', ordenarPorEvento([linha('OBITO', 3, 2, { pessoaNome: 'Beto' }), linha('NASCIMENTO', 4, 2, { pessoaNome: 'Ana' }), linha('NASCIMENTO', 3, 2, { pessoaNome: 'Beto' }), linha('OBITO', 4, 2, { pessoaNome: 'Ana' })]).map((l) => `${l.pessoaNome}:${String(l.categoriaDoc)[0]}`).join(' ') === 'Ana:N Ana:O Beto:N Beto:O')
const fonte = readFileSync('src/components/operacao/operacao-v3-derivacoes.ts', 'utf8')
ok('a tabela de ordem do código é nascimento 0, casamento 1, óbito 2 (como a da Torre)', /\{ NASCIMENTO: 0, CASAMENTO: 1, OBITO: 2 \}/.test(fonte) && !/NASCIMENTO: 0, OBITO: 1/.test(fonte))
console.log(`\n${falhou === 0 ? '✅ PASSOU' : '❌ FALHOU'}: ${passou} ok, ${falhou} falhas`)
process.exit(falhou ? 1 : 0)
