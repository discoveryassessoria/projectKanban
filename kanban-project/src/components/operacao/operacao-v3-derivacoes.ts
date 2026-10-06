// src/components/operacao/operacao-v3-derivacoes.ts
// ============================================================================
// ETAPA 3 — DERIVAÇÕES PURAS (porte de `renderVals()` do protótipo).
//
// Nenhuma função aqui faz fetch nem toca estado — só transforma
// `LinhaOperacaoV3[]` (já vindo pronto do servidor) em rótulos/classes/grupos
// para a tela desenhar. As contas canônicas (atrasado/vencido/prazo) já vêm
// computadas do servidor (`rotuloDoPrazo`, `acompanhamentoPasso`, etc.) —
// aqui só se formata e agrupa, nunca se recalcula.
// ============================================================================
import { ordenarLinhasDeCertidao } from "@/lib/operacional/ordem-certidoes"
import type { LinhaOperacaoV3, EstadoTemporalApi } from "./operacao-v3-tipos"
import { ROTULO_STATUS as ROTULO_STATUS_TAREFA } from "@/src/lib/home/rotulo-status-tarefa"
import { FUSO_OPERACIONAL } from "@/lib/operacional/tempo-operacional"

export const fmtData = (iso: string | null): string => {
  if (!iso) return "—"
  const d = new Date(iso)
  // dia/mês no fuso da OPERAÇÃO (America/Sao_Paulo), nunca no do navegador (`getDate()/getMonth()` usavam o local).
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", timeZone: FUSO_OPERACIONAL })
}

/** "vencido há N d" / "hoje" / "amanhã" / "em N d" — a partir do EstadoTemporal já computado. */
export const relTxt = (et: EstadoTemporalApi | null): string => {
  if (!et || et.semPrazo) return "—"
  if (et.atrasado) return `vencido há ${et.atrasadoHaDias ?? "?"} d`
  if (et.venceHoje) return "hoje"
  if (et.venceAmanha) return "amanhã"
  if (et.diasParaPrazo != null) return `em ${et.diasParaPrazo} d`
  return "—"
}
/** "vencido há N d · DD/MM" — como o protótipo mostra na coluna Acompanhamento; "—" sozinho quando não há acompanhamento. */
export const acompTxtCompleto = (et: EstadoTemporalApi | null): string =>
  !et || et.semPrazo ? "—" : `${relTxt(et)} · ${fmtData(et.dueAt)}`
export const relCls = (et: EstadoTemporalApi | null): string => {
  if (!et || et.semPrazo) return "opv3-p-gry"
  if (et.atrasado) return "opv3-p-red"
  if (et.venceHoje) return "opv3-p-amb"
  return "opv3-p-gry"
}

/**
 * EM ANDAMENTO SEM DONO — a tarefa já foi iniciada (statusTarefa EM_ANDAMENTO) e hoje ninguém responde por ela.
 * Achado real 30/09/2026 (processo 651: #3834/#3845/#3850): depois de "devolver à fila" o status seguia EM_ANDAMENTO
 * e a tela dizia "A iniciar (enviar ao cartório)" — mentira sobre o estado — sem oferecer ação.
 * `aIniciar` (projeção da subtarefa) não conhece o status da Tarefa; a tela NUNCA o mostra para quem já iniciou sem dono.
 */
export const emAndamentoSemDono = (l: Pick<LinhaOperacaoV3, "statusTarefa" | "responsavelId">): boolean =>
  l.statusTarefa === "EM_ANDAMENTO" && l.responsavelId == null

/** `aIniciar` da projeção, corrigido: tarefa EM ANDAMENTO sem dono nunca é "a iniciar". */
export const aIniciarEfetivo = (l: Pick<LinhaOperacaoV3, "aIniciar" | "statusTarefa" | "responsavelId">): boolean =>
  l.aIniciar && !emAndamentoSemDono(l)

/** COLUNA "PASSO ATUAL" — SOMENTE o nome do passo (ex.: "Localizar registro da certidão"). Sem "A iniciar ·", sem
 *  "(enviar ao cartório)", sem "fase Genealogia" (a fase tem coluna própria) e sem "2/4" (a posição do passo fica dentro
 *  do painel). O ESTADO da tarefa não mora aqui: vai na coluna "Status" (`statusTarefaTxt`), sempre do `statusTarefa`
 *  real. O nome vem do cadastro (`passoCorrente.label`, senão `etapaAtual`) — nunca de literal no código.
 *  `sub` fica sempre vazio (mantido só para não quebrar quem lê `{ label, sub }`). */
export function passoLabelDe(l: Pick<LinhaOperacaoV3, "passoCorrente" | "etapaAtual">): { label: string; sub: string } {
  return { label: l.passoCorrente?.label ?? l.etapaAtual ?? "—", sub: "" }
}

/** O MAPA ÚNICO DE STATUS DA TAREFA em português claro — coluna "Status" da Operação e da Torre. Cobre TODO o enum
 *  `StatusTarefa` (prisma/schema.prisma). É o `statusTarefa` REAL da linha; nunca inferido do passo.
 *  NÃO é uma cópia: é o MESMO mapa de `src/lib/home/rotulo-status-tarefa.ts` (fonte única, módulo puro). */
export { ROTULO_STATUS_TAREFA }
export const statusTarefaTxt = (l: Pick<LinhaOperacaoV3, "statusTarefa">): string => ROTULO_STATUS_TAREFA[l.statusTarefa] ?? l.statusTarefa
/** Cor da pílula do status — neutro por padrão; âmbar só para o que pede atenção humana. */
export const statusTarefaCls = (l: Pick<LinhaOperacaoV3, "statusTarefa">): string => {
  if (l.statusTarefa === "BLOQUEADA") return "opv3-p-red"
  if (l.statusTarefa === "EM_ANDAMENTO") return "opv3-p-blu"
  if (l.statusTarefa === "CONCLUIDO_RECEBIDO" || l.statusTarefa === "CONCLUIDO_NAO_POSSUI") return "opv3-p-grn"
  return "opv3-p-gry"
}

/** A FASE da tarefa — coluna "Fase" (renomeada de "Por que aqui", mandato
 *  "Operação/Antão", correção pós-conferência 29/09/2026) e o selo da linha na
 *  agrupação por pessoa. Informação NEUTRA por padrão (nunca vermelho): o
 *  vermelho fica reservado para "Fase anterior", quando a tarefa É de uma fase
 *  já passada do processo — a única situação que é alerta de verdade.
 *  "Fase atual: <fase>"/"· <país>" saíram daqui: aparecem UMA vez, no
 *  cabeçalho da família (achado real, mandato acima: repetiam em toda linha
 *  de Genealogia, e "· Espanha" — nacionalidade do PROCESSO, não do
 *  documento — aparecia até na certidão de quem nasceu no Brasil). */
export function faseLabelDe(l: LinhaOperacaoV3): { texto: string; cls: string } {
  if (l.origem === "TRANSVERSAL") return { texto: "Transversal", cls: "opv3-p-gry" }
  if (l.faseAnteriorAFaseAtual) return { texto: "Fase anterior", cls: "opv3-p-red" }
  return { texto: l.faseAtualDoProcessoLabel ?? (l.faseMacroKey === "genealogia" ? "Genealogia" : "Emissão documental"), cls: "opv3-p-gry" }
}

/** Só o TIPO do documento ("Certidão de Nascimento") — sem "- Inteiro Teor" e
 *  sem o nome da pessoa (que já tem coluna própria). Mandato "Operação/Antão",
 *  29/09/2026: `t.titulo` vem pronto do servidor como
 *  "{Tipo} - Inteiro Teor · {Pessoa}" (ver `nomeDaTarefa`) — "Inteiro Teor" é
 *  jargão de cartório, não informação que falta aqui, e a pessoa duplicava a
 *  coluna ao lado. */
export function docTipoTxt(l: Pick<LinhaOperacaoV3, "titulo">): string {
  const semPessoa = l.titulo.split(" · ")[0]
  // Nunca "· com {cônjuge}": a pessoa (e o cônjuge) ficam na coluna "Pessoa".
  return semPessoa.replace(/\s*-\s*Inteiro Teor\s*$/i, "").trim()
}

/** Na Genealogia, sem órgão vinculado é o TRABALHO em curso (é isso que
 *  "Localizar registro" descobre), nunca falso alarme — "a definir", neutro.
 *  Bloqueio de verdade (vermelho) fica só na Emissão Documental, onde o órgão
 *  já devia estar resolvido antes de enviar o requerimento (mandato
 *  "Operação/Antão", correção pós-conferência 29/09/2026). */
export const orgaoTxt = (l: LinhaOperacaoV3): string =>
  l.terceiroNome
  ?? (l.documentoId == null ? "—"
    // Cartório DIGITADO mas sem órgão do cadastro: mostra o que a pessoa informou, marcado como não vinculado ("Aguila · não vinculado").
    : l.cartorioTexto ? `${l.cartorioTexto} · não vinculado`
    // "a definir" só quando não há nem vínculo nem texto.
    : l.faseMacroKey === "genealogia" ? "a definir" : "não vinculado")
/** Há cartório digitado, mas nenhum órgão vinculado — é onde aparece o atalho "vincular órgão". */
export const orgaoSoEmTexto = (l: Pick<LinhaOperacaoV3, "terceiroNome" | "cartorioTexto" | "documentoId">): boolean =>
  !l.terceiroNome && l.documentoId != null && !!l.cartorioTexto
export const orgaoCls = (l: LinhaOperacaoV3): string =>
  l.terceiroNome || l.documentoId == null ? "opv3-p-gry" : l.faseMacroKey === "genealogia" ? "opv3-p-gry" : "opv3-p-red"

/** "SEM ÓRGÃO EMISSOR" — a UMA definição do card do radar, do aviso "Vincular órgão nas N" e da lista que o
 *  card abre (número = lista). Só conta TAREFA DE DOCUMENTO (tem `documentoId`) que precisa de órgão: a tarefa
 *  de gestor ("Atribuir tarefas — <família>"), manual ou administrativa não tem documento nem cartório por
 *  natureza, e nunca poderia ser "vinculada" a um órgão (achado real 30/09/2026: #3980 e #3928 entravam na
 *  contagem). Genealogia fica de fora: sem órgão é o trabalho em curso (descobrir ONDE registrar). */
export const precisaDeOrgaoEmissor = (l: Pick<LinhaOperacaoV3, "documentoId" | "terceiroNome" | "faseMacroKey">): boolean =>
  l.documentoId != null && !l.terceiroNome && l.faseMacroKey !== "genealogia"

/** PENDÊNCIA DE FASE ANTERIOR — a UMA definição do cartão, da lista que ele abre (`radar === "faseant"`) e do número
 *  da aba. Só conta tarefa cuja fase é ANTERIOR à fase atual do processo (`faseAnteriorAFaseAtual`, calculado no
 *  servidor por `faseEhAnteriorA`). Tarefa da fase ATUAL (ex.: Genealogia com o processo em Genealogia) nunca entra.
 *  Achado real (30/09/2026, Antão): "Certidão de Casamento · Maria del Consuelo" é da fase atual e aparecia como
 *  "trava a família". Transversal não muda a fase, nunca é "de fase anterior". */
export const pendenciaDeFaseAnterior = (l: Pick<LinhaOperacaoV3, "faseAnteriorAFaseAtual" | "origem">): boolean =>
  l.faseAnteriorAFaseAtual === true && l.origem !== "TRANSVERSAL"

/** A lista que um cartão do radar abre — número do cartão = tamanho desta lista. `faseant` olha TODAS as abertas
 *  (o cartão conta abertas, não só as "a fazer"); `noorg` mantém a base da fila. */
export function linhasDoRadar<T extends Pick<LinhaOperacaoV3, "faseAnteriorAFaseAtual" | "origem" | "documentoId" | "terceiroNome" | "faseMacroKey">>(
  radar: "noorg" | "faseant" | null, abertas: readonly T[], fila: readonly T[],
): T[] {
  if (radar === "faseant") return abertas.filter(pendenciaDeFaseAnterior)
  if (radar === "noorg") return fila.filter(precisaDeOrgaoEmissor)
  return [...fila]
}

/** Quem é GESTOR para ver o cartão "Escaladas ao gestor": administrador ou quem tem `operacao.distribuirTarefas`
 *  (src/lib/permissoes.ts). A escalada é decisão de gestão — a assistente não a vê nem a conta. */
export const ehGestorDaOperacao = (a: { isAdmin: boolean; pode: (chave: string) => boolean }): boolean =>
  a.isAdmin || a.pode("operacao.distribuirTarefas")

/** O NÚMERO DA ABA "RADAR" — a SOMA dos números dos cartões que têm valor (> 0) e que a pessoa VÊ. Os quatro cartões
 *  fixos ("Dados inconsistentes", "Sem responsável", "Anexo faltando", "Erro do sistema") são 0 por definição e não
 *  somam. "Escaladas ao gestor" só soma para o gestor (para os demais o cartão não existe). Nada a mostrar = 0.
 *  Achados reais (30/09/2026, Daniela): um `+ 1` fixo fazia a aba dizer 2 com a soma dos cartões = 1. */
export const somaDosCartoesDoRadar = (
  c: { atras: readonly unknown[]; acompVenc: readonly unknown[]; decis: readonly unknown[]; noOrg: readonly unknown[]; genOpen: readonly unknown[] },
  opcoes: { verEscaladas: boolean },
): number => c.atras.length + c.acompVenc.length + (opcoes.verEscaladas ? c.decis.length : 0) + c.noOrg.length + c.genOpen.length

/** A ABA "FAMÍLIAS": UMA função dá os itens listados E o número da aba (número = itens). Chave = família cadastrada,
 *  senão o nome do processo. Entram as famílias com tarefa aberta OU concluída recente (o card "Concluídas"). */
export const chaveDaFamilia = (l: Pick<LinhaOperacaoV3, "familiaNome" | "processoNome">): string => l.familiaNome ?? l.processoNome ?? "—"
export function familiasDaAba<T extends Pick<LinhaOperacaoV3, "familiaNome" | "processoNome">>(abertos: readonly T[], feito: readonly T[]): string[] {
  return [...new Set([...abertos, ...feito].map(chaveDaFamilia))]
}

/** A FASE ATUAL REAL do processo para a família — `faseAtualDoProcessoLabel` (rótulo canônico), nunca a fase da
 *  tarefa (`faseMacroKey`) nem a da primeira linha sem conferir. Achado real: Cibils, em Emissão documental,
 *  aparecia como "genealogia" porque a UI lia `ts[0].faseMacroKey`. Sem rótulo em nenhuma linha → "—". */
export function faseAtualDaFamilia(linhas: ReadonlyArray<Pick<LinhaOperacaoV3, "faseAtualDoProcessoLabel">>): string {
  return linhas.find((l) => l.faseAtualDoProcessoLabel)?.faseAtualDoProcessoLabel ?? "—"
}

/** O GARGALO da família (linha "Gargalo:" da aba Famílias) — o órgão com mais escaladas, senão "órgão emissor não
 *  vinculado" pela MESMA `precisaDeOrgaoEmissor` do cartão "Sem órgão emissor" (o passo "Localizar registro" da
 *  Genealogia não exige órgão), senão "—". */
export function gargaloDaFamilia(abertosDaFamilia: ReadonlyArray<Pick<LinhaOperacaoV3, "escalada" | "terceiroNome" | "documentoId" | "faseMacroKey">>): string {
  const porOrgao = new Map<string, number>()
  for (const l of abertosDaFamilia) if (l.escalada && l.terceiroNome) porOrgao.set(l.terceiroNome, (porOrgao.get(l.terceiroNome) ?? 0) + 1)
  const topo = [...porOrgao.entries()].sort((a, b) => b[1] - a[1])[0]
  if (topo) return `${topo[0]} (escalada)`
  return abertosDaFamilia.some(precisaDeOrgaoEmissor) ? "órgão emissor não vinculado" : "—"
}

/** O PRÓXIMO MARCO — a próxima fase do caminho do processo, quando a linha a traz (`proximaFaseDoProcessoLabel`,
 *  derivada de `ordensDeFase(tipoProcesso)` no servidor). Sem o dado, `null`: a tela OMITE o marco — nunca um
 *  literal ("Análise documental") que só serve a um tipo de processo. */
export const proximoMarcoDaFamilia = (linhas: ReadonlyArray<Pick<LinhaOperacaoV3, "proximaFaseDoProcessoLabel">>): string | null =>
  linhas.find((l) => l.proximaFaseDoProcessoLabel)?.proximaFaseDoProcessoLabel ?? null

export const cobrancasTxt = (l: LinhaOperacaoV3): string =>
  l.totalCobrancas === 0 ? "0" : `${l.totalCobrancas}${l.escalada ? " · escalada" : ""}`

export const prazoTarefaCls = (l: LinhaOperacaoV3): string => (l.dataPrazo == null ? "opv3-p-gry" : l.atrasada ? "opv3-p-red" : "opv3-p-blu")

/** O rótulo do botão de ação, por estado — "Iniciar"/"Conferir"/"Continuar"/"Confirmado ✓"/"Recebi ✓"/"Abrir". */
export function acaoDe(l: LinhaOperacaoV3): { label: string; accent: boolean } {
  if (emAndamentoSemDono(l)) return { label: "Continuar", accent: true }
  if (l.aIniciar) return { label: "Iniciar", accent: true }
  if (l.faseMacroKey === "genealogia") return { label: "Continuar", accent: true }
  if (l.estadoOperacao === "FILA" && l.passoAtual && l.passoAtual.ordem + 1 === l.passoAtual.total) return { label: "Conferir", accent: true }
  return { label: "Abrir", accent: false }
}

export function concluirLabelDe(l: LinhaOperacaoV3): string {
  if (l.origem === "TRANSVERSAL") return "Concluída ✓"
  if (l.faseMacroKey === "genealogia") return "Registro localizado"
  const ordem = l.passoAtual ? l.passoAtual.ordem + 1 : null
  if (ordem === 2) return "Confirmado ✓"
  if (ordem === 3) return "Recebi ✓"
  if (l.passoAtual && ordem === l.passoAtual.total) return "Validar ✓"
  return "Concluir ✓"
}

// ── BUSCA (sem acento) ───────────────────────────────────────────────────
export const semAcento = (x: string | null | undefined): string =>
  String(x ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")

export function aplicarBusca(linhas: LinhaOperacaoV3[], busca: string): LinhaOperacaoV3[] {
  const bq = semAcento(busca.trim())
  if (!bq) return linhas
  return linhas.filter((l) =>
    semAcento(`${l.familiaNome} ${l.pessoaNome} ${l.titulo} ${l.terceiroNome} ${l.pais} ${l.processoNome}`).includes(bq),
  )
}

export function aplicarVista(linhas: LinhaOperacaoV3[], vista: string): LinhaOperacaoV3[] {
  if (vista === "es") return linhas.filter((l) => l.pais === "Espanha")
  if (vista === "it") return linhas.filter((l) => l.pais === "Itália")
  if (vista === "urg") return linhas.filter((l) => l.acompanhamentoVencido || l.atrasada)
  return linhas
}

// ── AGRUPAMENTO ──────────────────────────────────────────────────────────
export interface GrupoDeLinhas {
  chave: string
  titulo: string
  sub: string
  pill: string
  pillCls: string
  linhas: LinhaOperacaoV3[]
  lote: boolean
}

/** Agrupa (dentro de uma família) por pessoa/órgão/passo — mesma régua do seletor "Por família, depois por".
 *  ORDENADO por G1→Gn (`numeroLinhagem` crescente — mandato "Operação/Antão",
 *  29/09/2026): quem não tem número calculado (ainda) vai ao fim, nunca some.
 *
 *  CASAMENTO ENTRA NO GRUPO DA PESSOA (correção pós-conferência, 29/09/2026):
 *  `pessoaId`/`pessoaNome` de uma tarefa de União já são os da pessoa da
 *  linha reta (`tarefa-projecoes.ts::projetar`) — agrupar por `pessoaId` funde
 *  a certidão de casamento no MESMO grupo do nascimento/óbito dessa pessoa,
 *  nunca um grupo "Fulano e Fulana" à parte. */
/** A ORDEM DE QUALQUER LISTA DE CERTIDÕES: família → geração (G1…) → linha reta → nascimento → pessoa → Nascimento, Casamento, Óbito, outros.
 *  A ordem ENTRE famílias é a de primeira aparição na lista recebida (é o critério risco/prazo do servidor); dentro da família, só a regra. */
export function ordenarPorEvento(linhas: LinhaOperacaoV3[]): LinhaOperacaoV3[] {
  return ordenarLinhasDeCertidao(linhas)
}

export function agruparDentroDaFamilia(linhasEntrada: LinhaOperacaoV3[], por: "pessoa" | "orgao" | "passo"): GrupoDeLinhas[] {
  // G1→Gn e, na mesma geração, a ORDEM DO EVENTO (nascimento → casamento → óbito) — vale para qualquer agrupamento (pessoa, órgão, passo).
  const linhas = ordenarPorEvento(linhasEntrada)
  const ordem: string[] = []
  const mapa = new Map<string, LinhaOperacaoV3[]>()
  const chaveDe = (l: LinhaOperacaoV3): string => {
    if (por === "orgao") return l.terceiroNome ?? "não vinculado"
    if (por === "passo") return passoLabelDe(l).label
    return `${l.pessoaId ?? l.pessoaNome ?? "—"}|${l.origem === "TRANSVERSAL" ? "tr" : l.faseMacroKey === "genealogia" ? "gen" : "em"}`
  }
  for (const l of linhas) {
    const k = chaveDe(l)
    if (!mapa.has(k)) { mapa.set(k, []); ordem.push(k) }
    mapa.get(k)!.push(l)
  }
  return ordem.map((k) => {
    const rsBrutas = mapa.get(k)!
    const rs = rsBrutas // já na ordem canônica (a entrada foi ordenada por `ordenarPorEvento`)
    const f = rs[0]
    let titulo = k, sub = "", pill = "", pillCls = "opv3-p-blu"
    if (por === "pessoa") {
      titulo = f.pessoaNome ?? f.casalNomes ?? "—"
      sub = `${rs.length} tarefa(s)`
      // Selo "FASE" do grupo — mesma régua neutra da coluna por linha (`faseLabelDe`,
      // item 17 do mandato "Operação/Antão"): "Fase atual: X" saiu daqui também
      // ("não por pessoa nem por linha", correção pós-conferência 29/09/2026).
      const fl = faseLabelDe(f)
      pill = fl.texto; pillCls = fl.cls
    } else if (por === "orgao") {
      titulo = f.terceiroNome ?? "não vinculado"
      sub = `${rs.length} certidões`
      pill = f.terceiroNome ? "Órgão" : "Sem destino"
      pillCls = f.terceiroNome ? "opv3-p-gry" : "opv3-p-red"
    } else {
      titulo = passoLabelDe(f).label
      sub = `${rs.length} tarefas`
      pill = "Passo"; pillCls = "opv3-p-gry"
    }
    // "MESMO REQUERIMENTO" só quando o órgão vinculado é o MESMO em todas as
    // "a iniciar" do grupo — achado real, mandato acima: nascimento (Espanha)
    // e óbito (Brasil) da mesma pessoa nunca são o mesmo requerimento, mesmo
    // as duas "a iniciar" juntas.
    const aIniciarDoGrupo = rs.filter(aIniciarEfetivo)
    const orgaosDoGrupo = new Set(aIniciarDoGrupo.map((r) => r.terceiroNome ?? null))
    const lote = aIniciarDoGrupo.length > 1 && orgaosDoGrupo.size === 1 && aIniciarDoGrupo[0].terceiroNome != null
    return { chave: k, titulo, sub, pill, pillCls, linhas: rs, lote }
  })
}

export interface FamiliaComGrupos {
  fam: string
  pais: string | null
  /** Fase atual do processo — para o cabeçalho mostrar "Fase atual: X" UMA vez (item 5 do mandato "Operação/Antão"). `null` sem fase corrente. */
  faseAtualLabel: string | null
  linhas: LinhaOperacaoV3[]
}

/** Agrupa por família — usado em Aguardando/Acompanhamento/Feito/Fila (nível externo).
 *  Sem `Familia` cadastrada (`familiaNome` nulo), cai no NOME DO PROCESSO —
 *  nunca no país (achado real, mandato "Operação/Antão", correção
 *  pós-conferência 29/09/2026: processo 675/Antão sem `Familia` vinculada
 *  mostrava "—" no lugar do nome e o país ("Espanha", a nacionalidade
 *  buscada) sobrava como se fosse o rótulo da família). */
export function agruparPorFamilia(linhas: LinhaOperacaoV3[]): FamiliaComGrupos[] {
  const ordem: string[] = []
  const mapa = new Map<string, LinhaOperacaoV3[]>()
  for (const l of linhas) {
    const k = l.familiaNome ?? l.processoNome ?? "—"
    if (!mapa.has(k)) { mapa.set(k, []); ordem.push(k) }
    mapa.get(k)!.push(l)
  }
  return ordem.map((k) => {
    // Em TODAS as abas (A fazer, Aguardando, Acompanhamento, Feito, Fila) as certidões da família saem por evento: nascimento → casamento → óbito.
    const rs = ordenarPorEvento(mapa.get(k)!)
    return { fam: k, pais: rs[0].pais, faseAtualLabel: rs[0].faseAtualDoProcessoLabel, linhas: rs }
  })
}

/** Agrupa por órgão — "Aguardando: Agrupar por Órgão (cobrar juntos)". */
export function agruparPorOrgao(linhas: LinhaOperacaoV3[]): FamiliaComGrupos[] {
  const ordem: string[] = []
  const mapa = new Map<string, LinhaOperacaoV3[]>()
  for (const l of linhas) {
    const k = l.terceiroNome ?? "não vinculado"
    if (!mapa.has(k)) { mapa.set(k, []); ordem.push(k) }
    mapa.get(k)!.push(l)
  }
  return ordem.map((k) => ({ fam: k, pais: null, faseAtualLabel: null, linhas: ordenarPorEvento(mapa.get(k)!) }))
}
