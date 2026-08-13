// scripts/tempo-operacional.test.ts
// ============================================================================
// O TEMPO DA OPERAÇÃO — uma régua só, com relógio controlado.
//
//   npx tsx scripts/tempo-operacional.test.ts
//
// A mesma tarefa respondia coisas diferentes conforme a tela: a Minha Fila
// comparava o DIA no fuso da operação e a Central comparava blocos de 24 horas
// a partir do instante. Às 23h de 14/08, com prazo em 15/08 às 09h, uma dizia
// "vence amanhã" e a outra "vence hoje".
//
// Esta suíte fixa o relógio (nunca `sleep`) e prova a régua única: antes do
// prazo, no dia, depois, concluída antes, concluída depois, sem prazo, em
// espera externa. E prova que ninguém mais calcula prazo por conta própria.
// ============================================================================
import {
  estadoTemporal,
  prazoOperacional,
  diasEntreDiasOperacionais,
  diaOperacional,
  janelaDoDiaOperacional,
  rotuloDaPrevisaoExterna,
} from '../lib/operacional/tempo-operacional'
import { readFileSync, readdirSync, statSync } from 'node:fs'
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

/** Instante EM SÃO PAULO — o fuso em que a operação vive. */
const emSaoPaulo = (iso: string) => new Date(`${iso}-03:00`)

function main() {
  console.log('O TEMPO DA OPERAÇÃO — uma régua, todas as telas\n')

  // ══════════════════════════════════════════════════════════════════════════
  secao('§8/§72) O DIA É O DA OPERAÇÃO — não o do servidor, não o do navegador')
  // ══════════════════════════════════════════════════════════════════════════
  // 23h em São Paulo já é o dia seguinte em UTC. Se a régua fosse UTC, a
  // operação viraria o dia três horas antes de o expediente acabar.
  const noiteDeSp = emSaoPaulo('2026-08-14T23:30:00')
  ok('§8) 23h30 de 14/08 em São Paulo ainda é 14/08',
    diaOperacional(noiteDeSp) === '2026-08-14', diaOperacional(noiteDeSp))
  ok('§8) e a janela do dia começa à meia-noite DE LÁ',
    janelaDoDiaOperacional(noiteDeSp).inicio.toISOString() === '2026-08-14T03:00:00.000Z',
    janelaDoDiaOperacional(noiteDeSp).inicio.toISOString())

  // A DIFERENÇA QUE SEPARAVA AS DUAS TELAS.
  const prazoDeAmanha = emSaoPaulo('2026-08-15T09:00:00')
  ok('§8) às 23h30, prazo das 9h de amanhã é AMANHÃ',
    diasEntreDiasOperacionais(prazoDeAmanha, noiteDeSp) === 1,
    'a régua antiga de 24h dizia 0 — "vence hoje" — e as telas discordavam')

  // ══════════════════════════════════════════════════════════════════════════
  secao('§72) ANTES, NO DIA, DEPOIS — com relógio controlado')
  // ══════════════════════════════════════════════════════════════════════════
  const prazo = emSaoPaulo('2026-08-15T12:00:00')
  const antes = estadoTemporal({ dataPrazo: prazo, agora: emSaoPaulo('2026-08-10T09:00:00') })
  ok('§16) antes do prazo: "Vence em 5 dias"', antes.rotulo === 'Vence em 5 dias', antes.rotulo)
  ok('§13) e não está atrasada', !antes.atrasado && antes.tom === 'neutro')

  const vespera = estadoTemporal({ dataPrazo: prazo, agora: emSaoPaulo('2026-08-14T18:00:00') })
  ok('§16) na véspera: "Vence amanhã"', vespera.rotulo === 'Vence amanhã', vespera.rotulo)
  ok('§16) e o tom já é de alerta', vespera.tom === 'alerta')

  // O DIA DO VENCIMENTO NÃO É ATRASO. Um SLA de cinco dias vence NO DIA; dizer
  // "atrasada" às 8h da manhã do quinto dia tira do operador o dia inteiro que
  // ele ainda tem.
  const deManha = estadoTemporal({ dataPrazo: prazo, agora: emSaoPaulo('2026-08-15T08:00:00') })
  const deNoite = estadoTemporal({ dataPrazo: prazo, agora: emSaoPaulo('2026-08-15T23:00:00') })
  ok('§16) no dia: "Vence hoje" de manhã', deManha.rotulo === 'Vence hoje' && !deManha.atrasado)
  ok('§16) e AINDA "Vence hoje" às 23h', deNoite.rotulo === 'Vence hoje' && !deNoite.atrasado,
    'o dia acaba à meia-noite, não na hora gravada no prazo')

  const depois = estadoTemporal({ dataPrazo: prazo, agora: emSaoPaulo('2026-08-18T10:00:00') })
  ok('§13/§16) depois: "Atrasada há 3 dias"', depois.rotulo === 'Atrasada há 3 dias', depois.rotulo)
  ok('§13) atraso é condição derivada, com dias', depois.atrasado && depois.atrasadoHaDias === 3)
  ok('§16) singular no primeiro dia',
    estadoTemporal({ dataPrazo: prazo, agora: emSaoPaulo('2026-08-16T10:00:00') }).rotulo === 'Atrasada há 1 dia')

  // ══════════════════════════════════════════════════════════════════════════
  secao('§14) CONCLUIR CONGELA O RELÓGIO')
  // ══════════════════════════════════════════════════════════════════════════
  const noPrazo = estadoTemporal({
    dataPrazo: prazo, dataConclusao: emSaoPaulo('2026-08-14T16:00:00'),
    statusTarefa: 'CONCLUIDO_RECEBIDO', agora: emSaoPaulo('2026-09-30T10:00:00'),
  })
  ok('§14) concluída antes do prazo não atrasa nunca mais', !noPrazo.atrasado && noPrazo.rotulo === 'Concluída')

  const foraDoPrazo = estadoTemporal({
    dataPrazo: prazo, dataConclusao: emSaoPaulo('2026-08-17T16:00:00'),
    statusTarefa: 'CONCLUIDO_RECEBIDO', agora: emSaoPaulo('2026-09-30T10:00:00'),
  })
  ok('§14) concluída depois guarda o TAMANHO do atraso',
    foraDoPrazo.concluidoComAtraso && foraDoPrazo.concluidoComAtrasoDeDias === 2, foraDoPrazo.rotulo)
  ok('§14) e ele NÃO cresce com o calendário',
    estadoTemporal({
      dataPrazo: prazo, dataConclusao: emSaoPaulo('2026-08-17T16:00:00'),
      statusTarefa: 'CONCLUIDO_RECEBIDO', agora: emSaoPaulo('2027-01-01T10:00:00'),
    }).concluidoComAtrasoDeDias === 2,
    'o que aconteceu tem um tamanho; ele não aumenta porque o tempo passou')
  ok('§14) a tarefa concluída não conta como atrasada', !foraDoPrazo.atrasado)

  // ══════════════════════════════════════════════════════════════════════════
  secao('§16) SEM PRAZO É INFORMAÇÃO, NÃO OMISSÃO')
  // ══════════════════════════════════════════════════════════════════════════
  const semPrazo = estadoTemporal({ dataPrazo: null, agora: noiteDeSp })
  ok('§16) diz "Sem prazo"', semPrazo.rotulo === 'Sem prazo' && semPrazo.semPrazo)
  ok('§13) e sem prazo não existe atraso', !semPrazo.atrasado && semPrazo.diasParaPrazo === null,
    'inventar prazo para poder cobrar seria pior do que admitir que não há')

  // ══════════════════════════════════════════════════════════════════════════
  secao('§12) PREVISÃO DE TERCEIRO NÃO É PRAZO')
  // ══════════════════════════════════════════════════════════════════════════
  const comPrevisao = estadoTemporal({
    dataPrazo: prazo,
    previsaoExterna: emSaoPaulo('2026-09-20T12:00:00'),
    aguardandoTerceiro: true,
    agora: emSaoPaulo('2026-08-12T10:00:00'),
  })
  ok('§12) o prazo continua sendo o do escritório',
    comPrevisao.rotulo === 'Vence em 3 dias', comPrevisao.rotulo)
  ok('§12) a previsão do cartório vem ao lado, não no lugar',
    comPrevisao.previsaoExterna != null && comPrevisao.dueAt === prazo.toISOString())
  ok('§12) e ela tem frase própria',
    (rotuloDaPrevisaoExterna(emSaoPaulo('2026-09-20T12:00:00')) ?? '').startsWith('Retorno previsto'),
    rotuloDaPrevisaoExterna(emSaoPaulo('2026-09-20T12:00:00')) ?? '')
  ok('§10) e a espera externa é registrada como estado', comPrevisao.aguardandoTerceiro)

  // ══════════════════════════════════════════════════════════════════════════
  secao('§7) O PRAZO NASCE EM DIAS ÚTEIS — uma conta só')
  // ══════════════════════════════════════════════════════════════════════════
  // Sexta 14/08/2026 + 3 dias úteis = quarta 19/08. Contando corridos daria
  // segunda 17/08 — dois dias de trabalho a menos, silenciosamente.
  const sexta = new Date('2026-08-14T12:00:00.000Z')
  const tresUteis = prazoOperacional(3, sexta)
  ok('§7) 3 dias úteis a partir de sexta caem na quarta',
    tresUteis?.toISOString().slice(0, 10) === '2026-08-19', tresUteis?.toISOString().slice(0, 10) ?? '—')
  ok('§7) o fim de semana não conta como prazo',
    prazoOperacional(1, sexta)?.toISOString().slice(0, 10) === '2026-08-17')
  ok('§7) sem SLA não se inventa prazo', prazoOperacional(null, sexta) === null && prazoOperacional(0, sexta) === null)

  // ══════════════════════════════════════════════════════════════════════════
  secao('§3/§95) NINGUÉM MAIS CALCULA PRAZO POR CONTA PRÓPRIA')
  // ══════════════════════════════════════════════════════════════════════════
  const canonico = semComentarios(ler('lib/operacional/tempo-operacional.ts'))
  ok('§17) a projeção temporal é PURA — não consulta nada',
    !/prisma\./.test(canonico) && !/await /.test(canonico),
    'é por ser pura que ela pode ser a mesma em todas as telas')
  ok('§13) e nada aqui persiste estado temporal',
    !/\.(create|update|upsert)\(/.test(canonico))

  // Havia DUAS `calcularPrazo` com argumentos invertidos: `(slaDays, inicio)` em
  // dias corridos e `(base, sla)` em dias úteis. As duas vivas, em caminhos de
  // criação concorrentes.
  ok('§3) a conta do prazo mora em UM lugar',
    /export function prazoOperacional/.test(canonico))
  ok('§3) e os materializadores delegam a ela',
    /export const calcularPrazo = prazoOperacional/.test(semComentarios(ler('lib/operacional/tarefa-canonica.ts')))
    && /return prazoOperacional\(sla, base\)/.test(semComentarios(ler('src/services/passo-tarefa-helpers.ts'))))
  ok('§3) o motor legado também',
    /prazoOperacional\(spec\.slaDays/.test(semComentarios(ler('src/services/processEngine/taskEngine.ts'))),
    'era uma TERCEIRA conta, em milissegundos')

  // Varredura: ninguém somando dias em milissegundos para virar prazo.
  const varrer = (dir: string, acc: string[] = []): string[] => {
    for (const e of readdirSync(join(RAIZ, dir))) {
      if (e === 'node_modules' || e === '.next' || e.startsWith('.')) continue
      const rel = `${dir}/${e}`
      if (statSync(join(RAIZ, rel)).isDirectory()) varrer(rel, acc)
      else if (/\.(ts|tsx)$/.test(rel)) acc.push(rel)
    }
    return acc
  }
  const arquivos = [...varrer('src'), ...varrer('lib')]
  const PERMITIDOS = new Set([
    'lib/operacional/tempo-operacional.ts',   // a régua
    'lib/operacional/tarefa-ciclo.ts',        // pausa/retomada de SLA, em minutos
    'src/lib/motor/sla-core.ts',              // SLA do PROCESSO (outra camada, declarada)
    'src/lib/date-utils.ts',                  // utilitário de data, sem semântica de prazo
  ])
  const inventores = arquivos.filter((f) => {
    if (PERMITIDOS.has(f)) return false
    const src = semComentarios(ler(f))
    // Somar dias em milissegundos para PRODUZIR um prazo — o padrão que
    // espalhou três contas diferentes pelo sistema.
    return /dataPrazo[^\n]*86_?400_?000|86_?400_?000[^\n]*dataPrazo/.test(src)
  })
  ok('§3) ninguém mais fabrica prazo somando milissegundos',
    inventores.length === 0, inventores.join(', ') || 'nenhum')

  // A frase do prazo é do servidor; a tela escolhe a cor.
  const fila = semComentarios(ler('src/components/operacao/central-tarefas.tsx'))
  ok('§16) a fila mostra a frase canônica', /texto: l\.rotuloDoPrazo/.test(fila))
  const painel = semComentarios(ler('src/components/kanban/PainelDaFase.tsx'))
  ok('§16) a tabela da fase também', /const texto = f\.rotuloDoPrazo/.test(painel))
  ok('§95) e o drawer do documento parou de ter régua própria',
    /estadoTemporal\(\{ dataPrazo: prazo \}\)/.test(semComentarios(ler('src/components/kanban/DocumentoOperationalDrawer.tsx'))))
  ok('§95) a Home também',
    /estadoTemporal\(\{ dataPrazo: d \}\)/.test(semComentarios(ler('src/components/home/home-primitives.tsx'))),
    'o corte era meia-noite do NAVEGADOR — um gestor em Lisboa via outro dia')

  console.log(`\n${'═'.repeat(70)}`)
  console.log(`Total: ${passou + falhou} | ✅ ${passou} | ❌ ${falhou}`)
  if (falhas.length) { console.log('\nFALHAS:'); for (const f of falhas) console.log(`  • ${f}`) }
  console.log(falhou === 0
    ? 'Um prazo, uma régua, uma frase — em todas as telas.'
    : 'O tempo da operação voltou a ter mais de uma verdade.')
  process.exit(falhou > 0 ? 1 : 0)
}

main()
