// scripts/torre-nova-processo-detalhe.test.ts
// ============================================================================
// TORRE NOVA, FRENTE H — DETALHE DO PROCESSO (T392–T434): regras puras (textos, filtros, ordenação, resumo, menção, caminho, trava,
// distribuição), a varredura estática dos textos exatos do protótipo e a integração com banco de TESTE (detalhe, pausa, distribuição).
//   npx tsx scripts/torre-nova-processo-detalhe.test.ts
// ============================================================================
import { readFileSync } from "node:fs"
import { exigirBancoDeTeste } from "./_banco-de-teste"
import {
  rotuloQuando, rotuloDia, rotuloMesAno, rotuloDuracaoMedia, filtrarEOrdenar, resumirIguais, resolverMencoes, pedacosDoComentario, seloDoCabecalho,
  cartaoDaProximaAcao, cartoesDaFase, rotuloDoStatus, chaveDoStatus, tituloDaTabela, pessoasDaTabela, iniciaisDe, type LinhaDaTabela, type LinhaParaDerivar,
} from "../lib/operacional/torre-processo-puro"
import { montarCaminho, textosDaFase, passagensPelasFases } from "../lib/operacional/torre-caminho"
import { montarTrava, traduzirPendencias, aFase } from "../lib/operacional/torre-trava"
import { mensagemDaDistribuicao } from "../src/services/torre-processo-distribuir"

let passou = 0, falhou = 0
const falhas: string[] = []
const ok = (n: string, c: boolean, extra = "") => { if (c) { passou++; console.log(`  ✅ ${n}`) } else { falhou++; falhas.push(n); console.log(`  ❌ ${n}${extra ? ` — ${extra}` : ""}`) } }
const secao = (t: string) => console.log(`\n${t}`)
const AGORA = new Date("2026-10-01T15:00:00.000Z") // 12:00 em São Paulo

const linha = (o: Partial<LinhaDaTabela>): LinhaDaTabela => ({
  chave: "t1", tarefaId: 1, documentoId: 1, tipo: "ABERTA", titulo: "Certidão de nascimento", pessoaId: 1, pessoa: "Maria", geracao: "G1 bisavó", ordemArvore: 1, ordemTipo: 0,
  passo: { rotulo: "Solicitar certidão", ordem: 1, total: 4 }, status: "A_INICIAR", statusRotulo: "A iniciar", responsavelId: null, responsavelNome: null, iniciouEm: null, concluidaEm: null,
  dataPrazo: "2026-10-10T15:00:00.000Z", rotuloDoPrazo: "Iniciar até 10/10", risco: "atencao", atrasada: false, bola: null, encerramentoTexto: null, motivoTexto: null, reabrivel: false, podeAtribuir: true, ...o,
})

async function main() {
  secao("datas — fuso de São Paulo, hoje/ontem")
  ok("hoje 12:27", rotuloQuando("2026-10-01T15:27:00.000Z", AGORA) === "Hoje 12:27", rotuloQuando("2026-10-01T15:27:00.000Z", AGORA))
  ok("ontem minúsculo", rotuloQuando("2026-09-30T21:00:00.000Z", AGORA, true) === "ontem 18:00")
  ok("outro dia dd/mm hh:mm", rotuloQuando("2026-09-29T17:16:00.000Z", AGORA) === "29/09 14:16")
  ok("sem registro = —", rotuloQuando(null, AGORA) === "—")
  ok("rotuloDia hoje/ontem/data", rotuloDia("2026-10-01T15:00:00Z", AGORA) === "hoje" && rotuloDia("2026-09-30T15:00:00Z", AGORA) === "ontem" && rotuloDia("2026-09-29T15:00:00Z", AGORA) === "29/09")
  ok("abr/2027", rotuloMesAno("2027-04-15T12:00:00Z") === "abr/2027")
  ok("7,1 meses", rotuloDuracaoMedia(213) === "7,1 meses" && rotuloDuracaoMedia(14) === "14 dias")

  secao("status — vocabulário oficial")
  ok("Aguardando terceiros (nunca cartório)", rotuloDoStatus("AGUARDANDO_TERCEIRO") === "Aguardando terceiros")
  ok("A iniciar / Concluída", rotuloDoStatus("NAO_INICIADA") === "A iniciar" && rotuloDoStatus("CONCLUIDO_RECEBIDO") === "Concluída")
  ok("chave do status", chaveDoStatus("NAO_INICIADA") === "A_INICIAR" && chaveDoStatus("CONCLUIDO_NAO_POSSUI") === "CONCLUIDA")

  secao("tabela — filtros e ordens funcionam (o protótipo tinha selects sem efeito)")
  const l = [
    linha({ chave: "a", tarefaId: 1, pessoaId: 1, pessoa: "Maria", ordemArvore: 3, dataPrazo: "2026-10-12T15:00:00Z" }),
    linha({ chave: "b", tarefaId: 2, pessoaId: 2, pessoa: "Helena", ordemArvore: 2, status: "EM_ANDAMENTO", statusRotulo: "Em andamento", dataPrazo: "2026-10-05T15:00:00Z" }),
    linha({ chave: "c", tarefaId: 3, pessoaId: 1, pessoa: "Maria", ordemArvore: 3, ordemTipo: 2, tipo: "CONCLUIDA", status: "CONCLUIDA", statusRotulo: "Concluída", dataPrazo: null }),
    linha({ chave: "d", tarefaId: null, documentoId: 9, tipo: "CANCELADA", status: "CANCELADA", statusRotulo: "Cancelada", pessoaId: 2, pessoa: "Helena", ordemArvore: 2, reabrivel: true }),
    linha({ chave: "e", tarefaId: null, documentoId: 10, tipo: "NAO_EXIGIDA", status: "NAO_EXIGIDA", statusRotulo: "Não exigida", pessoaId: 3, pessoa: "Edison", ordemArvore: 1 }),
  ]
  const ids = (xs: LinhaDaTabela[]) => xs.map((x) => x.chave).join("")
  ok("árvore: abertas, concluídas, depois fora do jogo", ids(filtrarEOrdenar(l, { pessoaId: null, status: "TODOS", ordem: "arvore" })) === "baced", ids(filtrarEOrdenar(l, { pessoaId: null, status: "TODOS", ordem: "arvore" })))
  ok("prazo: mais cedo primeiro", ids(filtrarEOrdenar(l, { pessoaId: null, status: "TODOS", ordem: "prazo" })).startsWith("ba"))
  ok("status: em andamento depois de a iniciar", ids(filtrarEOrdenar(l, { pessoaId: null, status: "TODOS", ordem: "status" })).startsWith("ab"))
  ok("filtro pessoa", ids(filtrarEOrdenar(l, { pessoaId: 1, status: "TODOS", ordem: "arvore" })) === "ac")
  ok("filtro Concluída", ids(filtrarEOrdenar(l, { pessoaId: null, status: "CONCLUIDA", ordem: "arvore" })) === "c")
  ok("filtro Cancelada / não exigida", ids(filtrarEOrdenar(l, { pessoaId: null, status: "ENCERRADAS", ordem: "arvore" })) === "ed")
  ok("fora do jogo some nos demais filtros", !ids(filtrarEOrdenar(l, { pessoaId: null, status: "A_INICIAR", ordem: "arvore" })).match(/[de]/))
  ok("pessoas do select, na ordem da árvore", pessoasDaTabela(l).map((p) => p.nome).join() === "Edison,Helena,Maria")
  ok("título: tarefas quando não é tudo certidão", tituloDaTabela(l, (x) => x.documentoId != null && x.chave !== "b") === "Tarefas da fase atual · 3")
  ok("título: certidões · N (fora do jogo não conta)", tituloDaTabela(l, () => true) === "Certidões da fase atual · 3")

  secao("linha-resumo '+ N certidões iguais a estas'")
  const doze = Array.from({ length: 12 }, (_, i) => linha({ chave: `x${i}`, tarefaId: i + 1, pessoa: i < 7 ? `P${i}` : `Nome${i} Sobrenome` }))
  const r = resumirIguais(doze, () => "Solicitar certidão · A iniciar · sem responsável · 10/10")
  ok("7 visíveis e 5 resumidas", r.visiveis.length === 7 && r.ocultas.length === 5 && r.nomes.length === 5)
  ok("diferentes: mostra tudo", resumirIguais([...doze.slice(0, 11), linha({ chave: "z", responsavelId: 5, responsavelNome: "Ana" })], () => "").ocultas.length === 0)
  ok("até 7: nada a resumir", resumirIguais(doze.slice(0, 7), () => "").ocultas.length === 0)

  secao("@menção")
  const equipe = [{ id: 12, nome: "Daniela Brait" }, { id: 3, nome: "Priscila Tavares" }, { id: 5, nome: "Marco Rovatti" }, { id: 6, nome: "Marco Antônio" }]
  const m1 = resolverMencoes("@Daniela, pode distribuir as 12?", equipe)
  ok("primeiro nome único vira token", m1.texto === "@[Daniela Brait](12), pode distribuir as 12?" && m1.mencionados.length === 1, m1.texto)
  const m2 = resolverMencoes("oi @Marco Rovatti e @Priscila", equipe)
  ok("nome completo e primeiro nome", m2.texto === "oi @[Marco Rovatti](5) e @[Priscila Tavares](3)", m2.texto)
  ok("primeiro nome ambíguo NÃO vira menção", resolverMencoes("@Marco veja", equipe).mencionados.length === 0)
  ok("@ desconhecido fica texto", resolverMencoes("@Fulano oi", equipe).texto === "@Fulano oi")
  ok("sem @ nada muda", resolverMencoes("sem menção", equipe).texto === "sem menção")
  ok("token já pronto não é reprocessado", resolverMencoes("@[Daniela Brait](12) ok", equipe).texto === "@[Daniela Brait](12) ok")
  const pe = pedacosDoComentario("Feito. @[Marco Rovatti](5) cancele")
  ok("pedaços com menção em destaque", pe.length === 3 && pe[1].tipo === "mencao" && pe[1].valor === "@Marco Rovatti")
  ok("iniciais", iniciaisDe("Marco Rovatti") === "MR")

  secao("cabeçalho — selo e próxima ação")
  ok("Atenção · 12 sem responsável", seloDoCabecalho({ pausado: false, risco: "atencao", numeros: { vencidas: 0, semResponsavel: 12, comCartorio: 0 } }).rotulo === "Atenção · 12 sem responsável")
  ok("Crítico · 4 vencidas", seloDoCabecalho({ pausado: false, risco: "critico", numeros: { vencidas: 4, semResponsavel: 2, comCartorio: 0 } }).rotulo === "Crítico · 4 vencidas")
  ok("Pausado vence tudo", seloDoCabecalho({ pausado: true, risco: "critico", numeros: { vencidas: 4, semResponsavel: 2, comCartorio: 0 } }).rotulo === "Pausado")
  const pa = cartaoDaProximaAcao({ texto: "Distribuir as 12 certidões", tipo: "distribuir", urgencia: null, responsavelNome: null }, "hoje", "Emissão documental", true)
  ok("Distribuir as 12 certidões de Emissão documental", pa.titulo === "Distribuir as 12 certidões de Emissão documental")
  ok('responsável: nenhum · prazo: hoje · por isso…"Precisa de você"', pa.detalhe === 'responsável: nenhum · prazo: hoje · por isso este processo está em "Precisa de você"' && pa.urgente)

  secao("cinco cartões")
  const base = (o: Partial<LinhaParaDerivar>): LinhaParaDerivar => ({
    taskId: 1, titulo: "Certidão de nascimento · X", documentoId: 1, pessoaNome: "X", statusTarefa: "NAO_INICIADA", aIniciar: true, estadoOperacao: "FILA", responsavelId: null, responsavelNome: null,
    dataPrazo: "2026-10-10T15:00:00Z", rotuloDoPrazo: "Iniciar até 10/10", diasParaPrazo: 10, atrasada: false, faseMacroKey: "emissao_documental",
    passoAtual: { ordem: 0, total: 4 }, passoCorrente: { chave: "solicitar", label: "Solicitar certidão" }, bolaCom: "Equipe", terceiroNome: null, ...o,
  })
  const doze2 = Array.from({ length: 12 }, (_, i) => base({ taskId: i + 1 }))
  const c = cartoesDaFase({ linhas: doze2, encerradas: { canceladas: 1, naoExigidas: 1 }, riscoDe: () => "atencao" })
  ok("Passo atual: Solicitar certidão / passo 1 de 4 · 12 a iniciar", c[0].titulo === "Solicitar certidão" && c[0].sub === "passo 1 de 4 · 12 a iniciar", c[0].sub)
  ok("Com quem: Sem responsável vermelho / 0 equipe · 0 terceiros · 12 sem dono", c[1].titulo === "Sem responsável" && c[1].tom === "vermelho" && c[1].sub === "0 equipe · 0 terceiros · 12 sem dono", c[1].sub)
  ok("Prazo: Iniciar até 10/10 âmbar / as 12 · faltam 10 dias", c[2].titulo === "Iniciar até 10/10" && c[2].tom === "ambar" && c[2].sub === "as 12 · faltam 10 dias", `${c[2].titulo} | ${c[2].sub}`)
  ok("Cartórios: Ainda não vinculados", c[3].titulo === "Ainda não vinculados" && c[3].sub === "define-se ao iniciar cada pedido")
  ok("Fora do jogo: 2 certidões / 1 cancelada · 1 não exigida", c[4].titulo === "2 certidões" && c[4].sub === "1 cancelada · 1 não exigida")
  const vazio = cartoesDaFase({ linhas: [], encerradas: { canceladas: 0, naoExigidas: 0 }, riscoDe: () => "ritmo" })
  ok("sem tarefa aberta: traço, nunca exemplo", vazio[0].titulo === "—" && vazio[2].titulo === "—" && vazio[4].titulo === "Nenhuma")

  secao("caminho das fases")
  const fases = [
    { phaseKey: "gen", ordem: 1, label: "Genealogia", conditional: false, required: true }, { phaseKey: "emi", ordem: 2, label: "Emissão documental", conditional: false, required: true },
    { phaseKey: "ana", ordem: 3, label: "Análise documental", conditional: false, required: true }, { phaseKey: "ret", ordem: 4, label: "Retificação de registros", conditional: true, required: false },
    { phaseKey: "tra", ordem: 5, label: "Tradução juramentada", conditional: false, required: true },
  ]
  const logs = [{ faseAtual: "gen", fasePretendida: "emi", criadoEm: new Date("2026-09-29T21:00:00Z") }]
  const pass = passagensPelasFases({ fases, logs, instancias: [], abertoEm: new Date("2026-09-29T17:16:00Z"), faseAtualKey: "emi" })
  ok("1ª fase entra na abertura e sai no avanço", pass.get("gen")?.entradaEm === "2026-09-29T17:16:00.000Z" && pass.get("gen")?.saidaEm === "2026-09-29T21:00:00.000Z")
  ok("fase sem registro = null (nunca palpite)", pass.get("tra")?.entradaEm === null)
  const cam = montarCaminho({ fases, faseAtualKey: "emi", requerRetificacao: null, passagens: pass, tarefas: new Map([["gen", { total: 12, concluidas: 12, semResponsavel: 0, abertas: 0, responsaveis: [{ nome: "Daniela Brait", n: 12 }] }], ["emi", { total: 12, concluidas: 0, semResponsavel: 12, abertas: 12, responsaveis: [] }]]) })
  ok("estados: concluída · atual · futura · condicional · futura", cam.map((f) => f.estado).join() === "concluida,atual,futura,condicional,futura", cam.map((f) => f.estado).join())
  const t0 = textosDaFase(cam[0], AGORA), t1 = textosDaFase(cam[1], AGORA, { tempoNaFase: "8 h", certidoes: { recebidas: 0, requeridas: 12 } })
  ok("Genealogia ✓ + datas + 12 de 12 · Daniela Brait", t0.l1 === "1 · Genealogia ✓" && t0.l2 === "29/09 14:16 → 29/09 18:00" && t0.l3 === "12 de 12 concluídas · Daniela Brait", JSON.stringify(t0))
  ok("atual: desde … · 8 h / 0 de 12 recebidas · sem responsável", t1.l1 === "2 · Emissão documental · atual" && t1.l3 === "0 de 12 recebidas · sem responsável", JSON.stringify(t1))
  ok("condicional: só se preciso · futura: futura", textosDaFase(cam[3], AGORA).l2 === "só se preciso" && textosDaFase(cam[2], AGORA).l2 === "futura")
  const cam2 = montarCaminho({ fases, faseAtualKey: "tra", requerRetificacao: false, passagens: new Map(), tarefas: new Map() })
  ok("condicional que a Análise não pediu e ficou para trás = pulada", cam2[3].estado === "pulada" && cam2[3].motivoPulada === "NAO_FOI_PRECISO" && cam2[2].estado === "pulada")
  const cam3 = montarCaminho({ fases, faseAtualKey: "tra", requerRetificacao: true, passagens: new Map([["ret", { entradaEm: "2026-09-30T10:00:00Z", saidaEm: null }]]), tarefas: new Map() })
  ok("retificação pedida entra no caminho como concluída", cam3[3].estado === "concluida")

  secao("trava para avançar")
  const tv = montarTrava({ issues: Array.from({ length: 12 }, () => ({ code: "CERTIDAO_OBRIGATORIA_PENDENTE", severity: "BLOCKING" as const, message: "x" })), proximaFaseLabel: "Análise documental", faseAtualKey: "emi", certidoes: { recebidas: 0, requeridas: 12 } })
  ok("Trava para avançar à Análise documental", tv.rotulo === "Trava para avançar à Análise documental" && tv.travado)
  ok("0 de 12 certidões recebidas e conferidas", tv.titulo === "0 de 12 certidões recebidas e conferidas")
  ok("regra: avançar na marra exige justificativa", tv.detalhe.includes("avançar na marra exige justificativa e fica no histórico"))
  const livre = montarTrava({ issues: [{ code: "PASSO_OPCIONAL_ABERTO", severity: "WARNING", message: "w" }], proximaFaseLabel: "Apostilamento", faseAtualKey: "x", certidoes: { recebidas: 1, requeridas: 1 } })
  ok("só WARNING não trava", !livre.travado && livre.rotulo === "Pode avançar ao Apostilamento")
  ok("preposição por gênero", aFase("Análise documental") === "à Análise documental" && aFase("Emissão documental") === "à Emissão documental" && aFase("Protocolado") === "ao Protocolado")
  ok("código desconhecido cai na mensagem do motor", traduzirPendencias([{ code: "XPTO", severity: "BLOCKING", message: "algo" }])[0].texto === "algo")
  ok("agrupa por código", traduzirPendencias([{ code: "PASSO_BLOQUEADO", severity: "BLOCKING", message: "a" }, { code: "PASSO_BLOQUEADO", severity: "BLOCKING", message: "b" }]).length === 1)

  secao("distribuir — frase do toast")
  ok("uma pessoa com aptidão", mensagemDaDistribuicao({ total: 12, atribuidas: 12, porPessoa: [{ usuarioId: 1, nome: "Daniela Brait", n: 12, apto: "apto em Espanha" }], semAtribuir: [] }, "certidões") === "12 certidões atribuídas a Daniela Brait (apto em Espanha) · fica no histórico")
  ok("várias pessoas + sobra sem aptidão", mensagemDaDistribuicao({ total: 12, atribuidas: 10, porPessoa: [{ usuarioId: 1, nome: "A", n: 6, apto: null }, { usuarioId: 2, nome: "B", n: 4, apto: null }], semAtribuir: [{ n: 2, motivo: "sem aptidão cadastrada" }] }).includes("2 ficou sem responsável (sem aptidão cadastrada)"))

  secao("estático — textos exatos do protótipo e vocabulário")
  const fonte = ["Cabecalho", "Caminho", "Certidoes", "Fatos", "Comentarios", "Relatorio"].map((n) => readFileSync(`src/components/torre/Processo${n}.tsx`, "utf8")).join("\n") + readFileSync("src/components/torre/TorreProcessoPagina.tsx", "utf8")
  for (const t of ["Próxima ação · obrigatória", "Previsão · validade", "Caminho do processo", "Últimos fatos", "Ver histórico completo", "Comentários da família", "Relatório de controle", "Histórico completo", "Árvore e cadastro", "Pausar processo", "Mencionar…", "Comentar", "Escreva um comentário… use @ para mencionar alguém da equipe", "Quem é mencionado recebe aviso no sino e no resumo diário. O comentário fica no histórico da família.", "Selecionar todas", "Todas as pessoas", "ver todas", "Motivo", "Reabrir", "Atribuir", "Certidão · pessoa", "Passo atual", "Iniciou em", "Aguardando", "Processo pausado com motivo · sai do Radar e das contagens, volta quando você reativar", "Certidão reaberta · volta para A iniciar e entra de novo na contagem · fica no histórico", "Responsável atribuído", "Filtro: família", "Relatório exportado ·", "Exportar CSV", "Mostrando"]) ok(`texto "${t.slice(0, 50)}"`, fonte.includes(t) || readFileSync("lib/operacional/torre-processo-puro.ts", "utf8").includes(t))
  ok("sem 'Com o cartório' nem 'ninguém'", !/com o cart[óo]rio|ningu[ée]m/i.test(fonte))

  secao("integração (banco de teste) — detalhe, pausa, distribuição sem aptidão, comentário sem família")
  exigirBancoDeTeste("monta processo, pausa e distribui")
  const { prisma } = await import("../lib/prisma")
  const { montarCenario } = await import("./_fixture-torre-gh")
  const { detalheDoProcesso } = await import("../lib/operacional/torre-foco")
  const { pausarProcesso, reativarProcesso } = await import("../src/services/processo-pausa")
  const { distribuirProcesso } = await import("../src/services/torre-processo-distribuir")
  const { criarComentario } = await import("../src/services/comentario-tarefa")
  const MARCA = "TNPD"
  const cen = await montarCenario(MARCA)
  try {
    const adm = await prisma.usuario.create({ data: { nome: `${MARCA} Adm`, email: `${MARCA.toLowerCase()}-adm@t.com`, senha: "x", tipo: "admin" } })
    const o1 = await cen.novaObrigacao({}); await cen.novaObrigacao({})
    const d = await detalheDoProcesso(o1.processoId, AGORA)
    ok("detalhe monta", d != null && d.cabecalho.faseTotal >= 1 && Array.isArray(d.tabela) && d.cartoes.length === 5, JSON.stringify(d?.cabecalho))
    ok("tabela da fase atual com a tarefa", !!d && d.tabela.some((x) => x.tarefaId != null))
    ok("trava lida do BlockingEngine", !!d?.trava && typeof d.trava.travado === "boolean")
    ok("processo ativo sem pausa", d?.pausa == null)
    const p = await pausarProcesso({ processoId: o1.processoId, usuarioId: adm.id, justificativa: "ok" })
    ok("pausar com menos de 5 letras é recusado", !p.ok && p.codigo === "JUSTIFICATIVA_CURTA")
    const p2 = await pausarProcesso({ processoId: o1.processoId, usuarioId: adm.id, justificativa: "cliente sumiu" })
    ok("pausa com motivo", p2.ok)
    const dp = await detalheDoProcesso(o1.processoId, AGORA)
    ok("detalhe continua acessível e mostra a pausa; sem risco calculado", dp?.pausa?.motivo === "cliente sumiu" && dp.cabecalho.risco === null)
    const rr = await reativarProcesso({ processoId: o1.processoId, usuarioId: adm.id, desfazer: true })
    ok("desfazer = reativar", rr.ok && (await detalheDoProcesso(o1.processoId, AGORA))?.pausa == null)
    const dist = await distribuirProcesso({ processoId: o1.processoId, autorId: adm.id, agora: AGORA })
    ok("distribuir sem aptidão cadastrada NUNCA atribui", dist.total >= 1 && dist.atribuidas === 0 && dist.semAtribuir.length > 0 && !dist.ok, dist.mensagem)
    const semFam = await criarComentario({ familiaId: null, tarefaId: null, autorId: adm.id, texto: "oi" })
    ok("comentário sem âncora familiar é recusado, sem criar família", !semFam.ok && (await prisma.familia.count({ where: { nome: { startsWith: MARCA } } })) === 0)
  } finally {
    await prisma.logAuditoria.deleteMany({ where: { descricao: { contains: MARCA } } }).catch(() => {})
    await prisma.processoPausa.deleteMany({ where: { processo: { nome: { startsWith: MARCA } } } }).catch(() => {})
    await cen.limpar().catch(() => {})
    await prisma.usuario.deleteMany({ where: { email: { startsWith: MARCA.toLowerCase() } } }).catch(() => {})
  }

  console.log(`\n${passou} passaram, ${falhou} falharam`)
  if (falhou) { console.log(falhas.map((f) => ` - ${f}`).join("\n")); process.exit(1) }
  process.exit(0)
}
main().catch((e) => { console.error(e); process.exit(1) })
