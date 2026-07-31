/**
 * GUARDA — criação de processo não estoura o pool de conexões.
 * Rodar: npm run test:criar-processo-conexao
 *
 * DEFEITO QUE ISTO TRAVA (produção, 31/07):
 *   Erro ao criar processo: Timed out fetching a new connection from the
 *   connection pool — em `prisma.phaseInternalWorkflow.findFirst()`.
 *
 * Duas causas somadas:
 *   1. `connection_limit=1`: com uma conexão só, qualquer concorrência dentro da
 *      mesma instância é fatal. A criação abre transação de até 20s e segura a
 *      conexão inteira; a requisição ao lado espera o pool_timeout e morre.
 *   2. Uma PRÉ-VALIDAÇÃO redundante resolvia o Workflow Interno com o client
 *      GLOBAL antes da transação — e a instanciação resolvia tudo de novo lá
 *      dentro. Duas idas ao pool a mais na operação mais longa do sistema.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..')
const src = (p: string) => readFileSync(join(RAIZ, p), 'utf8')

let passou = 0, falhou = 0
const falhas: string[] = []
const ok = (n: string, c: boolean) => { if (c) { passou++; console.log(`  ✅ ${n}`) } else { falhou++; falhas.push(n); console.log(`  ❌ ${n}`) } }
const secao = (t: string) => console.log(`\n${t}`)

console.log('Criação de processo — pool de conexões\n')

const criar = src('src/services/criar-processo.ts')
const cliente = src('lib/prisma.ts')

secao('1) O pool comporta uma transação em curso')
{
  ok('connection_limit não é mais 1', !cliente.includes('connection_limit=1&'))
  ok('limite explícito e pequeno', /connection_limit=[2-9]&pool_timeout=/.test(cliente))
  ok('pool_timeout preservado', cliente.includes('pool_timeout=20'))
  ok('URL já pooled continua intocada', cliente.includes('if (pooled) return bruta'))
  ok('a razão do número está escrita', cliente.includes('POR QUE NÃO 1'))
}

secao('2) Nenhuma resolução de workflow fora da transação')
{
  ok('a pré-validação redundante saiu', !criar.includes('resolverWorkflowAplicavel(tipoMotor.id, primeiraFase)'))
  ok('o import morto saiu junto', !criar.includes('resolverWorkflowAplicavel'))
  ok('quem instancia recebe a transação', /instanciarWorkflowDaFase\([\s\S]{0,400}\n\s+tx,\n\s+\)/.test(criar))
  ok('as tarefas iniciais também', /garantirTarefaDePasso\([\s\S]{0,300}\n\s+tx,\n\s+\)/.test(criar))
}

secao('3) O contrato de erro não se perdeu')
{
  ok('workflow ausente tem código próprio', criar.includes('if (ex.__instFail === "WORKFLOW_NAO_ENCONTRADO") return err("SEM_WORKFLOW_INTERNO")'))
  ok('SEM_WORKFLOW_INTERNO segue no contrato', criar.includes('| "SEM_WORKFLOW_INTERNO"'))
  ok('mensagem orienta o operador', criar.includes('não possui Workflow Interno configurado'))
  ok('demais falhas de instanciação preservadas', criar.includes('if (ex.__instFail) return err("INSTANCIACAO_FALHOU"'))
  ok('idempotência sob corrida preservada', criar.includes('if (ex.code === "P2002")'))
}

secao('4) A transação segue atômica')
{
  ok('nascimento em transação única', criar.includes('prisma.$transaction(async (tx)'))
  ok('timeout e maxWait explícitos', criar.includes('{ timeout: 20000, maxWait: 10000 }'))
  ok('código público gerado dentro da transação', criar.includes('gerarCodigoPublico(tx, "PROCESS"'))
}

console.log(`\n${'='.repeat(60)}`)
console.log(`Criação de processo: ${passou} passaram, ${falhou} falharam`)
if (falhou > 0) { console.log('\nFalhas:'); for (const f of falhas) console.log(`  · ${f}`); process.exit(1) }
console.log('Pool comporta a transação · nenhuma consulta extra fora dela ✅')
