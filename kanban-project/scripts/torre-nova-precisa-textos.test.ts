// scripts/torre-nova-precisa-textos.test.ts
// ============================================================================
// TORRE NOVA, FRENTE B2 (01/10/2026) — "PRECISA DE VOCÊ": OS TEXTOS E AS REGRAS PURAS dos 6 tipos (inventário §1.2 e §2.4).
//
//   npx tsx scripts/torre-nova-precisa-textos.test.ts   (sem banco)
//
// Cobre o CHECKLIST T080–T111: os 6 cartões (nome, regra, cor), o título/detalhe/sugestão/2 ações de cada tipo, o plano de atribuição
// por aptidão comprovada, o "quanto mover" da Carga, a data "entrou ontem 14:15 / desde hoje 12:27", o rodapé e a varredura de textos
// proibidos (vocabulário oficial) — tudo em funções puras com `agora` e fuso fixos.
// ============================================================================
import { readFileSync } from "node:fs"
import {
  TIPOS_DO_PAINEL, ROTULO_DO_TIPO, regraDoTipo, DIAS_BLOQUEADA_PARA_DECIDIR, certidoes, decimalPt, diasDeCalendario, quandoEntrouNaFase,
  canaisPorExtenso, identidadeDaCertidao, planoDoSemDono, textosDoSemDono, textosDaFaseDeixada, textosDaEscalada, textosDaDivergencia,
  textosDaBloqueada, bloqueioPedeDecisao, quantoMoverDaCarga, textosDaCarga, contagemPorTipo, type SugestaoParaTexto,
} from "../lib/operacional/precisa-de-voce-decisoes"

let passou = 0, falhou = 0
const falhas: string[] = []
const ok = (nome: string, cond: boolean, extra = "") => {
  if (cond) { passou++; console.log(`  ✅ ${nome}${extra ? ` — ${extra}` : ""}`) } else { falhou++; falhas.push(nome); console.log(`  ❌ ${nome}${extra ? ` — ${extra}` : ""}`) }
}
const secao = (t: string) => console.log(`\n${t}`)

// 01/10/2026 15:00 em São Paulo (UTC-3 fixo) = 18:00 UTC
const AGORA = new Date("2026-10-01T18:00:00.000Z")

secao("OS 6 TIPOS — nome, regra e ordem dos cartões (T082–T087)")
ok("a ordem dos cartões: Sem responsável · Fase deixada · Escalada · Divergência · Bloqueada · Carga", TIPOS_DO_PAINEL.map((t) => ROTULO_DO_TIPO[t]).join(" · ") === "Sem responsável · Fase deixada · Escalada · Divergência · Bloqueada · Carga")
ok("'Sem dono' vira 'Sem responsável' no vocabulário oficial", ROTULO_DO_TIPO.SEM_DONO === "Sem responsável")
ok("regra Sem responsável: 'certidão ativa sem responsável'", regraDoTipo("SEM_DONO") === "certidão ativa sem responsável")
ok("regra Fase deixada: 'fase sem próxima ação'", regraDoTipo("FASE_DEIXADA") === "fase sem próxima ação")
ok("regra Escalada usa o limite do CADASTRO (padrão 2): 'cartório sem resposta após 2 cobranças'", regraDoTipo("ESCALADA") === "cartório sem resposta após 2 cobranças" && regraDoTipo("ESCALADA", 3) === "cartório sem resposta após 3 cobranças")
ok("regra Divergência: 'tarefa, passo e Central discordam'", regraDoTipo("DIVERGENCIA") === "tarefa, passo e Central discordam")
ok("regra Bloqueada: 'esperando o cliente há 10+ dias'", regraDoTipo("BLOQUEADA") === "esperando o cliente há 10+ dias" && DIAS_BLOQUEADA_PARA_DECIDIR === 10)
ok("regra Carga: 'pessoa acima do limite'", regraDoTipo("CARGA") === "pessoa acima do limite")
const c = contagemPorTipo([{ tipo: "SEM_DONO" }, { tipo: "SEM_DONO" }, { tipo: "CARGA" }, { tipo: "PAREDE_A_FRENTE" }])
ok("a contagem por tipo soma só os 6 tipos (cadastro/PAREDE_A_FRENTE não entra)", c.SEM_DONO === 2 && c.CARGA === 1 && Object.values(c).reduce((a, b) => a + b, 0) === 3)

secao("FORMATAÇÃO — datas no fuso de SP, plural e decimal com vírgula")
ok("'2,0' com vírgula", decimalPt(2) === "2,0" && decimalPt(22.46) === "22,5")
ok("'1 certidão' / '12 certidões'", certidoes(1) === "1 certidão" && certidoes(12) === "12 certidões")
ok("dias de calendário em SP: 23h de SP de ontem → ontem (1 dia)", diasDeCalendario(new Date("2026-10-01T02:30:00.000Z"), AGORA) === 1)
ok("'desde hoje 12:27' (entrou hoje)", quandoEntrouNaFase(new Date("2026-10-01T15:27:00.000Z"), AGORA) === "desde hoje 12:27", quandoEntrouNaFase(new Date("2026-10-01T15:27:00.000Z"), AGORA))
ok("'entrou ontem 14:15'", quandoEntrouNaFase(new Date("2026-09-30T17:15:00.000Z"), AGORA) === "entrou ontem 14:15", quandoEntrouNaFase(new Date("2026-09-30T17:15:00.000Z"), AGORA))
ok("'entrou em 28/09 09:00' (mais antigo)", quandoEntrouNaFase(new Date("2026-09-28T12:00:00.000Z"), AGORA) === "entrou em 28/09 09:00", quandoEntrouNaFase(new Date("2026-09-28T12:00:00.000Z"), AGORA))
ok("sem registro de entrada: 'entrada na fase não registrada' (nunca um palpite)", quandoEntrouNaFase(null, AGORA) === "entrada na fase não registrada")
ok("canais por extenso: 'e-mail' · 'e-mail e telefone' · 'e-mail, telefone e ofício'", canaisPorExtenso(["EMAIL"]) === "e-mail" && canaisPorExtenso(["EMAIL", "TELEFONE", "EMAIL"]) === "e-mail e telefone" && canaisPorExtenso(["EMAIL", "TELEFONE", "OFICIO"]) === "e-mail, telefone e ofício")
ok("a certidão leva a pessoa (regra: nunca só o número): título sem a pessoa ganha a pessoa", identidadeDaCertidao({ titulo: "Certidão de casamento", pessoaNome: "Antonio Bellandi" }) === "Certidão de casamento · Antonio Bellandi")
ok("...e não repete a pessoa quando o título já a traz", identidadeDaCertidao({ titulo: "Certidão de nascimento · Luigi Bellandi", pessoaNome: "Luigi Bellandi" }) === "Certidão de nascimento · Luigi Bellandi")

secao("SEM RESPONSÁVEL — por PROCESSO, com a sugestão por aptidão comprovada (T096, T100)")
const rafael: SugestaoParaTexto = { usuarioId: 2, nome: "Rafael", aptidao: ["apto em Itália"], ativas: 88, filaLivre: true }
const priscila: SugestaoParaTexto = { usuarioId: 3, nome: "Priscila", aptidao: ["apto em Espanha"], ativas: 10, filaLivre: false }
const semApto: SugestaoParaTexto = { usuarioId: 9, nome: "Dani", fallback: true, ativas: 1 }
const planoUm = planoDoSemDono([{ taskId: 1, sugestao: rafael }, { taskId: 2, sugestao: rafael }])
const t1 = textosDoSemDono({ familia: "Salvarani", pais: "Itália", faseLabel: "Genealogia", entrouNaFase: new Date("2026-09-30T17:15:00.000Z"), agora: AGORA, total: 12, plano: planoUm })
ok("título: 'Salvarani · 12 certidões sem responsável'", t1.titulo === "Salvarani · 12 certidões sem responsável")
ok("detalhe: 'Itália · Genealogia · entrou ontem 14:15'", t1.detalhe === "Itália · Genealogia · entrou ontem 14:15", t1.detalhe)
ok("sugestão: 'Atribuir a Rafael (apto em Itália, 88 certidões, fila livre)'", t1.sugestao === "Atribuir a Rafael (apto em Itália, 88 certidões, fila livre)", t1.sugestao)
ok("as 2 ações: 'Atribuir a Rafael' e 'Escolher outro'", t1.acao1.rotulo === "Atribuir a Rafael" && t1.acao1.acao === "ATRIBUIR_SUGERIDO" && t1.acao2.rotulo === "Escolher outro" && t1.acao2.acao === "ATRIBUIR_ESCOLHIDO")
const planoDois = planoDoSemDono([{ taskId: 1, sugestao: rafael }, { taskId: 2, sugestao: rafael }, { taskId: 3, sugestao: priscila }])
const t2 = textosDoSemDono({ familia: "Antão", pais: "Espanha", faseLabel: "Emissão documental", entrouNaFase: new Date("2026-10-01T15:27:00.000Z"), agora: AGORA, total: 3, plano: planoDois })
ok("entrou hoje: 'Espanha · Emissão documental · desde hoje 12:27'", t2.detalhe === "Espanha · Emissão documental · desde hoje 12:27", t2.detalhe)
ok("duas pessoas aptas: cada certidão vai a quem tem aptidão, dito na sugestão", /Rafael \(2 certidões\), Priscila \(1 certidão\)/.test(t2.sugestao) && t2.acao1.rotulo === "Atribuir às sugeridas", t2.sugestao)
const planoSemApto = planoDoSemDono([{ taskId: 1, sugestao: semApto }, { taskId: 2, sugestao: null }])
ok("SEM aptidão cadastrada: ninguém é sugerido (o menor-carga do fallback NÃO entra no plano)", planoSemApto.atribuicoes.length === 0 && planoSemApto.semAptidao.length === 2)
const t3 = textosDoSemDono({ familia: "Ferrante", pais: "Itália", faseLabel: "Genealogia", entrouNaFase: null, agora: AGORA, total: 2, plano: planoSemApto })
ok("...fica para decisão humana: 'Sem aptidão cadastrada…' e o botão é 'Escolher responsável'", /^Sem aptidão cadastrada/.test(t3.sugestao) && t3.acao1.rotulo === "Escolher responsável" && !/Atribuir a/.test(t3.acao1.rotulo), t3.sugestao)
const planoMisto = planoDoSemDono([{ taskId: 1, sugestao: rafael }, { taskId: 2, sugestao: semApto }])
const t4 = textosDoSemDono({ familia: "Misto", pais: null, faseLabel: null, entrouNaFase: null, agora: AGORA, total: 2, plano: planoMisto })
ok("plano misto: atribui só quem tem aptidão e diz quantas ficam para você", /Atribuir a Rafael/.test(t4.sugestao) && /1 certidão sem aptidão cadastrada fica para você/.test(t4.sugestao), t4.sugestao)

secao("FASE DEIXADA — por PROCESSO, 'fase sem próxima ação' (T097)")
const f1 = textosDaFaseDeixada({ familia: "Panza", pais: "Itália", faseLabel: "Apostilamento", proximaFaseLabel: "Aguardando protocolo", ultimaConclusao: new Date("2026-09-28T15:00:00.000Z"), entrouNaFase: null, agora: AGORA })
ok("título: 'Panza · Apostilamento sem próxima ação'", f1.titulo === "Panza · Apostilamento sem próxima ação")
ok("detalhe: país · 'concluídas há 3 dias' · o próximo passo não foi marcado (sem a palavra proibida)", f1.detalhe === "Itália · todas as tarefas da fase concluídas há 3 dias · o próximo passo não foi marcado", f1.detalhe)
ok("sugestão: 'Avançar para Aguardando protocolo e abrir as tarefas dela'", f1.sugestao === "Avançar para Aguardando protocolo e abrir as tarefas dela")
const f2 = textosDaFaseDeixada({ familia: "Nova", pais: null, faseLabel: "Genealogia", proximaFaseLabel: "Emissão documental", ultimaConclusao: null, entrouNaFase: new Date("2026-09-29T15:00:00.000Z"), agora: AGORA })
ok("fase que nunca teve tarefa concluída: conta desde a entrada na fase", /na fase há 2 dias e sem nenhuma tarefa aberta/.test(f2.detalhe), f2.detalhe)

secao("ESCALADA (T098)")
const e1 = textosDaEscalada({ orgao: "4ª Zona de Porto Alegre", certidao: "Certidão de nascimento · Joaquim Ferreira Lopes", familia: "Família Lopes", pais: "Portugal", pedidoHaDias: 42, cobrancas: 3, canais: ["EMAIL", "EMAIL", "EMAIL"] })
ok("título: '<órgão> · <certidão + pessoa>'", e1.titulo === "4ª Zona de Porto Alegre · Certidão de nascimento · Joaquim Ferreira Lopes")
ok("detalhe: país · família · 'pedido há 42 d' · '3 cobranças por e-mail sem resposta'", e1.detalhe === "Portugal · Família Lopes · pedido há 42 d · 3 cobranças por e-mail sem resposta", e1.detalhe)
ok("sugestão: 'Trocar o canal para telefone e registrar a ligação'", e1.sugestao === "Trocar o canal para telefone e registrar a ligação")
const e2 = textosDaEscalada({ orgao: null, certidao: "x", familia: null, pais: null, pedidoHaDias: null, cobrancas: 1, canais: ["TELEFONE"] })
ok("sem data do pedido: 'pedido não registrado' (nunca inventa)", /pedido não registrado/.test(e2.detalhe) && /1 cobrança por telefone sem resposta/.test(e2.detalhe))
ok("já houve ligação: a sugestão não manda 'trocar para telefone' de novo", !/para telefone/.test(e2.sugestao), e2.sugestao)

secao("DIVERGÊNCIA (T099)")
const d1 = textosDaDivergencia({ familia: "Fogli", certidao: "Certidão de nascimento · Rodolfo Giovanni Fogli", pais: "Itália", statusTarefa: "CONCLUIDO_RECEBIDO", statusPasso: "AGUARDANDO", esperado: "AGUARDANDO_TERCEIRO" })
ok("título: '<família> · <certidão + pessoa>'", d1.titulo === "Fogli · Certidão de nascimento · Rodolfo Giovanni Fogli")
ok("detalhe: a tarefa diz X, o passo diz Y, a Central espera Z", /^Itália · a tarefa diz "concluída", o passo diz "aguardando", a Central espera "aguardando terceiros"$/.test(d1.detalhe), d1.detalhe)
ok("sugestão: reconciliar pela Central", /^Reconciliar pela Central/.test(d1.sugestao))

secao("BLOQUEADA — esperando o cliente há 10+ dias (T101)")
const b1 = textosDaBloqueada({ familia: "Martín Manzano", certidao: "Procuração · Martín Manzano", pais: "Espanha", faseLabel: "Retificação", bloqueadaHaDias: 14, cobrancasAoCliente: 2, motivo: "esperando procuração do cliente" })
ok("detalhe: 'Espanha · Retificação · bloqueada há 14 d · 2 cobranças ao cliente'", b1.detalhe.startsWith("Espanha · Retificação · bloqueada há 14 d · 2 cobranças ao cliente"), b1.detalhe)
ok("sugestão cobra o cliente de novo e prevê pausar o processo", /^Cobrar o cliente de novo/.test(b1.sugestao) && /pausar o processo/.test(b1.sugestao))
ok("só entra com 10+ dias (ou sem data registrada: nunca se prova que é recente)", !bloqueioPedeDecisao(9) && bloqueioPedeDecisao(10) && bloqueioPedeDecisao(14) && bloqueioPedeDecisao(null))

secao("CARGA (T102)")
ok("mover o bastante para ficar UMA abaixo do limite, limitado ao que ainda não foi iniciado", quantoMoverDaCarga({ executaveis: 91, limite: 80, aIniciar: 40 }) === 12 && quantoMoverDaCarga({ executaveis: 91, limite: 80, aIniciar: 5 }) === 5 && quantoMoverDaCarga({ executaveis: 80, limite: 80, aIniciar: 9 }) === 1 && quantoMoverDaCarga({ executaveis: 80, limite: 80, aIniciar: 0 }) === 0)
const k1 = textosDaCarga({ nome: "Daniela Brait", executaveis: 91, limite: 80, vencidas: 19, filaEmSemanas: 2, mover: 12, paisDasMovidas: "Itália", destinos: ["Priscila"] })
ok("título: 'Daniela Brait · 91 executáveis (limite 80)'", k1.titulo === "Daniela Brait · 91 executáveis (limite 80)")
ok("detalhe: '19 vencidas · fila de 2,0 semanas'", k1.detalhe === "19 vencidas · fila de 2,0 semanas", k1.detalhe)
ok("sugestão: 'Mover 12 certidões de Itália para Priscila (fila livre)' e botão 'Redistribuir 12'", k1.sugestao === "Mover 12 certidões de Itália para Priscila (fila livre)" && k1.rotuloAcao1 === "Redistribuir 12", `${k1.sugestao} | ${k1.rotuloAcao1}`)
const k2 = textosDaCarga({ nome: "Lucas", executaveis: 3, limite: 2, vencidas: 1, filaEmSemanas: null, mover: 0, paisDasMovidas: null, destinos: [] })
ok("sem o que mover: diz isso e manda decidir na Equipe (botão 'Redistribuir' sem número)", /Nenhuma certidão ainda não iniciada/.test(k2.sugestao) && k2.rotuloAcao1 === "Redistribuir" && /1 vencida · /.test(k2.detalhe))
const k3 = textosDaCarga({ nome: "Ana", executaveis: 10, limite: 8, vencidas: 0, filaEmSemanas: 1, mover: 3, paisDasMovidas: null, destinos: [] })
ok("sem pessoa apta de fila livre: não finge destino", /sem pessoa apta com fila livre/.test(k3.sugestao) && /fila de 1,0 semana$/.test(k3.detalhe), `${k3.sugestao} | ${k3.detalhe}`)

secao("VARREDURA — vocabulário oficial e texto do rodapé nos arquivos da frente B2")
const ler = (p: string) => readFileSync(p, "utf8")
const semComentarios = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:\\])\/\/[^\n]*/g, "$1")
const ARQUIVOS = [
  "lib/operacional/precisa-de-voce-decisoes.ts", "src/components/torre/TorrePrecisaDeVoce.tsx", "src/components/torre/TorreRevisao.tsx",
  "src/components/torre/TorreBriefing.tsx", "src/components/torre/acoes-do-item.tsx", "src/components/torre/tipos-precisa.ts", "src/services/precisa-de-voce-acoes.ts",
]
const proibidos = /ningu[ée]m|com o cart[óo]rio|sem dono"|'Sem dono'/i
const achados = ARQUIVOS.filter((f) => proibidos.test(semComentarios(ler(f))))
ok("nenhum 'ninguém', 'Com o cartório' ou 'Sem dono' visível nos arquivos da frente", achados.length === 0, achados.join(", "))
const tela = ler("src/components/torre/TorrePrecisaDeVoce.tsx")
ok("os textos exatos da seção: título, apoio e botão", /Precisa de você · \{todos\.length\}/.test(tela) && tela.includes("Decisões que só o Administrador toma. Tarefa vencida não entra aqui: é trabalho da equipe. Ordem: maior risco primeiro.") && tela.includes("▶ Revisar uma por uma"))
ok("as 4 colunas: Tipo · O que está acontecendo · Sugestão do sistema · Ação", tela.includes("<div>Tipo</div><div>O que está acontecendo</div><div>Sugestão do sistema</div><div>Ação</div>"))
ok("o rodapé com filtro e sem filtro", tela.includes('Mostrando só "${ROTULO_TIPO[tipo]}" · ordenadas do maior risco para o menor') && tela.includes("ordenadas do maior risco para o menor"))
ok("a assinatura estável: embutido? e onRevisar? opcionais; itens/carregando/erro/irParaAba obrigatórios", /embutido\?: boolean/.test(tela) && /onRevisar\?: \(\) => void/.test(tela) && /itens: ItemPrecisa\[\] \| null\n\s+carregando: boolean\n\s+erro: string \| null\n\s+irParaAba/.test(tela))
const brief = ler("src/components/torre/TorreBriefing.tsx")
ok("Briefing: 'Ver a Torre' e '▶ Revisar o dia (N decisões)'; nada abre sozinho (sem sessionStorage nem abertura automática)", brief.includes("Ver a Torre") && brief.includes("▶ Revisar o dia (") && !/sessionStorage|localStorage/.test(brief))
const rev = ler("src/components/torre/TorreRevisao.tsx")
ok("Revisão: 'Revisar o dia · N de T', 'N decididas · N puladas', Sair · Abrir o processo · Pular · Fechar", rev.includes("Revisar o dia · {posicao} de {total}") && rev.includes("{decididas} decididas · {puladas} puladas") && ["Sair", "Abrir o processo", "Pular", "Fechar", "Revisão concluída. Decisões tomadas:"].every((t) => rev.includes(t)))

secao("ACESSO — as rotas usam a guarda da Torre (admin ou gerência operacional) + a permissão da porta")
const rotaLista = ler("src/app/api/torre/precisa-de-voce/route.ts")
const rotaAcao = ler("src/app/api/torre/precisa-de-voce/acao/route.ts")
const rotaDesfazer = ler("src/app/api/torre/precisa-de-voce/desfazer/route.ts")
ok("GET /api/torre/precisa-de-voce usa exigirTorre('tarefas.ver') — não só usuarios.gerenciar", /exigirTorre\(request, 'tarefas\.ver'\)/.test(rotaLista) && !/verificarPermissao/.test(semComentarios(rotaLista)))
ok("POST …/acao usa exigirTorre com a permissão de cada ação", /exigirTorre\(request, PERMISSAO_DA_ACAO\[acao\]\)/.test(rotaAcao) && !/verificarPermissao/.test(semComentarios(rotaAcao)))
ok("avançar fase pede workflow.avancar; forçar/encerrar fase pede workflow.forcarAvanco (as MESMAS permissões das rotas de avanço)", /AVANCAR_FASE: 'workflow\.avancar'/.test(rotaAcao) && /AVANCAR_FASE_FORCADO: 'workflow\.forcarAvanco'/.test(rotaAcao) && /ENCERRAR_FASE_NAO_DEVIDA: 'workflow\.forcarAvanco'/.test(rotaAcao))
ok("o avanço passa pela PORTA CANÔNICA (advance/forceAdvance do PhaseAdvanceService) — nunca escreve faseAtualKey", /from '@\/src\/lib\/motor\/phase-advance'/.test(ler("src/services/precisa-de-voce-acoes.ts")) && !/faseAtualKey:/.test(semComentarios(ler("src/services/precisa-de-voce-acoes.ts"))))
ok("POST …/desfazer usa exigirTorre('tarefas.editar')", /exigirTorre\(request, 'tarefas\.editar'\)/.test(rotaDesfazer) && !/verificarPermissao/.test(semComentarios(rotaDesfazer)))

console.log(`\n${falhou === 0 ? "✅ PASSOU" : "❌ FALHOU"}: ${passou} ok, ${falhou} falhas`)
if (falhou > 0) { console.log(falhas.join("\n")); process.exit(1) }
