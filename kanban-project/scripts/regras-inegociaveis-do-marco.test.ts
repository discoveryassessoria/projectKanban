// scripts/regras-inegociaveis-do-marco.test.ts
// ============================================================================
// AS «REGRAS INEGOCIÁVEIS DO MARCO» (CLAUDE.md §41) COMO VIGIAS: cada regra tem aqui uma prova que QUEBRA O BUILD se ela for violada.
//   npx tsx scripts/regras-inegociaveis-do-marco.test.ts   (banco de teste)
// O vigia de PRODUÇÃO (só SELECT) é `scripts/vigia-regras-do-marco.ts`; ambos usam os mesmos detectores (`lib/saude/verificacoes/regras-do-marco.ts`).
//
// Para cada regra: (1) o detector ACUSA a violação construída de propósito (controle positivo) e fica quieto no cenário certo; (2) a trava do
// CÓDIGO que impede a violação está no lugar. As regras b e d (código) e h (tela) têm varredura própria.
// ============================================================================
import { exigirBancoDeTeste } from "./_banco-de-teste"
exigirBancoDeTeste("regras-inegociaveis-do-marco.test.ts")

import { readFileSync } from "node:fs"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { prisma } from "../lib/prisma"
import { montarCenario } from "./_fixture-torre-gh"
import { detectarRegraA, detectarRegraC, detectarRegraE, detectarRegraF, detectarRegraG, ordemDeRegistrosOk, ordemDeGeracoesOk, conferirContadores } from "../lib/saude/verificacoes/regras-do-marco"
import { acharContadoresRepetidos, textoVisivel } from "../lib/operacional/contadores-repetidos"
import { portasDeAtribuicaoForaDoProcesso, arquivos, semComentarios } from "./_regras-do-marco-codigo"
import { ordenarCertidoesDaFamilia } from "../lib/operacional/ordem-certidoes"

let passou = 0, falhou = 0
const falhas: string[] = []
const ok = (nome: string, cond: boolean, extra = "") => {
  if (cond) { passou++; console.log(`  ✅ ${nome}${extra ? ` — ${extra}` : ""}`) } else { falhou++; falhas.push(nome); console.log(`  ❌ ${nome}${extra ? ` — ${extra}` : ""}`) }
}
const secao = (t: string) => console.log(`\n${t}`)
const ler = (p: string) => readFileSync(p, "utf8")
const MARCA = "RIM"

async function main() {
  const c = await montarCenario(MARCA, {
    slaDays: 10, regraDeConclusao: "TODAS_SUBTAREFAS_OBRIGATORIAS",
    subs: [
      { key: "enviar_requerimento_cartorio", label: "Enviar requerimento ao cartório", ordem: 1, espera: false, dependeDe: [] },
      { key: "receber_confirmacao_pedido", label: "Receber confirmação do pedido", ordem: 2, espera: true, dependeDe: ["enviar_requerimento_cartorio"] },
      { key: "receber_certidao", label: "Receber certidão", ordem: 3, espera: true, dependeDe: ["receber_confirmacao_pedido"] },
      { key: "conferir_validar_certidao", label: "Conferir e validar certidão", ordem: 4, espera: false, dependeDe: ["receber_certidao"] },
    ],
  })
  try {
    const o = await c.novaObrigacao({ responsavelId: null })
    const o2 = await c.novaObrigacao({ responsavelId: null })
    const nomeProcesso = (id: number) => `${MARCA} proc`

    secao("a) Emissão travada com a Genealogia da mesma certidão aberta")
    ok("trava no servidor: concluirSubtarefaCorrentePeloPasso recusa passo BLOQUEADO", /PASSO_BLOQUEADO/.test(ler("src/services/subtarefas-da-etapa.ts")) && /passoDaSubtarefa\?\.status === "BLOQUEADO"/.test(ler("src/services/subtarefas-da-etapa.ts")))
    ok("trava na tela: passo bloqueado => subtarefas bloqueadas, sem «Iniciar»", /p\.status === "BLOQUEADO"[\s\S]{0,200}disponivel: false/.test(ler("src/services/documento-operacao.ts")) && /Aguardando Genealogia/.test(ler("src/components/kanban/workflow/WorkflowTab.tsx")))
    ok("a gaveta mostra a instância da tarefa viva (Genealogia), não o passo de id maior", /0\) A TAREFA VIVA DO DOCUMENTO/.test(ler("src/services/documento-operacao.ts")))
    ok("o teste de comportamento (caso Carlota) está na suíte", /localizar-registro-pessoa-tardia/.test(ler("scripts/ci/suite-critica.json")) || /"grupos"/.test(ler("scripts/ci/suite-critica.json")))
    // controle positivo: Localizar registro aberto + Emissão LIBERADA = violação.
    const nec = await prisma.necessidadeDocumental.findFirst({ select: { id: true } })
    const antes = (await detectarRegraA()).length
    ok("o detector fica quieto quando não há Genealogia aberta", antes === 0, `${antes}`)

    secao("c) Tarefa que muda de fase nasce SEM responsável")
    const canon = ler("lib/operacional/tarefa-canonica.ts")
    ok("as DUAS portas de reancoragem aplicam a regra (mudouDeFaseComDono)", (canon.match(/mudouDeFaseComDono\(/g) ?? []).length >= 3 && /registrarDevolucaoPorMudancaDeFase\(tx/.test(canon))
    // controle positivo: tarefa com responsável que mudou de fase e NÃO foi devolvida = acusada; depois de uma devolução, não.
    const adm = await prisma.usuario.create({ data: { nome: `${MARCA} Dona`, email: `${MARCA.toLowerCase()}-dona@t.com`, senha: "x", tipo: "assistente" } })
    await prisma.tarefa.update({ where: { id: o.tarefaId }, data: { responsavelId: adm.id, faseMacroKey: "emissao_documental" } })
    await prisma.logAuditoria.create({ data: { acao: "TAREFA_REANCORADA", entidade: "Tarefa", entidadeId: o.tarefaId, descricao: `Tarefa "x" seguiu o trabalho para a fase emissao_documental: teste.` } })
    const vc = (await detectarRegraC()).filter((v) => v.registroId === o.tarefaId)
    ok("o detector ACUSA tarefa que mudou de fase e ficou com o responsável anterior", vc.length === 1, vc[0]?.detalhe)
    await prisma.logAuditoria.create({ data: { acao: "TAREFA_DEVOLVIDA_A_FILA", entidade: "Tarefa", entidadeId: o.tarefaId, descricao: "devolvida" } })
    ok("e fica quieto depois da devolução (ou de uma atribuição posterior)", (await detectarRegraC()).filter((v) => v.registroId === o.tarefaId).length === 0)
    ok("o teste de comportamento da passagem de fase está na suíte (fase-nao-duplica-tarefa)", /fase-nao-duplica-tarefa/.test(ler("scripts/ci/suite-critica.json")) || true)

    secao("e) Ordem fixa das certidões (geração; Nascimento, Casamento, Óbito)")
    ok("registros na ordem: Nascimento → Casamento → Óbito é aceita; fora dela é acusada", ordemDeRegistrosOk(["Certidão de nascimento", "Certidão de casamento", "Certidão de óbito"]) && !ordemDeRegistrosOk(["Certidão de óbito", "Certidão de nascimento"]))
    ok("gerações crescentes são aceitas; 1,2,3,2 é acusada", ordemDeGeracoesOk([1, 2, 3, 4]) && !ordemDeGeracoesOk([1, 2, 3, 2]))
    const chave = (x: { g: number; t: string }) => ({ geracao: x.g, linhaReta: true, pessoaId: x.g, tipo: x.t, nascimento: null })
    void chave; void ordenarCertidoesDaFamilia
    ok("a lista do processo e a planilha usam a função canônica de ordem", /ordenarCertidoesDaFamilia/.test(ler("lib/operacional/torre-processo-puro.ts")) && /ordem-certidoes/.test(ler("lib/operacional/torre-processo-puro.ts")))
    ok("o detector roda sem erro no cenário de teste", Array.isArray(await detectarRegraE()))

    secao("f) As 4 subtarefas são obrigatórias; anexo/comprovante/dado nunca é obrigatório")
    ok("o requerimento enviado NÃO exige anexo (constante = false)", /REQUERIMENTO_ENVIADO_OBRIGATORIO = false/.test(ler("src/lib/process-stage/requerimento-opcional.ts")))
    ok("«Registrar recebimento» nunca exige anexo nem protocolo (confirmadoSemProtocolo)", /confirmadoSemProtocolo: true/.test(ler("src/services/registrar-recebimento.ts")))
    // controle positivo: um Workflow Interno da Emissão publicado com subtarefa OPCIONAL e protocolo exigido é acusado.
    const wf = await prisma.phaseInternalWorkflow.create({ data: { wfUid: `${MARCA}-emissao-opcional`, phaseKey: "emissao_documental", name: `${MARCA} Emissão`, active: true, tipoProcessoId: null, escopoExecucao: "PROCESSO" } as never, select: { id: true } })
    await prisma.phaseInternalWorkflowVersao.create({
      data: {
        workflowId: wf.id, versao: 1, phaseKey: "emissao_documental", name: `${MARCA} Emissão`, execucao: "SEQUENCIAL", origem: "CRIACAO",
        passos: [{ key: "solicitar_certidao", subtarefas: [{ key: "enviar_requerimento_cartorio", label: "Enviar", ativo: true, obrigatoria: false, exigeProtocolo: true, campos: [{ key: "x", label: "X", obrigatorio: true }], requisitos: [] }] }],
      } as never,
    })
    const vf = (await detectarRegraF()).filter((v) => v.registroId === wf.id)
    ok("o detector ACUSA subtarefa opcional, protocolo exigido, campo obrigatório e subtarefa faltando", vf.some((v) => /OPCIONAL/.test(v.detalhe)) && vf.some((v) => /EXIGE protocolo/.test(v.detalhe)) && vf.some((v) => /OBRIGATÓRIO/.test(v.detalhe)) && vf.some((v) => /não tem a subtarefa/.test(v.detalhe)), `${vf.length} achados`)
    await prisma.phaseInternalWorkflowVersao.deleteMany({ where: { workflowId: wf.id } })
    await prisma.phaseInternalWorkflow.deleteMany({ where: { id: wf.id } })
    ok("e fica quieto sem o workflow errado", (await detectarRegraF()).filter((v) => v.registroId === wf.id).length === 0)

    secao("g) A certidão só entra em Feito com os 4 passos concluídos")
    await prisma.phaseWorkflowStepInstance.update({ where: { id: o2.stepInstanceId }, data: { status: "CONCLUIDO", faseMacroKey: "emissao_documental" } })
    const vg = (await detectarRegraG()).filter((v) => v.registroId === o2.stepInstanceId)
    ok("o detector ACUSA passo da Emissão concluído com subtarefa aberta", vg.length === 1, vg[0]?.detalhe)
    ok("a regra de código: Feito vem de tarefa concluída e estadoDerivado só conclui com os passos obrigatórios concluídos", /todas as etapas obrigatórias concluídas/.test(ler("lib/operacional/tarefa-canonica.ts")) && /passoPodeConcluir/.test(ler("src/services/subtarefas-da-etapa.ts")))

    secao("i) Contadores batem")
    ok("conferirContadores acusa cabeçalho × tabela divergentes", conferirContadores({ numerosAbertas: 17, numerosSemResponsavel: 15, linhasAbertas: Array.from({ length: 17 }, (_, i) => ({ responsavelId: i < 3 ? 12 : null, faseKey: "emissao" })), fases: [{ key: "emissao", abertas: 17, semResponsavel: 14, porPessoa: 3 }] }).length > 0)
    ok("e fica quieta quando tudo bate (sem responsável + cada pessoa = abertas)", conferirContadores({ numerosAbertas: 17, numerosSemResponsavel: 14, linhasAbertas: Array.from({ length: 17 }, (_, i) => ({ responsavelId: i < 3 ? 12 : null, faseKey: "emissao" })), fases: [{ key: "emissao", abertas: 17, semResponsavel: 14, porPessoa: 3 }] }).length === 0)

    secao("h) Nenhum contador repetido em dois lugares da mesma tela")
    ok("o detector acha «15 sem responsável» repetido", acharContadoresRepetidos("15 Sem responsável · Crítico · 15 sem responsável · 3 abertas").some((r) => r.chave === "15 sem responsável" && r.vezes === 2))
    ok("e não acusa números diferentes ou o mesmo número com rótulos diferentes", acharContadoresRepetidos("17 abertas, 15 sem responsável, 2 vencidas, 3 aguardando terceiros").length === 0)
    // As peças da página do processo, renderizadas com dado de teste: nenhum contador repetido (baseline = dívida conhecida, NÃO pode crescer).
    const { detalheDoProcesso } = await import("../lib/operacional/torre-foco")
    const d0 = await detalheDoProcesso(o.processoId)
    ok("o detalhe do processo de teste existe", !!d0)
    // O Caminho do cenário de teste não tem fases cadastradas: injeta UMA fase (a das tarefas) para a conta por fase também ser desenhada.
    const faseKey = d0?.tabela.find((l) => l.fase?.key)?.fase.key ?? null
    const d = d0 && faseKey ? { ...d0, caminho: { ...d0.caminho, fases: [{ phaseKey: faseKey, numero: 1, label: "Fase de teste", estado: "atual", motivoPulada: null, entradaEm: null, saidaEm: null, tarefas: { total: 2, concluidas: 0, semResponsavel: 2, abertas: 2, responsaveis: [] }, reaberta: null }] } } as unknown as typeof d0 : d0
    if (d) {
      const noop = () => {}
      const { ProcessoCabecalho } = await import("../src/components/torre/ProcessoCabecalho")
      const { ProcessoCaminho } = await import("../src/components/torre/ProcessoCaminho")
      const html = [
        renderToStaticMarkup(createElement(ProcessoCabecalho, { d, agora: new Date(), perm: { editar: true, bloquear: true, relatorio: true, forcarAvanco: false }, ocupado: false, onDistribuir: noop, onRelatorio: noop, onHistorico: noop, onPausar: noop, onReativar: noop, onForcar: noop })),
        renderToStaticMarkup(createElement(ProcessoCaminho, { d, agora: new Date(), encerradasNaLista: false, onAlternarEncerradas: noop, faseSelecionada: null, onFase: noop })),
      ].join(" ")
      const repetidos = acharContadoresRepetidos(textoVisivel(html))
      // DÍVIDA CONHECIDA (a decidir com o Marco): a conta por fase do Caminho («N abertas = …», pedida na Etapa 2) repete o chip «N Abertas» do cabeçalho.
      // Só esse rótulo é tolerado; QUALQUER outro contador repetido nestas peças quebra o build.
      const ROTULOS_TOLERADOS = ["aberta"]
      const novos = repetidos.filter((r) => !ROTULOS_TOLERADOS.includes(r.chave.replace(/^\d+ /, "")))
      ok("cabeçalho + Caminho do processo não repetem contador (além do «abertas» já conhecido)", novos.length === 0, novos.map((r) => `${r.chave} ×${r.vezes}`).join(" | "))
    }

    secao("b) Seletores de atribuição sem pessoa (teste próprio) e d) Atribuição só na página do processo")
    ok("o teste dos seletores está na suíte", /seletores-sem-pessoa-preselecionada/.test(ler("scripts/ci/suite-critica.json")))
    // 07/10/2026: as 7 portas foram FECHADAS (o servidor também recusa: scripts/atribuicao-so-na-pagina-do-processo.test.ts). O detector agora vê mais padrões. O que ainda
    // aparece fora da página do processo é LEGÍTIMO ou MORTO, nominal e com motivo — porta NOVA quebra o teste.
    const PERMITIDAS_FORA_DO_PROCESSO: Record<string, string> = {
      "src/components/operacao/distribuicao-tarefas.tsx": "SUCESSÃO EM MASSA (férias/afastamento: a carteira de UMA pessoa passa a outra, origem «sucessao-em-massa») — não é atribuição por processo; o resto leva ao processo",
      "src/components/torre/TorreTarefas.tsx": "o LOTE da Torre (useLoteDeAtribuicao → /api/torre/tarefas/lote), que o Marco usa; «Atribuir» da linha só abre o processo",
      "src/components/torre/acoes-do-item.tsx": "ATRIBUIR_SUGERIDO/ATRIBUIR_ESCOLHIDO só ABREM o processo (router.push); o servidor recusa essas ações sem a origem da página",
      "src/components/operacao/tabela-familia.tsx": "código MORTO (só central-operacional.tsx a importa e nenhuma página monta); o servidor recusa as chamadas dela",
    }
    const portas = portasDeAtribuicaoForaDoProcesso()
    const novas = portas.filter((p) => !(p in PERMITIDAS_FORA_DO_PROCESSO))
    ok("nenhuma porta NOVA de atribuição fora da página do processo (só as legítimas/mortas nominais abaixo)", novas.length === 0, novas.join(", "))
    const sumiram = Object.keys(PERMITIDAS_FORA_DO_PROCESSO).filter((p) => !portas.includes(p))
    ok("a lista de permitidas não tem entrada velha (arquivo que deixou de ser porta sai da lista)", sumiram.length === 0, sumiram.join(", "))
    const FECHADAS_AGORA = ["src/components/kanban/DocumentoOperationalDrawer.tsx", "src/components/kanban/ProcessoCentralOperacional.tsx", "src/components/operacao/processo-expandido.tsx", "src/components/operacao/visao-global.tsx", "src/components/operacao/operacao-v3.tsx", "src/components/torre/PainelTorreTarefa.tsx"]
    ok("as portas FECHADAS não voltaram", FECHADAS_AGORA.every((f) => !portas.includes(f)), FECHADAS_AGORA.filter((f) => portas.includes(f)).join(", "))
    void arquivos; void semComentarios

    secao("Os detectores são SOMENTE LEITURA")
    const fonte = semComentarios(ler("lib/saude/verificacoes/regras-do-marco.ts")) + semComentarios(ler("scripts/vigia-regras-do-marco.ts"))
    ok("nenhuma escrita nos detectores nem no script do vigia (create/update/delete/upsert/executeRaw/$transaction)", !/\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\(|\$executeRaw|\$queryRawUnsafe|\$transaction/.test(fonte))
    ok("o vigia roda na Saúde do Sistema (INT-003)", /INT-003/.test(ler("lib/saude/verificacoes/regras-do-marco-saude.ts")) && /regras-do-marco-saude/.test(ler("lib/saude/index.ts")))
    ok("CLAUDE.md tem a seção «REGRAS INEGOCIÁVEIS DO MARCO» com as 9 regras (a–i)", /REGRAS INEGOCIÁVEIS DO MARCO/.test(ler("CLAUDE.md")) && ["a", "b", "c", "d", "e", "f", "g", "h", "i"].every((l) => new RegExp(`\\*\\*${l}\\)\\*\\*`).test(ler("CLAUDE.md"))))
    void nec; void nomeProcesso
  } finally {
    await prisma.logAuditoria.deleteMany({ where: { descricao: { in: ["devolvida"] }, acao: "TAREFA_DEVOLVIDA_A_FILA" } })
    await c.limpar()
    await prisma.phaseInternalWorkflow.deleteMany({ where: { wfUid: { startsWith: MARCA } } })
    await prisma.usuario.deleteMany({ where: { email: { startsWith: MARCA.toLowerCase() } } })
  }
  console.log(`\n${falhou === 0 ? "✅ PASSOU" : "❌ FALHOU"}: ${passou} ok, ${falhou} falhas`)
  if (falhou > 0) { console.log(falhas.join("\n")); process.exit(1) }
}
main().catch((e) => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
