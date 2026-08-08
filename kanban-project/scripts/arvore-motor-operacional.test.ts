// scripts/arvore-motor-operacional.test.ts
// ============================================================================
// MOTOR OPERACIONAL DA ÁRVORE — suíte pura, sem banco e sem rede.
//
// Cobre as três peças que transformaram a árvore de desenho em motor:
//   1. LINHAGENS — cadeia de transmissão por requerente, dante causa,
//      compartilhamento entre requerentes e quem não influencia ninguém;
//   2. FOCO — quem fica em pleno, quem recua, quem some; e a regra que
//      protege da poda quem está na linha ou ancora alguém que está;
//   3. DOSSIÊ — projeção por pessoa das exigências, divergências, tarefas e
//      valores, com a próxima ação e a urgência ponderada por dependentes.
//
// Também trava três INVARIANTES que, se caírem, quebram a promessa feita ao
// usuário: o foco não muda topologia; a árvore não converte moeda; e sem SLA
// configurado ela não inventa prazo.
//
// Rodar: npx tsx scripts/arvore-motor-operacional.test.ts
// ============================================================================

import { construirGrafo } from "@/src/lib/genealogia/motor/grafo"
import { analisarArvore } from "@/src/lib/genealogia/motor/analisar"
import {
  calcularLinhagem,
  ehRequerente,
  mapaDeLinhagens,
  requerentesDaArvore,
  requerentesQueDependemDe,
} from "@/src/lib/genealogia/motor/linhagens"
import {
  calcularFoco,
  gruposRecolhiveis,
  opacidadeDe,
  preferenciasPadrao,
  OPACIDADE_ESMAECIDA,
  MINIMO_PARA_RECOLHER,
} from "@/src/lib/genealogia/navegacao/foco"
import {
  decidirProximaAcao,
  projetarDossies,
  resumirLinhagem,
  type FatosOperacionais,
} from "@/src/lib/genealogia/operacional/dossie"
import { responder, responderTodas } from "@/src/lib/genealogia/operacional/perguntas"
import {
  diagnosticar,
  resolveNextGenealogyAction,
  tarefaVencida,
} from "@/src/lib/genealogia/operacional/diagnostico"
import { analisarIntegridade } from "@/src/lib/genealogia/motor/regras/integridade"
import {
  compararLinhagens,
  relacionadosDaLinhagem,
  trilhaDaLinhagem,
} from "@/src/lib/genealogia/motor/linhagens"
import type { PessoaEntrada, UniaoEntrada } from "@/src/lib/genealogia/motor/tipos"

let passed = 0
let failed = 0
const falhas: string[] = []

function ok(cond: boolean, nome: string, extra?: unknown) {
  if (cond) {
    passed++
    console.log(`  ✅ ${nome}`)
  } else {
    failed++
    falhas.push(nome)
    console.log(`  ❌ ${nome}${extra !== undefined ? ` — ${JSON.stringify(extra)}` : ""}`)
  }
}

function secao(titulo: string) {
  console.log(`\n${titulo}`)
}

// ── CENÁRIO ─────────────────────────────────────────────────────────────────
// Bisavô italiano (1) → avô (2) → pai (3) → dois requerentes irmãos (4 e 5).
// O avô tem uma irmã (6) que casou (7) e teve seis filhos (10..15) — o ramo
// colateral grande que polui a tela e que o recolhimento existe para conter.
// O pai é casado com (8), que não transmite mas cuja certidão é exigida.
// (9) é uma prima solta, sem influência em ninguém.

const PESSOAS: PessoaEntrada[] = [
  { id: 1, nome: "Giuseppe", sobrenome: "Rossi", sexo: "M", pais_nasc: "Itália", data_nasc: "1880-03-02" },
  { id: 2, nome: "Antonio", sobrenome: "Rossi", sexo: "M", pais_nasc: "Brasil", data_nasc: "1915-06-11", paiId: 1 },
  { id: 3, nome: "Carlos", sobrenome: "Rossi", sexo: "M", pais_nasc: "Brasil", data_nasc: "1950-01-20", paiId: 2 },
  { id: 4, nome: "Marcos", sobrenome: "Rossi", sexo: "M", pais_nasc: "Brasil", data_nasc: "1980-05-05", paiId: 3, maeId: 8, requerente: "maior" },
  { id: 5, nome: "Paula", sobrenome: "Rossi", sexo: "F", pais_nasc: "Brasil", data_nasc: "1983-09-09", paiId: 3, maeId: 8, requerente: "maior" },
  { id: 6, nome: "Maria", sobrenome: "Rossi", sexo: "F", pais_nasc: "Brasil", data_nasc: "1918-02-02", paiId: 1 },
  { id: 7, nome: "Joao", sobrenome: "Souza", sexo: "M", pais_nasc: "Brasil", data_nasc: "1916-07-07" },
  { id: 8, nome: "Ana", sobrenome: "Lima", sexo: "F", pais_nasc: "Brasil", data_nasc: "1955-04-04" },
  { id: 9, nome: "Solta", sobrenome: "Avulsa", sexo: "F", pais_nasc: "Brasil" },
  ...Array.from({ length: 6 }, (_, i) => ({
    id: 10 + i,
    nome: `Primo${i + 1}`,
    sobrenome: "Souza",
    sexo: "M",
    pais_nasc: "Brasil",
    data_nasc: `194${i}-01-01`,
    paiId: 7,
    maeId: 6,
  })),
]

const UNIOES: UniaoEntrada[] = [
  { id: 100, pessoa1Id: 3, pessoa2Id: 8, data_inicio: "1978-10-10" },
  { id: 101, pessoa1Id: 6, pessoa2Id: 7, data_inicio: "1939-05-05" },
]

const grafo = construirGrafo(PESSOAS, UNIOES)
const analise = analisarArvore(PESSOAS, UNIOES, { paisAlvo: "ITALIA", raizId: 4 })

// ── 1. LINHAGENS ────────────────────────────────────────────────────────────
secao("1) linhagens multi-requerente")

const requerentes = requerentesDaArvore(grafo)
ok(requerentes.length === 2, "encontra os dois requerentes marcados", requerentes.map((p) => p.id))
ok(!ehRequerente(PESSOAS[0]), "quem não está marcado não é requerente")

const mapa = mapaDeLinhagens(grafo, "ITALIA", 4)
ok(mapa.linhagens.length === 2, "uma linhagem por requerente", mapa.linhagens.length)

const lMarcos = mapa.porRequerente.get(4)!
ok(lMarcos.danteCausaId === 1, "dante causa é o ascendente italiano mais próximo", lMarcos.danteCausaId)
ok(
  JSON.stringify(lMarcos.cadeia) === JSON.stringify([4, 3, 2, 1]),
  "cadeia vai do requerente ao dante causa, em ordem",
  lMarcos.cadeia,
)
ok(lMarcos.geracoes === 3, "conta as gerações da cadeia", lMarcos.geracoes)
ok(
  lMarcos.conjugesDaLinha.has(8) && !lMarcos.naLinha.has(8),
  "cônjuge da linha entra em visível sem entrar na cadeia",
)
ok(lMarcos.visivel.has(8) && lMarcos.visivel.has(1), "visível soma cadeia e cônjuges")

// A troca de requerente é o que precisa ser instantâneo e correto.
const lPaula = mapa.porRequerente.get(5)!
ok(lPaula.cadeia[0] === 5 && lPaula.danteCausaId === 1, "a outra requerente tem cadeia própria", lPaula.cadeia)
ok(
  requerentesQueDependemDe(mapa, 1).length === 2,
  "o bisavô é compartilhado pelos dois requerentes",
  requerentesQueDependemDe(mapa, 1),
)
ok(
  requerentesQueDependemDe(mapa, 4).length === 1,
  "cada requerente só depende de si na própria ponta",
)

ok(mapa.semInfluencia.has(9), "pessoa solta é marcada como sem influência")
ok(!mapa.semInfluencia.has(8), "cônjuge de quem está na linha NÃO é sem influência")
ok(mapa.semInfluencia.has(10), "primo colateral é sem influência")
ok(mapa.papeis.get(1) === "dante_causa", "papel do dante causa", mapa.papeis.get(1))
ok(mapa.papeis.get(4) === "requerente", "papel do requerente", mapa.papeis.get(4))
ok(mapa.papeis.get(8) === "conjuge", "papel do cônjuge da linha", mapa.papeis.get(8))

// Sem país-alvo a árvore não pode afirmar transmissão: cai na cadeia mais
// profunda e NÃO promove ninguém a dante causa comprovado.
const semPais = calcularLinhagem(grafo, 4, null)
ok(semPais.cadeia.length > 1, "sem país-alvo ainda há cadeia (a mais profunda)", semPais.cadeia)

// Determinismo: duas execuções sobre a mesma entrada dão o mesmo resultado.
const mapa2 = mapaDeLinhagens(grafo, "ITALIA", 4)
ok(
  JSON.stringify(mapa.linhagens.map((l) => l.cadeia)) ===
    JSON.stringify(mapa2.linhagens.map((l) => l.cadeia)),
  "mapa de linhagens é determinístico",
)

// ── 2. FOCO ─────────────────────────────────────────────────────────────────
secao("2) foco, esmaecimento e ramos recolhíveis")

const prefsTodos = { ...preferenciasPadrao(), modo: "todos" as const }
const focoTodos = calcularFoco(grafo, lMarcos, prefsTodos)
// INVARIANTE: a vista normal é a árvore de sempre. Nem esmaecimento, nem
// recolhimento automático — abrir a árvore não pode mudar o que ela mostra.
ok(
  [...focoTodos.estados.values()].every((e) => e === "pleno"),
  "no modo todos TODA pessoa fica em pleno",
  [...focoTodos.estados.entries()].filter(([, e]) => e !== "pleno"),
)
ok(focoTodos.gruposAtivos.length === 0, "no modo todos nenhum ramo é recolhido por padrão")
ok(focoTodos.totalRecuado === 0, "no modo todos ninguém recua")

const focoLinha = calcularFoco(grafo, lMarcos, {
  ...preferenciasPadrao(),
  modo: "linhagem",
  estilo: "esmaecer",
})
ok(focoLinha.estados.get(1) === "pleno", "dante causa fica em pleno na linhagem")
ok(focoLinha.estados.get(8) === "pleno", "cônjuge da linha fica em pleno")
ok(focoLinha.estados.get(9) === "esmaecido", "quem está fora recua a 20%", focoLinha.estados.get(9))
ok(opacidadeDe("esmaecido") === OPACIDADE_ESMAECIDA, "opacidade do esmaecido é a constante única")
ok(opacidadeDe("pleno") === 1, "pleno é opacidade cheia")

const focoOculto = calcularFoco(grafo, lMarcos, {
  ...preferenciasPadrao(),
  modo: "linhagem",
  estilo: "ocultar",
})
ok(focoOculto.estados.get(9) === "oculto", "no estilo ocultar quem está fora some")
ok(focoOculto.estados.get(4) === "pleno", "o requerente nunca some")

// INVARIANTE: o foco decide APENAS estado. Nenhuma pessoa entra ou sai do mapa.
ok(
  focoLinha.estados.size === PESSOAS.length && focoOculto.estados.size === PESSOAS.length,
  "o foco cobre todas as pessoas, sempre — não muda a topologia",
)
ok(
  focoLinha.totalPleno + focoLinha.totalRecuado === PESSOAS.length,
  "pleno + recuado fecha o total (nenhuma pessoa perdida)",
)

// Fixar e realçar vencem o esmaecimento — foi o usuário que pediu para ver.
const focoRealce = calcularFoco(grafo, lMarcos, {
  ...preferenciasPadrao(),
  modo: "linhagem",
  estilo: "ocultar",
  realcados: new Set([9]),
})
ok(focoRealce.estados.get(9) === "pleno", "realce de filtro vence o modo linhagem")

// Recolhimento: os seis primos formam grupo; ninguém da linha entra nele.
const grupos = gruposRecolhiveis(grafo, lMarcos.visivel)
const grupoPrimos = grupos.find((g) => g.membros.includes(10))
ok(grupoPrimos != null, "o ramo de seis primos vira grupo recolhível")
ok(
  grupoPrimos!.membros.length >= MINIMO_PARA_RECOLHER,
  "só recolhe a partir do mínimo configurado",
  grupoPrimos!.membros.length,
)
ok(grupoPrimos!.rotulo === "+6 irmãos", "o rótulo já vem pronto e no plural certo", grupoPrimos!.rotulo)
ok(
  grupos.every((g) => g.membros.every((id) => !lMarcos.visivel.has(id))),
  "NENHUM grupo recolhe alguém que está na linha",
)

// A regra que impede esconder trabalho: quem ancora descendente protegido fica.
const grafoNeto = construirGrafo(
  [
    ...PESSOAS,
    { id: 200, nome: "Neto", sobrenome: "Souza", paiId: 10, pais_nasc: "Brasil" },
  ],
  UNIOES,
)
const gruposNeto = gruposRecolhiveis(grafoNeto, new Set([...lMarcos.visivel, 200]))
const grupoComNeto = gruposNeto.find((g) => g.ancoraId === 7)
ok(
  grupoComNeto == null || !grupoComNeto.membros.includes(10),
  "não recolhe quem ancora um descendente protegido",
)

const focoExpandido = calcularFoco(grafo, lMarcos, {
  ...preferenciasPadrao(),
  modo: "linhagem",
  estilo: "esmaecer",
  gruposExpandidos: new Set([grupoPrimos!.chave]),
})
ok(focoExpandido.estados.get(10) !== "oculto", "expandir o grupo devolve os membros à tela")

// ── 3. DOSSIÊ ───────────────────────────────────────────────────────────────
secao("3) dossiê operacional por pessoa")

const FATOS: FatosOperacionais = {
  necessidades: [
    { id: 1, pessoaId: 1, status: "PENDENTE", obrigatoriedade: "OBRIGATORIA" },
    { id: 2, pessoaId: 1, status: "NAO_LOCALIZADA", obrigatoriedade: "OBRIGATORIA" },
    { id: 3, pessoaId: 2, status: "ATENDIDA", obrigatoriedade: "OBRIGATORIA" },
    { id: 4, pessoaId: 3, status: "EM_ATENDIMENTO", obrigatoriedade: "OBRIGATORIA" },
    { id: 5, pessoaId: 4, status: "DISPENSADA", obrigatoriedade: "OBRIGATORIA" },
    { id: 6, pessoaId: 4, status: "PENDENTE", obrigatoriedade: "OPCIONAL" },
    { id: 7, uniaoId: 100, status: "PENDENTE", obrigatoriedade: "OBRIGATORIA" },
  ],
  tarefas: [
    { id: 10, pessoaId: 3, titulo: "Solicitar certidão", concluida: false, statusTarefa: "EM_ANDAMENTO", necessidadeId: 4 },
    { id: 11, pessoaId: null, titulo: "Tarefa por necessidade", concluida: false, statusTarefa: "NAO_INICIADA", necessidadeId: 1 },
    { id: 12, pessoaId: 3, titulo: "Já feita", concluida: true, necessidadeId: 4 },
    { id: 13, pessoaId: null, titulo: "Tarefa do processo", concluida: false, necessidadeId: null },
  ],
  lancamentos: [
    { id: 20, pessoaId: 1, natureza: "CUSTO", descricao: "CUS-1", moeda: "EUR", valor: 100, recebido: 40, saldo: 60 },
    { id: 21, pessoaId: 1, natureza: "CUSTO", descricao: "CUS-2", moeda: "BRL", valor: 250, recebido: 0, saldo: 250 },
    { id: 22, pessoaId: 4, natureza: "RECEITA", descricao: "REC-1", moeda: "BRL", valor: 5000, recebido: 1000, saldo: 4000 },
  ],
  financeiroVisivel: true,
}

const dossies = projetarDossies({ grafo, analise, mapa, fatos: FATOS })

const d1 = dossies.get(1)!
ok(d1.documental.necessarias === 2, "conta só as obrigatórias no denominador", d1.documental.necessarias)
ok(d1.documental.naoLocalizadas === 1, "propaga o status NAO_LOCALIZADA")
ok(d1.situacao === "bloqueado", "não localizado bloqueia a situação da pessoa", d1.situacao)
ok(
  d1.proximaAcao?.includes("não localizado") === true,
  "a próxima ação aponta o bloqueio primeiro",
  d1.proximaAcao,
)
ok(d1.requerentesDependentes.length === 2, "o dossiê sabe quantos requerentes dependem da pessoa")

const d3 = dossies.get(3)!
ok(d3.tarefasAbertas.length === 1, "tarefa concluída sai das abertas", d3.tarefasAbertas.length)
ok(d3.tarefasConcluidas === 1, "e é contada como concluída")

// A tarefa 11 não tem pessoaId: ela pertence à pessoa da necessidade que a criou.
const dNec = dossies.get(1)!
ok(
  dNec.tarefasAbertas.some((t) => t.id === 11),
  "tarefa sem pessoaId é atribuída pela necessidade de origem",
)
ok(
  [...dossies.values()].every((d) => !d.tarefasAbertas.some((t) => t.id === 13)),
  "tarefa sem necessidade é do processo — não vira tarefa de ninguém",
)

// Certidão de casamento é exigida da UNIÃO e aparece nas duas pessoas dela.
const d3Uniao = dossies.get(3)!.documental
const d8Uniao = dossies.get(8)!.documental
ok(
  d3Uniao.necessarias === 2 && d8Uniao.necessarias === 1,
  "a exigência da união soma nas duas pessoas",
  [d3Uniao.necessarias, d8Uniao.necessarias],
)

// INVARIANTE: nunca converter moeda. EUR e BRL ficam em linhas separadas.
ok(d1.custos.length === 2, "custos ficam separados por moeda, sem conversão", d1.custos)
ok(
  d1.custos.find((c) => c.moeda === "EUR")?.valor === 100 &&
    d1.custos.find((c) => c.moeda === "BRL")?.valor === 250,
  "cada moeda mantém o próprio total",
)
ok(dossies.get(4)!.receitas[0]?.valor === 5000, "receita da pessoa vem do lançamento dela")

// Urgência: mesma pendência vale mais em quem sustenta mais requerentes.
const soloComMesmaPendencia = decidirProximaAcao({
  ...d1,
  requerentesDependentes: [4],
})
ok(soloComMesmaPendencia === d1.proximaAcao, "a próxima ação não depende de quantos dependem")
ok(
  d1.urgencia > dossies.get(3)!.urgencia,
  "quem bloqueia dois requerentes é mais urgente",
  [d1.urgencia, dossies.get(3)!.urgencia],
)

// Sem pendência alguma a resposta honesta é null, não uma sugestão inventada.
const limpo = decidirProximaAcao({
  ...d1,
  documental: { ...d1.documental, naoLocalizadas: 0, pendentes: 0, emAtendimento: 0 },
  divergencias: [],
  tarefasAbertas: [],
})
ok(limpo === null, "sem pendência, a próxima ação é ausência de ação", limpo)

// ── 4. RESUMO DA LINHAGEM ───────────────────────────────────────────────────
secao("4) resumo da linhagem")

const resumo = resumirLinhagem(lMarcos, dossies, null)
ok(resumo.requerenteId === 4, "o resumo é da linhagem pedida")
ok(resumo.pessoas === lMarcos.visivel.size, "conta as pessoas visíveis da linha")
ok(resumo.documental.necessarias > 0, "consolida as exigências da linha inteira")
ok(resumo.focoId === 1, "aponta a pessoa mais urgente da linha", resumo.focoId)
ok(resumo.proximaAcao?.startsWith("Giuseppe") === true, "a próxima ação nomeia a pessoa", resumo.proximaAcao)

// INVARIANTE: sem SLA configurado, a árvore NÃO inventa prazo.
ok(resumo.prazo === null, "sem projeção de SLA o prazo é nulo, não estimado")
const comPrazo = resumirLinhagem(lMarcos, dossies, {
  rotuloDias: "Vence em 3 dias",
  rotuloStatus: "Próximo do vencimento",
  status: "ATENCAO",
  diasParaVencimento: 3,
  prazoPrevisto: "2026-08-10T00:00:00.000Z",
  configurado: true,
})
ok(comPrazo.prazo?.rotuloDias === "Vence em 3 dias", "quando há SLA, o prazo vem dele intacto")

// ── 5. PERGUNTAS ────────────────────────────────────────────────────────────
secao("5) perguntas determinísticas")

const ctxPerguntas = { grafo, analise, mapa, dossies, linhagem: lMarcos }
const todas = responderTodas(ctxPerguntas)
ok(todas.length === 5, "responde as cinco perguntas do escopo", todas.length)
ok(
  todas.every((r) => r.resumo.trim().length > 0 && r.fonte.trim().length > 0),
  "toda resposta tem resumo e fonte declarada",
)

const transmite = responder("quem_transmite", ctxPerguntas)
ok(transmite.resumo.includes("Giuseppe"), "identifica quem transmite", transmite.resumo)
ok(transmite.itens.length === lMarcos.cadeia.length, "lista a cadeia inteira como apoio")

const impede = responder("o_que_impede", ctxPerguntas)
ok(impede.itens.some((i) => i.pessoaId === 1), "aponta o documento não localizado como impedimento")

// Sem cadeia, a resposta é "não dá para afirmar" — nunca um palpite.
const grafoSolto = construirGrafo([{ id: 1, nome: "Sozinho", requerente: "maior" }], [])
const mapaSolto = mapaDeLinhagens(grafoSolto, "ITALIA", 1)
const semCadeia = responder("quem_transmite", {
  grafo: grafoSolto,
  analise: null,
  mapa: mapaSolto,
  dossies: new Map(),
  linhagem: mapaSolto.porRequerente.get(1)!,
})
ok(
  semCadeia.resumo.startsWith("Não dá para afirmar"),
  "sem ascendente, a resposta declara que não sabe",
  semCadeia.resumo,
)

// ── 5b. BREADCRUMB E RELACIONADOS ───────────────────────────────────────────
secao("5b) trilha da linhagem e relacionados")

const trilha = trilhaDaLinhagem(grafo, lMarcos, mapa)
ok(trilha.length === lMarcos.cadeia.length, "a trilha tem um degrau por pessoa da cadeia")
ok(trilha[0].rotulo === "Requerente", "o primeiro degrau é o requerente", trilha[0].rotulo)
ok(trilha[1].rotulo.toLowerCase().startsWith("pai"), "o segundo degrau é o pai", trilha[1].rotulo)
ok(
  trilha[trilha.length - 1].ehDanteCausa,
  "o último degrau é marcado como ascendente transmissor",
)
ok(
  trilha[trilha.length - 1].compartilhadoPor === 2,
  "o degrau compartilhado sabe quantos requerentes dependem dele",
  trilha[trilha.length - 1].compartilhadoPor,
)
// A trilha é PROJEÇÃO: cada degrau aponta para um id que já existe na árvore.
ok(
  trilha.every((d) => grafo.existe(d.pessoaId)),
  "todo degrau aponta para um nó real da árvore (sem cópia)",
)

const relacionados = relacionadosDaLinhagem(grafo, lMarcos)
ok(relacionados.has(6), "irmã do avô entra em relacionados")
ok(relacionados.has(5), "a outra requerente (irmã) entra em relacionados")
ok(
  [...relacionados].every((id) => !lMarcos.visivel.has(id)),
  "relacionados NUNCA repete quem já está visível na linha",
)
// Regra que protege o cálculo documental: relacionado não vira linhagem.
ok(
  [...relacionados].every((id) => !lMarcos.naLinha.has(id)),
  "pessoa relacionada não entra na cadeia de transmissão",
)

// ── 5c. INTEGRIDADE ESTRUTURAL ──────────────────────────────────────────────
secao("5c) integridade estrutural")

// Árvore sã: nenhuma invenção de problema.
const integroLimpo = analisarIntegridade(grafo, { requerenteIds: [4, 5] })
ok(integroLimpo.length === 0, "árvore consistente não gera nenhum achado", integroLimpo.map((i) => i.id))

const gAuto = construirGrafo([{ id: 1, nome: "Auto", paiId: 1 }], [])
const rAuto = analisarIntegridade(gAuto)
ok(rAuto.some((i) => i.id === "int-auto-vinculo-1"), "detecta pessoa ligada a si mesma")
ok(rAuto[0].severidade === "critico", "auto-vínculo é crítico")

const gCiclo = construirGrafo(
  [
    { id: 1, nome: "A", paiId: 2 },
    { id: 2, nome: "B", paiId: 3 },
    { id: 3, nome: "C", paiId: 1 },
  ],
  [],
)
const rCiclo = analisarIntegridade(gCiclo)
ok(rCiclo.some((i) => i.id.startsWith("int-ciclo-")), "detecta ciclo genealógico", rCiclo.map((i) => i.id))
ok(
  rCiclo.filter((i) => i.id.startsWith("int-ciclo-")).length === 1,
  "o mesmo ciclo é reportado UMA vez, não três",
)

const gUniaoDupla = construirGrafo(
  [
    { id: 1, nome: "X" },
    { id: 2, nome: "Y" },
  ],
  [
    { id: 10, pessoa1Id: 1, pessoa2Id: 2 },
    { id: 11, pessoa1Id: 1, pessoa2Id: 2 },
  ],
)
ok(
  analisarIntegridade(gUniaoDupla).some((i) => i.id.startsWith("int-uniao-duplicada-")),
  "detecta duas uniões abertas entre o mesmo par",
)
// Recasamento após término NÃO é duplicidade.
const gRecasou = construirGrafo(
  [
    { id: 1, nome: "X" },
    { id: 2, nome: "Y" },
  ],
  [
    { id: 10, pessoa1Id: 1, pessoa2Id: 2, data_fim: "1990-01-01" },
    { id: 11, pessoa1Id: 1, pessoa2Id: 2 },
  ],
)
ok(
  !analisarIntegridade(gRecasou).some((i) => i.id.startsWith("int-uniao-duplicada-")),
  "união encerrada + nova união NÃO é sinalizada (não inventa problema)",
)

const gRamoSolto = construirGrafo(
  [
    { id: 1, nome: "Tronco" },
    { id: 2, nome: "Filho", paiId: 1 },
    { id: 50, nome: "Solto A" },
    { id: 51, nome: "Solto B", paiId: 50 },
  ],
  [],
)
ok(
  analisarIntegridade(gRamoSolto).some((i) => i.id.startsWith("int-ramo-solto-")),
  "detecta ramo desconectado com 2+ pessoas",
)
// Pessoa isolada é cadastro em andamento, não ramo órfão.
const gUmaSolta = construirGrafo(
  [
    { id: 1, nome: "Tronco" },
    { id: 2, nome: "Filho", paiId: 1 },
    { id: 50, nome: "Recem cadastrada" },
  ],
  [],
)
ok(
  !analisarIntegridade(gUmaSolta).some((i) => i.id.startsWith("int-ramo-solto-")),
  "pessoa isolada sozinha NÃO vira ramo órfão",
)

const gReqSemLinha = construirGrafo([{ id: 7, nome: "Sem pais", requerente: "maior" }], [])
ok(
  analisarIntegridade(gReqSemLinha, { requerenteIds: [7] }).some(
    (i) => i.id === "int-requerente-sem-linha-7",
  ),
  "detecta requerente sem nenhum ascendente",
)
ok(
  analisarIntegridade(gReqSemLinha).length === 0,
  "sem a lista de requerentes, NÃO infere requerente (não inventa)",
)

// ── 5d. DIAGNÓSTICO E PRÓXIMA AÇÃO ──────────────────────────────────────────
secao("5d) diagnóstico e próxima melhor ação")

const HOJE = new Date("2026-08-08T12:00:00.000Z")

const diag = diagnosticar({
  grafo,
  analise,
  mapa,
  dossies,
  linhagem: lMarcos,
  prazo: null,
  agora: HOJE,
})
ok(diag.saude === "critico", "documento não localizado torna o processo CRÍTICO", diag.saude)
ok(diag.criticos >= 1, "conta ao menos um impeditivo", diag.criticos)
ok(
  diag.problemas.some((p) => p.categoria === "bloqueio_documental" && p.pessoaId === 1),
  "encontra o documento não localizado do bisavô",
)
ok(
  diag.problemas.some((p) => p.categoria === "documento_ausente"),
  "encontra exigência documental pendente",
)
ok(
  diag.problemas.every((p) => p.fonte.trim().length > 0 && p.acao.trim().length > 0),
  "todo problema tem FONTE e AÇÃO declaradas",
)
ok(
  diag.problemas.some((p) => p.impacto.includes("Marcos") || p.impacto.includes("linhagens")),
  "o impacto nomeia as linhagens afetadas",
)
// Ordem determinística: crítico antes de atenção.
ok(
  diag.problemas[0].impeditivo,
  "a lista começa pelo impeditivo",
  diag.problemas[0].categoria,
)

// NÃO INVENTA PROBLEMA: árvore genuinamente sã → nenhum achado.
//
// A primeira versão deste fixture deixava a naturalização do dante causa em
// branco, e o motor apontou "naturalização não verificada" — corretamente: é o
// ponto que mais derruba processo italiano. O fixture é que estava sujo, não a
// regra. Agora a naturalização é POSTERIOR ao nascimento do filho na linha, que
// é o caso em que a transmissão se preserva e não há o que apontar.
const grafoSao = construirGrafo(
  [
    {
      id: 1,
      nome: "Nonno",
      sobrenome: "Verdi",
      sexo: "M",
      pais_nasc: "Itália",
      data_nasc: "1900-01-01",
      // Sem data de óbito ele teria 126 anos vivo, e o motor apontaria — de novo
      // com razão. Fixture limpo é fixture COMPLETO.
      vivo: false,
      data_obito: "1975-03-01",
      naturalizado: true,
      data_naturalizacao: "1960-01-01",
    },
    { id: 2, nome: "Pai", sobrenome: "Verdi", sexo: "M", paiId: 1, pais_nasc: "Brasil", data_nasc: "1940-01-01" },
    {
      id: 3, nome: "Req", sobrenome: "Verdi", sexo: "M", paiId: 2,
      pais_nasc: "Brasil", data_nasc: "1975-01-01", requerente: "maior",
    },
  ],
  [],
)
const analiseSa = analisarArvore(grafoSao.pessoas, [], { paisAlvo: "ITALIA", raizId: 3 })
const mapaSao = mapaDeLinhagens(grafoSao, "ITALIA", 3)
const dossiesSaos = projetarDossies({
  grafo: grafoSao,
  analise: analiseSa,
  mapa: mapaSao,
  fatos: { necessidades: [], tarefas: [], lancamentos: [], financeiroVisivel: false },
})
const diagSao = diagnosticar({
  grafo: grafoSao,
  analise: analiseSa,
  mapa: mapaSao,
  dossies: dossiesSaos,
  linhagem: mapaSao.porRequerente.get(3)!,
  prazo: null,
  agora: HOJE,
})
ok(diagSao.problemas.length === 0, "árvore sem pendência não gera problema", diagSao.problemas.map((p) => p.id))
ok(diagSao.saude === "saudavel", "e o veredito é saudável")
// Honestidade: verde sem exigência materializada NÃO é aprovação.
ok(diagSao.semExigenciaMaterializada, "sinaliza que não havia exigência para conferir")
ok(
  diagSao.resumo.includes("Nada a apontar"),
  "e o texto diz isso em vez de 'Processo saudável'",
  diagSao.resumo,
)

// Tarefa vencida
ok(tarefaVencida({ id: 1, titulo: "x", concluida: false, dataPrazo: "2020-01-01" }, HOJE), "prazo passado = vencida")
ok(!tarefaVencida({ id: 1, titulo: "x", concluida: false, dataPrazo: "2099-01-01" }, HOJE), "prazo futuro = no prazo")
ok(!tarefaVencida({ id: 1, titulo: "x", concluida: true, dataPrazo: "2020-01-01" }, HOJE), "concluída nunca vence")
ok(!tarefaVencida({ id: 1, titulo: "x", concluida: false }, HOJE), "sem prazo nunca vence")

const comVencida = projetarDossies({
  grafo,
  analise,
  mapa,
  fatos: {
    ...FATOS,
    tarefas: [
      { id: 90, pessoaId: 3, titulo: "Atrasada", concluida: false, dataPrazo: "2020-01-01", necessidadeId: 4 },
    ],
  },
})
const diagVencida = diagnosticar({
  grafo, analise, mapa, dossies: comVencida, linhagem: lMarcos, prazo: null, agora: HOJE,
})
ok(
  diagVencida.problemas.some((p) => p.categoria === "tarefa_vencida"),
  "diagnóstico encontra tarefa vencida",
)

// PRIORIDADE FIXA da próxima ação.
const acao = resolveNextGenealogyAction(diag)
ok(acao.prioridade === 1, "bloqueio crítico é prioridade 1", acao.prioridade)
ok(acao.pessoaId === 1, "e aponta a pessoa bloqueada", acao.pessoaId)
ok(acao.fonte.length > 0, "a ação declara a fonte")
ok(acao.problemaId != null, "a ação tem link de navegação (id do problema)")

const acaoSa = resolveNextGenealogyAction(diagSao)
ok(acaoSa.prioridade === 7, "sem pendência, prioridade 7", acaoSa.prioridade)
ok(acaoSa.acao === "Nenhuma ação necessária.", "e a ação é ausência de ação")

// Sem bloqueio, a tarefa vencida sobe na fila acima da tarefa aberta.
const semBloqueio = {
  ...diagVencida,
  problemas: diagVencida.problemas.filter((p) => !p.impeditivo && p.categoria !== "documento_ausente"),
}
const acaoVencida = resolveNextGenealogyAction(semBloqueio)
ok(acaoVencida.prioridade === 4, "tarefa vencida é prioridade 4", acaoVencida.prioridade)

// SLA vencido entra no diagnóstico; sem SLA configurado, não.
const diagSla = diagnosticar({
  grafo, analise, mapa, dossies, linhagem: lMarcos, agora: HOJE,
  prazo: {
    rotuloDias: "12 dias atrasado", rotuloStatus: "Atrasado", status: "ATRASADO",
    diasParaVencimento: -12, prazoPrevisto: "2026-07-01T00:00:00.000Z", configurado: true,
  },
})
ok(diagSla.problemas.some((p) => p.categoria === "sla"), "SLA vencido vira pendência")
ok(
  !diag.problemas.some((p) => p.categoria === "sla"),
  "sem projeção de SLA, nenhum problema de prazo é inventado",
)

// ── 5e. DELTA DE LINHAGEM (base do preview) ─────────────────────────────────
secao("5e) delta de linhagem")

// Trocar o pai de Carlos (3) tira o bisavô italiano da linha dos DOIS requerentes.
const pessoasDepois = PESSOAS.map((p) => (p.id === 3 ? { ...p, paiId: null } : p))
const grafoDepois = construirGrafo(pessoasDepois, UNIOES)
const mapaDepois = mapaDeLinhagens(grafoDepois, "ITALIA", 4)
const delta = compararLinhagens(mapa, mapaDepois, grafoDepois)

ok(delta.requerentesAfetados.length === 2, "os dois requerentes são afetados", delta.requerentesAfetados)
ok(
  delta.requerentesAfetados.some((r) => r.nome.includes("Marcos")),
  "e são nomeados, não numerados",
)
ok(delta.saemDaLinha.includes(1), "o bisavô sai da linha", delta.saemDaLinha)
ok(delta.transmissorAlterado, "o ascendente transmissor muda")

// Alteração sem efeito estrutural → delta vazio.
const semEfeito = compararLinhagens(mapa, mapaDeLinhagens(grafo, "ITALIA", 4), grafo)
ok(semEfeito.requerentesAfetados.length === 0, "alteração sem impacto estrutural gera delta vazio")
ok(!semEfeito.transmissorAlterado, "e nenhum transmissor muda")

// ── 6. ESCALA ───────────────────────────────────────────────────────────────
// O requisito é explícito: 500 e 1000 pessoas sem travar. O que se mede aqui é
// o CUSTO DO MOTOR — a parte que roda a cada troca de requerente e a cada
// filtro. O desenho em si é do reactflow e não entra nesta conta.
secao("6) escala — 1000 pessoas")

function arvoreGrande(total: number): PessoaEntrada[] {
  // Cadeia principal de 12 gerações + irmandades largas penduradas nela: é a
  // forma real de uma árvore de cidadania grande, não uma lista plana.
  const pessoas: PessoaEntrada[] = [
    { id: 1, nome: "Raiz", sobrenome: "Origine", pais_nasc: "Itália", data_nasc: "1850-01-01" },
  ]
  let anterior = 1
  for (let g = 2; g <= 12; g++) {
    pessoas.push({
      id: g,
      nome: `Ger${g}`,
      sobrenome: "Origine",
      pais_nasc: "Brasil",
      data_nasc: `${1850 + g * 12}-01-01`,
      paiId: anterior,
    })
    anterior = g
  }
  pessoas[pessoas.length - 1].requerente = "maior"
  let id = 100
  while (pessoas.length < total) {
    const paiId = 2 + (id % 11)
    pessoas.push({
      id: id++,
      nome: `Colateral${id}`,
      sobrenome: "Origine",
      pais_nasc: "Brasil",
      data_nasc: "1950-01-01",
      paiId,
    })
  }
  return pessoas
}

for (const total of [500, 1000]) {
  const grandes = arvoreGrande(total)
  const g = construirGrafo(grandes, [])
  const inicio = Date.now()
  const m = mapaDeLinhagens(g, "ITALIA", grandes[11].id)
  const alvo = m.linhagens[0]!
  const f = calcularFoco(g, alvo, { ...preferenciasPadrao(), modo: "linhagem", estilo: "esmaecer" })
  const ms = Date.now() - inicio
  ok(f.estados.size === total, `${total} pessoas: o foco cobre todas`, f.estados.size)
  ok(alvo.cadeia.length === 12, `${total} pessoas: a cadeia continua correta`, alvo.cadeia.length)
  // Teto generoso: o que ele impede é a regressão de ordem de grandeza (o
  // O(n²) que já existiu na correção de sobreposição), não a variação de 10ms.
  ok(ms < 1500, `${total} pessoas: linhagem + foco em ${ms}ms (teto 1500ms)`, ms)
}

// ── veredito ────────────────────────────────────────────────────────────────
console.log("\n" + "─".repeat(60))
if (failed === 0) {
  console.log(`${passed} verificações · motor operacional da Árvore ÍNTEGRO ✅\n`)
  process.exit(0)
}
console.log(`${passed} passaram, ${failed} falharam:`)
for (const f of falhas) console.log(`  · ${f}`)
process.exit(1)
