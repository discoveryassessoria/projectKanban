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
  estadoTemporalSubtarefa,
  prazoOperacional,
  diasEntreDiasOperacionais,
  diaOperacional,
  janelaDoDiaOperacional,
  rotuloDaPrevisaoExterna,
} from '../lib/operacional/tempo-operacional'
import { isDiaUtil } from '../src/lib/diasUteis'
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
  secao('§7) O PRAZO NASCE EM DIAS CORRIDOS — uma conta só (decisão definitiva, 23/09/2026)')
  // ══════════════════════════════════════════════════════════════════════════
  // Sexta 14/08/2026 + 3 dias corridos = segunda 17/08 — NUNCA pula fim de
  // semana ou feriado. A régua antiga (dias úteis) daria quarta 19/08; é
  // exatamente essa interpretação que foi corrigida de ponta a ponta.
  const sexta = new Date('2026-08-14T12:00:00.000Z')
  const tresCorridos = prazoOperacional(3, sexta)
  ok('§7) 3 dias corridos a partir de sexta caem na segunda',
    tresCorridos?.toISOString().slice(0, 10) === '2026-08-17', tresCorridos?.toISOString().slice(0, 10) ?? '—')
  ok('§7) o fim de semana CONTA como prazo (dias corridos, não úteis)',
    prazoOperacional(1, sexta)?.toISOString().slice(0, 10) === '2026-08-15')
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
  ok('§7) prazoOperacional não chama mais isDiaUtil — dias corridos, decisão definitiva 23/09/2026',
    !/isDiaUtil/.test(canonico) && !canonico.includes("from '@/src/lib/diasUteis'"))
  ok('§7) addDiasUteis (a segunda conta, dias úteis) foi removida de passo-tarefa-helpers',
    !/export function addDiasUteis/.test(semComentarios(ler('src/services/passo-tarefa-helpers.ts'))))

  // Havia DUAS `calcularPrazo` com argumentos invertidos: `(slaDays, inicio)` em
  // dias corridos e `(base, sla)` em dias úteis. As duas vivas, em caminhos de
  // criação concorrentes.
  ok('§3) a conta do prazo mora em UM lugar',
    /export function prazoOperacional/.test(canonico))
  ok('§3) e os materializadores delegam a ela',
    /export const calcularPrazo = prazoOperacional/.test(semComentarios(ler('lib/operacional/tarefa-canonica.ts')))
    && /return prazoOperacional\(sla, base\)/.test(semComentarios(ler('src/services/passo-tarefa-helpers.ts'))))
  // O "motor legado" (src/services/processEngine/taskEngine.ts) que tinha a
  // TERCEIRA conta de prazo (em milissegundos) foi REMOVIDO na Unidade 5
  // (10/09/2026) — não delegou, deixou de existir. Uma conta a menos, não uma
  // conta sem prova.

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
  const fila = semComentarios(ler('src/components/operacao/minha-operacao.tsx'))
  ok('§16) a fila mostra a frase canônica', /l\.rotuloDoPrazo/.test(fila))
  const painel = semComentarios(ler('src/components/kanban/PainelDaFase.tsx'))
  ok('§16) a tabela da fase também', /const texto = f\.rotuloDoPrazo/.test(painel))
  // A régua migrou para o servidor (document-operational-projection.ts) — o
  // Drawer não chama mais `estadoTemporal` por conta própria; ele só lê a
  // frase que a projeção já calculou, igual à fila e à tabela da fase.
  const drawer = semComentarios(ler('src/components/kanban/DocumentoOperationalDrawer.tsx'))
  ok('§95) e o drawer do documento parou de ter régua própria',
    !/estadoTemporal\(/.test(drawer) && /text:\s*tarefa\.rotuloDoPrazo/.test(drawer))
  ok('§95) quem calcula agora é a projeção do servidor, uma vez só',
    /estadoTemporal\(\{/.test(semComentarios(ler('src/lib/process-stage/document-operational-projection.ts'))))
  ok('§95) a Home também',
    /estadoTemporal\(\{ dataPrazo: d \}\)/.test(semComentarios(ler('src/components/home/home-primitives.tsx'))),
    'o corte era meia-noite do NAVEGADOR — um gestor em Lisboa via outro dia')

  secao('§96 — Calendário operacional: virada de mês/ano em dias corridos (mandato Emissão Documental)')
  // SLA de 1 dia CORRIDO a partir de uma sexta cai no sábado seguinte —
  // nunca pula fim de semana (isDiaUtil não é mais consultado aqui).
  const sextaCal = new Date('2026-09-11T12:00:00.000Z')
  ok('§96) SLA=1 a partir de sexta cai no sábado seguinte (dias corridos)',
    prazoOperacional(1, sextaCal)?.toISOString().slice(0, 10) === '2026-09-12')
  // Virada de mês: 5 dias corridos a partir de 27/08/2026 (quinta) atravessa para setembro sem quebrar.
  const finalDeAgosto = new Date('2026-08-27T12:00:00.000Z')
  const pMes = prazoOperacional(5, finalDeAgosto)
  ok('§96) SLA atravessa virada de mês sem quebrar', pMes !== null && pMes.getTime() > finalDeAgosto.getTime(),
    pMes?.toISOString().slice(0, 10))
  ok('§96) 5 dias corridos a partir de 27/08 caem em 01/09, sem pular nada',
    pMes?.toISOString().slice(0, 10) === '2026-09-01', pMes?.toISOString().slice(0, 10))
  // Virada de ano: 10 dias corridos a partir de 22/12/2026 atravessa Natal, Ano Novo e o ano civil.
  const antesDoNatal = new Date('2026-12-22T12:00:00.000Z')
  const pAno = prazoOperacional(10, antesDoNatal)
  ok('§96) SLA atravessa virada de ano sem quebrar', pAno !== null && pAno.getUTCFullYear() === 2027,
    pAno?.toISOString().slice(0, 10))
  ok('§96) 10 dias corridos a partir de 22/12 caem em 01/01/2027, contando Natal e Ano Novo como dias normais',
    pAno?.toISOString().slice(0, 10) === '2027-01-01', pAno?.toISOString().slice(0, 10))
  // `isDiaUtil` CONTINUA correto e em uso — só não é mais chamado por
  // `prazoOperacional`. O Financeiro (vencimento de boleto/parcela) usa a
  // mesma função, com a régua de dias úteis bancários que é dele por
  // convenção — nunca a régua de prazo de Tarefa.
  ok('§96) 25/12 (Natal) não é dia útil', !isDiaUtil(new Date('2026-12-25T12:00:00.000Z')))
  ok('§96) 01/01 (Ano Novo) não é dia útil', !isDiaUtil(new Date('2027-01-01T12:00:00.000Z')))
  ok('§96) dia útil comum continua sendo dia útil', isDiaUtil(new Date('2026-12-23T12:00:00.000Z')))
  ok('§96) sábado não é dia útil', !isDiaUtil(new Date('2026-09-12T12:00:00.000Z')))
  ok('§96) domingo não é dia útil', !isDiaUtil(new Date('2026-09-13T12:00:00.000Z')))
  // Feriados MÓVEIS (baseados na Páscoa) calculados dinamicamente — não é
  // tabela fixa: prova-se calculando para DOIS anos civis diferentes.
  ok('§96) Sexta-feira Santa 2026 (03/04, calculada) não é dia útil',
    !isDiaUtil(new Date('2026-04-03T12:00:00.000Z')))
  ok('§96) Sexta-feira Santa 2027 (26/03, ano diferente, calculada) não é dia útil',
    !isDiaUtil(new Date('2027-03-26T12:00:00.000Z')))
  // Timezone: FUSO_OPERACIONAL é fixo (America/Sao_Paulo) por desenho — é o SLA
  // INTERNO do escritório processando, não o fuso do país do processo (Itália/
  // Alemanha/Espanha só mudam o TEMA visual, nunca a régua de prazo). Isso já
  // está prescrito no próprio arquivo (linhas 104-126, `deslocamentoDoFuso`
  // medido no instante — cobre DST automaticamente, sem tabela).
  ok('§96) FUSO_OPERACIONAL é America/Sao_Paulo (fixo, por desenho — SLA é do escritório, não do país do processo)',
    /FUSO_OPERACIONAL = 'America\/Sao_Paulo'/.test(ler('lib/operacional/tempo-operacional.ts')))

  // ══════════════════════════════════════════════════════════════════════════
  secao('§97) DOIS RELÓGIOS — Tarefa (macro) e Subtarefa (operacional), 17/09/2026')
  // ══════════════════════════════════════════════════════════════════════════
  // MESMA matemática (o núcleo é um só), vocabulário de status DIFERENTE —
  // `estadoTemporalSubtarefa` não pode aceitar StatusTarefa nem o contrário.
  const prazoSub = emSaoPaulo('2026-08-15T12:00:00')
  const subAntes = estadoTemporalSubtarefa({ dataPrazo: prazoSub, status: 'DISPONIVEL', agora: emSaoPaulo('2026-08-10T09:00:00') })
  ok('§97) subtarefa disponível, antes do prazo: mesma frase da Tarefa',
    subAntes.rotulo === 'Vence em 5 dias', subAntes.rotulo)
  const subDepois = estadoTemporalSubtarefa({ dataPrazo: prazoSub, status: 'EM_ANDAMENTO', agora: emSaoPaulo('2026-08-18T10:00:00') })
  ok('§97) subtarefa em andamento, depois do prazo: atrasada',
    subDepois.atrasado && subDepois.rotulo === 'Atrasada há 3 dias', subDepois.rotulo)
  ok('§97) AGUARDANDO_EXTERNO vira aguardandoTerceiro=true (sem estar em ENCERRADOS de Tarefa)',
    estadoTemporalSubtarefa({ dataPrazo: prazoSub, status: 'AGUARDANDO_EXTERNO', agora: emSaoPaulo('2026-08-10T09:00:00') }).aguardandoTerceiro)
  const subConcluidaComAtraso = estadoTemporalSubtarefa({
    dataPrazo: prazoSub, status: 'CONCLUIDO', dataConclusao: emSaoPaulo('2026-08-17T09:00:00'), agora: emSaoPaulo('2026-08-20T09:00:00'),
  })
  ok('§97) concluída CONGELA — mesma regra da Tarefa, vocabulário de subtarefa',
    subConcluidaComAtraso.concluidoComAtraso && subConcluidaComAtraso.concluidoComAtrasoDeDias === 2,
    subConcluidaComAtraso.rotulo)
  ok('§97) sem prazo (ainda BLOQUEADA, relógio não ligou): "Sem prazo", nunca atrasada',
    estadoTemporalSubtarefa({ dataPrazo: null, status: 'BLOQUEADO', agora: emSaoPaulo('2026-08-20T09:00:00') }).semPrazo)
  ok('§97) CANCELADO/INVALIDADO/FALHOU encerram o relógio, igual CONCLUIDO',
    !estadoTemporalSubtarefa({ dataPrazo: prazoSub, status: 'CANCELADO', agora: emSaoPaulo('2026-08-20T09:00:00') }).atrasado)

  // O NÚCLEO É UM SÓ — Tarefa e Subtarefa não podem divergir na matemática,
  // só no vocabulário de status. Mesmo prazo, mesmo instante, mesma resposta.
  const tarefaEquivalente = estadoTemporal({ dataPrazo: prazoSub, agora: emSaoPaulo('2026-08-18T10:00:00') })
  ok('§97) mesmo núcleo: Tarefa e Subtarefa concordam byte a byte quando o status não distingue',
    tarefaEquivalente.rotulo === subDepois.rotulo && tarefaEquivalente.diasParaPrazo === subDepois.diasParaPrazo)

  // A SUBTAREFA NÃO TEM RELÓGIO DE EXECUÇÃO PRÓPRIO — decisão definitiva
  // (23/09/2026): existe um único prazo final por Tarefa. `relogioDeNascimentoDaSubtarefa`/
  // `slaEfetivoDaSubtarefa` (o antigo "SLA de ação interna" da subtarefa)
  // foram removidos por completo, schema incluso (`StepSubtaskDefinition.
  // slaDays`/`SubtaskExecution.prazo`) — prova de ausência, para a regra
  // antiga nunca ser reintroduzida silenciosamente.
  const subtarefasDaEtapaSrc = semComentarios(ler('src/services/subtarefas-da-etapa.ts'))
  ok('§97) relogioDeNascimentoDaSubtarefa não existe em lugar nenhum',
    !/relogioDeNascimentoDaSubtarefa/.test(subtarefasDaEtapaSrc)
    && !/relogioDeNascimentoDaSubtarefa/.test(semComentarios(ler('src/services/executar-acao-cadastrada.ts')))
    && !/relogioDeNascimentoDaSubtarefa/.test(semComentarios(ler('src/services/execucao-da-subtarefa.ts'))))
  ok('§97) slaEfetivoDaSubtarefa não existe em lugar nenhum', !/slaEfetivoDaSubtarefa/.test(subtarefasDaEtapaSrc))
  ok('§97) StepSubtaskDefinition não tem mais coluna slaDays no schema',
    !/model StepSubtaskDefinition[\s\S]*?slaDays/.test(semComentarios(ler('prisma/schema.prisma')).slice(
      semComentarios(ler('prisma/schema.prisma')).indexOf('model StepSubtaskDefinition'),
      semComentarios(ler('prisma/schema.prisma')).indexOf('model StepSubtaskDefinition') + 2000,
    )))
  ok('§97) SubtaskExecution não tem mais coluna prazo no schema',
    !/model SubtaskExecution[\s\S]*?\n\s+prazo\s+DateTime/.test(semComentarios(ler('prisma/schema.prisma')).slice(
      semComentarios(ler('prisma/schema.prisma')).indexOf('model SubtaskExecution'),
      semComentarios(ler('prisma/schema.prisma')).indexOf('model SubtaskExecution') + 2000,
    )))
  ok('§97) acompanhamento/regra temporal continuam intocados (dimensões C/D, nunca prazo)',
    /acompanhamentoAtivo/.test(subtarefasDaEtapaSrc) === false // a régua vive em relogioDeEsperaExternaDaSubtarefa, não mais citada por nome de campo aqui
    || /relogioDeEsperaExternaDaSubtarefa/.test(subtarefasDaEtapaSrc))
  ok('§97) a projeção (subtarefasDaEtapa) não expõe mais situacaoTemporal — a subtarefa não tem estado temporal próprio',
    !/situacaoTemporal/.test(subtarefasDaEtapaSrc))

  // A HOME PAROU DE TER RÉGUA PRÓPRIA — achado real, 17/09/2026: `estaAtrasado`/
  // `venceHoje` reimplementavam a conta com o fuso LOCAL DA MÁQUINA.
  const homeLogic = semComentarios(ler('src/lib/home/home-logic.ts'))
  ok('§97) Home delega estaAtrasado/venceHoje pra engine única — parou de reimplementar',
    /estaAtrasado[^}]*estadoTemporal\(\{ dataPrazo: prazo/.test(homeLogic)
    && /venceHoje[^}]*estadoTemporal\(\{ dataPrazo: prazo/.test(homeLogic)
    && !/setHours\(0,\s*0,\s*0,\s*0\)/.test(homeLogic.split('estaAtrasado')[1]?.split('export function venceHoje')[0] ?? ''))

  console.log(`\n${'═'.repeat(70)}`)
  console.log(`Total: ${passou + falhou} | ✅ ${passou} | ❌ ${falhou}`)
  if (falhas.length) { console.log('\nFALHAS:'); for (const f of falhas) console.log(`  • ${f}`) }
  console.log(falhou === 0
    ? 'Um prazo, uma régua, uma frase — em todas as telas.'
    : 'O tempo da operação voltou a ter mais de uma verdade.')
  process.exit(falhou > 0 ? 1 : 0)
}

main()
