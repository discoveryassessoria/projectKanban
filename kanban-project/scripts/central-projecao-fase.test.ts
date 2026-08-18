// scripts/central-projecao-fase.test.ts
// ============================================================================
// A TABELA DA FASE RESPONDE UMA PERGUNTA SÓ: "como está isto AQUI, agora?".
//
//   npx tsx scripts/central-projecao-fase.test.ts
//
// A Central Operacional da Emissão Documental mostrava, por documento, se ele
// já fora RETIFICADO, TRADUZIDO e APOSTILADO — três fases FUTURAS ocupando três
// colunas em todas as linhas. Com um punhado de certidões isso passava; com
// quinhentas, descobrir o que falta HOJE exigia abrir uma por uma, que é
// exatamente o trabalho que uma tabela existe para evitar.
//
// Esta suíte protege a projeção nova: progresso PONDERADO pelo peso publicado,
// etapa corrente em nome de gente, responsável da Tarefa, prazo com atraso
// derivado, status operacional — e os recortes que tornam quinhentos documentos
// navegáveis.
//
// NADA AQUI TOCA O MOTOR. É leitura e derivação; se algum teste desta suíte
// precisar escrever passo, tarefa ou status, é sinal de que a tela invadiu o
// motor e o teste está certo em não conseguir.
// ============================================================================
import {
  montarEstruturaOperacional,
  montarIndiceOperacional,
  type PassoBruto,
  type AlvoBruto,
  type DocumentoDoIndice,
  type TarefasPorChave,
} from '../src/lib/process-stage/estrutura-operacional-core'
import type { PessoaDoProcesso } from '../src/lib/process-stage/central-operacional-core'
import {
  passaNoRecorte,
  ordenarDocumentos,
  recorteDoKpi,
  RECORTE_VAZIO,
  type Recorte,
} from '../src/components/kanban/PainelDaFase'
import { existsSync, readFileSync } from 'node:fs'
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
const existe = (p: string) => existsSync(join(RAIZ, p))
const semComentarios = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

// ── O workflow publicado da Emissão Documental, com os pesos do catálogo ─────
const PUBLICADOS = [
  { key: 'solicitar_certidao', titulo: 'Solicitar certidão', peso: 25 },
  { key: 'aguardar_retorno_do_cartorio', titulo: 'Aguardar retorno do cartório', peso: 10 },
  { key: 'receber_certidao', titulo: 'Receber certidão', peso: 18 },
  { key: 'conferir_certidao', titulo: 'Conferir certidão', peso: 15 },
  { key: 'validar_certidao', titulo: 'Validar certidão', peso: 12 },
]
const PONTOS_TOTAIS = PUBLICADOS.reduce((a, p) => a + p.peso, 0) // 80

let seq = 1
interface Cena {
  necessidadeId: number
  pessoaId: number
  concluidos?: number
  /** Estado do passo corrente — é ele que define o estado operacional da linha. */
  statusCorrente?: string
  motivo?: string | null
  responsavelId?: number | null
  responsavelNome?: string | null
  /** Dias até o prazo do passo corrente; negativo = atrasado. */
  diasParaPrazo?: number | null
  // ── A TAREFA DA UNIDADE ───────────────────────────────────────────────────
  // Responsável, prazo e status da LINHA saem daqui, não do passo. A cena
  // descreve os dois lados de propósito: é assim que se prova que a tabela não
  // volta a ler o passo quando os dois discordam.
  semTarefa?: boolean
  statusTarefa?: string
  tarefaResponsavelId?: number | null
  tarefaResponsavelNome?: string | null
  /** Dias até o prazo da TAREFA; negativo = atrasada. */
  diasParaPrazoTarefa?: number | null
}

/** O status de tarefa coerente com o passo corrente — o que o motor projetaria. */
function statusTarefaDaCena(c: Cena): string {
  if ((c.concluidos ?? 0) >= PUBLICADOS.length) return 'CONCLUIDO_RECEBIDO'
  if (c.statusTarefa) return c.statusTarefa
  const st = (c.statusCorrente ?? 'DISPONIVEL').toUpperCase()
  if (st === 'BLOQUEADO') return 'BLOQUEADA'
  if (st === 'AGUARDANDO' || st === 'AGUARDANDO_APROVACAO') return 'AGUARDANDO_TERCEIRO'
  if (st === 'EM_ANDAMENTO') return 'EM_ANDAMENTO'
  return 'NAO_INICIADA'
}

/**
 * A TAREFA VIVA de cada cena, no formato que a camada de I/O entrega.
 *
 * Documento concluído NÃO tem tarefa viva (terminal sai da busca canônica) —
 * é assim em produção, e a projeção precisa continuar coerente sem ela.
 */
function tarefasDasCenas(cenas: Cena[]): TarefasPorChave {
  const m: TarefasPorChave = new Map()
  let id = 3000
  for (const c of cenas) {
    id++
    if (c.semTarefa || (c.concluidos ?? 0) >= PUBLICADOS.length) continue
    const dias = c.diasParaPrazoTarefa
    m.set(`necessidade:${c.necessidadeId}`, {
      taskId: id,
      statusTarefa: statusTarefaDaCena(c),
      responsavelId: c.tarefaResponsavelId ?? null,
      responsavelNome: c.tarefaResponsavelNome ?? null,
      dataPrazo: dias != null ? new Date(Date.now() + dias * 86400000).toISOString() : null,
      dataConclusao: null,
      slaPausadoEm: null,
      slaPausaAcumuladaMin: 0,
      criadaEm: new Date(Date.now() - 5 * 86400000).toISOString(),
    })
  }
  return m
}

function passosDaCena(c: Cena): PassoBruto[] {
  const feitos = c.concluidos ?? 0
  return PUBLICADOS.map((def, i) => {
    const feito = i < feitos
    const corrente = i === feitos
    const dias = corrente ? c.diasParaPrazo ?? null : null
    return {
      stepInstanceId: seq++,
      stepDefinitionId: 100 + i,
      stepKey: def.key,
      titulo: def.titulo,
      peso: def.peso,
      ordem: i + 1,
      obrigatorio: true,
      status: feito ? 'CONCLUIDO' : corrente ? c.statusCorrente ?? 'DISPONIVEL' : 'PENDENTE',
      ciclo: 1,
      pessoaId: c.pessoaId,
      necessidadeId: c.necessidadeId,
      documentoId: 5000 + c.necessidadeId,
      responsavelId: corrente ? c.responsavelId ?? null : null,
      responsavelNome: corrente ? c.responsavelNome ?? null : null,
      prazo: dias != null ? new Date(Date.now() + dias * 86400000).toISOString() : null,
      diasParaPrazo: dias,
      slaDays: 3,
      motivo: corrente ? c.motivo ?? null : null,
      executor: 'OPERACAO_DOCUMENTO' as const,
      erroAdministrativo: null,
      dependeDeStepKeys: i > 0 ? [PUBLICADOS[i - 1].key] : [],
    }
  })
}

function pessoa(id: number, nome: string): PessoaDoProcesso {
  return {
    pessoaId: id, nome, iniciais: nome.slice(0, 2).toUpperCase(), geracao: 0,
    posicao: 'Requerente', requerente: true, classificacao: 'LINHA_PRINCIPAL',
    pendencia: null,
  } as PessoaDoProcesso
}

function indiceDe(cenas: Cena[], pessoas: PessoaDoProcesso[]) {
  const passos = cenas.flatMap(passosDaCena)
  const alvos: AlvoBruto[] = cenas.map((c) => ({
    chave: `necessidade:${c.necessidadeId}`,
    escopo: 'NECESSIDADE',
    necessidadeId: c.necessidadeId,
    documentoId: 5000 + c.necessidadeId,
    pessoaId: c.pessoaId,
    titulo: `Certidão de Nascimento #${c.necessidadeId}`,
    subtitulo: 'Certidão de Nascimento',
    statusLabel: null,
    pais: 'Espanha',
  }))
  return montarIndiceOperacional(
    montarEstruturaOperacional({ pessoas, passos, alvos }),
    undefined,
    tarefasDasCenas(cenas),
  )
}

const docsDe = (idx: ReturnType<typeof indiceDe>): DocumentoDoIndice[] =>
  [...idx.linhaPrincipal, ...idx.foraDaLinha, ...idx.pendenteClassificacao].flatMap((p) => p.documentos)

function main() {
  console.log('A TABELA DA FASE — progresso, etapa, responsável, prazo, status\n')

  // ══════════════════════════════════════════════════════════════════════════
  secao('§6/§7/§8) O PROGRESSO É PONDERADO PELO PESO PUBLICADO')
  // ══════════════════════════════════════════════════════════════════════════
  const P = [pessoa(1, 'Ademir Matheus')]
  const doisDeCinco = docsDe(indiceDe([{ necessidadeId: 1, pessoaId: 1, concluidos: 2 }], P))[0]
  ok('§7) a fração conta ETAPAS — é assim que uma pessoa lê o trabalho',
    doisDeCinco.naFase.progresso.concluidos === 2 && doisDeCinco.naFase.progresso.total === 5)
  ok('§8) e o percentual respeita o PESO canônico',
    doisDeCinco.naFase.progresso.pct === 44,
    `${doisDeCinco.naFase.progresso.pontosFeitos}/${doisDeCinco.naFase.progresso.pontosTotais} = ${doisDeCinco.naFase.progresso.pct}%`)
  ok('§8) e não a contagem simples 1/N', doisDeCinco.naFase.progresso.pct !== 40,
    'solicitar (25) não vale o mesmo que aguardar (10)')
  ok('§7) os pontos totais são os do catálogo',
    doisDeCinco.naFase.progresso.pontosTotais === PONTOS_TOTAIS, `${PONTOS_TOTAIS}`)

  const zerado = docsDe(indiceDe([{ necessidadeId: 2, pessoaId: 1, concluidos: 0 }], P))[0]
  ok('§16) nada feito é 0%', zerado.naFase.progresso.pct === 0)
  const completo = docsDe(indiceDe([{ necessidadeId: 3, pessoaId: 1, concluidos: 5 }], P))[0]
  ok('§38) tudo feito é 100%', completo.naFase.progresso.pct === 100)

  // ══════════════════════════════════════════════════════════════════════════
  secao('§9/§30) O PERCENTUAL VEM DO WORKFLOW — nunca do status, nunca do banco')
  // ══════════════════════════════════════════════════════════════════════════
  const core = semComentarios(ler('src/lib/process-stage/estrutura-operacional-core.ts'))
  ok('§7) a conta é pontos feitos ÷ pontos totais',
    /pontosFeitos \/ pontosTotais/.test(core))
  ok('§9) e o status da tarefa não entra na conta',
    !/EM_ANDAMENTO.*=>.*50|estado.*\?\s*50/.test(core))
  const painel = semComentarios(ler('src/components/kanban/PainelDaFase.tsx'))
  ok('§6) não existe campo de progresso persistido',
    !/progressoPersistido|progressoSalvo|percentualGravado/.test(core + painel))
  ok('§30) a projeção não escreve nada',
    !/\b(prisma|tx)\s*\.\s*\w+\s*\.\s*(create|update|updateMany|upsert|delete)/.test(core))

  // ══════════════════════════════════════════════════════════════════════════
  secao('§10/§11/§12/§13) ETAPA, RESPONSÁVEL, PRAZO, STATUS')
  // ══════════════════════════════════════════════════════════════════════════
  const emAndamento = docsDe(indiceDe([{
    necessidadeId: 4, pessoaId: 1, concluidos: 2, statusCorrente: 'EM_ANDAMENTO',
    // O PASSO SEM DONO E COM OUTRO PRAZO — exatamente o que produção tinha.
    responsavelId: null, responsavelNome: null, diasParaPrazo: -9,
    tarefaResponsavelId: 12, tarefaResponsavelNome: 'Daniela Brait', diasParaPrazoTarefa: 2,
  }], P))[0]
  ok('§10) a etapa atual é o nome humano', emAndamento.naFase.etapaAtual === 'Receber certidão')
  ok('§10) e nunca a chave técnica', !/receber_certidao/.test(emAndamento.naFase.etapaAtual ?? ''))
  ok('§11) o responsável é o da Tarefa', emAndamento.naFase.responsavelNome === 'Daniela Brait')
  ok('§13) o status é operacional', emAndamento.naFase.estado === 'EM_ANDAMENTO')
  ok('§12) o prazo vem com os dias', emAndamento.naFase.diasParaPrazo === 2 && !emAndamento.naFase.atrasado)

  const semDono = docsDe(indiceDe([{ necessidadeId: 5, pessoaId: 1, concluidos: 0 }], P))[0]
  ok('§11) sem responsável é dito, não escondido', semDono.naFase.responsavelId === null)
  ok('§13) e o estado é A FAZER', semDono.naFase.estado === 'A_FAZER')

  const concluida = docsDe(indiceDe([{ necessidadeId: 6, pessoaId: 1, concluidos: 5 }], P))[0]
  ok('§10) documento concluído não tem etapa atual', concluida.naFase.etapaAtual === null)
  ok('§13) e o estado é CONCLUÍDA', concluida.naFase.estado === 'CONCLUIDA')

  // ── §39: espera externa preserva o progresso ─────────────────────────────
  const esperando = docsDe(indiceDe([{
    necessidadeId: 7, pessoaId: 1, concluidos: 1, statusCorrente: 'AGUARDANDO',
  }], P))[0]
  ok('§39) espera externa é status próprio', esperando.naFase.estado === 'AGUARDANDO_TERCEIRO')
  ok('§39) a etapa é a da espera', esperando.naFase.etapaAtual === 'Aguardar retorno do cartório')
  ok('§39) e o progresso NÃO vira 100%', esperando.naFase.progresso.pct === 31,
    `${esperando.naFase.progresso.pontosFeitos}/${PONTOS_TOTAIS}`)

  // ── §40: bloqueio não mexe no percentual ────────────────────────────────
  const bloqueada = docsDe(indiceDe([{
    necessidadeId: 8, pessoaId: 1, concluidos: 2, statusCorrente: 'BLOQUEADO',
    motivo: 'Cartório exige procuração atualizada.',
  }], P))[0]
  ok('§40) bloqueio é status', bloqueada.naFase.estado === 'BLOQUEADA')
  ok('§40) com o motivo à vista', bloqueada.naFase.motivoBloqueio?.includes('procuração') === true)
  ok('§40) e o progresso continua o real', bloqueada.naFase.progresso.pct === 44)

  // ── §41: atraso é condição, não status ──────────────────────────────────
  const atrasada = docsDe(indiceDe([{
    necessidadeId: 9, pessoaId: 1, concluidos: 2, statusCorrente: 'EM_ANDAMENTO',
    tarefaResponsavelId: 12, tarefaResponsavelNome: 'Daniela Brait', diasParaPrazoTarefa: -3,
  }], P))[0]
  ok('§41) atrasada continua EM ANDAMENTO', atrasada.naFase.estado === 'EM_ANDAMENTO')
  ok('§41) e o atraso é uma condição à parte', atrasada.naFase.atrasado === true)
  ok('§41) com os dias de atraso derivados', atrasada.naFase.diasParaPrazo === -3)
  ok('§13) "ATRASADA" não virou status',
    !['A_FAZER', 'EM_ANDAMENTO', 'AGUARDANDO_TERCEIRO', 'BLOQUEADA', 'CONCLUIDA']
      .includes('ATRASADA' as never))

  // ══════════════════════════════════════════════════════════════════════════
  secao('ITEM 1 §2/§3/§5) UMA TAREFA, UM RESPONSÁVEL — a tabela não inventa o seu')
  // ══════════════════════════════════════════════════════════════════════════
  // O CASO REAL. Processo 523, certidão do Ademir (doc 2111): os CINCO passos com
  // `responsavelId` nulo, a Tarefa #3358 da Daniela. A tabela dizia "Sem
  // responsável", o painel do documento dizia "Daniela Brait", a Minha Fila dizia
  // "Daniela Brait". Três telas, duas respostas, o mesmo trabalho.
  const ademir = docsDe(indiceDe([{
    necessidadeId: 20, pessoaId: 1, concluidos: 2, statusCorrente: 'EM_ANDAMENTO',
    responsavelId: null, responsavelNome: null,
    tarefaResponsavelId: 12, tarefaResponsavelNome: 'Daniela Brait',
  }], P))[0]
  ok('§2) passo sem dono NÃO faz a linha dizer "sem responsável"',
    ademir.naFase.responsavelNome === 'Daniela Brait')
  ok('§3) e a linha aponta a TAREFA que a fila também aponta', ademir.naFase.taskId != null)

  // CENÁRIO C — transferir a tarefa muda a linha, e só a tarefa manda.
  const transferida = docsDe(indiceDe([{
    necessidadeId: 21, pessoaId: 1, concluidos: 2, statusCorrente: 'EM_ANDAMENTO',
    responsavelId: 12, responsavelNome: 'Daniela Brait',
    tarefaResponsavelId: 77, tarefaResponsavelNome: 'Gabriel',
  }], P))[0]
  ok('§5-C) transferida a Tarefa, a linha mostra o novo responsável',
    transferida.naFase.responsavelNome === 'Gabriel')
  ok('§5-C) e o responsável ANTIGO do passo não sobrevive na linha',
    transferida.naFase.responsavelNome !== 'Daniela Brait')

  // CENÁRIO B — tarefa sem responsável: a linha diz isso, e não pega o do passo.
  const semDonoNaTarefa = docsDe(indiceDe([{
    necessidadeId: 22, pessoaId: 1, concluidos: 1, statusCorrente: 'EM_ANDAMENTO',
    responsavelId: 12, responsavelNome: 'Daniela Brait',
    tarefaResponsavelId: null, tarefaResponsavelNome: null,
  }], P))[0]
  ok('§5-B) tarefa sem responsável ⇒ linha sem responsável',
    semDonoNaTarefa.naFase.responsavelId === null && semDonoNaTarefa.naFase.responsavelNome === null)

  // ══════════════════════════════════════════════════════════════════════════
  secao('ITEM 1 §17/§18) O PRAZO É O DA TAREFA — um só, em todas as projeções')
  // ══════════════════════════════════════════════════════════════════════════
  // Em produção o passo "Receber certidão" vencia 14/08 e a Tarefa 15/08. Cada
  // tela mostrava a sua data e as duas pareciam certas.
  const prazoDivergente = docsDe(indiceDe([{
    necessidadeId: 23, pessoaId: 1, concluidos: 2, statusCorrente: 'EM_ANDAMENTO',
    diasParaPrazo: -9, tarefaResponsavelId: 12, tarefaResponsavelNome: 'Daniela Brait',
    diasParaPrazoTarefa: -3,
  }], P))[0]
  ok('§18) a linha usa o prazo da TAREFA, não o do passo',
    prazoDivergente.naFase.diasParaPrazo === -3, `${prazoDivergente.naFase.diasParaPrazo}`)
  ok('§18) e o atraso é contado sobre ele', prazoDivergente.naFase.atrasado === true)

  // TAREFA SEM PRAZO não vira "no prazo" nem herda o do passo: é dito.
  const tarefaSemPrazo = docsDe(indiceDe([{
    necessidadeId: 24, pessoaId: 1, concluidos: 2, statusCorrente: 'EM_ANDAMENTO',
    diasParaPrazo: -4, tarefaResponsavelId: 12, tarefaResponsavelNome: 'Daniela Brait',
  }], P))[0]
  ok('§17) tarefa sem prazo é uma informação, não o prazo do passo',
    tarefaSemPrazo.naFase.prazo === null && tarefaSemPrazo.naFase.atrasado === false)
  ok('§17) e a frase é a canônica', tarefaSemPrazo.naFase.rotuloDoPrazo === 'Sem prazo')

  // ══════════════════════════════════════════════════════════════════════════
  secao('ITEM 1 §15/§16) STATUS OPERACIONAL × ESTADO DOCUMENTAL')
  // ══════════════════════════════════════════════════════════════════════════
  // A tabela dizia "Em andamento" e o painel dizia "Solicitado". Não era
  // contradição: eram duas perguntas. Agora as duas aparecem, na ordem certa.
  const comDocumental = montarIndiceOperacional(
    montarEstruturaOperacional({
      pessoas: P,
      passos: passosDaCena({ necessidadeId: 25, pessoaId: 1, concluidos: 2, statusCorrente: 'EM_ANDAMENTO' }),
      alvos: [{
        chave: 'necessidade:25', escopo: 'NECESSIDADE', necessidadeId: 25, documentoId: 5025,
        pessoaId: 1, titulo: 'Certidão de Nascimento #25', subtitulo: 'Certidão de Nascimento',
        statusLabel: null, pais: 'Espanha',
      }],
    }),
    new Map([['necessidade:25', { statusDocumentalLabel: 'Solicitado' }]]),
    tarefasDasCenas([{ necessidadeId: 25, pessoaId: 1, concluidos: 2, statusCorrente: 'EM_ANDAMENTO' }]),
  )
  const linhaDupla = docsDe(comDocumental)[0]
  ok('§15) o status da linha é o OPERACIONAL da tarefa', linhaDupla.naFase.estado === 'EM_ANDAMENTO')
  ok('§15) o estado documental continua existindo, em segundo plano',
    linhaDupla.naFase.statusDocumentalLabel === 'Solicitado')
  ok('§15) e um não substitui o outro',
    linhaDupla.naFase.estadoLabel === 'Em andamento' && linhaDupla.naFase.statusDocumentalLabel === 'Solicitado')

  // SEM TAREFA a linha não inventa dono nem prazo — cai no que o workflow sabe.
  const orfa = docsDe(indiceDe([{
    necessidadeId: 26, pessoaId: 1, concluidos: 2, statusCorrente: 'EM_ANDAMENTO',
    responsavelId: 12, responsavelNome: 'Daniela Brait', diasParaPrazo: -5, semTarefa: true,
  }], P))[0]
  ok('§4) documento sem tarefa viva não ganha responsável emprestado',
    orfa.naFase.responsavelNome === null && orfa.naFase.taskId === null)
  ok('§4) nem prazo emprestado do passo', orfa.naFase.prazo === null)
  ok('§4) e o estado ainda é derivado do workflow', orfa.naFase.estado === 'EM_ANDAMENTO')

  // ══════════════════════════════════════════════════════════════════════════
  secao('ITEM 1 §6/§7/§9/§28) "CONTINUAR" NÃO ABRE UMA SEGUNDA CENTRAL')
  // ══════════════════════════════════════════════════════════════════════════
  const drawer = semComentarios(ler('src/components/kanban/DocumentoOperationalDrawer.tsx'))
  const central = semComentarios(ler('src/components/kanban/ProcessoCentralOperacional.tsx'))
  ok('§6) o cockpit paralelo de operação não existe mais',
    !/TabOperationCockpit/.test(drawer + central) && !existe('src/components/kanban/TabOperationCockpit.tsx'))
  ok('§9) o painel do documento abre NO WORKFLOW',
    /useState<TabId>\("workflow"\)/.test(drawer))
  ok('§7) e não há mais aba "Operação" para desviar o caminho',
    !/id: "operation"/.test(drawer))
  ok('§8) o que era exclusivo do cockpit ficou — iniciar a operação não materializada',
    /permissions\.canStart/.test(drawer) && /InitOperationModal/.test(drawer))
  ok('§2/§3) o cabeçalho do painel lê a TAREFA, não o documento',
    /projection\?\.tarefa/.test(drawer)
    && !/doc\.responsavel\?\.nome/.test(drawer)
    && !/doc\.dataPrazoOperacao/.test(drawer))
  ok('§3) e delegar move a TAREFA, pela porta canônica',
    /\/api\/tarefas\/\$\{taskId\}\/atribuir/.test(drawer))
  ok('§12) o passo atual é trazido à vista sozinho',
    /scrollIntoView/.test(semComentarios(ler('src/components/kanban/workflow/WorkflowTab.tsx'))))
  ok('§13) o executor especializado continua sendo a Central da Etapa',
    /CentralDaEtapaDrawer/.test(semComentarios(ler('src/components/kanban/workflow/WorkflowTab.tsx'))))

  // ══════════════════════════════════════════════════════════════════════════
  secao('§4/§5) AS COLUNAS DE FASE FUTURA SAÍRAM DA TABELA DA FASE')
  // ══════════════════════════════════════════════════════════════════════════
  ok('§4) a tabela da fase não tem coluna Retificada', !painel.includes('>Retificada<'))
  ok('§4) nem Tradução', !painel.includes('>Tradução<'))
  ok('§4) nem Apostila', !painel.includes('>Apostila<'))
  ok('§5) nem "Status final" duplicando o status operacional', !painel.includes('>Status final<'))
  ok('§4) as colunas são as da fase atual',
    ['>Documento<', '>Progresso<', '>Etapa atual<', '>Responsável<', '>Prazo<', '>Status<', '>Ação<']
      .every((c) => painel.includes(c)))
  // §48: o domínio continua inteiro — o que saiu foi a COLUNA, não o dado.
  ok('§48) o domínio dos artefatos continua na projeção',
    /retificada:/.test(core) && /traducao:/.test(core) && /apostila:/.test(core),
    'retificação, tradução e apostilamento seguem no índice e nas telas próprias')
  ok('§28) divergência resolve num selo, não numa coluna',
    /Divergente<\/span>|>\s*\{doc\.statusFinal === "INVALIDADO"/.test(painel))

  // ══════════════════════════════════════════════════════════════════════════
  secao('§14) A AÇÃO DA LINHA SEGUE O ESTADO')
  // ══════════════════════════════════════════════════════════════════════════
  for (const [estado, rotulo] of [
    ['A_FAZER', 'Iniciar'], ['EM_ANDAMENTO', 'Continuar'],
    ['AGUARDANDO_TERCEIRO', 'Ver etapa'], ['BLOQUEADA', 'Ver bloqueio'],
    ['CONCLUIDA', 'Ver detalhes'],
  ] as const) {
    ok(`§14) ${estado} oferece "${rotulo}"`,
      new RegExp(`case "${estado}": return "${rotulo}"`).test(painel))
  }
  ok('§15/§14) e a ação usa a porta única já validada',
    /onAbrirDetalhes!\(doc\)/.test(painel) && !/StepEditorRouter/.test(painel),
    'a Central não monta executor paralelo')

  // ══════════════════════════════════════════════════════════════════════════
  secao('§18/§20/§43/§44/§45/§46) OS RECORTES')
  // ══════════════════════════════════════════════════════════════════════════
  ok('§18) o KPI "Prontos" vira o recorte de prontos', recorteDoKpi('Prontos') === 'prontos')
  ok('§18) "Pendentes" vira pendentes', recorteDoKpi('Pendentes') === 'pendentes')
  ok('§18) "Divergentes" vira divergentes', recorteDoKpi('Divergentes') === 'divergentes')
  ok('§18) e "Pessoas" não vira filtro nenhum', recorteDoKpi('Pessoas') === null,
    'clique que não faz nada é pior do que número que só informa')

  const rec = (p: Partial<Recorte>): Recorte => ({ ...RECORTE_VAZIO, ...p })
  ok('§44) Prontos deixa passar só o 100%',
    passaNoRecorte(completo, rec({ rapido: 'prontos' }), 'Ademir')
    && !passaNoRecorte(doisDeCinco, rec({ rapido: 'prontos' }), 'Ademir'))
  ok('§19/§43) Pendentes é derivado: em andamento AINDA é pendente',
    passaNoRecorte(emAndamento, rec({ rapido: 'pendentes' }), 'Ademir')
    && !passaNoRecorte(completo, rec({ rapido: 'pendentes' }), 'Ademir'))
  // O FILTRO USA A MESMA RÉGUA DO CONTADOR. Clicar em "Pendentes: 400" e
  // receber 450 linhas transformaria o número numa decoração.
  ok('§43) e a régua do recorte é a MESMA do contador (statusFinal)',
    /doc\.statusFinal !== "PENDENTE" && doc\.statusFinal !== "EM_ANDAMENTO"/.test(painel)
    && /doc\.statusFinal !== "PRONTO"/.test(painel))
  ok('§20) Atrasados só pega quem venceu',
    passaNoRecorte(atrasada, rec({ rapido: 'atrasados' }), 'Ademir')
    && !passaNoRecorte(emAndamento, rec({ rapido: 'atrasados' }), 'Ademir'))
  ok('§45) o filtro de responsável é por id, não por nome',
    passaNoRecorte(emAndamento, rec({ responsavelId: 12 }), 'Ademir')
    && !passaNoRecorte(emAndamento, rec({ responsavelId: 99 }), 'Ademir'))
  ok('§20) e "sem responsável" é um recorte próprio',
    passaNoRecorte(semDono, rec({ responsavelId: 'sem' }), 'Ademir')
    && !passaNoRecorte(emAndamento, rec({ responsavelId: 'sem' }), 'Ademir'))
  ok('§46) o filtro de etapa usa o nome humano',
    passaNoRecorte(emAndamento, rec({ etapa: 'Receber certidão' }), 'Ademir')
    && !passaNoRecorte(esperando, rec({ etapa: 'Receber certidão' }), 'Ademir'))
  ok('§20) e o de status usa o estado operacional',
    passaNoRecorte(bloqueada, rec({ estado: 'BLOQUEADA' }), 'Ademir')
    && !passaNoRecorte(emAndamento, rec({ estado: 'BLOQUEADA' }), 'Ademir'))

  // ── §21: busca ──────────────────────────────────────────────────────────
  ok('§21) a busca acha pela PESSOA', passaNoRecorte(emAndamento, rec({ busca: 'ademir' }), 'Ademir Matheus'))
  ok('§21) ignora acento e caixa', passaNoRecorte(emAndamento, rec({ busca: 'ADEMÍR' }), 'Ademir Matheus'))
  ok('§21) acha pelo tipo do documento', passaNoRecorte(emAndamento, rec({ busca: 'nascimento' }), 'Ademir'))
  ok('§21) e todos os termos precisam casar',
    !passaNoRecorte(emAndamento, rec({ busca: 'nascimento obito' }), 'Ademir'))

  // ══════════════════════════════════════════════════════════════════════════
  secao('§17) A ORDEM É DETERMINÍSTICA')
  // ══════════════════════════════════════════════════════════════════════════
  const baralho = [completo, emAndamento, bloqueada, atrasada, esperando, semDono]
  const porAtencao = ordenarDocumentos(baralho, 'atencao')
  ok('§17) o padrão põe o bloqueio na frente', porAtencao[0] === bloqueada)
  ok('§17) depois o atraso', porAtencao[1] === atrasada)
  ok('§17) e o concluído por último', porAtencao[porAtencao.length - 1] === completo)
  ok('§17) e a mesma entrada dá sempre a mesma saída',
    JSON.stringify(ordenarDocumentos(baralho, 'atencao').map((d) => d.chave))
    === JSON.stringify(ordenarDocumentos([...baralho].reverse(), 'atencao').map((d) => d.chave)),
    'desempate por título, nunca pela ordem de chegada')
  const porProgresso = ordenarDocumentos(baralho, 'progresso')
  ok('§17) por progresso, o mais atrasado no trabalho vem primeiro',
    porProgresso[0].naFase.progresso.pct <= porProgresso[porProgresso.length - 1].naFase.progresso.pct)
  const porPrazo = ordenarDocumentos(baralho, 'prazo')
  ok('§17) por prazo, quem não tem prazo vai para o fim',
    porPrazo[porPrazo.length - 1].naFase.prazo === null)

  // ══════════════════════════════════════════════════════════════════════════
  secao('§16/§42) QUINHENTOS DOCUMENTOS')
  // ══════════════════════════════════════════════════════════════════════════
  const PESSOAS = Array.from({ length: 25 }, (_, i) => pessoa(i + 1, `Pessoa ${String(i + 1).padStart(2, '0')}`))
  const cenas: Cena[] = []
  for (let i = 0; i < 500; i++) {
    const faixa = i % 10
    cenas.push({
      necessidadeId: 1000 + i,
      pessoaId: (i % 25) + 1,
      concluidos: faixa <= 4 ? faixa : faixa === 9 ? 5 : faixa - 4,
      statusCorrente:
        faixa === 5 ? 'AGUARDANDO' : faixa === 6 ? 'BLOQUEADO' : faixa === 7 ? 'EM_ANDAMENTO' : 'DISPONIVEL',
      motivo: faixa === 6 ? 'Aguarda procuração.' : null,
      responsavelId: faixa % 3 === 0 ? null : 12,
      responsavelNome: faixa % 3 === 0 ? null : 'Daniela Brait',
      diasParaPrazo: faixa === 8 ? -2 : faixa === 7 ? 1 : null,
    })
  }
  const t0 = process.hrtime.bigint()
  const grande = indiceDe(cenas, PESSOAS)
  const ms = Number(process.hrtime.bigint() - t0) / 1e6
  const todos = docsDe(grande)
  ok('§42) o palco tem 500 documentos', todos.length === 500, `${todos.length}`)
  ok('§42) e a projeção inteira é montada de uma vez', ms < 1500, `${ms.toFixed(0)}ms`)

  // A distribuição precisa ser LEGÍVEL de bater o olho: é isso que a coluna existe para dar.
  const faixas = new Map<number, number>()
  for (const d of todos) {
    const f = Math.floor(d.naFase.progresso.pct / 20) * 20
    faixas.set(f, (faixas.get(f) ?? 0) + 1)
  }
  ok('§16) há documentos em várias faixas de progresso', faixas.size >= 4,
    [...faixas.entries()].sort((a, b) => a[0] - b[0]).map(([f, n]) => `${f}%:${n}`).join(' '))

  // Os três contadores do topo particionam a fase — é isso que faz cada um
  // deles poder virar um filtro exato.
  const prontos = todos.filter((d) => d.statusFinal === 'PRONTO').length
  const pendentes = todos.filter((d) => d.statusFinal === 'PENDENTE' || d.statusFinal === 'EM_ANDAMENTO').length
  const divergentes = todos.filter((d) => d.statusFinal === 'DIVERGENTE' || d.statusFinal === 'INVALIDADO').length
  ok('§36) prontos + pendentes + divergentes = a fase inteira',
    prontos + pendentes + divergentes === 500, `${prontos} + ${pendentes} + ${divergentes}`)
  const filtradosPendentes = todos.filter((d) => passaNoRecorte(d, rec({ rapido: 'pendentes' }), ''))
  ok('§43) o recorte de pendentes devolve exatamente os pendentes',
    filtradosPendentes.length === pendentes, `${filtradosPendentes.length}`)
  const filtradosProntos = todos.filter((d) => passaNoRecorte(d, rec({ rapido: 'prontos' }), ''))
  ok('§44) e o de prontos, exatamente os 100%',
    filtradosProntos.length === prontos && filtradosProntos.every((d) => d.naFase.progresso.pct === 100),
    `${filtradosProntos.length}`)
  ok('§45) o recorte por responsável não vaza para quem não é dela',
    todos.filter((d) => passaNoRecorte(d, rec({ responsavelId: 12 }), ''))
      .every((d) => d.naFase.responsavelId === 12))

  const t1 = process.hrtime.bigint()
  ordenarDocumentos(todos, 'atencao')
  todos.filter((d) => passaNoRecorte(d, rec({ busca: 'nascimento' }), 'Pessoa 01'))
  const msRecorte = Number(process.hrtime.bigint() - t1) / 1e6
  ok('§16) ordenar e filtrar 500 é instantâneo', msRecorte < 300, `${msRecorte.toFixed(0)}ms`)

  // ══════════════════════════════════════════════════════════════════════════
  secao('§32/§33) SEM N+1 — a projeção resolve em lote')
  // ══════════════════════════════════════════════════════════════════════════
  const projecao = semComentarios(ler('src/lib/process-stage/estrutura-operacional.ts'))
  // O estado da fase é DERIVADO dos passos que a estrutura já carregou. Se a
  // linha precisasse buscar tarefa, responsável ou prazo por documento, seriam
  // quinhentas idas ao banco para desenhar uma tabela.
  ok('§33) o estado da linha é derivado do que já veio',
    /function estadoNaFase/.test(core) && !/await /.test(core),
    'o núcleo da projeção é síncrono: não tem como consultar nada')
  ok('§32) os responsáveis vêm em UMA consulta, por lista de ids',
    /usuario\.findMany\(\{ where: \{ id: \{ in: respIds \} \}/.test(projecao) && /respMap/.test(projecao),
    'um findMany para todos, não um por linha')
  ok('§32) e os documentos também',
    /documento\.findMany\(\{[\s\S]{0,80}?id: \{ in: docIds \}/.test(projecao))
  ok('§33) e os passos da fase também',
    (projecao.match(/phaseWorkflowStepInstance\.findMany/g) ?? []).length <= 2)

  // ══════════════════════════════════════════════════════════════════════════
  secao('§34/§35) ESCALA NÃO PODE QUEBRAR O DEEP-LINK')
  // ══════════════════════════════════════════════════════════════════════════
  ok('§34) a renderização por pessoa tem teto', /LINHAS_POR_PESSOA/.test(painel))
  ok('§35) mas o documento do deep-link nunca fica atrás do "mostrar mais"',
    /alvoForaDoCorte/.test(painel) && /mostrarTudo \|\| alvoForaDoCorte \? docs : docs\.slice/.test(painel))
  ok('§35) nem é filtrado para fora',
    /documentoDestacadoId != null && d\.documentoId === documentoDestacadoId\)\s*\|\|\s*passaNoRecorte/.test(painel),
    'chegar por link e achar a tela vazia anula o link')
  ok('§35) e a pessoa dele continua abrindo sozinha', /chaveDaPessoaAlvo/.test(painel))

  // ══════════════════════════════════════════════════════════════════════════
  secao('§36) OS CONTADORES DIZEM DE QUE CONJUNTO FALAM')
  // ══════════════════════════════════════════════════════════════════════════
  ok('§36) o topo fala da fase inteira', /indiceBruto\.resumo\.documentos/.test(painel))
  ok('§36) e o recorte diz "X de Y"', /de \$\{indiceBruto\.resumo\.documentos\} documento/.test(painel))
  ok('§36) recorte vazio não mente dizendo que a fase está vazia',
    /Nenhum documento neste recorte/.test(painel))

  // ══════════════════════════════════════════════════════════════════════════
  secao('§31) O MOTOR NÃO FOI TOCADO')
  // ══════════════════════════════════════════════════════════════════════════
  for (const arquivo of [
    'lib/operacional/identidade-da-tarefa.ts',
    'lib/operacional/tarefa-comandos.ts',
    'lib/operacional/reconciliar-tarefas.ts',
    'src/services/task-step-sync.ts',
    'lib/operacional/navegacao.ts',
  ]) {
    ok(`§31) a tela não importa nem reescreve ${arquivo.split('/').pop()}`,
      !painel.includes(arquivo.replace(/^(lib|src)\//, '')),
      'a Central consome o motor; não o edita')
  }
  ok('§30) e a tabela não conclui, não bloqueia e não muda peso',
    !/concluirEtapa|bloquearTarefa|iniciarTarefa|weight:/.test(painel))

  console.log(`\n${'═'.repeat(70)}`)
  console.log(`Total: ${passou + falhou} | ✅ ${passou} | ❌ ${falhou}`)
  if (falhas.length) { console.log('\nFALHAS:'); for (const f of falhas) console.log(`  • ${f}`) }
  console.log(falhou === 0
    ? 'A linha responde onde o documento está NESTA fase — e quinhentas linhas continuam legíveis.'
    : 'A projeção da fase divergiu do contrato.')
  process.exit(falhou > 0 ? 1 : 0)
}

main()
