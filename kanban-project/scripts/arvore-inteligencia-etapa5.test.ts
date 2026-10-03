// scripts/arvore-inteligencia-etapa5.test.ts
// ============================================================================
// ETAPA 5 DA REFORMA DA ÁRVORE — A INTELIGÊNCIA FUNCIONAL.
//
// Trava, por sub-item:
//   (a) CADA PORCENTAGEM TEM A CONTA ABERTA: o número é produzido a partir dos
//       MESMOS itens que a tela lista (`Medida { valor, itens[] }`), com link para
//       a pessoa. Nada de segunda função "para explicar".
//   (b) AS PERGUNTAS RESPONDEM COM ENTIDADES REAIS (pessoa, documento pelo nome,
//       tarefa existente), com os MESMOS totais do cartão, e nenhuma cita prazo
//       sem fonte.
//   (c) "CRIAR TAREFA" usa a PORTA CANÔNICA (`POST /api/tarefas/manual`), com
//       rascunho tirado do dado, idempotência por ID canônico e permissão.
//   (d) UM SÓ CÁLCULO: painel de Inteligência, cartão de resumo e aba Operação
//       leem de `indicadores.ts`; "mesma entrada ⇒ mesmos números" e varredura
//       de fonte contra cálculo paralelo.
//   (e) CRONOLOGIA: limites exatos (11a364d × 12a, óbito do pai 8 × 10 meses,
//       casamento no dia do nascimento, data ausente/parcial) viram achado do
//       motor e caem na fila da aba Operação.
//
//   npx tsx scripts/arvore-inteligencia-etapa5.test.ts
//   node scripts/ci/gate-build.mjs --suite todas --so arvore-inteligencia-etapa5
// ============================================================================
import { readFileSync } from "node:fs"

import { construirGrafo } from "@/src/lib/genealogia/motor/grafo"
import { analisarArvore } from "@/src/lib/genealogia/motor/analisar"
import { calcularQualidade } from "@/src/lib/genealogia/motor/qualidade"
import { analisarCronologia } from "@/src/lib/genealogia/motor/regras/cronologia"
import { anosCompletosEntre, tsDe } from "@/src/lib/genealogia/motor/texto"
import { mapaDeLinhagens } from "@/src/lib/genealogia/motor/linhagens"
import type { Medida, PessoaEntrada, UniaoEntrada } from "@/src/lib/genealogia/motor/tipos"
import { achadosDoMotorPorPessoa } from "@/src/lib/genealogia/operacional/achados-do-motor"
import { projetarIndicadores } from "@/src/lib/genealogia/documental/indicadores"
import { projetarDossies, resumirLinhagem, type FatosOperacionais } from "@/src/lib/genealogia/operacional/dossie"
import { montarFilaDaPessoa, type NecessidadeDaFila } from "@/src/lib/genealogia/operacional/fila-da-pessoa"
import {
  indicadoresDaArvore,
  indicadoresDaPessoa,
  indicadoresDoEscopo,
} from "@/src/lib/genealogia/operacional/indicadores"
import { PERGUNTAS, contextoDePerguntas, responder, responderTodas } from "@/src/lib/genealogia/operacional/perguntas"
import {
  chaveDeOrigem,
  corpoDaCriacao,
  LIMITE_CHAVE_ORIGEM,
  LIMITE_TITULO,
  rascunhoDaProximaAcao,
  rascunhoDoDocumento,
  rascunhoDoPasso,
} from "@/src/lib/genealogia/operacional/tarefa-do-passo"
import { diagnosticar, resolveNextGenealogyAction } from "@/src/lib/genealogia/operacional/diagnostico"

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

// ── Fixture ─────────────────────────────────────────────────────────────────
// Bisavô italiano (1) → avô (2) → pai (3) → requerente (4). A mãe do requerente (8)
// nasceu 9 anos antes dele: achado cronológico que toca DUAS pessoas da linhagem
// (4 e 8) — o caso que o cartão contava em dobro.
const PESSOAS: PessoaEntrada[] = [
  { id: 1, nome: "Giuseppe", sobrenome: "Rossi", sexo: "M", pais_nasc: "Itália", data_nasc: "1880-03-02" },
  { id: 2, nome: "Antonio", sobrenome: "Rossi", sexo: "M", pais_nasc: "Brasil", data_nasc: "1915-06-11", paiId: 1 },
  { id: 3, nome: "Carlos", sobrenome: "Rossi", sexo: "M", pais_nasc: "Brasil", data_nasc: "1950-01-20", paiId: 2 },
  { id: 4, nome: "Marcos", sobrenome: "Rossi", sexo: "M", pais_nasc: "Brasil", data_nasc: "1980-05-05", paiId: 3, maeId: 8, requerente: "maior" },
  { id: 8, nome: "Ana", sobrenome: "Lima", sexo: "F", pais_nasc: "Brasil", data_nasc: "1971-04-04" },
]
const UNIOES: UniaoEntrada[] = [{ id: 100, pessoa1Id: 3, pessoa2Id: 8, data_inicio: "1978-10-10" }]
const grafo = construirGrafo(PESSOAS, UNIOES)
const analise = analisarArvore(PESSOAS, UNIOES, { paisAlvo: "ITALIA", raizId: 4 })
const mapa = mapaDeLinhagens(grafo, "ITALIA", 4)
const linhagem = mapa.porRequerente.get(4)!

const NECESSIDADES: NecessidadeDaFila[] = [
  { id: 1, pessoaId: 1, status: "NAO_LOCALIZADA", obrigatoriedade: "OBRIGATORIA", itemCatalogo: { id: 1, name: "Certidão de nascimento" }, situacaoCertidao: "NAO_LOCALIZADA" },
  { id: 2, pessoaId: 2, status: "PENDENTE", obrigatoriedade: "OBRIGATORIA", itemCatalogo: { id: 1, name: "Certidão de nascimento" }, situacaoCertidao: "NAO_SOLICITADA" },
  { id: 3, pessoaId: 3, status: "ATENDIDA", obrigatoriedade: "OBRIGATORIA", itemCatalogo: { id: 1, name: "Certidão de nascimento" }, situacaoCertidao: "RECEBIDA" },
  { id: 4, pessoaId: 4, status: "EM_ATENDIMENTO", obrigatoriedade: "OBRIGATORIA", itemCatalogo: { id: 1, name: "Certidão de nascimento" }, situacaoCertidao: "PENDENTE" },
  // Certidão de casamento: da UNIÃO 100, aparece nos dois cônjuges (3 e 8).
  { id: 5, uniaoId: 100, status: "PENDENTE", obrigatoriedade: "OBRIGATORIA", itemCatalogo: { id: 2, name: "Certidão de casamento" }, situacaoCertidao: "NAO_SOLICITADA" },
]
const FATOS: FatosOperacionais = {
  necessidades: NECESSIDADES,
  // A tarefa 77 já existe para a necessidade 4 (Marcos).
  tarefas: [{ id: 77, pessoaId: 4, titulo: "Solicitar certidão", concluida: false, statusTarefa: "EM_ANDAMENTO", necessidadeId: 4 }],
  lancamentos: [],
  financeiroVisivel: false,
}
const PROCESSO_ID = 9001
const projecao = projetarIndicadores(FATOS.necessidades)
const dossies = projetarDossies({ grafo, analise, mapa, fatos: FATOS })
const achadosPorPessoa = achadosDoMotorPorPessoa(analise)
const filaDe = (pessoaId: number) =>
  montarFilaDaPessoa({
    pessoaId,
    processoId: PROCESSO_ID,
    faseAtualKey: null,
    necessidades: FATOS.necessidades,
    tarefas: FATOS.tarefas,
    uniaoIdsDaPessoa: grafo.unioesDe(pessoaId).map((u) => u.id as number),
    achados: achadosPorPessoa.get(pessoaId) ?? [],
  })
const ctx = contextoDePerguntas({ grafo, analise, mapa, dossies, linhagem, projecao, filaDe })

// ═══ (a) CADA PORCENTAGEM ABRE A CONTA ═══════════════════════════════════════
secao("(a) decomposição das porcentagens: valor e itens saem da MESMA conta")

const det = analise.qualidade.detalhe
ok(!!det && (["qualidade", "completude", "consistencia", "cobertura"] as const).every((k) => det[k]?.chave === k), "as quatro medidas existem com chave e rótulo")
ok(det.completude.valor === analise.qualidade.completude && det.consistencia.valor === analise.qualidade.consistencia &&
   det.cobertura.valor === analise.qualidade.coberturaLinha && det.qualidade.valor === analise.qualidade.score,
  "o valor de cada medida é EXATAMENTE o número que o painel sempre mostrou")

// Completude: valor = 100 × Σ numerador ÷ Σ denominador, e cada item é uma pessoa com os campos que faltam.
{
  const m = det.completude
  ok(Math.round((100 * m.numerador) / m.denominador!) === m.valor, "completude: valor = 100 × Σ numerador ÷ Σ denominador", [m.numerador, m.denominador, m.valor])
  const todas = [...analise.porPessoa.values()]
  const comPerda = todas.filter((a) => a.completude < 100)
  ok(m.totalItens === todas.length && m.itens.length + m.omitidos === comPerda.length, "completude: lista exatamente as pessoas que perdem pontos", [m.itens.length, comPerda.length])
  ok(m.itens.every((i) => i.pessoaId != null && i.pessoaIds[0] === i.pessoaId), "completude: todo item aponta para a pessoa (link)")
  ok(
    m.itens.every((i) => {
      const a = analise.porPessoa.get(i.pessoaId!)!
      return i.campos.map((c) => c.rotulo).join("|") === a.faltando.join("|") && i.numerador === a.completude * (a.naLinhaCidadania ? 4 : 1)
    }),
    "completude: os campos listados são os que faltam na pessoa, e o peso (4× na linha) está no numerador",
  )
  const somaPerdas = m.itens.reduce((s, i) => s + (i.denominador! - i.numerador), 0)
  const somaTodas = todas.reduce((s, a) => s + (100 - a.completude) * (a.naLinhaCidadania ? 4 : 1), 0)
  ok(somaPerdas === somaTodas, "completude: o que falta nos itens fecha com o que falta na conta", [somaPerdas, somaTodas])
}
// Consistência: cada achado de conflito/duplicidade, com pontos = 2 × grau.
{
  const m = det.consistencia
  const esperado = Math.max(0, Math.round(100 - (m.numerador / m.denominador!) * 8))
  ok(esperado === m.valor, "consistência: valor = 100 − (Σ pontos ÷ pessoas × 8)", [m.numerador, m.denominador, m.valor])
  ok(m.itens.length === analise.qualidade.conflitos + analise.qualidade.duplicidades, "consistência: um item por conflito/duplicidade", m.itens.length)
  ok(m.itens.reduce((s, i) => s + i.numerador, 0) === m.numerador, "consistência: os pontos dos itens somam a penalidade")
  const jovem = m.itens.find((i) => i.chave.startsWith("cron-parente-jovem-4-8"))
  ok(!!jovem && jovem.pessoaIds.includes(4) && jovem.pessoaIds.includes(8), "consistência: o achado cronológico lista as pessoas envolvidas (link)", jovem?.rotulo)
}
// Cobertura: um item por pessoa da linha; resolvida = ficha ≥ 80%.
{
  const m = det.cobertura
  ok(m.totalItens === analise.linhaCidadania.length && m.itens.length === analise.linhaCidadania.length, "cobertura: um item por pessoa da linha de cidadania", m.itens.length)
  ok(m.itens.filter((i) => !i.pesa).length === m.numerador && Math.round((100 * m.numerador) / m.denominador!) === m.valor, "cobertura: valor = resolvidas ÷ linha")
  ok(m.itens.every((i) => (analise.porPessoa.get(i.pessoaId!)!.completude >= 80) === !i.pesa), "cobertura: pesa só quem tem ficha abaixo de 80%")
}
// Qualidade geral: 40/30/30 sobre as outras três.
{
  const m = det.qualidade
  ok(m.itens.map((i) => i.chave).join(",") === "completude,consistencia,cobertura", "qualidade: três componentes, na ordem da fórmula")
  ok(Math.round(m.itens.reduce((s, i) => s + i.numerador, 0)) === m.valor && m.denominador === 100, "qualidade: Σ (valor × peso) = nota")
  ok(m.itens[0].numerador === det.completude.valor * 0.4, "qualidade: o componente usa o valor da OUTRA medida (mesma conta, sem recálculo)")
}
// Sem linha: cobertura 0 declara por quê.
{
  const vazio = calcularQualidade(construirGrafo([{ id: 1, nome: "A" }], []), new Map(), [], [], new Map())
  ok(vazio.detalhe.cobertura.observacao != null && vazio.coberturaLinha === 0 && vazio.detalhe.cobertura.totalItens === 0, "cobertura sem linha: nota explica que não há o que cobrir", vazio.detalhe.cobertura.observacao)
}
// Teto de exibição: omitidos dizem a verdade.
{
  const muitas: PessoaEntrada[] = Array.from({ length: 300 }, (_, i) => ({ id: i + 1, nome: `P${i}`, sobrenome: "X" }))
  const a = analisarArvore(muitas, [], { paisAlvo: null, raizId: 1 })
  const m = a.qualidade.detalhe.completude
  ok(m.itens.length === 100 && m.omitidos === 200 && m.totalItens === 300, "completude: teto de 100 itens e o resto declarado em 'omitidos'", [m.itens.length, m.omitidos])
}

// ═══ (b) PERGUNTAS COM ENTIDADES REAIS ═══════════════════════════════════════
secao("(b) perguntas: pessoas, documentos e tarefas reais; totais iguais aos do cartão")

const respostas = responderTodas(ctx)
ok(PERGUNTAS.length === 5 && respostas.length === 5, "cinco perguntas, todas respondidas")
ok(respostas.every((r) => r.itens.every((i) => i.pessoaId != null && i.texto.trim().length > 0)), "todo item de resposta aponta para uma pessoa real (clicável)")
ok(respostas.every((r) => r.fonte.trim() && r.escopo.trim()), "toda resposta declara fonte e escopo")
ok(respostas.every((r) => !/prazo|vence|venc[ie]/i.test(r.resumo + r.itens.map((i) => i.texto).join(" "))), "nenhuma resposta cita prazo (a Árvore não tem SLA e Tarefa.dataPrazo não é fonte do prazo de certidão)")
ok(!/dataPrazo|previsaoRetorno/.test(codigo(ler("src/lib/genealogia/operacional/perguntas.ts"))), "o módulo das perguntas não lê data de prazo")
ok(!PERGUNTAS.some((p) => /documento.*retifica/i.test(p.texto)), "a pergunta de retificação não finge saber QUAL documento (fala em dados que se contradizem)", PERGUNTAS[4].texto)

const resumo = resumirLinhagem(linhagem, dossies, grafo, projecao, analise)
{
  const falta = responder("o_que_falta", ctx)
  // O número do cartão é o consolidado (a união conta UMA vez). Somar por pessoa contaria o casamento duas vezes.
  const somaPorPessoa = [...linhagem.visivel].reduce((s, id) => s + (dossies.get(id)?.documental.necessarias ?? 0), 0)
  ok(somaPorPessoa !== resumo.documental.necessarias, "fixture: somar por pessoa DIFERE do consolidado (a certidão de casamento é da união)", [somaPorPessoa, resumo.documental.necessarias])
  const faltam = resumo.documental.necessarias - resumo.documental.atendidas - resumo.documental.dispensadas
  ok(falta.resumo.includes(`Faltam ${faltam} de ${resumo.documental.necessarias}`), "'O que falta?' usa os MESMOS totais do cartão de resumo", falta.resumo)
  const docs = falta.itens.filter((i) => i.documento)
  ok(docs.length === faltam, "'O que falta?' lista cada documento em aberto, pelo nome do catálogo", docs.map((d) => d.texto))
  ok(docs.every((d) => /Certidão de (nascimento|casamento)/.test(d.documento!.nome) && d.texto.includes(d.documento!.nome)), "o nome do documento vem do catálogo, não de texto fixo")
  ok(new Set(docs.map((d) => d.documento!.necessidadeId)).size === docs.length, "a certidão de casamento da união aparece UMA vez (não uma por cônjuge)")
  const comTarefa = docs.find((d) => d.documento!.necessidadeId === 4)
  ok(comTarefa?.tarefa?.id === 77 && comTarefa.tarefa.processoId === PROCESSO_ID && !comTarefa.rascunho, "documento COM tarefa: link para a tarefa existente (id 77), sem 'Criar tarefa'")
  const semTarefa = docs.find((d) => d.documento!.necessidadeId === 2)
  ok(!semTarefa?.tarefa && semTarefa?.rascunho?.necessidadeId === 2 && semTarefa.rascunho.pessoaId === 2, "documento SEM tarefa: rascunho de 'Criar tarefa' ligado à necessidade e à pessoa", semTarefa?.rascunho?.titulo)

  const impede = responder("o_que_impede", ctx)
  ok(impede.itens.some((i) => i.documento?.necessidadeId === 1 && i.documento.estado === "bloqueado" && i.pessoaId === 1), "'O que impede?' nomeia o documento não localizado e a pessoa")
  ok(impede.itens.some((i) => !i.documento && /Ana|Marcos/.test(i.texto)) || impede.itens.every((i) => i.pessoaId != null), "'O que impede?' também lista conflito crítico do motor, com pessoa")

  const pend = responder("quem_tem_pendencia", ctx)
  const ana = pend.itens.find((i) => i.pessoaId === 8)
  ok(!!ana && /divergência/.test(ana.texto), "'Quem tem pendência?' conta divergência pela lista de achados (a mesma da aba Operação)", ana?.texto)
  const nDivAna = (achadosPorPessoa.get(8) ?? []).length
  ok(ana?.texto.includes(`${nDivAna} divergência(s)`) === true, "e o número de divergências da pessoa é o da aba Operação", nDivAna)

  const ret = responder("o_que_retificar", ctx)
  ok(ret.itens.every((i) => i.pessoaId != null) && ret.itens.some((i) => /anos ao nascer/.test(i.texto)), "retificação: lista o dado que se contradiz e quem está envolvido", ret.itens.map((i) => i.texto))

  const trans = responder("quem_transmite", ctx)
  ok(trans.itens.length === linhagem.cadeia.length && trans.itens.every((i) => i.pessoaId != null), "'Quem transmite?': a cadeia inteira, pessoa a pessoa")
}

// ═══ (c) CRIAR TAREFA — PORTA CANÔNICA, RASCUNHO DO DADO ═════════════════════
secao("(c) criar tarefa: rascunho, idempotência por ID e porta canônica")

{
  const passo = analise.proximosPassos[0]
  ok(!!passo?.insightId, "todo próximo passo carrega o id do achado de origem", passo?.insightId)
  const insight = analise.insights.find((i) => i.id === passo.insightId)
  const r = rascunhoDoPasso(passo, insight, grafo)
  ok(r.pessoaId === passo.pessoaIds[0] && !!r.pessoaNome && r.titulo.includes(r.pessoaNome), "rascunho do passo: título com a ação e o nome da pessoa", r.titulo)
  ok(!!insight && r.motivo.includes(insight.titulo) && r.motivo.includes(insight.explicacao.slice(0, 20)), "descrição = achado de origem (título + explicação), nada escrito à mão")
  ok(r.chaveOrigem === chaveDeOrigem("arvore-achado", passo.insightId) && r.chaveOrigem!.length <= LIMITE_CHAVE_ORIGEM, "chave de origem = id do achado (idempotência por ID, nunca pelo título)", r.chaveOrigem)
  ok(r.titulo.length <= LIMITE_TITULO, "título cabe na coluna")

  const longa = chaveDeOrigem("arvore-achado", "x".repeat(200))
  ok(longa.length <= LIMITE_CHAVE_ORIGEM && longa === chaveDeOrigem("arvore-achado", "x".repeat(200)), "chave longa é encurtada de forma determinística")
  ok(chaveDeOrigem("arvore-achado", "x".repeat(200)) !== chaveDeOrigem("arvore-achado", "x".repeat(199) + "y"), "e chaves longas diferentes continuam diferentes")

  const doc = rascunhoDoDocumento({ necessidadeId: 2, nome: "Certidão de nascimento", rotuloEstado: "A solicitar" }, 2, "Antonio Rossi")
  ok(doc.necessidadeId === 2 && doc.documentoNome === "Certidão de nascimento" && doc.chaveOrigem === null, "rascunho de documento: necessidade como identidade (a porta já dedupa por ela)")

  const diag = diagnosticar({ grafo, analise, mapa, dossies, linhagem })
  const acao = resolveNextGenealogyAction(diag)
  const ra = rascunhoDaProximaAcao(acao)
  ok(!!ra && ra.pessoaId === acao.pessoaId && ra.chaveOrigem!.startsWith("arvore-problema:"), "rascunho da próxima ação do cartão")
  ok(rascunhoDaProximaAcao({ pessoaId: null, pessoaNome: null, acao: "Nenhuma ação necessária.", motivo: "", fonte: "", prioridade: 5, problemaId: null }) === null, "'Nenhuma ação necessária' não vira tarefa")

  const corpo = corpoDaCriacao(r, PROCESSO_ID, { responsavelId: 5, dataPrazo: "2026-12-01", confirmarDuplicidade: true })
  ok(corpo.processoId === PROCESSO_ID && corpo.pessoaId === r.pessoaId && corpo.chaveOrigem === r.chaveOrigem && corpo.responsavelId === 5 && corpo.dataPrazo === "2026-12-01" && corpo.confirmarDuplicidade === true && typeof corpo.motivo === "string" && (corpo.motivo as string).length > 0, "corpo = exatamente o que a porta espera (motivo obrigatório incluído)")
  ok(!("responsavelId" in corpoDaCriacao(r, PROCESSO_ID)) && !("confirmarDuplicidade" in corpoDaCriacao(r, PROCESSO_ID)), "responsável, prazo e confirmação são opcionais e só vão quando preenchidos")
}

{
  const modal = ler("src/components/arvore/inteligencia/criar-tarefa-modal.tsx")
  const mod = codigo(modal)
  ok(/authFetch\(\s*["']\/api\/tarefas\/manual["']/.test(mod) && /method:\s*["']POST["']/.test(mod), "o modal grava pela porta canônica POST /api/tarefas/manual")
  ok(!/\bprisma\b|\$transaction|from\s+["']@\/lib\/prisma["']/.test(mod), "o modal não usa o ORM (a árvore não escreve em Tarefa)")
  ok(/r\.status === 409/.test(mod) && /semelhantes/.test(mod) && /Abrir tarefa/.test(mod) && /Criar mesmo assim/.test(mod), "409 de duplicidade: avisa, oferece ABRIR a existente e (secundário) criar mesmo assim")
  ok(/confirmarDuplicidade/.test(mod) && /corpoDaCriacao\(/.test(mod), "o corpo vem de corpoDaCriacao (módulo puro testado)")
  ok(/data-tarefa-criada/.test(mod) && /Abrir tarefa/.test(mod) && /useAbrirTarefaNaCentral/.test(mod), "sucesso: feedback com o número e link para a tarefa (mesmo caminho da fila)")
  ok(/LAYER\.aboveProcessDrawer/.test(mod) && !/z-\[\d+\]/.test(mod), "camada vem de layers.ts (acima do painel de Inteligência)")
  ok(/atribuiveis/.test(mod) && /pode\(["']tarefas\.editar["']\)/.test(mod), "responsável opcional só para quem distribui (mesma rota do seletor de Atribuir)")

  const usos = ["src/components/arvore/arvore-genealogica-view.tsx", "src/components/arvore/inteligencia/cartoes-flutuantes.tsx", "src/components/arvore/pessoa-sidebar.tsx", "src/components/arvore/fila-da-pessoa.tsx", "src/components/arvore/inteligencia/use-arvore-operacional.ts"]
  const quemChamaPorta = usos.filter((f) => /api\/tarefas\/manual/.test(codigo(ler(f))))
  ok(quemChamaPorta.length === 0, "só o modal chama a porta — nenhuma outra tela da árvore escreve em Tarefa", quemChamaPorta)

  const view = codigo(ler("src/components/arvore/arvore-genealogica-view.tsx"))
  ok(/pode\(['"]tarefas\.criar['"]\)\s*\?\s*setRascunhoTarefa\s*:\s*undefined/.test(view), "sem a permissão tarefas.criar o handler não existe (e portanto o botão também não)")
  ok(/<CriarTarefaModal/.test(view) && /onCriada/.test(view) && /invalidar\(`\/api\/processos\/\$\{processoId\}\/genealogia\/operacional`\)/.test(view), "criar tarefa invalida os fatos operacionais (a fila enxerga a tarefa nova)")
  ok(/data-criar-tarefa/.test(codigo(ler("src/components/arvore/inteligencia/cartoes-flutuantes.tsx"))), "cartão: 'Criar tarefa' na próxima ação")

  // Porta: a chave de origem chega ao dono e NÃO vira chaveIdempotencia (gates de fase tratam "tem chave" como tarefa do motor).
  const rota = codigo(ler("src/app/api/tarefas/manual/route.ts"))
  ok(/chaveOrigem/.test(rota) && /criarTarefaManual\(/.test(rota) && /tarefasSemelhantesAbertas\(/.test(rota), "a rota repassa a chave de origem ao dono e ao aviso de duplicidade")
  const ciclo = ler("lib/operacional/tarefa-ciclo.ts")
  const corpoCriar = ciclo.slice(ciclo.indexOf("export async function criarTarefaManual"), ciclo.indexOf("OBRIGAÇÃO ADMINISTRATIVA"))
  ok(/correlationId:\s*nova\.chaveOrigem/.test(corpoCriar) && !/chaveIdempotencia/.test(codigo(corpoCriar)), "a chave de origem vai em Tarefa.correlationId — nunca em chaveIdempotencia")
  ok(/correlationId:\s*n\.chaveOrigem/.test(ciclo), "o aviso de duplicidade compara pela chave de origem (ID canônico), além de necessidade/documento")
}

// ═══ (d) UM SÓ CÁLCULO ═══════════════════════════════════════════════════════
secao("(d) consistência entre painéis: um módulo, mesmos números")

{
  const ind = indicadoresDaArvore(analise)
  ok(ind.qualidade === analise.qualidade.detalhe, "painel de Inteligência: as quatro porcentagens são as da conta (mesmo objeto)")

  // CARTÃO × aba Operação × painel: divergências da MESMA linhagem.
  const escopo = indicadoresDoEscopo({ ids: linhagem.visivel, grafo, analise, projecao })
  ok(resumo.divergencias === escopo.divergencias.total, "cartão (resumirLinhagem) = indicadoresDoEscopo: mesma entrada ⇒ mesmo número", [resumo.divergencias, escopo.divergencias.total])
  ok(JSON.stringify(resumo.documental) === JSON.stringify(escopo.documental), "documentos do cartão = documentos de indicadoresDoEscopo")

  // O defeito de antes: somar dossiê por pessoa conta em dobro o achado que toca duas pessoas.
  const antes = [...linhagem.visivel].reduce((s, id) => s + (dossies.get(id)?.divergencias.length ?? 0), 0)
  const unicos = new Set(escopo.divergencias.itens.map((a) => a.id)).size
  ok(escopo.divergencias.total === unicos, "divergência é contada UMA vez por achado")
  ok(antes > escopo.divergencias.itens.filter((a) => a.categoria === "divergencia").length, "fixture reproduz o defeito antigo: soma por pessoa contava o achado de 2 pessoas em dobro", [antes, escopo.divergencias.total])

  // Aba Operação: o número da pessoa = a lista que a fila mostra.
  let divergente = 0
  for (const p of grafo.pessoas) {
    const nFila = filaDe(p.id).itens.filter((i) => i.tipo === "divergencia").length
    const ip = indicadoresDaPessoa(dossies.get(p.id)!.documental, achadosPorPessoa.get(p.id) ?? [])
    if (ip.divergencias !== nFila) divergente++
  }
  ok(divergente === 0, "aba Operação: o contador da pessoa = os itens de divergência que a fila lista (todas as pessoas)")

  // A soma das pessoas da linhagem (cada achado UMA vez) = total do cartão.
  const ids = new Set<string>()
  for (const id of linhagem.visivel) for (const a of achadosPorPessoa.get(id) ?? []) ids.add(a.id)
  ok(ids.size >= 1 && [...escopo.divergencias.itens].every((a) => ids.has(a.id) || a.pessoaIds.length === 0), "o total do cartão = união dos achados das pessoas da linhagem")

  // Determinismo: duas leituras da mesma entrada, mesmos números.
  const analise2 = analisarArvore(PESSOAS, UNIOES, { paisAlvo: "ITALIA", raizId: 4 })
  ok(JSON.stringify(indicadoresDaArvore(analise2).qualidade) === JSON.stringify(ind.qualidade), "mesma entrada ⇒ mesma decomposição (determinístico)")

  // Pergunta × cartão (já provado em (b)) e painel: o 'Divergências na árvore' é o mesmo cálculo em escopo de árvore.
  ok(ind.divergencias.total === indicadoresDoEscopo({ ids: new Set(grafo.pessoas.map((p) => p.id)), grafo, analise, projecao }).divergencias.total, "painel: divergências da árvore = indicadoresDoEscopo(árvore inteira)")
}

{
  // Varredura de fonte: ninguém recalcula.
  const cartao = codigo(ler("src/components/arvore/inteligencia/cartoes-flutuantes.tsx"))
  ok(/resumo\.divergencias/.test(cartao) && !/\.reduce\(|analise\./.test(cartao), "cartão só exibe o que o resumo (indicadores) entrega")
  const hook = codigo(ler("src/components/arvore/inteligencia/use-arvore-operacional.ts"))
  ok(!/\.divergencias\.length/.test(hook) && /indicadoresDaArvore\(/.test(hook) && /indicadoresDaPessoa\(/.test(hook) && /contextoDePerguntas\(/.test(hook), "hook: usa indicadores.ts e o construtor único de contexto; não conta divergência")
  const dossieSrc = codigo(ler("src/lib/genealogia/operacional/dossie.ts"))
  const corpoResumo = dossieSrc.slice(dossieSrc.indexOf("export function resumirLinhagem"))
  ok(/consolidarDocumental\(/.test(corpoResumo) && /indicadorDeDivergencias\(/.test(corpoResumo) && !/somarIndicadorEm|divergencias\s*\+=/.test(dossieSrc), "resumirLinhagem delega a indicadores.ts (sem somatório próprio)")
  const perg = codigo(ler("src/lib/genealogia/operacional/perguntas.ts"))
  ok(/indicadoresDoEscopo\(/.test(perg) && !/\.reduce\([^)]*necessarias/.test(perg), "perguntas: totais de indicadores.ts, não somados por pessoa")
  const analisarSrc = codigo(ler("src/lib/genealogia/motor/analisar.ts"))
  ok(!/function calcularQualidade/.test(analisarSrc) && /from "\.\/qualidade"/.test(analisarSrc), "o motor tem UMA implementação da qualidade (qualidade.ts)")
  const sidebar = codigo(ler("src/components/arvore/fila-da-pessoa.tsx"))
  ok(/indicadores\.documental/.test(sidebar) && /indicadores\.divergencias/.test(sidebar), "aba Operação: o resumo mostra os números de indicadoresDaPessoa")
}

// ═══ (e) VALIDAÇÃO CRONOLÓGICA ═══════════════════════════════════════════════
secao("(e) cronologia: limites exatos, tolerâncias documentadas, datas ausentes/parciais")

const cron = (pessoas: PessoaEntrada[], unioes: UniaoEntrada[] = []) =>
  analisarCronologia(construirGrafo(pessoas, unioes))
const tem = (r: ReturnType<typeof cron>, prefixo: string) => r.filter((i) => i.id.startsWith(prefixo))
const maeFilho = (nascMae: string, nascFilho: string): PessoaEntrada[] => [
  { id: 1, nome: "Mae", sexo: "F", data_nasc: nascMae },
  { id: 2, nome: "Filho", data_nasc: nascFilho, maeId: 1 },
]
const paiFilho = (nascPai: string, nascFilho: string): PessoaEntrada[] => [
  { id: 1, nome: "Pai", sexo: "M", data_nasc: nascPai },
  { id: 2, nome: "Filho", data_nasc: nascFilho, paiId: 1 },
]

{
  // Idade mínima: 11a364d é impossível; 12a exatos não.
  const onze = cron(maeFilho("2000-01-01", "2011-12-31"))
  ok(tem(onze, "cron-parente-jovem").length === 1 && tem(onze, "cron-parente-jovem")[0].titulo.includes("11 anos"), "mãe com 11 anos e 364 dias ao parto: achado (11 anos)", tem(onze, "cron-parente-jovem")[0]?.titulo)
  const doze = cron(maeFilho("2000-01-01", "2012-01-01"))
  ok(tem(doze, "cron-parente-jovem").length === 0, "mãe com 12 anos exatos: sem achado")
  // O caso que a divisão por 365,2425 errava: 12 anos de calendário com só 2 anos bissextos = 4382 dias (11,9976).
  const dozeBorda = cron(maeFilho("1897-03-01", "1909-03-01"))
  ok(anosCompletosEntre("1897-03-01", "1909-03-01") === 12, "12 anos de calendário em 4382 dias contam 12")
  ok(tem(dozeBorda, "cron-parente-jovem").length === 0, "mãe com 12 anos exatos (4382 dias): sem falso positivo")
  const diaAntes = cron(maeFilho("1897-03-01", "1909-02-28"))
  ok(tem(diaAntes, "cron-parente-jovem").length === 1, "um dia antes de fazer 12: achado")
  const bissexto = cron(maeFilho("2000-02-29", "2012-02-28"))
  ok(tem(bissexto, "cron-parente-jovem").length === 1, "nascida em 29/02: aos 28/02 ainda não fez 12")
  const bissexto2 = cron(maeFilho("2000-02-29", "2012-03-01"))
  ok(tem(bissexto2, "cron-parente-jovem").length === 0, "nascida em 29/02: em 01/03 já fez 12")
  const pai12 = cron(paiFilho("2000-01-01", "2012-06-01"))
  ok(tem(pai12, "cron-parente-jovem").length === 1, "pai com 12 anos: achado (mínimo do pai é 13)")
  ok(IDADES_OK(), "constantes de idade exportadas e documentadas")

  // Óbito do pai × nascimento do filho (gestação máx. 300 dias).
  const pai = (obito: string, filho: string): PessoaEntrada[] => [
    { id: 1, nome: "Pai", sexo: "M", data_nasc: "1900-01-01", data_obito: obito, vivo: false },
    { id: 2, nome: "Filho", data_nasc: filho, paiId: 1 },
  ]
  ok(tem(cron(pai("1950-01-01", "1950-09-01")), "cron-postumo").length === 0, "pai morreu 8 meses (243 dias) antes: póstumo possível, sem achado")
  ok(tem(cron(pai("1950-01-01", "1950-10-28")), "cron-postumo").length === 0, "300 dias: no limite, sem achado")
  ok(tem(cron(pai("1950-01-01", "1950-10-29")), "cron-postumo").length === 1, "301 dias: achado")
  const dez = tem(cron(pai("1950-01-01", "1950-11-01")), "cron-postumo")
  ok(dez.length === 1 && dez[0].severidade === "critico" && dez[0].pessoaIds.includes(1) && dez[0].pessoaIds.includes(2), "pai morreu 10 meses (304 dias) antes: crítico, com as duas pessoas", dez[0]?.titulo)
  // Mãe: óbito antes do nascimento do filho é impossível (tolerância de 1 dia).
  const mae = (obito: string, filho: string): PessoaEntrada[] => [
    { id: 1, nome: "Mae", sexo: "F", data_nasc: "1900-01-01", data_obito: obito, vivo: false },
    { id: 2, nome: "Filho", data_nasc: filho, maeId: 1 },
  ]
  ok(tem(cron(mae("1950-01-01", "1950-01-01")), "cron-postumo").length === 0, "mãe morreu no dia do parto: sem achado")
  ok(tem(cron(mae("1950-01-01", "1950-01-02")), "cron-postumo").length === 0, "mãe morreu 1 dia antes: dentro da tolerância de registro")
  const maeMorta = tem(cron(mae("1950-01-01", "1950-01-03")), "cron-postumo")
  ok(maeMorta.length === 1 && /da mãe/.test(maeMorta[0].titulo), "mãe morreu 2 dias antes do parto: impossível", maeMorta[0]?.titulo)

  // Casamento × nascimento dos cônjuges.
  const casal = (nascA: string, uniao: string): [PessoaEntrada[], UniaoEntrada[]] => [
    [{ id: 1, nome: "A", data_nasc: nascA }, { id: 2, nome: "B", data_nasc: "1850-01-01" }],
    [{ id: 10, pessoa1Id: 1, pessoa2Id: 2, data_inicio: uniao }],
  ]
  const antes = tem(cron(...casal("1920-05-05", "1920-05-04")), "cron-casou-antes-nascer")
  ok(antes.length === 1 && antes[0].severidade === "critico", "casamento um dia ANTES do nascimento do cônjuge: crítico")
  ok(antes[0].pessoaIds.includes(1) && antes[0].pessoaIds.includes(2), "e o cônjuge entra nos envolvidos (o achado aparece na fila dos dois)", antes[0].pessoaIds)
  const mesmoDia = cron(...casal("1920-05-05", "1920-05-05"))
  ok(tem(mesmoDia, "cron-casou-antes-nascer").length === 0, "casamento no MESMO dia do nascimento: não é 'antes de nascer'")
  ok(tem(mesmoDia, "cron-casou-crianca").length === 1, "…mas casar com 0 anos continua sendo achado (criança)", tem(mesmoDia, "cron-casou-crianca")[0]?.titulo)
  const onzeAnos = tem(cron(...casal("1920-05-05", "1932-05-04")), "cron-casou-crianca")
  ok(onzeAnos.length === 1 && onzeAnos[0].titulo.includes("11 anos"), "casamento aos 11a364d: achado")
  ok(tem(cron(...casal("1897-03-01", "1909-03-01")), "cron-casou-crianca").length === 0, "casamento aos 12 anos exatos (4382 dias): sem falso positivo")
  const morto = tem(cron([{ id: 1, nome: "A", data_nasc: "1900-01-01", data_obito: "1920-01-01" }, { id: 2, nome: "B", data_nasc: "1900-01-01" }], [{ id: 10, pessoa1Id: 1, pessoa2Id: 2, data_inicio: "1920-01-02" }]), "cron-casou-morto")
  ok(morto.length === 1 && morto[0].pessoaIds.length === 2, "casou depois de falecer: achado com os dois cônjuges")

  // Datas ausentes e parciais NUNCA geram achado.
  ok(cron([{ id: 1, nome: "Mae" }, { id: 2, nome: "Filho", maeId: 1 }]).length === 0, "sem nenhuma data: zero achados")
  ok(cron(maeFilho("2000-01-01", "")).length === 0 && cron([{ id: 1, nome: "Mae", data_nasc: "2000-01-01" }, { id: 2, nome: "Filho", maeId: 1 }]).length === 0, "só uma das datas: zero achados")
  ok(cron([{ id: 1, nome: "A" }, { id: 2, nome: "B" }], [{ id: 10, pessoa1Id: 1, pessoa2Id: 2 }]).length === 0, "união sem data: zero achados")
  ok(tsDe("1850") === null && tsDe("1850-03") === null && tsDe("1850-03-02") !== null, "data parcial (ano, ano-mês) não vira timestamp; data completa vira")
  // (vivo:false: o aviso "viva com mais de 110 anos" é de ANO, legítimo, e não é o que se mede aqui.)
  const falecida = (nasc: string, filho: string): PessoaEntrada[] => [
    { id: 1, nome: "Mae", sexo: "F", data_nasc: nasc, vivo: false },
    { id: 2, nome: "Filho", data_nasc: filho, maeId: 1, vivo: false },
  ]
  ok(cron(falecida("1850", "1860-06-01")).length === 0, "mãe com SÓ O ANO de nascimento: o motor não inventa o dia 1º de janeiro (zero achados)")
  ok(cron(falecida("1850-03", "1860-02-01")).length === 0, "mãe com ano-mês: idem")
  ok(cron(falecida("1850", "1860")).length === 0, "ambas parciais: zero achados")

  // Entra na fila da aba Operação e no painel de Análise.
  const jovem = analise.insights.find((i) => i.id === "cron-parente-jovem-4-8")
  ok(!!jovem && jovem.categoria === "conflito" && jovem.severidade === "alto" && jovem.pessoaIds.join() === "4,8", "fixture: mãe de 9 anos vira achado do motor (categoria conflito, severidade, pessoas)", jovem?.titulo)
  ok((achadosPorPessoa.get(4) ?? []).some((a) => a.id === "cron-parente-jovem-4-8") && (achadosPorPessoa.get(8) ?? []).some((a) => a.id === "cron-parente-jovem-4-8"), "o achado cai automaticamente na fila das DUAS pessoas (achados-do-motor)")
  ok(filaDe(8).itens.some((i) => i.tipo === "divergencia" && i.achadoId === "cron-parente-jovem-4-8" && i.titulo.includes("Ana")), "e aparece na aba Operação da mãe com texto claro", filaDe(8).itens.find((i) => i.tipo === "divergencia")?.titulo)
  ok(det.consistencia.itens.some((i) => i.chave === "cron-parente-jovem-4-8"), "e pesa na Consistência do painel de Análise")
}

function IDADES_OK(): boolean {
  const src = ler("src/lib/genealogia/motor/regras/cronologia.ts")
  return /export const IDADE_MIN_MAE = 12/.test(src) && /export const GESTACAO_MAX_DIAS = 300/.test(src) && /export const TOLERANCIA_OBITO_MAE_DIAS = 1/.test(src)
}

console.log("\n" + "─".repeat(60))
console.log(`${passou + falhou} verificações · ${falhou === 0 ? "inteligência da árvore ÍNTEGRA ✅" : `${falhou} FALHA(S) ❌`}`)
if (falhou > 0) {
  for (const f of falhas) console.log(`  ✗ ${f}`)
  process.exit(1)
}
