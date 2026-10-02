// scripts/arvore-moldura-etapa2.test.ts
// ============================================================================
// ETAPA 2 DA REFORMA DA ÁRVORE — MOLDURA (barra única, cartões flutuantes,
// painel Diagnóstico removido).
//
// Trava quatro compromissos:
//
//   1. TAREFA NUNCA É PENDÊNCIA DE ÁRVORE. Tarefa vencida/aberta/com dono é
//      trabalho em andamento (já tem lugar na Torre e em Tarefas). Não entra no
//      diagnóstico, na "Próxima ação", na urgência, na Saúde da pessoa, no resumo
//      da linhagem nem como marca do cartão.
//   2. OS ACHADOS DO MOTOR NÃO SE PERDEM com o painel: `achados-do-motor.ts` é a
//      fonte única; a "Próxima ação" lê dela; a aba Operação da pessoa os lista
//      com botão que leva ao alvo.
//   3. O PAINEL DIAGNÓSTICO NÃO EXISTE MAIS (arquivo, botão/selo, atalho D, estado,
//      ESC, tipos e rótulos só dele).
//   4. A MOLDURA: UMA barra de ferramentas (a linha PAISAGEM | RETRATO) com os
//      controles de linhagem e Comparar; idioma do PDF DENTRO do botão PDF; resumo
//      do requerente, legenda da Saúde e trilha como cartões flutuantes.
//
// Os testes de UI do repo são varreduras de fonte (código sem comentários), no
// padrão de `arvore-sem-placeholders-pai-mae.test.ts`.
//
//   npx tsx scripts/arvore-moldura-etapa2.test.ts
//   node scripts/ci/gate-build.mjs --suite todas --so arvore-moldura-etapa2
// ============================================================================
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"

import { construirGrafo } from "@/src/lib/genealogia/motor/grafo"
import { analisarArvore } from "@/src/lib/genealogia/motor/analisar"
import { mapaDeLinhagens } from "@/src/lib/genealogia/motor/linhagens"
import type { Insight, PessoaEntrada, UniaoEntrada } from "@/src/lib/genealogia/motor/tipos"
import {
  calcularUrgencia,
  decidirProximaAcao,
  projetarDossies,
  resumirLinhagem,
  type FatosOperacionais,
} from "@/src/lib/genealogia/operacional/dossie"
import {
  CATEGORIAS_DE_PENDENCIA,
  FILA_DE_PRIORIDADE,
  diagnosticar,
  resolveNextGenealogyAction,
} from "@/src/lib/genealogia/operacional/diagnostico"
import { calcularSaude } from "@/src/lib/genealogia/operacional/saude"
import { projetarIndicadores } from "@/src/lib/genealogia/documental/indicadores"
import {
  achadosDoMotor,
  achadosDoMotorPorPessoa,
} from "@/src/lib/genealogia/operacional/achados-do-motor"

let passou = 0, falhou = 0
const falhas: string[] = []
const ok = (c: boolean, n: string, extra: unknown = "") => {
  const e = extra === "" || extra == null ? "" : ` — ${typeof extra === "string" ? extra : JSON.stringify(extra)}`
  if (c) { passou++; console.log(`  ✅ ${n}${e}`) } else { falhou++; falhas.push(n); console.log(`  ❌ ${n}${e}`) }
}
const secao = (t: string) => console.log(`\n${t}`)
const ler = (p: string) => readFileSync(p, "utf8")
/** Tira comentários de linha e de bloco — o que sobra é CÓDIGO. */
const codigo = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1")

// ── Fixture: casal com filho em comum SEM união registrada (achado de relação) ──
const PESSOAS: PessoaEntrada[] = [
  { id: 1, nome: "Giuseppe", sobrenome: "Rossi", sexo: "M", pais_nasc: "Itália", data_nasc: "1900-01-01", vivo: false, data_obito: "1970-01-01" },
  { id: 2, nome: "Carla", sobrenome: "Bianchi", sexo: "F", pais_nasc: "Itália", data_nasc: "1905-01-01", vivo: false, data_obito: "1975-01-01" },
  // filho dos dois, mas o casal NÃO tem união cadastrada
  { id: 3, nome: "Marcos", sobrenome: "Rossi", sexo: "M", pais_nasc: "Brasil", data_nasc: "1940-01-01", paiId: 1, maeId: 2, requerente: "maior" },
]
const UNIOES: UniaoEntrada[] = []
const grafo = construirGrafo(PESSOAS, UNIOES)
const analise = analisarArvore(PESSOAS, UNIOES, { paisAlvo: "ITALIA", raizId: 3 })
const mapa = mapaDeLinhagens(grafo, "ITALIA", 3)
const linhagem = mapa.porRequerente.get(3) ?? null

// Uma tarefa ATRASADA e outra no prazo, ambas da pessoa 1, ambas com dono.
const FATOS_COM_TAREFAS: FatosOperacionais = {
  necessidades: [],
  tarefas: [
    { id: 90, pessoaId: 1, titulo: "Atrasada", concluida: false, dataPrazo: "2020-01-01", statusTarefa: "EM_ANDAMENTO", responsavel: "Ana" },
    { id: 91, pessoaId: 1, titulo: "No prazo", concluida: false, dataPrazo: "2099-01-01", statusTarefa: "NAO_INICIADA", responsavel: "Ana" },
  ],
  lancamentos: [],
  financeiroVisivel: false,
}
const FATOS_SEM_TAREFAS: FatosOperacionais = { ...FATOS_COM_TAREFAS, tarefas: [] }

// ═══ 1) TAREFA NUNCA É PENDÊNCIA DE ÁRVORE ═══════════════════════════════════
secao("1) tarefa vencida/aberta/com dono nunca é pendência de árvore")

const dossiesCom = projetarDossies({ grafo, analise, mapa, fatos: FATOS_COM_TAREFAS })
const dossiesSem = projetarDossies({ grafo, analise, mapa, fatos: FATOS_SEM_TAREFAS })
ok(dossiesCom.get(1)!.tarefasAbertas.length === 2, "o dossiê continua INFORMANDO o trabalho em andamento da pessoa")

ok(!(CATEGORIAS_DE_PENDENCIA as readonly string[]).some((c) => /tarefa/i.test(c)), "o fecho de categorias de pendência não tem tarefa")
ok(!FILA_DE_PRIORIDADE.some((f) => /tarefa/i.test(f)), "a fila fixa da Próxima ação não tem faixa de tarefa")

const diagCom = diagnosticar({ grafo, analise, mapa, dossies: dossiesCom, linhagem })
const diagSem = diagnosticar({ grafo, analise, mapa, dossies: dossiesSem, linhagem })
ok(diagCom.problemas.length === diagSem.problemas.length, "tarefa atrasada + aberta NÃO muda a lista de pendências", [diagCom.problemas.length, diagSem.problemas.length])
ok(diagCom.problemas.every((p) => (CATEGORIAS_DE_PENDENCIA as readonly string[]).includes(p.categoria)), "toda pendência é de uma categoria da árvore")
ok(!diagCom.problemas.some((p) => /tarefa/i.test(p.titulo) || /tarefa/i.test(p.fonte)), "nenhuma pendência cita tarefa como título ou fonte")
ok(diagCom.resumo === diagSem.resumo, "o veredito do processo não muda por causa de tarefa", diagCom.resumo)

const acaoCom = resolveNextGenealogyAction(diagCom)
const acaoSem = resolveNextGenealogyAction(diagSem)
ok(acaoCom.acao === acaoSem.acao && acaoCom.prioridade === acaoSem.prioridade, "a Próxima ação é a MESMA com ou sem tarefa", acaoCom.acao)
ok(!/tarefa/i.test(acaoCom.acao) && !/tarefa/i.test(acaoCom.motivo), "e nunca é 'concluir/cobrar a tarefa X'")

// Pessoa cuja ÚNICA coisa aberta é tarefa: nada pendente na árvore.
const soTarefa = { ...dossiesCom.get(2)!, tarefasAbertas: dossiesCom.get(1)!.tarefasAbertas, divergencias: [], documental: { ...dossiesCom.get(2)!.documental, naoLocalizadas: 0, pendentes: 0, emAtendimento: 0 } }
ok(decidirProximaAcao(soTarefa) === null, "pessoa só com tarefa aberta: a próxima ação da árvore é 'nada' (null)", String(decidirProximaAcao(soTarefa)))
ok(calcularUrgencia(soTarefa) === 0, "tarefa não pesa na urgência da pessoa", String(calcularUrgencia(soTarefa)))

const saude = calcularSaude(grafo, new Map([[1, { ...soTarefa, pessoaId: 1 }]]), null)
ok(saude.get(1)?.nivel === "saudavel", "tarefa aberta não pinta a Saúde da pessoa (heatmap)", saude.get(1)?.nivel)

const resumoCom = resumirLinhagem(linhagem!, dossiesCom, grafo, projetarIndicadores([]), analise)
ok(!("tarefasVencidas" in resumoCom) && !("tarefasAbertas" in resumoCom), "o resumo da linhagem não carrega contagem de tarefa", Object.keys(resumoCom).join(","))

// ═══ 2) OS ACHADOS DO MOTOR NÃO SE PERDEM ════════════════════════════════════
secao("2) achados do motor: fonte única, por pessoa")

const sintetico = (id: string, categoria: Insight["categoria"], pessoaIds: number[], peso = 50, severidade: Insight["severidade"] = "medio"): Insight =>
  ({ id, categoria, severidade, titulo: `t-${id}`, explicacao: `e-${id}`, acao: `a-${id}`, pessoaIds, peso })
const insights: Insight[] = [
  sintetico("c", "conflito", [1], 90, "critico"),
  sintetico("d", "duplicidade", [1, 2], 70),
  sintetico("s", "sobrenome", [2, 3], 55),
  sintetico("r", "relacao", [1, 2], 40),
  sintetico("k", "risco", [3], 60, "critico"),
  sintetico("l", "lacuna", [1], 99),
  sintetico("p", "pesquisa", [2], 99),
  sintetico("m", "migracao", [3], 99),
  sintetico("g", "conflito", [], 30), // achado da árvore toda: sem pessoa
]
const todos = achadosDoMotor({ insights })
ok(todos.length === 6, "conflito/duplicidade/sobrenome/relação/risco entram; lacuna/pesquisa/migração ficam de fora", todos.map((a) => a.id).join(","))
ok(todos.map((a) => a.id).join(",") === "c,d,k,s,r,g", "ordem do mais pesado ao mais leve", todos.map((a) => a.id).join(","))
ok(todos.find((a) => a.id === "c")!.impeditivo && !todos.find((a) => a.id === "s")!.impeditivo, "só o que o motor classificou como crítico é impeditivo")
ok(todos.every((a) => a.acao.length > 0 && a.fonte.length > 0), "todo achado tem ação e fonte")

const porPessoa = achadosDoMotorPorPessoa({ insights })
ok(porPessoa.get(1)!.map((a) => a.id).join(",") === "c,d,r", "pessoa 1 vê os 3 achados que a tocam", porPessoa.get(1)?.map((a) => a.id).join(","))
ok(porPessoa.get(2)!.some((a) => a.id === "d") && porPessoa.get(1)!.some((a) => a.id === "d"), "achado de duas pessoas aparece nas duas fichas")
ok(![...porPessoa.values()].flat().some((a) => a.id === "g"), "achado sem pessoa não tem dono (continua em achadosDoMotor e na Análise)")
ok(achadosDoMotor({ insights }, new Set([3])).map((a) => a.id).join(",") === "k,s,g", "escopo da linhagem: só quem toca o escopo + os da árvore toda", achadosDoMotor({ insights }, new Set([3])).map((a) => a.id).join(","))

// Fixture real: o motor aponta "filho em comum sem união registrada".
const reais = achadosDoMotor(analise)
const uniaoImplicita = reais.find((a) => a.id.startsWith("sug-uniao-implicita"))
ok(uniaoImplicita != null && uniaoImplicita.categoria === "relacao", "o motor real aponta 'filho em comum sem união registrada' como achado", uniaoImplicita?.titulo ?? "")
ok(uniaoImplicita != null && uniaoImplicita.pessoaIds.includes(1) && uniaoImplicita.pessoaIds.includes(2), "e ele toca os dois pais")
ok(achadosDoMotorPorPessoa(analise).get(1)?.some((a) => a.id === uniaoImplicita?.id) === true, "e aparece na ficha de cada um dos pais")

// Nada se perde: tudo o que o painel Diagnóstico listava do motor está em achadosDoMotor.
const idsDoDiagnostico = new Set(diagSem.problemas.filter((p) => p.fonte.startsWith("Motor genealógico")).map((p) => p.id))
ok(reais.length > 0 && reais.every((a) => idsDoDiagnostico.has(`diag-${a.id}`)), "todo achado do motor continua a gerar pendência da Próxima ação (mesma fonte)")
ok([...idsDoDiagnostico].every((id) => reais.some((a) => `diag-${a.id}` === id)), "e a Próxima ação não lê insight por conta própria")

// ═══ 3) O PAINEL DIAGNÓSTICO NÃO EXISTE MAIS ═════════════════════════════════
secao("3) painel Diagnóstico removido, sem órfão")

function arquivos(dir: string, acc: string[] = []): string[] {
  for (const nome of readdirSync(dir)) {
    const p = join(dir, nome)
    if (statSync(p).isDirectory()) arquivos(p, acc)
    else if (/\.(ts|tsx|css)$/.test(nome)) acc.push(p)
  }
  return acc
}
const fontes = arquivos("src")
ok(!existsSync("src/components/arvore/inteligencia/painel-diagnostico.tsx"), "o arquivo do painel foi apagado")
const resto = fontes.filter((f) => /PainelDiagnostico|SeloSaude|painel-diagnostico|diagnosticoAberto|setDiagnosticoAberto/.test(codigo(ler(f))))
ok(resto.length === 0, "nenhum código referencia o painel, o selo ou o estado dele", resto.join(", "))

const view = codigo(ler("src/components/arvore/arvore-genealogica-view.tsx"))
ok(!/tecla === "d"/.test(view), "o atalho D (abrir Diagnóstico) saiu")
ok(!/Fechar diagnóstico|Diagnóstico do processo/.test(view), "e nenhum texto de botão/título do painel sobrou na tela")
const hook = codigo(ler("src/components/arvore/inteligencia/use-arvore-operacional.ts"))
ok(!/\bagora\b/.test(hook), "o 'agora' do hook (só existia para 'tarefa vencida') saiu")
ok(!/\bauditor\b|ContextoAuditor/.test(hook), "o contexto do Modo Auditor (só o painel usava) saiu do hook")
ok(!/diagnostico:\s*Diagnostico|^\s+diagnostico,\s*$/m.test(hook), "o hook não expõe mais o diagnóstico à tela (só a Próxima ação)")
ok(!/tarefaAberta/.test(hook) && !/tarefaAberta/.test(codigo(ler("src/components/arvore/react-flow-tree.tsx"))), "o cartão não tem mais a marca de 'tarefa aberta'")
const dossieSrc = codigo(ler("src/lib/genealogia/operacional/dossie.ts"))
ok(!/tarefasVencidas|agora/.test(dossieSrc), "o dossiê não conta 'tarefas vencidas' nem recebe relógio")
ok(!/tarefa_vencida|tarefa_aberta|tarefaVencida/.test(codigo(ler("src/lib/genealogia/operacional/diagnostico.ts"))), "o diagnóstico não conhece tarefa vencida/aberta")

// ═══ 4) A MOLDURA ═══════════════════════════════════════════════════════════
secao("4) uma barra, cartões flutuantes, idioma dentro do PDF")

ok(!/BarraLinhagem/.test(view), "a segunda barra sobreposta ao canvas (BarraLinhagem) não existe mais")
ok(/<ControlesLinhagem/.test(view), "os controles de linhagem estão na linha de ferramentas")
const iToolbar = view.indexOf("PAISAGEM")
const iControles = view.indexOf("<ControlesLinhagem")
const iCanvas = view.indexOf("ref={treeContainerRef}")
ok(iToolbar > 0 && iControles > iToolbar && iControles < iCanvas, "ControlesLinhagem fica NA MESMA linha de Paisagem/Retrato, antes do canvas")
ok(!/<select[\s\S]{0,200}idiomaPdf|value=\{idiomaPdf\}/.test(view.replace(/<MenuPdf[\s\S]*?\/>/, "")), "o seletor de idioma saiu da barra")
ok(/<MenuPdf/.test(view) && /idioma=\{idiomaPdf\}/.test(view), "o idioma do PDF vive no botão PDF (MenuPdf)")
const menuPdf = codigo(ler("src/components/arvore/menu-pdf.tsx"))
ok(/menuitemradio/.test(menuPdf) && /onIdioma/.test(menuPdf) && /onExportar/.test(menuPdf), "o menu do PDF escolhe o idioma E exporta")
ok(!/<select/.test(menuPdf), "sem <select> solto")
ok(/<div className="[^"]*\bflex max-w-full flex-wrap items-center justify-between[^"]*"/.test(view.slice(0, iToolbar)), "a linha única QUEBRA em largura estreita (flex-wrap), sem rolagem horizontal")
ok(!/overflow-x-auto|overflow-x-scroll/.test(view.slice(view.indexOf("flex max-w-full flex-wrap items-center justify-between"), iCanvas)), "e não cria rolagem horizontal")

const barra = codigo(ler("src/components/arvore/inteligencia/barra-linhagem.tsx"))
ok(/Comparar/.test(barra) && /GitCompare/.test(barra), "Comparar está nos controles da barra única (não em linha própria)")
ok(!/Tarefas abertas|Tarefas vencidas|vencida\(s\)/.test(barra), "nada de tarefa nos controles")
ok(!/\babsolute (left|right)-4 top-4\b/.test(barra), "nenhuma faixa `absolute` própria sobre o canvas")
ok(/LAYER\.popover/.test(barra), "menus usam a camada de popover do SSOT (layers.ts)")
ok(/--surface-popover/.test(barra), "e a superfície opaca de popover do DS")

const cartoes = codigo(ler("src/components/arvore/inteligencia/cartoes-flutuantes.tsx"))
ok(/CartaoResumoFlutuante/.test(view) && /aria-expanded/.test(cartoes), "o resumo do requerente é cartão flutuante RECOLHÍVEL")
ok(/Próxima ação/.test(cartoes), "e leva a Próxima ação")
ok(!/Tarefas abertas|Tarefas vencidas/.test(cartoes), "sem linhas de tarefa no resumo")
ok(/<LegendaSaude/.test(view) && /operacional\.saudeLigada\s*&&[\s\S]{0,40}<LegendaSaude/.test(view), "a legenda só existe com o modo Saúde ligado")
ok(!/tarefa/i.test(cartoes.slice(cartoes.indexOf("LegendaSaude"), cartoes.indexOf("TrilhaFlutuante"))), "a legenda não fala de tarefa")
ok(/<TrilhaFlutuante/.test(view) && /bottom-3/.test(cartoes), "a trilha Requerente>Pai>Avó é flutuante na base do canvas")
ok(/--surface-elevated/.test(cartoes), "cartões usam a superfície opaca de 'o que flutua'")
ok(!/\bpainelAberto.*Resumo|resumoAberto/.test(barra), "não sobrou popover de resumo na barra")

// ═══ 5) AÇÃO: a aba Operação lista os achados com botão que leva ao alvo ════
secao("5) aba Operação da pessoa: as divergências do motor viraram itens da fila (Etapa 4)")

const sidebar = codigo(ler("src/components/arvore/pessoa-sidebar.tsx"))
const filaUi = codigo(ler("src/components/arvore/fila-da-pessoa.tsx"))
ok(/Fila de trabalho/.test(sidebar) && /<ListaDaFila/.test(sidebar), "a aba Operação tem a 'Fila de trabalho' (as divergências do motor entram nela)")
ok(/data-achado-do-motor=\{item\.achadoId\}/.test(filaUi), "cada divergência continua sendo um item identificável na fila")
ok(/onClick=\{\(\) => onExecutar\(acao\)\}/.test(filaUi), "cada item tem botão ligado a um handler real")
ok(/fila=\{selectedPersonId != null \? operacional\.filaDe\(selectedPersonId\)/.test(view) && /onAbrirAchado=\{abrirAchado\}/.test(view), "a tela alimenta a fila e liga o botão de abrir pessoa")
ok(/setSidebarTabInicial\("operacao"\)[\s\S]{0,80}localizarPessoa\(pessoaId\)/.test(view), "o botão foca a pessoa-alvo e abre o painel dela na aba Operação")
ok(/achadosDoMotorPorPessoa\(analise\)/.test(hook), "o hook serve os achados pela função única")
ok(!/Concluir a tarefa/.test(sidebar), "o painel da pessoa não manda 'concluir a tarefa'")
ok(/Tarefas não são pendência da árvore/.test(ler("src/components/arvore/pessoa-sidebar.tsx")), "tarefas continuam visíveis na pessoa só como 'trabalho em andamento'")

console.log(`\n${falhou === 0 ? "✅ PASSOU" : "❌ FALHOU"}: ${passou} ok, ${falhou} falhas`)
if (falhou > 0) { console.log(falhas.join("\n")); process.exit(1) }
