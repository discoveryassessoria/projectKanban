// scripts/guard-prazo-e-distribuicao.test.ts
// ============================================================================
// AS DUAS FRONTEIRAS QUE ESTA RODADA FECHOU — e que precisam continuar fechadas.
//
//   npx tsx scripts/guard-prazo-e-distribuicao.test.ts
//
// 1. O TEMPO tem uma régua só. Havia três contas de prazo (duas com o mesmo
//    nome e argumentos invertidos) e seis réguas de atraso com cortes
//    diferentes. Este guard reprova a quarta.
//
// 2. DISTRIBUIR É DEFINIR RESPONSABILIDADE, NÃO COMEÇAR TRABALHO. Atribuir,
//    transferir, devolver à fila e navegar não podem, em nenhuma circunstância,
//    iniciar uma tarefa — e distribuição automática continua não existindo.
//
// Guard é leitura de código: não monta cenário, não escreve, não depende de
// banco. Ele falha o CI antes de o defeito chegar em alguém.
// ============================================================================
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join } from 'node:path'

let passou = 0, falhou = 0
const falhas: string[] = []
const ok = (nome: string, cond: boolean, extra = '') => {
  if (cond) { passou++; console.log(`  ✅ ${nome}${extra ? ` — ${extra}` : ''}`) }
  else { falhou++; falhas.push(nome); console.log(`  ❌ ${nome}${extra ? ` — ${extra}` : ''}`) }
}
const secao = (t: string) => console.log(`\n${t}`)
const RAIZ = join(__dirname, '..')
const ler = (p: string) => readFileSync(join(RAIZ, p), 'utf8')
const semComentarios = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

const varrer = (dir: string, acc: string[] = []): string[] => {
  if (!existsSync(join(RAIZ, dir))) return acc
  for (const e of readdirSync(join(RAIZ, dir))) {
    if (e === 'node_modules' || e === '.next' || e.startsWith('.')) continue
    const rel = `${dir}/${e}`
    if (statSync(join(RAIZ, rel)).isDirectory()) varrer(rel, acc)
    else if (/\.(ts|tsx)$/.test(rel)) acc.push(rel)
  }
  return acc
}
const RUNTIME = [...varrer('src'), ...varrer('lib')]

console.log('PRAZO E DISTRIBUIÇÃO — as duas fronteiras\n')

// ═══════════════════════════════════════════════════════════════════════════
secao('§94) ATRASO É CONDIÇÃO — nunca um status persistido')
// ═══════════════════════════════════════════════════════════════════════════
// Um status "ATRASADA" precisaria de alguém para escrevê-lo: um cron diário
// varrendo o banco, marcando linhas, e outro para desmarcar quando o prazo
// mudasse. Toda vez que esse relógio falhasse, a fila mentiria — e ninguém
// saberia, porque o banco "confirmaria" a mentira.
const schema = ler('prisma/schema.prisma')
const enumStatus = schema.slice(schema.indexOf('enum StatusTarefa'), schema.indexOf('}', schema.indexOf('enum StatusTarefa')))
for (const proibido of ['ATRASADA', 'VENCE_HOJE', 'VENCE_AMANHA', 'EM_FERIAS', 'SOBRECARREGADO']) {
  ok(`§94) StatusTarefa não tem "${proibido}"`, !enumStatus.includes(proibido))
}
ok('§94) e a Tarefa não guarda coluna de atraso',
  !/\n\s+(atrasada|estaAtrasada|overdue)\s+Boolean/.test(schema))
// Um cron que marca atraso é a mesma dívida com outro nome.
const cronsQueMarcamAtraso = RUNTIME.filter((f) =>
  /cron|job|scheduler/i.test(f) && /atrasad/i.test(semComentarios(ler(f)))
  && /\.(update|updateMany)\(/.test(semComentarios(ler(f))),
)
ok('§94) nenhum job escreve atraso no banco', cronsQueMarcamAtraso.length === 0,
  cronsQueMarcamAtraso.join(', ') || 'nenhum')

// ═══════════════════════════════════════════════════════════════════════════
secao('§95) A CONTA DO PRAZO MORA EM UM LUGAR SÓ')
// ═══════════════════════════════════════════════════════════════════════════
const canonico = 'lib/operacional/tempo-operacional.ts'
ok('§95) existe a régua canônica', existsSync(join(RAIZ, canonico)))
const regua = semComentarios(ler(canonico))
ok('§95) e ela é pura — não consulta, não escreve',
  !/prisma\./.test(regua) && !/await /.test(regua))

// Quem materializa tarefa delega a conta.
for (const [arquivo, marca] of [
  ['lib/operacional/tarefa-canonica.ts', /calcularPrazo = prazoOperacional/],
  ['src/services/passo-tarefa-helpers.ts', /prazoOperacional\(sla, base\)/],
  ['src/services/processEngine/taskEngine.ts', /prazoOperacional\(spec\.slaDays/],
  ['src/services/documento-operacao.ts', /prazoOperacional\(/],
] as const) {
  ok(`§95) ${arquivo.split('/').pop()} usa a conta canônica`, marca.test(semComentarios(ler(arquivo))))
}

// NINGUÉM soma dias em milissegundos para produzir prazo. Foi assim que
// nasceram a segunda e a terceira implementação.
const PERMITIDOS_MS = new Set([
  canonico,
  'lib/operacional/tarefa-ciclo.ts',   // pausa de SLA, contada em minutos
  'src/lib/motor/sla-core.ts',         // SLA do PROCESSO — outra camada, declarada
  'src/lib/date-utils.ts',
])
const somadores = RUNTIME.filter((f) => {
  if (PERMITIDOS_MS.has(f)) return false
  const src = semComentarios(ler(f))
  return /dataPrazo[^\n]*86_?400_?000|86_?400_?000[^\n]*dataPrazo|prazo\s*=\s*new Date\([^)]*86_?400_?000/.test(src)
})
ok('§95) ninguém fabrica prazo somando milissegundos', somadores.length === 0,
  somadores.join(', ') || 'nenhum')

// E o CLIENTE não calcula prazo para mandar ao servidor.
const clientesQueCalculam = varrer('src/hooks').concat(varrer('src/utils')).filter((f) => {
  const src = semComentarios(ler(f))
  return /dataPrazo/.test(src) && /setDate\(|86_?400_?000/.test(src)
})
ok('§95) o cliente não calcula prazo para enviar', clientesQueCalculam.length === 0,
  clientesQueCalculam.join(', ') || 'nenhum')

// ═══════════════════════════════════════════════════════════════════════════
secao('§12) PREVISÃO DE TERCEIRO NÃO VIRA PRAZO')
// ═══════════════════════════════════════════════════════════════════════════
// O cartório informa trinta dias; o compromisso do escritório continua sendo o
// que foi assumido. Deixar a previsão sobrescrever o prazo terceirizaria o SLA.
const gravamPrazo = RUNTIME.filter((f) => {
  const src = semComentarios(ler(f))
  return /dataPrazo:\s*[^,\n]*previsao/i.test(src)
})
ok('§12) previsão do terceiro nunca é gravada como dataPrazo', gravamPrazo.length === 0,
  gravamPrazo.join(', ') || 'nenhum')
ok('§12) e a fila não conhece a previsão externa',
  !/previsaoRetorno/.test(semComentarios(ler('lib/operacional/tarefa-projecoes.ts'))))

// ═══════════════════════════════════════════════════════════════════════════
secao('§11) A PAUSA DE SLA É POLÍTICA DE DOMÍNIO — não `if` por nome de passo')
// ═══════════════════════════════════════════════════════════════════════════
const ciclo = semComentarios(ler('lib/operacional/tarefa-ciclo.ts'))
ok('§11) a política vem do workflow publicado',
  /pausarSlaEmEsperaExterna/.test(ciclo) && /export async function politicaDeSla/.test(ciclo))
ok('§11) e não existe regra fixa por chave de passo',
  !/stepKey === ['"]aguardar/.test(ciclo) && !/=== ['"]aguardar_retorno/.test(ciclo),
  'um `if` por nome de passo quebra no dia em que o cadastro renomeia a etapa')
ok('§11) retomar devolve o tempo parado ao prazo',
  /export async function retomarSla/.test(ciclo) && /slaPausaAcumuladaMin/.test(ciclo))

// ═══════════════════════════════════════════════════════════════════════════
secao('§93) DISTRIBUIR NÃO INICIA')
// ═══════════════════════════════════════════════════════════════════════════
const comandos = semComentarios(ler('lib/operacional/tarefa-comandos.ts'))
const corpoDe = (src: string, nome: string): string => {
  const i = src.indexOf(`export async function ${nome}`)
  if (i < 0) return ''
  const fim = src.indexOf('\nexport ', i + 10)
  return src.slice(i, fim < 0 ? undefined : fim)
}
for (const porta of ['atribuirTarefa', 'redistribuirTarefas']) {
  const corpo = corpoDe(comandos, porta)
  ok(`§93) ${porta} não chama iniciarTarefa`, corpo !== '' && !/iniciarTarefa\(/.test(corpo))
}
const devolver = corpoDe(semComentarios(ler('lib/operacional/tarefa-ciclo.ts')), 'devolverAFila')
ok('§30) devolver à fila não apaga progresso',
  devolver !== '' && !/dataInicio: null/.test(devolver) && !/workflowStepInstanceId: null/.test(devolver))

// E a navegação — que é GET — não pode comandar nada.
const navegacao = semComentarios(ler('src/app/api/operacao/tarefas/[tarefaId]/navegacao/route.ts'))
ok('§79) a rota de navegação é leitura pura',
  /export async function GET/.test(navegacao)
  && !/\b(prisma|tx)\s*\.\s*\w+\s*\.\s*(create|update|updateMany|upsert|delete)/.test(navegacao)
  && !/iniciarTarefa|atribuirTarefa/.test(navegacao))

// ═══════════════════════════════════════════════════════════════════════════
secao('§61/§28) TRANSFERIR NÃO RESETA')
// ═══════════════════════════════════════════════════════════════════════════
const atribuir = corpoDe(comandos, 'atribuirTarefa')

/**
 * O QUE A FUNÇÃO ESCREVE — só os payloads de `data:`.
 *
 * Procurar o nome do campo no corpo inteiro acusaria `select: { dataPrazo:
 * true }`: LER o prazo para pôr na notificação é o oposto de reescrevê-lo. O
 * guard precisa distinguir leitura de escrita, senão vira ruído e alguém o
 * desliga.
 */
function camposEscritos(corpo: string): string {
  const partes: string[] = []
  let i = corpo.indexOf('data: {')
  while (i >= 0) {
    let nivel = 0
    let j = corpo.indexOf('{', i)
    const inicio = j
    for (; j < corpo.length; j++) {
      if (corpo[j] === '{') nivel++
      else if (corpo[j] === '}') { nivel--; if (nivel === 0) break }
    }
    partes.push(corpo.slice(inicio, j + 1))
    i = corpo.indexOf('data: {', j)
  }
  return partes.join('\n')
}

const escritoPorAtribuir = camposEscritos(atribuir)
for (const [campo, oQueEra] of [
  ['dataPrazo', 'o prazo é do trabalho, não de quem o executa'],
  ['workflowInstanceId', 'o roteiro não recomeça porque mudou de mão'],
  ['workflowStepInstanceId', 'o passo corrente continua sendo o mesmo'],
  ['statusTarefa', 'transferir não é iniciar nem reabrir'],
  ['dataInicio', 'atribuir não é começar'],
] as const) {
  ok(`§61) atribuir/transferir não ESCREVE ${campo}`,
    !new RegExp(`${campo}\\s*:`).test(escritoPorAtribuir), oQueEra)
}
ok('§42) e a atribuição é protegida contra escrita concorrente',
  /lockVersion/.test(atribuir), 'dois gestores ao mesmo tempo: um vence, o outro é informado')

// ═══════════════════════════════════════════════════════════════════════════
secao('§19/§96) DISTRIBUIÇÃO AUTOMÁTICA CONTINUA DESLIGADA')
// ═══════════════════════════════════════════════════════════════════════════
// Ela não existe — e é assim que fica. Um autoassign ligado sem ninguém saber
// distribuiria trabalho real para pessoas reais sem decisão humana nenhuma.
const autoassign = RUNTIME.filter((f) => {
  const src = semComentarios(ler(f))
  return /autoassign|autoAtribuir|distribuicaoAutomatica|distribuirAutomaticamente/i.test(src)
})
ok('§96) não existe autoassign no runtime', autoassign.length === 0, autoassign.join(', ') || 'nenhum')

const sugestao = semComentarios(ler('src/app/api/operacao/sugestao/route.ts'))
ok('§32) a recomendação é um GET', /export async function GET/.test(sugestao))
ok('§32) e não existe POST nela', !/export async function POST/.test(sugestao),
  'um POST sugeriria efeito; esta rota só opina')
ok('§76) a simulação não escreve nada',
  !/\b(prisma|tx)\s*\.\s*\w+\s*\.\s*(create|update|updateMany|upsert|delete)/.test(sugestao))
const elegibilidade = semComentarios(ler('lib/operacional/elegibilidade.ts'))
ok('§32/§76) o motor de elegibilidade também não escreve',
  !/\bprisma\s*\.\s*\w+\s*\.\s*(create|update|updateMany|upsert|delete)/.test(elegibilidade))

// ═══════════════════════════════════════════════════════════════════════════
secao('§9/§51) A CARGA TEM UMA DEFINIÇÃO SÓ')
// ═══════════════════════════════════════════════════════════════════════════
ok('§9) a classificação de carga é exportada de um lugar',
  /export function classificarCarga/.test(elegibilidade))
const capacidade = semComentarios(ler('src/app/api/operacao/capacidade/route.ts'))
ok('§9) a tela de capacidade consome essa definição', /classificarCarga\(/.test(capacidade))
ok('§9) e não refaz a contagem por conta própria',
  !/c\.executaveis\+\+/.test(capacidade) && !/carga\.set\(/.test(capacidade),
  'duas contagens da mesma coisa acabam divergindo, e o gestor vê dois números')
ok('§51) a tela de capacidade não cadastra equipe/cargo/departamento',
  !/grupoUsuario\.create|cargoCadastro|departamento\.create/i.test(capacidade),
  'ela CONSOME o cadastro; cadastrar de novo criaria uma segunda verdade')

console.log(`\n${'═'.repeat(70)}`)
console.log(`Total: ${passou + falhou} | ✅ ${passou} | ❌ ${falhou}`)
if (falhas.length) { console.log('\nFALHAS:'); for (const f of falhas) console.log(`  • ${f}`) }
console.log(falhou === 0
  ? 'Um prazo, uma carga, e distribuir continua sendo diferente de começar.'
  : 'Uma das duas fronteiras foi atravessada.')
process.exit(falhou > 0 ? 1 : 0)
