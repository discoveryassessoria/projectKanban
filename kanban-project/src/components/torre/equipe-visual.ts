// src/components/torre/equipe-visual.ts
// ============================================================================
// ABA EQUIPE (Torre nova, frente F) — TUDO O QUE É TEXTO E COR da tela, em funções PURAS (sem React, sem relógio:
// o "agora" vem do servidor no payload). A tela só pinta o que estas funções devolvem; os testes provam as regras do protótipo
// sem montar a interface. Os números NÃO são calculados aqui: vêm de /api/torre/equipe (`cargaPorPessoa`, a conta única).
// ============================================================================

export const TITULO_EQUIPE = 'Quem está carregando o quê'
export const TEXTO_EXPLICATIVO =
  'Carga = certidões que a pessoa pode tocar agora (fora as que aguardam terceiros) ÷ limite cadastrado. Fila = carga ÷ o que ela fecha por semana (média das últimas 4). Limite e aptidões vêm de Capacidade Operacional.'
export const TITULO_PREVISAO = 'Previsão de carga · próximas 4 semanas'
export const SUBTITULO_PREVISAO = 'quantos prazos vencem por pessoa em cada semana'
export const NOTA_PREVISAO = 'As 4 semanas + vencidas + depois + sem prazo somam o total de abertas da pessoa. Vermelho = semana acima do que a pessoa costuma fechar.'
export const NOTA_SIMULACAO = 'Nada foi gravado. "Aplicar" marca a ausência e move a carteira para o sucessor sugerido, com "Desfazer" (que também encerra a ausência).'
export const TEXTO_MARCAR_AUSENCIA = 'Só registra a ausência. Nada é movido; para mover use "Mover carteira" ou a simulação.'
export const COLUNAS_DA_TABELA = ['Pessoa', 'Carga', 'Ativas', 'Atrasadas', 'Aguard. terceiros', 'Fila', 'Ações'] as const
export const COLUNAS_DA_PREVISAO = ['Vencidas', 'Depois', 'Sem prazo', 'Abertas'] as const

export const TIPOS_DE_AUSENCIA: ReadonlyArray<readonly [valor: string, rotulo: string]> = [
  ['FERIAS', 'Férias'], ['AFASTAMENTO', 'Afastamento'], ['AUSENCIA', 'Ausência'], ['BLOQUEIO_OPERACIONAL', 'Bloqueio operacional'],
]

const FUSO = 'America/Sao_Paulo'

/** "06/10" no fuso da operação. */
export const diaMes = (iso: string): string => new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', timeZone: FUSO })

/** A janela de uma semana da previsão: "30/09–06/10". */
export const rotuloDaSemana = (s: { inicio: string; fim: string }): string => `${diaMes(s.inicio)}–${diaMes(s.fim)}`

const capitalizar = (t: string): string => (t ? t.charAt(0).toUpperCase() + t.slice(1) : t)

// ─── A PESSOA ───────────────────────────────────────────────────────────────

export interface AusenciaDaPessoa {
  id: number; tipo: string; rotulo: string; inicio: string; fim: string | null; motivo: string | null
  sucessorSugerido: { usuarioId: number; nome: string } | null
}

/**
 * "férias até 10/10 · sucessor sugerido: Priscila" (já começou) · "férias 06/10 a 17/10" (começa depois) · "saída simulada · 10 dias"
 * (aplicada pela simulação). O sucessor SUGERIDO vem do cadastro da ausência — só sugestão, nunca move nada.
 */
export function textoDaAusencia(a: AusenciaDaPessoa, agoraIso: string): string {
  const sucessor = a.sucessorSugerido ? ` · sucessor sugerido: ${a.sucessorSugerido.nome}` : ''
  if (a.motivo && a.motivo.startsWith('saída simulada')) return `${a.motivo}${sucessor}`
  const comecou = Date.parse(a.inicio) <= Date.parse(agoraIso)
  const quando = a.fim
    ? (comecou ? ` até ${diaMes(a.fim)}` : ` ${diaMes(a.inicio)} a ${diaMes(a.fim)}`)
    : (comecou ? ' sem data de retorno' : ` desde ${diaMes(a.inicio)}`)
  return `${a.rotulo}${quando}${sucessor}`
}

export interface PessoaParaTexto {
  papel: string; aptidoes: string[]; aptidoesPais: string[]; ausencia: AusenciaDaPessoa | null
}

/** O que a pessoa sabe fazer: os PAÍSES em que é apta ("Itália, Espanha"); sem país, as unidades de trabalho; sem nada, "sem aptidão cadastrada". */
export function textoDeAptidoes(p: Pick<PessoaParaTexto, 'aptidoes' | 'aptidoesPais'>): string {
  if (p.aptidoesPais.length) return `aptidões: ${p.aptidoesPais.join(', ')}`
  if (p.aptidoes.length) return `aptidões: ${p.aptidoes.join(', ')}`
  return 'sem aptidão cadastrada'
}

/** "Assistente · aptidões: Itália, Espanha · disponível" / "… · ausente (férias até 10/10 · sucessor sugerido: Priscila)". */
export function textoDoPapel(p: PessoaParaTexto & { ehAdministrador?: boolean }, agoraIso: string): string {
  const papel = capitalizar(p.papel) + (p.ehAdministrador ? ' · decisões' : '')
  const estado = p.ausencia ? `ausente (${textoDaAusencia(p.ausencia, agoraIso)})` : 'disponível'
  // O administrador não é "apto" por país/unidade: o protótipo mostra só "Administrador · decisões · disponível".
  if (p.ehAdministrador && !p.aptidoesPais.length && !p.aptidoes.length) return `${papel} · ${estado}`
  return `${papel} · ${textoDeAptidoes(p)} · ${estado}`
}

// ─── CARGA, ATRASADAS, FILA ─────────────────────────────────────────────────

export type CorDaBarra = 'verm' | 'amb' | 'verde'

/** A barra: largura = min(100, executáveis ÷ limite); vermelha se executáveis > limite, âmbar se > 80 % do limite, senão verde. */
export function barraDaCarga(executaveis: number, limite: number): { largura: number; cor: CorDaBarra } {
  if (limite <= 0) return { largura: executaveis > 0 ? 100 : 0, cor: executaveis > 0 ? 'verm' : 'verde' }
  return {
    largura: Math.min(100, Math.round((executaveis / limite) * 100)),
    cor: executaveis > limite ? 'verm' : executaveis > limite * 0.8 ? 'amb' : 'verde',
  }
}

/** "91 executáveis · limite 80 · fecha 46/sem" — sem limite cadastrado o texto DIZ (nunca inventa um teto). */
export function textoDaCarga(executaveis: number, limite: number | null, fechaPorSemana: number): string {
  const fecha = `fecha ${Math.round(fechaPorSemana)}/sem`
  return limite != null ? `${executaveis} executáveis · limite ${limite} · ${fecha}` : `${executaveis} executáveis · sem limite cadastrado · ${fecha}`
}

/** Atrasadas em vermelho 700 quando > 5 (senão 600). */
export const atrasadasEmAlerta = (n: number): boolean => n > 5

export type FilaVisual = { texto: string; cor: 'red' | 'amb' | 'grn' | 'gry' }

/**
 * Fila: semanas = executáveis ÷ o que ela fecha por semana. > 3 → "x.x sem · cheia" (vermelho); > 1,5 → "x.x sem" (âmbar);
 * senão "livre" (verde). Decimal com PONTO, como o protótipo. Sem base de medição (não fechou nada nas últimas 4 semanas) COM
 * trabalho: "sem base" (cinza) — dizer "livre" seria mentir.
 */
export function filaVisual(semanas: number | null, executaveis: number): FilaVisual {
  if (semanas == null) return executaveis > 0 ? { texto: 'sem base', cor: 'gry' } : { texto: 'livre', cor: 'grn' }
  if (semanas > 3) return { texto: `${semanas.toFixed(1)} sem · cheia`, cor: 'red' }
  if (semanas > 1.5) return { texto: `${semanas.toFixed(1)} sem`, cor: 'amb' }
  return { texto: 'livre', cor: 'grn' }
}

// ─── PREVISÃO ───────────────────────────────────────────────────────────────

export type ClasseDaCelula = 'zero' | 'verm' | 'amb' | 'neutra'

/**
 * A cor de uma célula da previsão (colunas 0–3 = semanas; 4 = vencidas; 5 = depois; 6 = sem prazo):
 * zero → "·" cinza · semana vermelha quando o valor > o que a pessoa fecha por semana (quem fecha 0 — e a linha "Sem
 * responsável" — fica vermelha se > 0) · vencidas âmbar quando > 0 · as demais brancas.
 */
export function classeDaCelula(coluna: number, valor: number, fechaPorSemana: number): ClasseDaCelula {
  if (valor === 0) return 'zero'
  if (coluna < 4 && (fechaPorSemana === 0 || valor > fechaPorSemana)) return 'verm'
  if (coluna === 4) return 'amb'
  return 'neutra'
}
export const textoDaCelula = (valor: number): string => (valor === 0 ? '·' : String(valor))

// ─── SUGESTÃO AUTOMÁTICA (rodapé) ───────────────────────────────────────────

export interface SugestaoParaTexto {
  movimentos: Array<{ deNome: string; paraNome: string; quantidade: number }>
  semResponsavel: { total: number; porPessoa: Array<{ nome: string; quantidade: number }>; semApto: number; seguradas: number }
  temAcao: boolean
}

/** O primeiro nome — como o protótipo ("Daniela", "Priscila") — a menos que dois da lista dividam o mesmo (aí o nome inteiro). */
export function nomeCurto(nome: string, todos: string[]): string {
  const primeiro = nome.trim().split(/\s+/)[0] ?? nome
  return todos.filter((n) => (n.trim().split(/\s+/)[0] ?? n) === primeiro).length > 1 ? nome : primeiro
}

const certidoes = (n: number): string => (n === 1 ? '1 certidão' : `${n} certidões`)

export interface PedacoDaSugestao { texto: string; destaque?: boolean }

/**
 * "Sugestão automática: passar **40 certidões de Daniela para Priscila** e distribuir as 96 sem responsável entre Priscila e Rafael."
 * Tudo calculado: quem passou do limite, para quem iria, e entre quem as sem dono se distribuiriam (só aptos).
 */
export function pedacosDaSugestao(s: SugestaoParaTexto, nomesDaEquipe: string[]): PedacoDaSugestao[] {
  const curto = (n: string) => nomeCurto(n, nomesDaEquipe)
  const acoes: PedacoDaSugestao[][] = []
  for (const m of s.movimentos) {
    acoes.push([{ texto: 'passar ' }, { texto: `${certidoes(m.quantidade)} de ${curto(m.deNome)} para ${curto(m.paraNome)}`, destaque: true }])
  }
  const sr = s.semResponsavel
  if (sr.total > 0) {
    if (sr.porPessoa.length > 0) {
      const nomes = sr.porPessoa.map((p) => curto(p.nome))
      const lista = nomes.length === 1 ? nomes[0] : `${nomes.slice(0, -1).join(', ')} e ${nomes[nomes.length - 1]}`
      const resto = sr.semApto + sr.seguradas
      acoes.push([{ texto: `distribuir as ${sr.total} sem responsável entre ${lista}${resto > 0 ? ` (${resto} ficam para você atribuir em Tarefas: sem apto ou no limite de carga)` : ''}` }])
    } else {
      acoes.push([{ texto: `as ${sr.total} sem responsável ficam para você atribuir em Tarefas: nenhuma tem apto com carga livre` }])
    }
  }
  if (acoes.length === 0) return [{ texto: 'Sugestão automática: nenhuma — nenhuma pessoa está acima do limite cadastrado e não há certidão sem responsável.' }]
  const pedacos: PedacoDaSugestao[] = [{ texto: 'Sugestão automática: ' }]
  acoes.forEach((a, i) => {
    if (i > 0) pedacos.push({ texto: ' e ' })
    pedacos.push(...a)
  })
  pedacos.push({ texto: '.' })
  return pedacos
}

// ─── TOASTS (os textos do protótipo) ────────────────────────────────────────

export const toastAusenciaMarcada = (nome: string): string => `Ausência marcada · ${nome}`
export const toastAusenciaCancelada = (nome: string): string => `Ausência de ${nome} cancelada`
export const toastSimulacaoAplicada = (nome: string): string => `Ausência marcada e carteira de ${nome} movida`

/** "184 tarefas movidas de Daniela Brait" (+ o que ficou, quando o destino não é apto a tudo). */
export function toastCarteiraMovida(nome: string, r: { movidas: number; naoAptas?: number; falhas?: number }): string {
  const base = `${r.movidas} ${r.movidas === 1 ? 'tarefa movida' : 'tarefas movidas'} de ${nome}`
  return base + (r.naoAptas ? ` · ${r.naoAptas} ficaram (destino não apto)` : '') + (r.falhas ? ` · ${r.falhas} não passaram` : '')
}

/** "96 certidões distribuídas por aptidão e carga: Rafael 51 · Priscila 45". */
export function toastDistribuicao(r: { atribuidas: number; porPessoa: Array<{ nome: string; quantidade: number }>; semApto: number; seguradas: number }, nomesDaEquipe: string[]): string {
  const resto = r.semApto + r.seguradas
  const pendente = resto > 0 ? ` · ${resto} ficam para você atribuir em Tarefas (sem apto ou no limite de carga)` : ''
  if (r.atribuidas === 0) return `Nenhuma certidão distribuída: ${resto > 0 ? `${resto} sem apto com carga livre ficam para você atribuir em Tarefas` : 'não havia certidão sem responsável'}`
  return `${certidoes(r.atribuidas)} ${r.atribuidas === 1 ? 'distribuída' : 'distribuídas'} por aptidão e carga: ${r.porPessoa.map((p) => `${nomeCurto(p.nome, nomesDaEquipe)} ${p.quantidade}`).join(' · ')}${pendente}`
}

/** "40 certidões de Daniela movidas para Priscila · 96 sem dono distribuídas". */
export function toastRedistribuicao(
  r: { movimentos: Array<{ deNome: string; paraNome: string; movidas: number }>; atribuidas: number; semApto: number; seguradas: number }, nomesDaEquipe: string[],
): string {
  const curto = (n: string) => nomeCurto(n, nomesDaEquipe)
  const partes = r.movimentos.filter((m) => m.movidas > 0).map((m) => `${certidoes(m.movidas)} de ${curto(m.deNome)} ${m.movidas === 1 ? 'movida' : 'movidas'} para ${curto(m.paraNome)}`)
  if (r.atribuidas > 0) partes.push(`${r.atribuidas} sem dono ${r.atribuidas === 1 ? 'distribuída' : 'distribuídas'}`)
  const resto = r.semApto + r.seguradas
  if (resto > 0) partes.push(`${resto} ficam para você atribuir em Tarefas (sem apto ou no limite de carga)`)
  return partes.length ? partes.join(' · ') : 'Nada a redistribuir: nenhuma pessoa acima do limite e nenhuma certidão sem responsável com apto.'
}
