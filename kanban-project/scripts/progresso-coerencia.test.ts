// scripts/progresso-coerencia.test.ts
// ============================================================================
// UMA OBRIGAÇÃO ABERTA IMPEDE A FASE DE SE DIZER CONCLUÍDA.
//
//   npm run test:progresso-coerencia
//
// Três níveis, três perguntas diferentes, e nenhuma delas pode responder pela
// outra:
//
//   DOCUMENTO  quanto do workflow DELE já andou            (0–100%, ponderado)
//   FASE       quantas obrigações estão INTEIRAS           (n de N)
//   PROCESSO   quanto do caminho aplicável já foi cumprido
//
// ─── O QUE ESTA SUÍTE EXISTE PARA IMPEDIR ───────────────────────────────────
// Em produção (processo 523, Genealogia) a mesma tela mostrou, ao mesmo tempo:
//
//   certidão 1/2 · "Localizar registro" em andamento
//   "1 de 1 documentos validados" · "Genealogia concluída" · 99%
//
// Não era um número errado: eram TRÊS predicados de conclusão diferentes
// respondendo à mesma pergunta. A tabela somava todos os passos obrigatórios da
// unidade; o progresso por necessidade olhava UM passo, ou aceitava
// `status = ATENDIDA`; o progresso por documento olhava só o passo de maior
// ordem. Com dois passos para a mesma obrigação — um concluído, outro aberto —
// cada projeção contou um deles.
//
// O 99% era a blindagem funcionando sobre uma conta que mentia: a fase não podia
// dizer 100% porque o gate bloqueava, e não sabia dizer outra coisa porque a
// contagem dela dizia que tudo acabou.
//
// LEITURA PURA. Nada aqui escreve; o núcleo é síncrono e não consulta banco.
// ============================================================================
import {
  buildOperationalProjection,
  computeGate,
  type GateStepData,
  type ProjectionInput,
} from '../src/lib/motor/operational-projection-core'
import {
  montarEstruturaOperacional,
  montarIndiceOperacional,
  type AlvoBruto,
  type PassoBruto,
} from '../src/lib/process-stage/estrutura-operacional-core'
import type { PessoaDoProcesso } from '../src/lib/process-stage/central-operacional-core'
import { readFileSync } from 'node:fs'
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

// ── PALCO PURO ──────────────────────────────────────────────────────────────
let seq = 1
function passo(p: Partial<GateStepData> & { status: string }): GateStepData {
  return {
    id: seq++, stepKey: p.stepKey ?? 'localizar_registro', ordem: p.ordem ?? 1,
    status: p.status, obrigatorio: p.obrigatorio ?? true, tipo: 'HUMANO', geraTarefa: true,
    documentoId: p.documentoId ?? null, necessidadeId: p.necessidadeId ?? null,
    bloqueadoManual: false, motivo: null, snapshot: null, dependeDeStepKeys: null, tarefas: [],
  }
}

function projecao(args: {
  scope: 'NECESSIDADE' | 'DOCUMENTO'
  steps: GateStepData[]
  necessidades: Array<{ id: number; status?: string; obrigatoria?: boolean; ehCertidao?: boolean }>
  documentos?: Array<{ id: number; necessidadeId: number | null }>
}) {
  const input: ProjectionInput = {
    processId: 1,
    faseCode: args.scope === 'NECESSIDADE' ? 'GENEALOGIA' : 'EMISSAO_DOCUMENTAL',
    faseMacroKey: args.scope === 'NECESSIDADE' ? 'genealogia' : 'emissao_documental',
    phaseName: null, scope: args.scope, processoExists: true, hasActiveInstance: true,
    steps: args.steps,
    necessidades: args.necessidades.map((n) => ({
      id: n.id, status: n.status ?? 'PENDENTE', obrigatoria: n.obrigatoria ?? true,
      ehCertidao: n.ehCertidao ?? true,
    })) as ProjectionInput['necessidades'],
    documentos: (args.documentos ?? []) as ProjectionInput['documentos'],
    hasArvore: true, requerentesCount: 1,
  }
  return { projecao: buildOperationalProjection(input), issues: computeGate(input) }
}

/** A MESMA obrigação vista pela tabela da fase — para comparar as duas leituras. */
function linhaDaCentral(statusDosPassos: string[], pesos?: number[]) {
  const necessidadeId = 900
  const passos: PassoBruto[] = statusDosPassos.map((status, i) => ({
    stepInstanceId: 7000 + i, stepDefinitionId: 100 + i, stepKey: `s${i}`, titulo: `Etapa ${i + 1}`,
    ordem: i + 1, obrigatorio: true, status, ciclo: 1, pessoaId: 1,
    necessidadeId, documentoId: 5000, responsavelId: null, responsavelNome: null,
    prazo: null, diasParaPrazo: null, slaDays: 3, motivo: null,
    executor: 'OPERACAO_DOCUMENTO', erroAdministrativo: null, dependeDeStepKeys: [],
    peso: pesos?.[i] ?? 1,
  }))
  const alvos: AlvoBruto[] = [{
    chave: `necessidade:${necessidadeId}`, escopo: 'NECESSIDADE', necessidadeId,
    documentoId: 5000, pessoaId: 1, titulo: 'Certidão', subtitulo: null, statusLabel: null, pais: null,
  }]
  const pessoas: PessoaDoProcesso[] = [{
    pessoaId: 1, nome: 'Ademir', iniciais: 'AD', geracao: 0, posicao: 'Requerente',
    requerente: true, classificacao: 'LINHA_PRINCIPAL', pendencia: null,
  } as PessoaDoProcesso]
  const idx = montarIndiceOperacional(montarEstruturaOperacional({ pessoas, passos, alvos }))
  return [...idx.linhaPrincipal, ...idx.foraDaLinha, ...idx.pendenteClassificacao]
    .flatMap((p) => p.documentos)[0]
}

function main() {
  console.log('PROGRESSO COERENTE — documento, fase e processo respondem coisas diferentes\n')

  // ══════════════════════════════════════════════════════════════════════════
  secao('§1/§2/§3) O DOCUMENTO: 0/2, 1/2 e 2/2')
  // ══════════════════════════════════════════════════════════════════════════
  const zero = linhaDaCentral(['DISPONIVEL', 'PENDENTE'])
  ok('§1) 0 de 2 não é documento concluído',
    zero.naFase.progresso.concluidos === 0 && zero.statusFinal !== 'PRONTO', zero.statusFinal)
  ok('§1) e o percentual é 0%', zero.naFase.progresso.pct === 0)

  const metade = linhaDaCentral(['CONCLUIDO', 'EM_ANDAMENTO'])
  ok('§2) 1 de 2 é parcial', metade.naFase.progresso.concluidos === 1 && metade.naFase.progresso.total === 2)
  ok('§2) com pesos iguais, 50%', metade.naFase.progresso.pct === 50, `${metade.naFase.progresso.pct}%`)
  ok('§2) e o documento NÃO está concluído', metade.statusFinal !== 'PRONTO', metade.statusFinal)
  ok('§2) a etapa atual é a que falta', metade.naFase.etapaAtual === 'Etapa 2', String(metade.naFase.etapaAtual))

  const inteiro = linhaDaCentral(['CONCLUIDO', 'CONCLUIDO'])
  ok('§3) 2 de 2 é documento concluído', inteiro.statusFinal === 'PRONTO')
  ok('§3) e 100%', inteiro.naFase.progresso.pct === 100)
  ok('§3) sem etapa atual — não há o que fazer', inteiro.naFase.etapaAtual === null)

  // O PESO PUBLICADO CONTINUA VALENDO (Item 1): 25+10 de 80 = 44%.
  const ponderado = linhaDaCentral(
    ['CONCLUIDO', 'CONCLUIDO', 'EM_ANDAMENTO', 'PENDENTE', 'PENDENTE'],
    [25, 10, 18, 15, 12],
  )
  ok('§2) o percentual ponderado do Item 1 continua intacto',
    ponderado.naFase.progresso.pct === 44 && ponderado.naFase.progresso.concluidos === 2,
    `${ponderado.naFase.progresso.pct}% · ${ponderado.naFase.progresso.concluidos}/${ponderado.naFase.progresso.total}`)

  // ══════════════════════════════════════════════════════════════════════════
  secao('§6/§7) ETAPA ABERTA IMPEDE A CONCLUSÃO — em qualquer estado não terminal')
  // ══════════════════════════════════════════════════════════════════════════
  for (const st of ['DISPONIVEL', 'EM_ANDAMENTO', 'AGUARDANDO', 'BLOQUEADO', 'PENDENTE', 'FALHOU']) {
    const r = projecao({
      scope: 'NECESSIDADE',
      steps: [passo({ status: 'CONCLUIDO', necessidadeId: 10 }), passo({ status: st, necessidadeId: 10, ordem: 2 })],
      necessidades: [{ id: 10 }],
    })
    ok(`§6) com uma etapa ${st}, a fase conta 0 de 1`,
      r.projecao.metrics.completed === 0 && r.projecao.metrics.required === 1,
      `${r.projecao.metrics.completed}/${r.projecao.metrics.required}`)
  }
  // EXECUTADO é trabalho entregue com aprovação pendente — o gate não o conta.
  const executado = projecao({
    scope: 'NECESSIDADE',
    steps: [passo({ status: 'EXECUTADO', necessidadeId: 11 })],
    necessidades: [{ id: 11 }],
  })
  ok('§6) EXECUTADO (aguardando aprovação) não conclui a obrigação',
    executado.projecao.metrics.completed === 0)
  const linhaExecutado = linhaDaCentral(['EXECUTADO'])
  ok('§6) e a TABELA usa a mesma régua — não diz 100%',
    linhaExecutado.naFase.progresso.pct !== 100 && linhaExecutado.statusFinal !== 'PRONTO',
    `${linhaExecutado.naFase.progresso.pct}% · ${linhaExecutado.statusFinal}`)

  // ══════════════════════════════════════════════════════════════════════════
  secao('O CASO ABELLAN — dois passos para a MESMA obrigação')
  // ══════════════════════════════════════════════════════════════════════════
  // Instância 300: `localizar_registro` da necessidade 190 existia DUAS vezes —
  // um CONCLUIDO (materializador do workflow publicado) e um DISPONIVEL
  // (materializador documental). E a necessidade estava ATENDIDA.
  const abellan = projecao({
    scope: 'NECESSIDADE',
    steps: [
      passo({ status: 'CONCLUIDO', necessidadeId: 190, documentoId: 2111 }),
      passo({ status: 'DISPONIVEL', necessidadeId: 190 }),
    ],
    necessidades: [{ id: 190, status: 'ATENDIDA' }],
    documentos: [{ id: 2111, necessidadeId: 190 }],
  })
  ok('a fase conta 0 de 1 — há obrigação com trabalho aberto',
    abellan.projecao.metrics.completed === 0 && abellan.projecao.metrics.required === 1,
    `${abellan.projecao.metrics.completed}/${abellan.projecao.metrics.required}`)
  ok('§ATENDIDA não é conclusão: "localizado" não é "workflow concluído"',
    abellan.projecao.metrics.completed === 0)
  ok('e o percentual NÃO é 99%', abellan.projecao.progress.percentage !== 99,
    `${abellan.projecao.progress.percentage}%`)
  ok('é 0%, que é o que a conta dá', abellan.projecao.progress.percentage === 0)
  ok('a fase não pode avançar', abellan.projecao.status.canAdvance === false)
  ok('e não se diz concluída', abellan.projecao.status.operationalState !== 'CONCLUIDA'
    && abellan.projecao.status.operationalState !== 'PRONTA_PARA_AVANCAR', abellan.projecao.status.operationalState)

  // ══════════════════════════════════════════════════════════════════════════
  secao('§4/§5/§16) 0/1 não conclui; 1/1 conclui — e só então 100%')
  // ══════════════════════════════════════════════════════════════════════════
  const umAberto = projecao({
    scope: 'NECESSIDADE', steps: [passo({ status: 'DISPONIVEL', necessidadeId: 20 })], necessidades: [{ id: 20 }],
  })
  ok('§4) 0 de 1 → fase não concluída', umAberto.projecao.metrics.completed === 0
    && umAberto.projecao.status.canAdvance === false)
  ok('§16) e nunca 100%', umAberto.projecao.progress.percentage < 100)

  const umFeito = projecao({
    scope: 'NECESSIDADE', steps: [passo({ status: 'CONCLUIDO', necessidadeId: 21 })], necessidades: [{ id: 21 }],
  })
  ok('§5) 1 de 1 → fase concluída', umFeito.projecao.metrics.completed === 1
    && umFeito.projecao.metrics.required === 1)
  ok('§16) e 100% significa 100%', umFeito.projecao.progress.percentage === 100)
  ok('§5) e o gate libera', umFeito.projecao.status.canAdvance === true)

  // OBRIGAÇÃO SEM PASSO NA FASE — aí, e só aí, o estado documental responde.
  const semPasso = projecao({
    scope: 'NECESSIDADE', steps: [], necessidades: [{ id: 22, status: 'ATENDIDA' }],
  })
  ok('obrigação sem passo nesta fase cai no estado documental',
    semPasso.projecao.metrics.completed === 1, 'não há workflow a consultar')
  const semPassoPendente = projecao({
    scope: 'NECESSIDADE', steps: [], necessidades: [{ id: 23, status: 'PENDENTE' }],
  })
  ok('e pendente continua pendente', semPassoPendente.projecao.metrics.completed === 0)

  // ══════════════════════════════════════════════════════════════════════════
  secao('§9) MÚLTIPLOS DOCUMENTOS — parcial nunca vira concluído')
  // ══════════════════════════════════════════════════════════════════════════
  // 10 obrigações: 3 concluídas, 2 em andamento, 2 a fazer, 1 aguardando
  // terceiro, 1 divergente (FALHOU) e 1 bloqueada.
  const muitos: GateStepData[] = []
  const necs: Array<{ id: number }> = []
  const cenario = [
    'CONCLUIDO', 'CONCLUIDO', 'CONCLUIDO',
    'EM_ANDAMENTO', 'EM_ANDAMENTO',
    'DISPONIVEL', 'DISPONIVEL',
    'AGUARDANDO', 'FALHOU', 'BLOQUEADO',
  ]
  cenario.forEach((st, i) => {
    const nec = 100 + i
    necs.push({ id: nec })
    muitos.push(passo({ status: st, necessidadeId: nec }))
  })
  const agregado = projecao({ scope: 'NECESSIDADE', steps: muitos, necessidades: necs })
  ok('§9) 3 de 10 concluídas', agregado.projecao.metrics.completed === 3
    && agregado.projecao.metrics.required === 10,
    `${agregado.projecao.metrics.completed}/${agregado.projecao.metrics.required}`)
  ok('§9) 30% — nem 0, nem 99, nem 100', agregado.projecao.progress.percentage === 30,
    `${agregado.projecao.progress.percentage}%`)
  ok('§9) e a fase não avança', agregado.projecao.status.canAdvance === false)

  // ══════════════════════════════════════════════════════════════════════════
  secao('§17) NENHUMA PROJEÇÃO DIZ CONCLUÍDO COM OBRIGAÇÃO ABERTA')
  // ══════════════════════════════════════════════════════════════════════════
  // O invariante lido dos dois lados: para o MESMO conjunto de passos, a conta da
  // fase e a leitura da tabela concordam sobre "acabou".
  const combinacoes: string[][] = [
    ['DISPONIVEL'], ['EM_ANDAMENTO'], ['AGUARDANDO'], ['BLOQUEADO'], ['FALHOU'], ['EXECUTADO'],
    ['CONCLUIDO'], ['CONCLUIDO', 'DISPONIVEL'], ['CONCLUIDO', 'CONCLUIDO'],
    ['DISPENSADO'], ['CONCLUIDO', 'DISPENSADO'],
  ]
  let divergencias = 0
  for (const combo of combinacoes) {
    const nec = 300 + divergencias
    const central = linhaDaCentral(combo)
    const fase = projecao({
      scope: 'NECESSIDADE',
      steps: combo.map((st, i) => passo({ status: st, necessidadeId: nec, ordem: i + 1 })),
      necessidades: [{ id: nec }],
    })
    const centralDiz = central.statusFinal === 'PRONTO'
    const faseDiz = fase.projecao.metrics.completed === 1
    if (centralDiz !== faseDiz) {
      divergencias++
      console.log(`     ↳ divergiu em [${combo.join(', ')}]: tabela=${centralDiz} fase=${faseDiz}`)
    }
  }
  ok('§17) tabela e fase concordam em TODAS as combinações', divergencias === 0, `${combinacoes.length} combinações`)

  // ══════════════════════════════════════════════════════════════════════════
  secao('PROIBIÇÃO DO 99% ARTIFICIAL')
  // ══════════════════════════════════════════════════════════════════════════
  const core = semComentarios(ler('src/lib/motor/operational-projection-core.ts'))
  ok('o teto de 99% existe SÓ como blindagem de bloqueio',
    (core.match(/99/g) ?? []).length <= 4, `${(core.match(/99/g) ?? []).length} ocorrência(s)`)
  ok('e ele nunca sobe um número — só impede 100 com gate fechado',
    /blocked\) percentage = Math\.min\(99, raw\)/.test(core))
  ok('não existe "quase concluído" em lugar nenhum',
    !/quase|almost|nearlyDone/i.test(core))
  // A blindagem só aparece quando há motivo: com tudo feito e gate aberto, 100%.
  ok('com gate aberto e tudo feito, 100% — sem reserva',
    umFeito.projecao.progress.percentage === 100)

  // ══════════════════════════════════════════════════════════════════════════
  secao('§13/§14) NENHUMA REGRA NOVA POR FASE — a correção é genérica')
  // ══════════════════════════════════════════════════════════════════════════
  ok('o núcleo não conhece Abellan, Ademir nem nomes de documento',
    !/abellan|ademir|daniela/i.test(core))
  ok('nem decide por chave de fase escrita à mão',
    !/faseMacroKey === ['"]genealogia['"]|faseCode === ['"]GENEALOGIA['"]/.test(core))
  ok('o predicado de conclusão é UM e recebe os passos da obrigação',
    /function obrigacaoConcluidaNaFase/.test(core)
    && (core.match(/obrigacaoConcluidaNaFase\(/g) ?? []).length >= 2,
    'usado pelos dois escopos')
  ok('e a régua de "passo feito" é exportada para a tela usar a MESMA',
    /export const PASSO_CONTA_COMO_FEITO/.test(core)
    && /PASSO_CONTA_COMO_FEITO/.test(semComentarios(ler('src/lib/process-stage/estrutura-operacional-core.ts'))))

  // ══════════════════════════════════════════════════════════════════════════
  secao('§14) DUAS INSTÂNCIAS DO MESMO PASSO NÃO NASCEM MAIS')
  // ══════════════════════════════════════════════════════════════════════════
  const genealogia = semComentarios(ler('src/services/genealogia/materializar-genealogia.ts'))
  ok('§14) o materializador documental procura pela IDENTIDADE, não pela string da chave',
    /findFirst\(\{[\s\S]{0,400}?necessidadeId: necessidade\.id/.test(genealogia))
  ok('§14) ignorando o que já foi supersedido ou cancelado',
    /status: \{ notIn: \["SUPERSEDIDO", "CANCELADO"\] \}/.test(genealogia))
  const publicado = semComentarios(ler('src/services/phase-workflow.ts'))
  ok('§14) e o materializador publicado continua convergindo pelo mesmo critério',
    /idLogica/.test(publicado))

  console.log(`\n${'═'.repeat(70)}`)
  console.log(`Total: ${passou + falhou} | ✅ ${passou} | ❌ ${falhou}`)
  if (falhas.length) { console.log('\nFALHAS:'); for (const f of falhas) console.log(`  • ${f}`) }
  console.log(falhou > 0 ? '\nAs projeções de progresso divergiram.' : '\nUma obrigação aberta impede a fase de se dizer concluída.')
  process.exit(falhou > 0 ? 1 : 0)
}

main()
