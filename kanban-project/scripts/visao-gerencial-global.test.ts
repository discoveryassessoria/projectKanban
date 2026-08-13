// scripts/visao-gerencial-global.test.ts
// ============================================================================
// A VISÃO GERENCIAL GLOBAL — mesma Tarefa, outro alcance.
//
//   npx tsx scripts/visao-gerencial-global.test.ts
//
// O que este teste protege não é a tela: é a promessa de que ela não inventou
// uma segunda verdade sobre o trabalho. Três coisas, e são as três que a
// história deste sistema mostra que se perdem primeiro:
//
//   1. A COLUNA É DERIVADA. Não existe campo `coluna` no banco. Se um dia
//      existir, haverá duas respostas para "em que pé está esta tarefa".
//   2. O KANBAN GLOBAL NÃO É O WORKFLOW. Nenhuma coluna do quadro pode ter
//      nome de etapa: etapa vive DENTRO da tarefa, e já tem dono (o workflow).
//   3. NINGUÉM ESCREVE POR FORA. Arrastar um card executa COMANDO canônico —
//      não `prisma.tarefa.update`.
//
// Roda contra o banco de TESTE. Não toca em produção.
// ============================================================================
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { prisma } from '../lib/prisma'
import { exigirBancoDeTeste } from './_banco-de-teste'
import {
  colunaDaTarefa, visaoGerencial, indicadoresGerenciais, facetasGerenciais,
  COLUNAS_KANBAN, type ColunaKanban,
} from '../lib/operacional/tarefa-projecoes'
import { criarTarefaManual } from '../lib/operacional/tarefa-ciclo'
import { atribuirTarefa, iniciarTarefa } from '../lib/operacional/tarefa-comandos'

const RAIZ = join(__dirname, '..')
const ler = (p: string) => readFileSync(join(RAIZ, p), 'utf8')
const semComentarios = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

let passou = 0, falhou = 0
const falhas: string[] = []
const ok = (nome: string, cond: boolean, extra = '') => {
  if (cond) { passou++; console.log(`  ✅ ${nome}${extra ? ` — ${extra}` : ''}`) }
  else { falhou++; falhas.push(nome); console.log(`  ❌ ${nome}${extra ? ` — ${extra}` : ''}`) }
}
const secao = (t: string) => console.log(`\n${t}`)

async function main() {
  // O palco do §23 CRIA tarefas. Sem esta trava, apontar o script para o banco
  // errado encheria a operação real de trabalho fictício.
  exigirBancoDeTeste('monta o palco da visão gerencial global')
  console.log('A VISÃO GERENCIAL GLOBAL\n')

  // ══════════════════════════════════════════════════════════════════════════
  secao('§1/§5) A coluna é DERIVADA do estado canônico — não é estado novo')
  // ══════════════════════════════════════════════════════════════════════════
  const campos = Object.keys(prisma.tarefa.fields)
  ok('§5) não existe coluna `coluna` na Tarefa', !campos.some((f) => /^coluna|kanban|board/i.test(f)))
  ok('§5) não existe entidade de board/projeto', !Object.keys(prisma).some((k) => /^(board|quadro|coluna|projeto)/i.test(k)))

  // O mapeamento é total: todo estado canônico tem destino, e destino é coluna
  // ou "fora do quadro" — nunca undefined, que viraria card sumido.
  const ESTADOS = [
    'NAO_INICIADA', 'EM_ANDAMENTO', 'AGUARDANDO_CLIENTE', 'AGUARDANDO_TERCEIRO',
    'BLOQUEADA', 'CONCLUIDO_RECEBIDO', 'CONCLUIDO_NAO_POSSUI', 'CANCELADA', 'SUPERSEDIDA',
  ] as const
  for (const e of ESTADOS) {
    const c = colunaDaTarefa({ statusTarefa: e, responsavelId: 1 })
    ok(`§4) ${e} tem destino definido`, c === null || COLUNAS_KANBAN.includes(c), c ?? 'fora do quadro')
  }
  ok('§4) sem responsável vem antes de qualquer outro estado',
    colunaDaTarefa({ statusTarefa: 'EM_ANDAMENTO', responsavelId: null }) === 'SEM_RESPONSAVEL')
  ok('§4) cancelada NÃO é "concluída" — nada foi entregue',
    colunaDaTarefa({ statusTarefa: 'CANCELADA', responsavelId: 1 }) === null)
  ok('§4) supersedida também fica fora do quadro',
    colunaDaTarefa({ statusTarefa: 'SUPERSEDIDA', responsavelId: 1 }) === null)
  ok('§4) aguardando CLIENTE e TERCEIRO dividem coluna, e o estado continua distinto',
    colunaDaTarefa({ statusTarefa: 'AGUARDANDO_CLIENTE', responsavelId: 1 }) === 'AGUARDANDO_TERCEIRO' &&
    colunaDaTarefa({ statusTarefa: 'AGUARDANDO_TERCEIRO', responsavelId: 1 }) === 'AGUARDANDO_TERCEIRO')

  // ══════════════════════════════════════════════════════════════════════════
  secao('§5) KANBAN GLOBAL ≠ WORKFLOW INTERNO')
  // ══════════════════════════════════════════════════════════════════════════
  const tela = ler('src/components/operacao/visao-global.tsx')
  const ETAPAS_INTERNAS = ['Solicitar', 'Aguardar retorno', 'Receber', 'Conferir', 'Validar']
  const arrayDeColunas = tela.slice(tela.indexOf('const COLUNAS:'), tela.indexOf(']', tela.indexOf('const COLUNAS:')))
  const colunasDeclaradas = [...arrayDeColunas.matchAll(/rotulo:\s*"([^"]+)"/g)].map((m) => m[1])
  ok('§4) o quadro declara exatamente as seis colunas de ESTADO', colunasDeclaradas.length === 6,
    colunasDeclaradas.join(' | '))
  for (const etapa of ETAPAS_INTERNAS) {
    ok(`§5) nenhuma coluna se chama "${etapa}"`,
      !colunasDeclaradas.some((c) => c.toLowerCase().includes(etapa.toLowerCase())))
  }
  ok('§5) a tela mostra a ETAPA dentro do card, sem confundi-la com a coluna',
    /etapaAtual/.test(tela) && /Etapa:/.test(tela))

  // ══════════════════════════════════════════════════════════════════════════
  secao('§30) Zero writer operacional direto — inclusive no arrasto')
  // ══════════════════════════════════════════════════════════════════════════
  const codigoTela = semComentarios(tela)
  ok('§30) a tela não escreve na Tarefa', !/prisma\s*\.\s*tarefa\s*\.\s*(update|create|delete)/.test(codigoTela))
  ok('§30) a tela não escreve em passo', !/phaseWorkflowStepInstance/.test(codigoTela))
  ok('§30) toda mudança sai pela porta de comando',
    /\/api\/tarefas\/\$\{[^}]+\}\/comando/.test(codigoTela))
  // A rota de leitura precisa ser LEITURA: um POST aqui seria uma segunda porta.
  const rota = semComentarios(ler('src/app/api/operacao/visao-global/route.ts'))
  ok('§30) a rota da visão global só tem GET', /export async function GET/.test(rota) && !/export async function (POST|PATCH|PUT|DELETE)/.test(rota))
  ok('§19) e exige permissão de GESTÃO no backend', /verificarPermissao\(request, 'tarefas\.editar'\)/.test(rota))

  // ══════════════════════════════════════════════════════════════════════════
  secao('§11) Arrastar só onde existe comando canônico')
  // ══════════════════════════════════════════════════════════════════════════
  const arrastos = [...codigoTela.matchAll(/"([A-Z_]+)→([A-Z_]+)":\s*\{\s*acao:\s*"([a-z_]+)"/g)]
    .map((m) => ({ de: m[1], para: m[2], acao: m[3] }))
  ok('§11) existe um mapa explícito de arrastos permitidos', arrastos.length > 0, `${arrastos.length} transições`)
  const ACOES_DA_PORTA = [
    'iniciar', 'aguardar_terceiro', 'retomar_espera', 'bloquear', 'desbloquear',
    'devolver_a_fila', 'atribuir', 'transferir', 'concluir_etapa', 'reabrir', 'cancelar',
    'alterar_prazo', 'alterar_prioridade', 'adicionar_dependencia', 'remover_dependencia',
  ]
  for (const a of arrastos) {
    ok(`§11) ${a.de}→${a.para} usa comando existente (${a.acao})`, ACOES_DA_PORTA.includes(a.acao))
  }
  ok('§11) NADA arrasta para Concluída — tarefa conclui pelo último PASSO',
    !arrastos.some((a) => a.para === 'CONCLUIDA'))
  ok('§11) nada sai de Sem responsável arrastando — antes de andar, precisa de dono',
    !arrastos.some((a) => a.de === 'SEM_RESPONSAVEL'))
  ok('§11) colunas sem transição válida não aceitam o solto',
    /alvoValido/.test(codigoTela) && /arrastoDe\(/.test(codigoTela))

  // ══════════════════════════════════════════════════════════════════════════
  secao('§10/§9) Reúso, não reimplementação')
  // ══════════════════════════════════════════════════════════════════════════
  ok('§10) usa o MESMO seletor de responsável da Central', /SeletorResponsavel/.test(tela) && /from "\.\/kit-operacional"/.test(tela))
  // Clicar leva ao lugar canônico do trabalho — a Central Operacional do
  // processo. O painel local saiu: supervisionar não é executar.
  ok('§9) clicar leva à Central Operacional do processo', /urlOperacionalDaTarefa/.test(tela))
  ok('§9) e a visão global não monta executor', !/StepEditorRouter/.test(tela))
  ok('§9) e não existe um segundo modal de tarefa aqui',
    !/function\s+\w*Modal(Tarefa|Detalhe)/.test(codigoTela))
  const central = ler('src/components/operacao/central-tarefas.tsx')
  ok('§10) a Central passou a IMPORTAR o kit em vez de ter cópia própria',
    /from "\.\/kit-operacional"/.test(central) && !/function SeletorResponsavel\(/.test(central))

  // ══════════════════════════════════════════════════════════════════════════
  secao('§20) A leitura não faz N+1')
  // ══════════════════════════════════════════════════════════════════════════
  const proj = semComentarios(ler('lib/operacional/tarefa-projecoes.ts'))
  const corpo = proj.slice(proj.indexOf('export async function visaoGerencial'))
  ok('§20) a projeção não consulta dentro de um map', !/\.map\([^)]*async/.test(corpo))
  ok('§20) nome de pessoa vem em lote', /nomesDasPessoas\(/.test(corpo))
  ok('§20) e a página é paginada no banco', /skip:/.test(corpo) && /take:/.test(corpo))
  ok('§8) os indicadores contam no BANCO, não em memória',
    /prisma\.tarefa\.count/.test(proj.slice(proj.indexOf('export async function indicadoresGerenciais'))))

  // ══════════════════════════════════════════════════════════════════════════
  secao('§13/§14) Atraso e "vence hoje" são condições derivadas')
  // ══════════════════════════════════════════════════════════════════════════
  const enumStatus = ler('prisma/schema.prisma')
  const bloco = enumStatus.slice(enumStatus.indexOf('enum StatusTarefa'), enumStatus.indexOf('}', enumStatus.indexOf('enum StatusTarefa')))
  ok('§13) não existe status ATRASADA no domínio', !/ATRASAD/i.test(bloco))
  ok('§14) nem status VENCE_HOJE', !/VENCE/i.test(bloco))
  ok('§14) "vence hoje" usa o fuso operacional, não o do servidor',
    /America\/Sao_Paulo/.test(proj))

  // ══════════════════════════════════════════════════════════════════════════
  secao('§23) O palco: uma tarefa em cada estado, e cada uma na sua coluna')
  // ══════════════════════════════════════════════════════════════════════════
  const gestor = await prisma.usuario.findFirst({ where: { tipo: 'admin' }, select: { id: true } })
  const exec = await prisma.usuario.findFirst({ where: { tipo: { not: 'admin' } }, select: { id: true } })
  if (!gestor || !exec) {
    ok('§23) o banco de teste tem gestor e executor', false, 'sem usuários para montar o palco')
  } else try {
    const processo = await prisma.processo.findFirst({ select: { id: true } })
    const hoje = new Date()
    const ontem = new Date(hoje.getTime() - 86400000)
    const marca = `VG-${Date.now()}`

    // Cada tarefa nasce pela PORTA de criação e muda de estado pelas PORTAS —
    // montar o palco com `update` provaria a tela sobre dados que o motor nunca
    // produziria.
    const criar = async (titulo: string, prazo: Date | null, fase = 'emissao_documental') => {
      const r = await criarTarefaManual({
        titulo: `${marca} ${titulo}`, processoId: processo?.id ?? 0,
        autorId: gestor.id, dataPrazo: prazo, prioridade: 'MEDIA',
        faseMacroKey: fase,
        motivo: 'palco do teste da visão gerencial global',
        // Cinco tarefas do mesmo processo disparam a guarda de duplicidade, que
        // é exatamente o que ela existe para fazer. Aqui a repetição é
        // deliberada, e é o chamador quem afirma isso.
        confirmarDuplicidade: true,
      })
      if (!r.ok) throw new Error(`falhou criar "${titulo}": ${'error' in r ? r.error : '?'}`)
      return r.tarefaId
    }

    const semDono = await criar('sem responsável', null)
    const aFazer = await criar('a fazer', null)
    const andamento = await criar('em andamento', null)
    const atrasada = await criar('atrasada', ontem)
    const venceHoje = await criar('vence hoje', hoje)
    // Uma em OUTRA fase, para provar que o filtro de fase recorta de verdade.
    const outraFase = await criar('outra fase', ontem, 'analise_preliminar')

    for (const id of [aFazer, andamento, atrasada, venceHoje, outraFase]) {
      const a = await atribuirTarefa({ tarefaId: id, responsavelId: exec.id, autorId: gestor.id })
      if (!a.ok) throw new Error(`falhou atribuir #${id}`)
    }
    await iniciarTarefa({ tarefaId: andamento, autorId: exec.id })

    const { linhas } = await visaoGerencial({ busca: marca, porPagina: 50 })
    const de = (id: number) => linhas.find((l) => l.taskId === id)

    ok('§23) todas as tarefas do palco aparecem na visão global', linhas.length === 6, `${linhas.length} de 6`)
    ok('§23) sem responsável cai em SEM_RESPONSAVEL', de(semDono)?.coluna === 'SEM_RESPONSAVEL', de(semDono)?.coluna)
    ok('§23) atribuída e não iniciada cai em A_FAZER', de(aFazer)?.coluna === 'A_FAZER', de(aFazer)?.coluna)
    ok('§23) iniciada cai em EM_ANDAMENTO', de(andamento)?.coluna === 'EM_ANDAMENTO', de(andamento)?.coluna)
    ok('§13) prazo vencido marca atrasada — e o estado continua o dela',
      de(atrasada)?.atrasada === true && de(atrasada)?.coluna === 'A_FAZER',
      `${de(atrasada)?.coluna} · atrasada=${de(atrasada)?.atrasada}`)
    ok('§14) prazo de hoje marca vence hoje', de(venceHoje)?.venceHoje === true)
    ok('§14) e vencer hoje NÃO é estar atrasada', de(venceHoje)?.atrasada === false)

    // ── §25 IDENTIDADE ──────────────────────────────────────────────────────
    secao('§25) UMA tarefa, múltiplas projeções — o mesmo taskId em todas')
    const { minhaFila, semResponsavel } = await import('../lib/operacional/tarefa-projecoes')
    const fila = await minhaFila(exec.id)
    const sem = await semResponsavel()
    ok('§25) a tarefa iniciada tem o MESMO taskId na Minha Fila',
      fila.some((l) => l.taskId === andamento))
    ok('§25) a sem dono tem o MESMO taskId em Sem responsável',
      sem.some((l) => l.taskId === semDono))
    ok('§25) e a visão global mostra os dois com o mesmo id',
      de(andamento)?.taskId === andamento && de(semDono)?.taskId === semDono)
    ok('§1) nenhum id novo foi inventado pela visão global',
      linhas.every((l) => Number.isInteger(l.taskId) && l.taskId > 0))

    // ── §24 FILTROS COMBINADOS ──────────────────────────────────────────────
    secao('§24) Filtros combináveis, e limpar volta ao conjunto global')
    const porResponsavel = await visaoGerencial({ busca: marca, responsavelId: exec.id })
    ok('§24) filtrar por responsável recorta certo', porResponsavel.linhas.length === 5, `${porResponsavel.linhas.length}`)
    ok('§24) e a sem responsável some do recorte',
      !porResponsavel.linhas.some((l) => l.taskId === semDono))

    // §24 pede exatamente esta combinação tripla: pessoa + fase + atraso.
    const combinado = await visaoGerencial({
      busca: marca, responsavelId: exec.id, faseMacroKey: 'emissao_documental', atrasadas: true,
    })
    ok('§24) responsável + fase + atrasadas devolve SÓ a que satisfaz as três',
      combinado.linhas.length === 1 && combinado.linhas[0].taskId === atrasada,
      `${combinado.linhas.length} linha(s)`)
    ok('§24) a atrasada de OUTRA fase ficou de fora',
      !combinado.linhas.some((l) => l.taskId === outraFase))

    const semDonoFiltro = await visaoGerencial({ busca: marca, semResponsavel: true })
    ok('§24) filtrar por "sem responsável" devolve só ela',
      semDonoFiltro.linhas.length === 1 && semDonoFiltro.linhas[0].taskId === semDono)

    const limpo = await visaoGerencial({ busca: marca })
    ok('§24) limpar os filtros volta ao conjunto global', limpo.linhas.length === 6, `${limpo.linhas.length} de 6`)

    // ── §8 INDICADORES ──────────────────────────────────────────────────────
    secao('§8) Indicadores contam o mesmo universo que a lista mostra')
    const ind = await indicadoresGerenciais({ busca: marca })
    ok('§8) sem responsável', ind.semResponsavel === 1, String(ind.semResponsavel))
    ok('§8) em andamento', ind.emAndamento === 1, String(ind.emAndamento))
    ok('§8) atrasadas', ind.atrasadas === 2, String(ind.atrasadas))
    ok('§8) vence hoje', ind.venceHoje === 1, String(ind.venceHoje))
    ok('§8) e o total bate com a lista', ind.total === limpo.total, `${ind.total} × ${limpo.total}`)

    // ── §7 FACETAS ──────────────────────────────────────────────────────────
    const fac = await facetasGerenciais()
    ok('§7) as opções de FASE vêm do que existe, com contagem',
      fac.fases.some((f) => f.faseMacroKey === 'emissao_documental' && f.tarefas > 0))
    ok('§7) as opções de responsável vêm do que EXISTE',
      fac.responsaveis.some((r) => r.responsavelId === exec.id))
    ok('§7) com a carga junto, para decidir sabendo',
      fac.responsaveis.every((r) => Number.isInteger(r.tarefas)))

    // ── §12 ATRIBUIR PELO QUADRO ────────────────────────────────────────────
    secao('§12/§26) Atribuir pelo quadro: mesmo taskId, muda de coluna')
    const antes = de(semDono)
    const r = await atribuirTarefa({ tarefaId: semDono, responsavelId: exec.id, autorId: gestor.id })
    ok('§26) a porta canônica aceitou a atribuição', r.ok === true)
    const depois = (await visaoGerencial({ busca: marca })).linhas.find((l) => l.taskId === semDono)
    ok('§12) MESMO taskId', depois?.taskId === antes?.taskId)
    ok('§12) saiu de Sem responsável', depois?.coluna !== 'SEM_RESPONSAVEL', depois?.coluna)
    ok('§12) e apareceu no estado operacional correspondente', depois?.coluna === 'A_FAZER', depois?.coluna)
    ok('§26) a Minha Fila do executor já a enxerga',
      (await minhaFila(exec.id)).some((l) => l.taskId === semDono))
    const auditoria = await prisma.logAuditoria.count({
      where: { entidade: 'Tarefa', entidadeId: semDono, acao: { startsWith: 'TAREFA_ATRIBUIDA' } },
    })
    ok('§26) e a auditoria registrou UMA atribuição, não duas', auditoria === 1, `${auditoria} registro(s)`)

    // A limpeza roda mesmo se algo acima falhar: palco que não sai do lugar vira
    // ruído permanente na base de teste — e foi o que aconteceu nas primeiras
    // execuções, que deixaram tarefas VG- espalhadas pela tela.
    const ids = [semDono, aFazer, andamento, atrasada, venceHoje, outraFase]
    await prisma.logAuditoria.deleteMany({ where: { entidade: 'Tarefa', entidadeId: { in: ids } } })
    await prisma.tarefa.deleteMany({ where: { id: { in: ids } } })
  } finally {
    const restos = await prisma.tarefa.findMany({ where: { titulo: { startsWith: 'VG-' } }, select: { id: true } })
    const ids = restos.map((t) => t.id)
    if (ids.length) {
      await prisma.logAuditoria.deleteMany({ where: { entidade: 'Tarefa', entidadeId: { in: ids } } })
      await prisma.tarefa.deleteMany({ where: { id: { in: ids } } })
    }
  }

  console.log(`\n${'═'.repeat(70)}`)
  console.log(`Total: ${passou + falhou} | ✅ ${passou} | ❌ ${falhou}`)
  if (falhas.length) { console.log('\nFALHAS:'); for (const f of falhas) console.log(`  • ${f}`) }
  console.log(
    falhou === 0
      ? 'Uma tarefa, várias projeções: a visão global não criou uma segunda verdade.'
      : 'A visão global divergiu da tarefa canônica.',
  )
  await prisma.$disconnect()
  process.exit(falhou > 0 ? 1 : 0)
}

void main()
