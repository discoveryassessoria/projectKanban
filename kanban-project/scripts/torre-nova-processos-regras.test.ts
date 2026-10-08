// scripts/torre-nova-processos-regras.test.ts
// ============================================================================
// TORRE NOVA — PROCESSOS (POR FASE): as regras PURAS (`torre-fase.ts`, `torre-proxima-acao.ts`). Sem banco.
//
//   npx tsx scripts/torre-nova-processos-regras.test.ts
//
// PROVA (CHECKLIST T171–T207, T221–T227): botões de fase com contagem e a fase inicial; os 4 filtros de situação (Todos · Precisam de
// alguém · Atenção · Parados ou sem dono) e suas contagens; País, Responsável, busca (família + próxima ação + responsável, sem acento)
// combinando em E; as 4 ordens; paginação real e rodapé; "Na fase há" (cor pela meta); Saúde da fase (números,
// barra em %, tempo médio vs meta, frase da semana); o cartão por passo (caixas, gargalo); a PRÓXIMA AÇÃO derivada das tarefas abertas
// (prioridade, textos, "—" sem tarefa) e o prazo curto (ontem/hoje/amanhã/dd/mm); textos fixos do protótipo na tela.
// ============================================================================
import { readFileSync } from "node:fs"
import {
  FILTROS_DE_PROCESSOS, ORDENS_DE_PROCESSOS, PARAMETROS_INICIAIS, SEM_RESPONSAVEL, ITENS_POR_PAGINA,
  aplicarPaisRespBusca, botoesDeFase, contagensDosFiltros, escolherFaseInicial, metaDaVisao, opcoesDePais, opcoesDeResponsavel, ordenarProcessos,
  paginar, passaNoFiltro, passosDaFase, somaExibidaDosPassos, rodapeDeProcessos, saudeDaFase, fraseDaSemana, textoNaFase, tomDosDias, textoDuracao,
} from "../lib/operacional/torre-fase"
import { proximaAcaoDoProcesso, prazoCurto, tipoDaTarefa, type LinhaParaProximaAcao } from "../lib/operacional/torre-proxima-acao"
import { processo } from "./_torre-nova-fabrica"

let passou = 0, falhou = 0
const ok = (n: string, c: boolean, extra = "") => { if (c) { passou++; console.log(`  ✅ ${n}${extra ? ` — ${extra}` : ""}`) } else { falhou++; console.log(`  ❌ ${n}${extra ? ` — ${extra}` : ""}`) } }
const secao = (t: string) => console.log(`\n${t}`)

const AGORA = new Date("2026-10-01T15:00:00Z") // 12:00 em São Paulo
const prazoEm = (d: number) => new Date(AGORA.getTime() + d * 86_400_000).toISOString()
const acao = (texto: string, resp: string | null, dias: number | null) => ({
  texto, tipo: "executar" as const, urgencia: null, tarefaId: 1, responsavelId: resp ? 1 : null, responsavelNome: resp, dataPrazo: dias == null ? null : prazoEm(dias), quantas: 1,
  responsaveis: resp ? { donos: [{ id: 1, nome: resp, n: 1 }], semDono: 0, abertas: 1, texto: resp } : { donos: [], semDono: 1, abertas: 1, texto: "Sem responsável" },
  prazo: prazoCurto(dias == null ? null : prazoEm(dias), AGORA),
})
const d = (n: number) => ({ desde: "2026-09-01T12:00:00.000Z", origem: "AVANCO_DE_FASE", dias: n, horas: n * 24 })

// A fase "emissao" do protótipo (12 linhas de §1.4), com os dados de lá.
const EMISSAO = [
  processo({ id: 1, nome: "Bertolucci", pais: "Itália", nivel: "critico", naFase: d(52), proximaAcao: acao("Cobrar Cartório de Caxias do Sul (3 certidões)", "Daniela Brait", -1) }),
  processo({ id: 2, nome: "Ferreira Lopes", pais: "Portugal", nivel: "parado", naFase: d(38), proximaAcao: acao("Ligar 4ª Zona de Porto Alegre (3ª cobrança)", "Priscila", 1) }),
  processo({ id: 3, nome: "Salvarani", pais: "Itália", nivel: "critico", semDono: true, naFase: d(1), proximaAcao: acao("Distribuir as 12 certidões", null, 0) }),
  processo({ id: 4, nome: "Antão", pais: "Espanha", nivel: "atencao", semDono: true, naFase: d(0), proximaAcao: acao("Distribuir as 12 certidões de Emissão", null, 9) }),
  processo({ id: 5, nome: "Rossetto", pais: "Itália", nivel: "atencao", naFase: d(31), proximaAcao: acao("Conferir 2 certidões que chegaram ontem", "Marco Rovatti", 0) }),
  processo({ id: 6, nome: "Gallo Pereira", pais: "Itália", nivel: "atencao", naFase: d(33), proximaAcao: acao("Aguardar retorno do 1º Ofício de Santos", "Daniela Brait", 4) }),
  processo({ id: 7, nome: "Navarro Ruiz", pais: "Espanha", nivel: "no_ritmo", naFase: d(27), proximaAcao: acao("Conferir óbito de Manuel Navarro", "Priscila", 2) }),
  processo({ id: 8, nome: "Moretti Campos", pais: "Itália", nivel: "no_ritmo", naFase: d(19), proximaAcao: acao("Pedir 3 certidões ao Cartório de Jundiaí", "Priscila", 3) }),
  processo({ id: 9, nome: "Zanella", pais: "Itália", nivel: "no_ritmo", naFase: d(24), proximaAcao: acao("Aguardar Cartório de Bento Gonçalves", "Daniela Brait", 7) }),
  processo({ id: 10, nome: "Albuquerque Dias", pais: "Portugal", nivel: "no_ritmo", naFase: d(15), proximaAcao: acao("Aguardar Conservatória de Braga", "Marco Rovatti", 13) }),
  processo({ id: 11, nome: "Schneider", pais: "Alemanha", nivel: "no_ritmo", naFase: d(12), proximaAcao: acao("Solicitar 5 certidões em Blumenau", "Daniela Brait", 8) }),
  processo({ id: 12, nome: "Lombardi", pais: "Itália", nivel: "no_ritmo", naFase: d(6), proximaAcao: acao("Solicitar nascimento do bisavô em Nova Trento", "Priscila", 11) }),
]
const nomes = (xs: typeof EMISSAO) => xs.map((p) => p.familiaNome)

secao("SITUAÇÃO DA LINHA e os 4 FILTROS (T194, T195)")
ok("rótulos: Todos · Precisam de alguém · Atenção · Parados ou críticos", FILTROS_DE_PROCESSOS.map((f) => f.rotulo).join(" · ") === "Todos · Precisam de alguém · Atenção · Parados ou críticos")
ok("situações = o risco: crítico/parado → 'pa' (com ou sem dono); atenção → 'at'; no ritmo → 'ok'", EMISSAO.map((p) => p.situacao).join() === "pa,pa,pa,at,at,at,ok,ok,ok,ok,ok,ok")
const base = aplicarPaisRespBusca(EMISSAO, PARAMETROS_INICIAIS)
const c = contagensDosFiltros(base)
ok("contagens (protótipo, escala 12): todos 12 · precisam 6 · atenção 3 · parados ou críticos 3", c.todos === 12 && c.precisam === 6 && c.atencao === 3 && c.parados === 3, JSON.stringify(c))
ok("Precisam de alguém = situação ≠ No ritmo (6: Bertolucci, Ferreira Lopes, Salvarani, Antão, Rossetto, Gallo Pereira)", nomes(EMISSAO.filter((p) => passaNoFiltro(p, "precisam"))).join() === "Bertolucci,Ferreira Lopes,Salvarani,Antão,Rossetto,Gallo Pereira")
ok("Atenção = só Atenção (3) · Parados ou críticos = pa (3)", nomes(EMISSAO.filter((p) => passaNoFiltro(p, "atencao"))).join() === "Antão,Rossetto,Gallo Pereira" && nomes(EMISSAO.filter((p) => passaNoFiltro(p, "parados"))).join() === "Bertolucci,Ferreira Lopes,Salvarani")

secao("PAÍS, RESPONSÁVEL e BUSCA — combinam em E (T196, T197, T172, T221)")
const par = (o: Partial<typeof PARAMETROS_INICIAIS>) => aplicarPaisRespBusca(EMISSAO, { ...PARAMETROS_INICIAIS, ...o })
ok("País (igualdade): Itália 7 · Espanha 2 · Portugal 2 · Alemanha 1", par({ pais: "Itália" }).length === 7 && par({ pais: "Espanha" }).length === 2 && par({ pais: "Portugal" }).length === 2 && par({ pais: "Alemanha" }).length === 1)
ok("Responsável (igualdade): Daniela Brait 4 · Priscila 4 · Marco Rovatti 2 · Sem responsável 2", par({ resp: "Daniela Brait" }).length === 4 && par({ resp: "Priscila" }).length === 4 && par({ resp: "Marco Rovatti" }).length === 2 && nomes(par({ resp: SEM_RESPONSAVEL })).join() === "Salvarani,Antão")
ok("busca 'caxias' acha Bertolucci (a próxima ação cita Caxias do Sul); 'daniela' acha 4", nomes(par({ busca: "caxias" })).join() === "Bertolucci" && par({ busca: "daniela" }).length === 4)
ok("busca sem acento/maiúsculas: 'ANTAO' acha Antão; 'bisavo' acha a ação de Lombardi", nomes(par({ busca: "ANTAO" })).join() === "Antão" && nomes(par({ busca: "bisavo" })).join() === "Lombardi")
ok("busca vazia/só espaços não filtra", par({ busca: "   " }).length === 12)
ok("E: Itália + Daniela Brait + 'a' → Bertolucci, Gallo Pereira, Zanella", nomes(par({ pais: "Itália", resp: "Daniela Brait", busca: "a" })).sort().join() === "Bertolucci,Gallo Pereira,Zanella")
ok("sem resultado: país e responsável que não se cruzam", par({ pais: "Alemanha", resp: "Priscila" }).length === 0)
ok("opções do País: 'Todos os países' + os presentes; do Responsável: 'Todos os responsáveis' + nomes + 'Sem responsável'", opcoesDePais(EMISSAO).join() === "Todos os países,Alemanha,Espanha,Itália,Portugal" && opcoesDeResponsavel(EMISSAO).join() === "Todos os responsáveis,Daniela Brait,Marco Rovatti,Priscila,Sem responsável")
ok("linha SEM próxima ação não é 'Sem responsável' (é '—')", !aplicarPaisRespBusca([processo({ id: 50, nome: "Sem Ação" })], { ...PARAMETROS_INICIAIS, resp: SEM_RESPONSAVEL }).length)

secao("AS 4 ORDENS (T198, T199)")
ok("rótulos: mais atrasado primeiro · Prazo mais próximo · Entrou na fase há mais tempo · Família A–Z", ORDENS_DE_PROCESSOS.map((o) => o.rotulo).join(" | ") === "Ordenar: mais atrasado primeiro | Prazo mais próximo | Entrou na fase há mais tempo | Família A–Z")
ok("mais atrasado: Parado → Atenção → No ritmo, desempate pelo prazo", nomes(ordenarProcessos(EMISSAO, "atrasado")).join() === "Bertolucci,Salvarani,Ferreira Lopes,Rossetto,Gallo Pereira,Antão,Navarro Ruiz,Moretti Campos,Zanella,Schneider,Lombardi,Albuquerque Dias", nomes(ordenarProcessos(EMISSAO, "atrasado")).join())
ok("prazo mais próximo (ontem < hoje < amanhã < dd/mm; empate pelo nome)", nomes(ordenarProcessos(EMISSAO, "prazo")).slice(0, 5).join() === "Bertolucci,Rossetto,Salvarani,Ferreira Lopes,Navarro Ruiz")
ok("entrou na fase há mais tempo (dias, maior primeiro)", nomes(ordenarProcessos(EMISSAO, "tempo")).slice(0, 4).join() === "Bertolucci,Ferreira Lopes,Gallo Pereira,Rossetto" && nomes(ordenarProcessos(EMISSAO, "tempo")).at(-1) === "Antão")
ok("Família A–Z (pt-BR)", nomes(ordenarProcessos(EMISSAO, "az")).slice(0, 3).join() === "Albuquerque Dias,Antão,Bertolucci")
ok("sem prazo vai para o fim no 'prazo mais próximo'", nomes(ordenarProcessos([...EMISSAO, processo({ id: 60, nome: "Sem Prazo", proximaAcao: acao("x", "A", null) })], "prazo")).at(-1) === "Sem Prazo")

secao("PAGINAÇÃO REAL e RODAPÉ (T222, T224, T225)")
const mil = Array.from({ length: 30 }, (_, i) => processo({ id: 200 + i, nome: `F${String(i).padStart(2, "0")}` }))
const pg1 = paginar(mil, 1), pg3 = paginar(mil, 3)
ok("12 por página: página 1 = 12, página 3 = 6", ITENS_POR_PAGINA === 12 && pg1.itens.length === 12 && pg3.itens.length === 6 && pg1.totalPaginas === 3)
ok("rodapé: 'Mostrando 12 de 30 processos da fase · 12 por página' / página 3: 'Mostrando 6 de 30…'", rodapeDeProcessos(pg1) === "Mostrando 12 de 30 processos da fase · 12 por página" && rodapeDeProcessos(pg3) === "Mostrando 6 de 30 processos da fase · 12 por página")
ok("rodapé sem resultado: 'Nenhum processo encontrado com esses filtros.'", rodapeDeProcessos(paginar([], 1)) === "Nenhum processo encontrado com esses filtros.")

secao("'NA FASE HÁ' (T202)")
ok("'52 d / 30' com meta; '52 d' sem meta; '—' sem registro", textoNaFase(EMISSAO[0]) === "52 dias / 30 dias" && textoNaFase({ ...EMISSAO[0], metaDias: null }) === "52 dias" && textoNaFase({ naFase: { desde: null, origem: null, dias: null, horas: null }, metaDias: 30 }) === "—")
ok("cor pela META da fase: acima = vermelho; acima de 80% = âmbar; senão normal (meta 30 → cortes 30 e 24, como no protótipo)", tomDosDias(31, 30) === "vermelho" && tomDosDias(30, 30) === "ambar" && tomDosDias(25, 30) === "ambar" && tomDosDias(24, 30) === "normal" && tomDosDias(10, 30) === "normal")
ok("o corte acompanha a meta de cada fase (Retificação 60: 50 d é âmbar, 61 d vermelho) e sem meta não há cor", tomDosDias(50, 60) === "ambar" && tomDosDias(61, 60) === "vermelho" && tomDosDias(400, null) === "normal" && tomDosDias(null, 30) === "normal")

secao("BOTÕES DE FASE (T175, T176)")
const colunas = [{ key: "genealogia", label: "Genealogia", condicional: false }, { key: "emissao", label: "Emissão Documental", condicional: false }, { key: "analise", label: "Análise Documental", condicional: false }]
const mix = [...EMISSAO, processo({ id: 70, nome: "G1", fase: "genealogia" }), processo({ id: 71, nome: "G2", fase: "genealogia" })]
const botoes = botoesDeFase(colunas, mix)
ok("um botão por fase do cadastro, com a contagem dos processos que estão nela", botoes.map((b) => `${b.label} ${b.n}`).join() === "Genealogia 2,Emissão Documental 12,Análise Documental 0")
ok("a fase inicial é a de MAIOR volume (no protótipo, Emissão); sem processo nenhum, a primeira; sem fases, null", escolherFaseInicial(botoes) === "emissao" && escolherFaseInicial(botoesDeFase(colunas, [])) === "genealogia" && escolherFaseInicial([]) === null)

secao("SAÚDE DA FASE (T178–T187)")
const s = saudeDaFase(EMISSAO, { tempoMedioDias: 34, metaDias: 30, fluxo: { entraram: 14, sairam: [{ para: "analise", n: 11 }] }, rotuloDaFase: (k) => (k === "analise" ? "Análise" : k) })
ok("números: no ritmo 6 · atenção 3 · parados 3 (pa) = total 12", s.ok === 6 && s.atencao === 3 && s.parados === 3 && s.total === 12 && s.ok + s.atencao + s.parados === s.total)
ok("barra: valor/total em %, 1 casa (50 · 25 · 25)", s.barra.ok === 50 && s.barra.atencao === 25 && s.barra.parados === 25)
ok("tempo médio 34 d acima da meta 30 d → vermelho; abaixo ou sem meta → verde", s.acimaDaMeta === true && saudeDaFase(EMISSAO, { tempoMedioDias: 12, metaDias: 15, fluxo: null, rotuloDaFase: String }).acimaDaMeta === false && saudeDaFase(EMISSAO, { tempoMedioDias: 99, metaDias: null, fluxo: null, rotuloDaFase: String }).acimaDaMeta === false)
ok("frase da semana (Emissão): 'Entraram 14 esta semana · saíram 11 para Análise. Se o ritmo continuar, a fase cresce 3 processos/semana.'", s.semana === "Entraram 14 esta semana · saíram 11 para Análise. Se o ritmo continuar, a fase cresce 3 processos/semana.", s.semana)
ok("frase (Genealogia): 'Entraram 12 esta semana · saíram 14 para Emissão.' (sem 'cresce' quando saem mais)", fraseDaSemana({ entraram: 12, sairam: [{ para: "emissao", n: 14 }] }, (k) => (k === "emissao" ? "Emissão" : k)) === "Entraram 12 esta semana · saíram 14 para Emissão.")
ok("frase (Análise): destinos múltiplos 'saíram 9 (6 para Tradução, 3 para Retificação)'", fraseDaSemana({ entraram: 11, sairam: [{ para: "t", n: 6 }, { para: "r", n: 3 }] }, (k) => (k === "t" ? "Tradução" : "Retificação")) === "Entraram 11 esta semana · saíram 9 (6 para Tradução, 3 para Retificação). Se o ritmo continuar, a fase cresce 2 processos/semana.")
ok("frase sem movimento: nada inventado", fraseDaSemana(null, String) === "Nenhum processo entrou nem saiu desta fase esta semana." && fraseDaSemana({ entraram: 0, sairam: [] }, String) === "Nenhum processo entrou nem saiu desta fase esta semana.")
ok("singular: 'cresce 1 processo/semana'", fraseDaSemana({ entraram: 3, sairam: [{ para: "x", n: 2 }] }, String).endsWith("a fase cresce 1 processo/semana."))
ok("meta da visão: a que todos compartilham; se divergem (países), a padrão; sem nenhuma, null", metaDaVisao([{ metaDias: 45 }, { metaDias: 45 }], 30) === 45 && metaDaVisao([{ metaDias: 45 }, { metaDias: 30 }], 30) === 30 && metaDaVisao([{ metaDias: null }], null) === null && metaDaVisao([{ metaDias: null }], 30) === 30)
ok("duração: '34 d' · '4,1 meses' · '—'", textoDuracao(34, null) === "34 dias" && textoDuracao(123, null) === "4,1 meses" && textoDuracao(null, null) === "—")

secao("ONDE ESTÃO AS CERTIDÕES — POR PASSO (T188–T193)")
const fase = [
  processo({ id: 90, nome: "A", tarefasDaFase: { abertas: 5, semResponsavel: 2, concluidas: 3, ehCertidao: true, passos: [{ chave: "Solicitar", label: "Solicitar", ordem: 1, n: 1, aguardando: 0, acimaDaMeta: 0 }, { chave: "Aguardar", label: "Aguardar", ordem: 2, n: 2, aguardando: 2, acimaDaMeta: 1 }] } }),
  processo({ id: 91, nome: "B", tarefasDaFase: { abertas: 6, semResponsavel: 0, concluidas: 1, ehCertidao: true, passos: [{ chave: "Aguardar", label: "Aguardar", ordem: 2, n: 6, aguardando: 6, acimaDaMeta: 4 }] } }),
]
const pf = passosDaFase(fase, 30)
ok("o título soma abertas + concluídas (grain TAREFA): 15 certidões", pf.total === 15 && pf.substantivo === "certidões")
ok("caixas: SÓ passos reais (a se a maioria espera, n se não) + Concluídas (g) — 'Sem responsável' NÃO é caixa", pf.caixas.map((x) => `${x.nome}:${x.n}:${x.classe}`).join() === "Solicitar:1:n,Aguardar:8:a,Concluídas:4:g" && !pf.caixas.some((x) => x.nome === "Sem responsável"), pf.caixas.map((x) => `${x.nome}:${x.n}:${x.classe}`).join())
ok("as sem responsável vêm à parte (2) e a SOMA exibida continua igual ao total (N = 15)", pf.semResponsavel === 2 && somaExibidaDosPassos(pf) === pf.total && pf.total === 15, `${somaExibidaDosPassos(pf)} × ${pf.total}`)
ok("observação do passo em espera: quantas passaram da meta ('5 há mais de 30 d')", pf.caixas[1].obs === "5 há mais de 30 dias")
ok("gargalo: 'O passo com mais volume parado é Aguardar: 8 certidões, 5 há mais de 30 d.'", pf.gargalo === "O passo com mais volume parado é Aguardar: 8 certidões, 5 há mais de 30 dias.", pf.gargalo)
ok("o passo NÃO multiplica: as caixas de passo somam as tarefas abertas COM responsável (9 = 11 abertas − 2 sem responsável)", pf.caixas.filter((x) => x.classe === "n" || x.classe === "a").reduce((a, x) => a + x.n, 0) === 9)
ok("sem tarefa aberta: gargalo diz que está tudo concluído; sem nada: 'Nenhuma certidão nesta fase ainda.'", passosDaFase([processo({ id: 92, nome: "Z", tarefasDaFase: { abertas: 0, semResponsavel: 0, concluidas: 5, passos: [], ehCertidao: true } })], 30).gargalo.startsWith("Nenhuma certidão aberta") && passosDaFase([], null).gargalo === "Nenhuma tarefa nesta fase ainda.")
ok("fase sem certidões usa 'tarefas'", passosDaFase([processo({ id: 93, nome: "P", tarefasDaFase: { abertas: 1, semResponsavel: 1, concluidas: 0, passos: [], ehCertidao: false } })], null).substantivo === "tarefas")

secao("A PRÓXIMA AÇÃO — derivada das tarefas abertas (decisão 3 do PROGRESSO) (T200)")
const L = (o: Partial<LinhaParaProximaAcao> & { taskId: number }): LinhaParaProximaAcao => ({
  titulo: `Certidão de nascimento · Pessoa ${o.taskId}`, statusTarefa: "EM_ANDAMENTO", faseMacroKey: "emissao", responsavelId: 7, responsavelNome: "Daniela Brait", dataPrazo: prazoEm(5), atrasada: false,
  diasParaPrazo: 5, estadoOperacao: "FILA", esperandoDe: null, acompanhamentoVencido: false, totalCobrancas: 0, terceiroNome: null, documentoId: 1, aIniciar: false, ...o,
})
ok("sem tarefa aberta na fase → null ('—')", proximaAcaoDoProcesso([], "emissao") === null && proximaAcaoDoProcesso([L({ taskId: 1, estadoOperacao: "CONCLUIDA" })], "emissao") === null)
ok("tarefa de OUTRA fase nunca vaza para a fase consultada", proximaAcaoDoProcesso([L({ taskId: 1, faseMacroKey: "genealogia", atrasada: true })], "emissao") === null)
ok("sem responsável → 'Distribuir as N certidões' e o responsável da linha é null", (() => { const a = proximaAcaoDoProcesso([1, 2, 3].map((n) => L({ taskId: n, responsavelId: null, responsavelNome: null })), "emissao"); return a?.texto === "Distribuir as 3 certidões" && a.responsavelNome === null && a.tipo === "distribuir" })())
ok("uma só sem responsável: nomeia a certidão + pessoa", proximaAcaoDoProcesso([L({ taskId: 9, responsavelId: null, responsavelNome: null, titulo: "Certidão de óbito · Maria" })], "emissao")?.texto === "Distribuir: Certidão de óbito · Maria")
ok("cobrança vencida → 'Cobrar <terceiro> (N certidões)' e, sozinha, '(3ª cobrança): <certidão>'", (() => {
  const duas = proximaAcaoDoProcesso([1, 2].map((n) => L({ taskId: n, estadoOperacao: "AGUARDANDO", esperandoDe: "terceiro", acompanhamentoVencido: true, terceiroNome: "Cartório de Caxias do Sul" })), "emissao")
  const uma = proximaAcaoDoProcesso([L({ taskId: 3, estadoOperacao: "AGUARDANDO", esperandoDe: "terceiro", acompanhamentoVencido: true, terceiroNome: "4ª Zona de Porto Alegre", totalCobrancas: 2, titulo: "Certidão de casamento · João" })], "emissao")
  return duas?.texto === "Cobrar Cartório de Caxias do Sul (2 certidões)" && uma?.texto === "Cobrar 4ª Zona de Porto Alegre (3ª cobrança): Certidão de casamento · João"
})())
ok("espera em dia → 'Aguardar retorno de <terceiro>'; do cliente → 'o cliente'", proximaAcaoDoProcesso([L({ taskId: 1, estadoOperacao: "AGUARDANDO", esperandoDe: "terceiro", terceiroNome: "1º Ofício de Santos" })], "emissao")?.texto.startsWith("Aguardar retorno de 1º Ofício de Santos") === true && proximaAcaoDoProcesso([L({ taskId: 1, esperandoDe: "cliente", estadoOperacao: "AGUARDANDO" })], "emissao")?.texto.startsWith("Aguardar retorno de o cliente") === true)
ok("a mais urgente manda: atrasada > cobrança > sem responsável > bloqueada > prazo hoje/amanhã > a iniciar > executar > aguardar", (() => {
  const tarefas = [
    L({ taskId: 8, estadoOperacao: "AGUARDANDO", esperandoDe: "terceiro", terceiroNome: "X" }),
    L({ taskId: 7 }),
    L({ taskId: 6, aIniciar: true, statusTarefa: "NAO_INICIADA" }),
    L({ taskId: 5, diasParaPrazo: 1, dataPrazo: prazoEm(1) }),
    L({ taskId: 4, statusTarefa: "BLOQUEADA" }),
    L({ taskId: 3, responsavelId: null, responsavelNome: null }),
    L({ taskId: 2, estadoOperacao: "AGUARDANDO", esperandoDe: "terceiro", acompanhamentoVencido: true, terceiroNome: "Y" }),
    L({ taskId: 1, atrasada: true, diasParaPrazo: -2, dataPrazo: prazoEm(-2) }),
  ]
  const ordem: number[] = []
  let resto = tarefas
  while (resto.length) { const a = proximaAcaoDoProcesso(resto, "emissao"); if (!a) break; ordem.push(a.tarefaId); resto = resto.filter((t) => t.taskId !== a.tarefaId) }
  return ordem.join() === "1,2,3,4,5,6,7,8"
})())
ok("dono e prazo vêm da tarefa escolhida", (() => { const a = proximaAcaoDoProcesso([L({ taskId: 1, atrasada: true, dataPrazo: prazoEm(-1), diasParaPrazo: -1, responsavelNome: "Priscila" })], "emissao"); return a?.responsavelNome === "Priscila" && a.dataPrazo === prazoEm(-1) && a.urgencia === "atrasada" })())
ok("empate de urgência: prazo mais próximo, depois o menor id", proximaAcaoDoProcesso([L({ taskId: 5, dataPrazo: prazoEm(9) }), L({ taskId: 4, dataPrazo: prazoEm(3) })], "emissao")?.tarefaId === 4)
ok("tipoDaTarefa: sem dono vence espera (ninguém cobra o que não tem dono)", tipoDaTarefa(L({ taskId: 1, responsavelId: null, estadoOperacao: "AGUARDANDO", esperandoDe: "terceiro" })) === "distribuir")

secao("O PRAZO CURTO (T206)")
ok("ontem (vermelho) · hoje (âmbar) · amanhã · dd/mm", prazoCurto(prazoEm(-1), AGORA).texto === "ontem" && prazoCurto(prazoEm(-1), AGORA).tom === "vermelho" && prazoCurto(prazoEm(0), AGORA).texto === "hoje" && prazoCurto(prazoEm(0), AGORA).tom === "ambar" && prazoCurto(prazoEm(1), AGORA).texto === "amanhã" && prazoCurto(prazoEm(5), AGORA).texto === "06/10")
ok("passado mais antigo: 'dd/mm' em vermelho; sem prazo: null", prazoCurto(prazoEm(-9), AGORA).texto === "22/09" && prazoCurto(prazoEm(-9), AGORA).tom === "vermelho" && prazoCurto(null, AGORA).texto === null)
ok("o dia é o do fuso operacional (23:30 em São Paulo ainda é 'hoje' mesmo sendo 02:30 UTC do dia seguinte)", prazoCurto("2026-10-02T02:30:00Z", new Date("2026-10-01T15:00:00Z")).texto === "hoje")

secao("TEXTOS FIXOS NA TELA (T170–T177, T188, T194–T198, T200, T217–T227)")
const tela = readFileSync("src/components/torre/TorreProcessos.tsx", "utf8") + readFileSync("src/components/torre/TorreSaudeDaFase.tsx", "utf8") + readFileSync("src/components/torre/TorrePassosDaFase.tsx", "utf8") + readFileSync("lib/operacional/torre-fase.ts", "utf8")
for (const t of ["Torre de Controle", "Buscar família, pessoa, cartório…", "Escolha a fase — a tabela abaixo mostra só os processos dela", "Saúde da fase", "no ritmo", "atenção", "parados", "tempo médio real · meta", "desta fase — por passo", "Família · país", "Na fase há", "Certidões prontas", "Aguardando", "Próxima ação", "Responsável", "Prazo", "Situação", "Ações", "Foco", "Relatório", "Todos os países", "Todos os responsáveis", "Nenhum processo encontrado com esses filtros.", "12 por página", "Cada linha é um processo."])
  ok(`a tela tem o texto "${t}"`, tela.includes(t))
ok("todo botão tem handler; sem 'exemplo do protótipo' / 'Com o cartório' / 'Sem ninguém'", [...tela.matchAll(/<button\b[^>]*>/g)].every((m) => /onClick=/.test(m[0])) && !/exemplo do prot|reaproveitados|Com o cart[oó]rio|Sem ningu/.test(tela))
ok("Foco e o nome da família levam a /torre/processo/[id]; Relatório só com permissão", (tela.match(/href=\{`\/torre\/processo\/\$\{p\.processoId\}`\}/g) ?? []).length === 2 && /podeRelatorio && \(/.test(tela))

// A coluna "Passo onde a maioria está" foi REMOVIDA da aba Processos: mostrava "Sem responsável", que não é um passo.
{
  const tela = readFileSync("src/components/torre/TorreProcessos.tsx", "utf8")
  ok("a coluna 'Passo onde a maioria está' não existe mais na tela", !tela.includes("Passo onde a maioria está") && !tela.includes("passoDominante"))
}

console.log(`\n${passou} verificações ok, ${falhou} falha(s)`)
process.exit(falhou ? 1 : 0)

