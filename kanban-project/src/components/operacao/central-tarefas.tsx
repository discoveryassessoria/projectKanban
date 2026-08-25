// src/components/operacao/central-tarefas.tsx
// ============================================================================
// A OPERAÇÃO DE TAREFAS — duas leituras da MESMA tarefa.
//
//   MINHA FILA        o que EU tenho para fazer
//   SEM RESPONSÁVEL   o que existe e ainda não é de ninguém
//
// Nenhuma das duas é entidade: as duas são projeções da `Tarefa` canônica, e é
// por isso que atribuir move o trabalho de uma para a outra sem copiar nada —
// o `taskId` é o mesmo dos dois lados.
//
// ─── UMA TAREFA, NÃO OITO ───────────────────────────────────────────────────
// Uma tarefa com oito etapas internas aparece como UMA linha, com a etapa
// corrente escrita embaixo do título. Listar etapa como se fosse tarefa era o
// desenho antigo: sete linhas para a mesma certidão, sete prazos, sete donos.
//
// ─── ESTA TELA NÃO ESCREVE ──────────────────────────────────────────────────
// Toda mudança sai por `POST /api/tarefas/{id}/comando`. Não existe aqui
// nenhum caminho que toque em Tarefa ou em passo.
// ============================================================================
"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { urlOperacionalDaTarefa } from "@/lib/operacional/navegacao"
// O vocabulário visual e o seletor de responsável são COMPARTILHADOS com a
// visão gerencial global — mesma implementação, não uma cópia parecida.
import {
  auth, dataCurta, Estado, Etiqueta, ROTULO_PRIORIDADE, ROTULO_STATUS,
  rotularFase, SeletorResponsavel, type LinhaDeFila,
} from "./kit-operacional"

export type { LinhaDeFila }

/**
 * A LINHA DA FILA, ENRIQUECIDA.
 *
 * A Minha Fila passou a ler a MESMA projeção da visão gerencial — antes ela
 * mostrava menos sobre o próprio trabalho do que o gestor via. Estes campos
 * derivados não são estados novos: `atrasada` e `venceHoje` saem do prazo,
 * `esperandoHaDias` e `motivoBloqueio` saem do histórico canônico.
 */
export interface LinhaOperacional extends LinhaDeFila {
  venceHoje: boolean
  coluna: "SEM_RESPONSAVEL" | "A_FAZER" | "EM_ANDAMENTO" | "AGUARDANDO_TERCEIRO" | "BLOQUEADA" | "CONCLUIDA"
  esperandoDe: "terceiro" | "cliente" | null
  esperandoDesde: string | null
  esperandoHaDias: number | null
  motivoBloqueio: string | null
  concluidaEm: string | null
}

/** O prazo em linguagem operacional — a data sozinha não diz o que fazer. */
/**
 * A URGÊNCIA DO CARTÃO — frase do SERVIDOR, cor da tela.
 *
 * A frase era montada aqui, e a Central montava a dela, e o Kanban a dele. Três
 * lugares escrevendo "Vence em 1 dias" de jeitos diferentes é o sintoma; o
 * problema é que por trás das três frases havia réguas diferentes de dia. A
 * frase agora chega pronta e única; o que a tela decide é só a cor.
 */
export function urgencia(l: LinhaOperacional): { texto: string; tom: "critico" | "alerta" | "neutro" } {
  const tom: "critico" | "alerta" | "neutro" =
    l.atrasada ? "critico" : l.venceHoje || l.diasParaPrazo === 1 ? "alerta" : "neutro"
  return { texto: l.rotuloDoPrazo, tom }
}

/**
 * A AÇÃO PRINCIPAL — UMA por cartão, decidida pelo estado.
 *
 * O rótulo diz o que vai acontecer, e o `comando` diz se algo é ESCRITO:
 *
 *   A FAZER              Iniciar tarefa   → comanda (assume o trabalho)
 *   EM ANDAMENTO         Continuar        → só navega
 *   AGUARDANDO TERCEIRO  Ver etapa        → só navega
 *   BLOQUEADA            Ver bloqueio     → só navega
 *   CONCLUÍDA            Ver histórico    → só navega
 *   causa removida       Ver decisão      → só navega
 *
 * "Continuar" nunca aparece para uma tarefa que ninguém começou, e "Requer
 * decisão" não diz Continuar: continuar sugere executar, e essa tarefa perdeu a
 * causa — o que ela precisa é de alguém decidir o que fazer com ela.
 */
export function acaoPrincipal(l: LinhaOperacional): { rotulo: string; comando: "iniciar" | null } {
  if (l.requerDecisao) return { rotulo: "Ver decisão", comando: null }
  if (l.coluna === "A_FAZER") return { rotulo: "Iniciar tarefa", comando: "iniciar" }
  if (l.coluna === "BLOQUEADA") return { rotulo: "Ver bloqueio", comando: null }
  if (l.coluna === "AGUARDANDO_TERCEIRO") return { rotulo: "Ver etapa", comando: null }
  if (l.coluna === "CONCLUIDA") return { rotulo: "Ver histórico", comando: null }
  return { rotulo: "Continuar", comando: null }
}

type Visao = "minha_fila" | "sem_responsavel"
type Modo = "lista" | "calendario"

/**
 * UMA LINHA = UMA TAREFA.
 *
 * Densa de propósito: quem opera precisa varrer a lista, não admirar cartões.
 * A hierarquia é título → causa (quem/o quê) → etapa corrente; o resto é
 * informação de decisão (prazo, status, prioridade) alinhada à direita.
 */
function Linha({
  l,
  acao,
  aoAbrir,
}: {
  l: LinhaDeFila
  acao?: React.ReactNode
  aoAbrir?: () => void
}) {
  const contexto = [l.processoNome, l.pessoaNome, l.servico].filter(Boolean).join(" · ")
  return (
    <div className="group grid grid-cols-[1fr_auto] items-start gap-4 border-b border-white/[0.06] px-4 py-3 last:border-b-0 hover:bg-[var(--surface-primary)]">
      {/* Clicar na linha abre a TAREFA — é o gesto natural, e é por ele que o
          funcionário chega ao workflow interno sem passar pelo processo. */}
      <button type="button" onClick={aoAbrir} className="min-w-0 cursor-pointer text-left">
        <div className="flex items-center gap-2">
          <span className="truncate text-[13px] font-medium text-white/90">{l.titulo}</span>
          {l.atrasada && <Etiqueta tom="critico">Atrasada</Etiqueta>}
          {l.prioridade === "URGENTE" && <Etiqueta tom="alerta">Urgente</Etiqueta>}
          {l.aguardandoDependencia && <Etiqueta tom="neutro">Depende de outra</Etiqueta>}
          {l.requerDecisao && <Etiqueta tom="alerta">Requer decisão</Etiqueta>}
        </div>
        {contexto && <div className="mt-0.5 truncate text-[11px] text-[var(--text-secondary)]">{contexto}</div>}
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-[var(--text-muted)]">
          {l.etapaAtual && (
            <span>
              <span className="text-[var(--text-muted)]">Etapa atual:</span> <span className="text-white/60">{l.etapaAtual}</span>
            </span>
          )}
          {rotularFase(l.faseMacroKey) && <span className="text-[var(--text-muted)]">{rotularFase(l.faseMacroKey)}</span>}
          {l.responsavelNome && <span className="text-[var(--text-muted)]">{l.responsavelNome}</span>}
          {/* HÁ QUANTO TEMPO ESTE TRABALHO ESPERA. Quem distribui precisa ver
              o que está parado há mais tempo, não só o que vence antes — um
              pedido de duas semanas sem dono não aparece na régua de prazo. */}
          {l.criadaEm && <span className="text-[var(--text-muted)]">Entrou em {dataCurta(l.criadaEm)}</span>}
        </div>
      </button>

      <div className="flex shrink-0 items-center gap-4">
        <div className="text-right">
          <div className={`text-[12px] tabular-nums ${l.atrasada ? "text-red-700/90" : "text-white/70"}`}>
            {dataCurta(l.dataPrazo)}
          </div>
          <div className="mt-0.5 text-[10px] text-[var(--text-muted)]">
            {ROTULO_STATUS[l.statusTarefa] ?? l.statusTarefa} · {ROTULO_PRIORIDADE[l.prioridade] ?? l.prioridade}
          </div>
        </div>
        {acao}
      </div>
    </div>
  )
}

/**
 * O CALENDÁRIO É UMA LEITURA DA MESMA FILA — não uma tela de tarefas paralela.
 *
 * Era a única capacidade que a tela antiga de Atividades tinha e a operação
 * canônica não: ver o trabalho distribuído no tempo. Ela volta aqui como MODO
 * de exibição da projeção que já existe — mesma consulta, mesma tarefa, mesmo
 * taskId. Sem prazo não há lugar no calendário; essas ficam num grupo próprio,
 * porque some-las seria esconder trabalho.
 */
function agruparPorDia(linhas: LinhaOperacional[]): Array<{ dia: string; rotulo: string; linhas: LinhaOperacional[] }> {
  const porDia = new Map<string, LinhaOperacional[]>()
  for (const l of linhas) {
    const dia = l.dataPrazo ? l.dataPrazo.slice(0, 10) : "sem-prazo"
    const atual = porDia.get(dia)
    if (atual) atual.push(l)
    else porDia.set(dia, [l])
  }
  const hoje = new Date().toISOString().slice(0, 10)
  return [...porDia.entries()]
    .sort((a, b) => (a[0] === "sem-prazo" ? 1 : b[0] === "sem-prazo" ? -1 : a[0].localeCompare(b[0])))
    .map(([dia, ls]) => ({
      dia,
      rotulo:
        dia === "sem-prazo" ? "Sem prazo definido"
        : dia === hoje ? `Hoje · ${dataCurta(dia)}`
        : dia < hoje ? `Vencido · ${dataCurta(dia)}`
        : dataCurta(dia),
      linhas: ls,
    }))
}

/** Os quatro estados obrigatórios de qualquer superfície do Discovery. */
/**
 * O CARTÃO DA MINHA FILA — o cockpit de quem executa.
 *
 * A pergunta que ele responde em um relance é "o que eu faço agora": o estado
 * operacional, a etapa em nome de gente, quanto tempo falta (ou passou), e UMA
 * ação principal. Prazo aqui não é data solta — é "vence em 3 dias", porque a
 * data sozinha obriga cada pessoa a fazer a conta na cabeça.
 *
 * O que está parado diz POR QUE está parado, no próprio cartão: bloqueio com
 * motivo, espera com há-quanto-tempo. Sem isso, descobrir o motivo custava
 * abrir a tarefa e ler o histórico.
 */
function CartaoDaFila({
  l, ocupado, aoAbrir, aoExecutar, acaoSecundaria,
}: {
  l: LinhaOperacional
  ocupado: boolean
  /** O único destino: a Central Operacional do processo, no documento certo. */
  /** Só navega. Nunca comanda. */
  aoAbrir: () => void
  /** A ação principal do cartão: comanda (quando há o que comandar) e navega. */
  aoExecutar: () => void
  acaoSecundaria?: React.ReactNode
}) {
  const u = urgencia(l)
  const acao = acaoPrincipal(l)
  const contexto = [l.pessoaNome, l.processoNome].filter(Boolean).join(" · ")
  const corDaBorda =
    l.atrasada ? "border-l-red-400/70"
    : l.venceHoje ? "border-l-amber-300/70"
    : l.coluna === "BLOQUEADA" ? "border-l-red-300/40"
    : l.coluna === "AGUARDANDO_TERCEIRO" ? "border-l-white/20"
    : "border-l-transparent"

  return (
    <div className={`border-b border-l-2 border-white/[0.06] px-4 py-3 transition-colors last:border-b-0 hover:bg-[var(--surface-primary)] ${corDaBorda}`}>
      <div className="flex items-start justify-between gap-4">
        {/* O CARTÃO LEVA AO TRABALHO — E SÓ LEVA.
            Clicar no cartão nunca comanda: leva à Central Operacional do
            processo, no documento certo. O cartão inteiro chamando o comando
            fazia passar os olhos numa tarefa marcá-la como começada — com data
            de início, evento e prazo correndo — sem ninguém ter decidido nada.
            Assumir é ato explícito, e tem botão próprio. */}
        <button type="button" onClick={aoAbrir} className="min-w-0 flex-1 cursor-pointer text-left">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate text-[13px] font-medium text-white/90">{l.titulo}</span>
            {l.prioridade === "URGENTE" && <Etiqueta tom="alerta">Urgente</Etiqueta>}
            {l.requerDecisao && <Etiqueta tom="alerta">Requer decisão</Etiqueta>}
            {l.aguardandoDependencia && <Etiqueta tom="neutro">Depende de outra</Etiqueta>}
          </div>
          {contexto && <div className="mt-0.5 truncate text-[11px] text-[var(--text-secondary)]">{contexto}</div>}

          {/* ESTADO + ETAPA: as duas coisas que dizem onde o trabalho está. */}
          <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px]">
            <span className="text-white/70">{ROTULO_STATUS[l.statusTarefa] ?? l.statusTarefa}</span>
            {l.etapaAtual && (
              <>
                <span className="text-[var(--text-muted)]">›</span>
                <span className="text-white/60">{l.etapaAtual}</span>
              </>
            )}
            {rotularFase(l.faseMacroKey) && (
              <span className="text-[var(--text-muted)]">· {rotularFase(l.faseMacroKey)}</span>
            )}
          </div>

          {/* POR QUE ESTÁ PARADO — no cartão, não a três cliques de distância. */}
          {l.coluna === "AGUARDANDO_TERCEIRO" && l.esperandoHaDias != null && (
            <div className="mt-1 text-[11px] text-[var(--text-secondary)]">
              Aguardando {l.esperandoDe === "cliente" ? "o cliente" : "terceiro"} há {l.esperandoHaDias} dia
              {l.esperandoHaDias === 1 ? "" : "s"}
            </div>
          )}
          {l.motivoBloqueio && (
            <div className="mt-1 text-[11px] text-red-700/75">Bloqueio: {l.motivoBloqueio}</div>
          )}
        </button>

        <div className="flex shrink-0 flex-col items-end gap-1.5">
          {/* PRAZO OPERACIONAL: o que ele significa vem primeiro; a data, depois. */}
          <div className="text-right">
            <div className={`text-[11px] font-medium ${
              u.tom === "critico" ? "text-red-700/90" : u.tom === "alerta" ? "text-amber-700/90" : "text-[var(--text-secondary)]"
            }`}>
              {u.texto}
            </div>
            {l.dataPrazo && <div className="text-[10px] tabular-nums text-[var(--text-muted)]">{dataCurta(l.dataPrazo)}</div>}
          </div>
          <div className="flex items-center gap-1.5">
            {acaoSecundaria}
            {/* ENQUANTO O PEDIDO CORRE, O BOTÃO DIZ ISSO. Um botão que não muda
                de aparência ao ser clicado é indistinguível de um botão que não
                fez nada — e foi assim que uma tarefa iniciada de verdade passou
                por "não aconteceu nada". */}
            <button
              disabled={ocupado}
              onClick={aoExecutar}
              className="rounded border border-[var(--border-default)] bg-[var(--surface-primary)] px-2.5 py-1 text-[11px] text-white/85 transition-colors hover:bg-[var(--surface-primary)] disabled:opacity-40"
            >
              {ocupado && acao.comando === "iniciar" ? "Iniciando…" : acao.rotulo}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

/** Os recortes da fila — derivados, nunca estados novos. */
const FILTROS: Array<{ id: string; rotulo: string; aplica: (l: LinhaOperacional) => boolean }> = [
  { id: "todas", rotulo: "Todas", aplica: () => true },
  { id: "a_fazer", rotulo: "A fazer", aplica: (l) => l.coluna === "A_FAZER" },
  { id: "em_andamento", rotulo: "Em andamento", aplica: (l) => l.coluna === "EM_ANDAMENTO" },
  { id: "aguardando", rotulo: "Aguardando terceiro", aplica: (l) => l.coluna === "AGUARDANDO_TERCEIRO" },
  { id: "bloqueadas", rotulo: "Bloqueadas", aplica: (l) => l.coluna === "BLOQUEADA" },
  { id: "atrasadas", rotulo: "Atrasadas", aplica: (l) => l.atrasada },
  { id: "vence_hoje", rotulo: "Vence hoje", aplica: (l) => l.venceHoje },
]

export function CentralTarefas({ podeDistribuir }: { podeDistribuir: boolean }) {
  const [visao, setVisao] = useState<Visao>(podeDistribuir ? "sem_responsavel" : "minha_fila")
  const [resultado, setResultado] = useState<{ chave: string; lista: LinhaOperacional[] | null } | null>(null)
  const [filtro, setFiltro] = useState("todas")
  const router = useRouter()
  const [recarga, setRecarga] = useState(0)
  const [alvo, setAlvo] = useState<LinhaDeFila | null>(null)
  const [ocupado, setOcupado] = useState(false)
  const [erroComando, setErroComando] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [modo, setModo] = useState<Modo>("lista")

  // Mesma disciplina do seletor: o pedido tem chave, o "carregando" é derivado
  // e a resposta atrasada de uma aba não pinta a lista da outra.
  const chave = `${visao}#${recarga}`
  useEffect(() => {
    let vivo = true
    fetch(`/api/operacao/tarefas?visao=${visao}`, { headers: auth() })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: { linhas?: LinhaOperacional[] }) => { if (vivo) setResultado({ chave, lista: d.linhas ?? [] }) })
      .catch(() => { if (vivo) setResultado({ chave, lista: null }) })
    return () => { vivo = false }
  }, [chave, visao])

  const carregando = resultado?.chave !== chave
  const linhas = carregando ? null : resultado?.lista ?? null
  const falhou = !carregando && linhas == null
  const carregar = useCallback(() => setRecarga((n) => n + 1), [])

  /**
   * A LISTA, RELIDA E **ESPERADA** — o comando não termina antes de a tela contar
   * a verdade nova.
   *
   * Só disparar `carregar()` deixava uma janela em que o comando já tinha
   * acontecido e o cartão ainda dizia o estado antigo. Se a releitura demorasse,
   * falhasse ou fosse descartada, a janela virava permanente: era isso que
   * fazia "cliquei em Iniciar e nada aconteceu", com a tarefa já iniciada no
   * banco. Agora quem comanda espera a resposta nova antes de dar o ato por
   * encerrado — e a lista devolvida é aplicada aqui mesmo.
   */
  const recarregarAgora = useCallback(async (): Promise<LinhaOperacional[] | null> => {
    try {
      const r = await fetch(`/api/operacao/tarefas?visao=${visao}`, { headers: auth() })
      if (!r.ok) return null
      const d: { linhas?: LinhaOperacional[] } = await r.json()
      const lista = d.linhas ?? []
      setResultado({ chave, lista })
      return lista
    } catch {
      return null
    }
  }, [visao, chave])

  /**
   * TODA MUDANÇA SAI POR UMA PORTA SÓ.
   *
   * Inclusive o conflito: quando outro gestor mexeu na tarefa antes, a porta
   * responde 409 e a tela DIZ isso e recarrega — em vez de sobrescrever em
   * silêncio a decisão de quem chegou primeiro.
   */
  const comandar = useCallback(
    async (tarefaId: number, corpo: Record<string, unknown>, sucesso: string) => {
      setOcupado(true)
      setErroComando(null)
      try {
        const r = await fetch(`/api/tarefas/${tarefaId}/comando`, {
          method: "POST",
          headers: auth(),
          body: JSON.stringify(corpo),
        })
        const d = await r.json().catch(() => ({}))
        if (!r.ok) {
          // O CÓDIGO IMPORTA para quem lê. "Não foi possível" não diz se falta
          // permissão, se alguém chegou antes ou se o servidor caiu — e é a
          // diferença entre chamar o gestor e tentar de novo.
          const porStatus: Record<number, string> = {
            401: "Sua sessão expirou. Entre de novo.",
            403: "Você não tem permissão para esta ação.",
            409: "Esta tarefa foi alterada por outra pessoa. A lista foi atualizada.",
            422: d.error ?? "A ação não é válida para o estado atual desta tarefa.",
          }
          setErroComando(porStatus[r.status] ?? d.error ?? `Não foi possível concluir a ação (HTTP ${r.status}).`)
          setAlvo(null)
          await recarregarAgora()
          return false
        }
        setAlvo(null)
        setAviso(sucesso)
        // ESPERA a lista nova. Sem isto o ato "terminava" antes de a tela mudar.
        await recarregarAgora()
        return true
      } catch {
        // FALHA DE REDE NÃO É SILÊNCIO. O comando pode ter chegado ao servidor e
        // só a resposta ter se perdido — por isso relemos antes de acusar.
        const lista = await recarregarAgora()
        setErroComando(
          lista == null
            ? "Falha de rede. Verifique a conexão e tente novamente."
            : "A resposta do servidor não chegou. A lista foi atualizada — confira o estado da tarefa.",
        )
        return false
      } finally {
        setOcupado(false)
      }
    },
    [recarregarAgora],
  )

  /**
   * ONDE O TRABALHO ACONTECE — a Minha Fila não executa.
   *
   * O deep-link canônico leva ao processo, na Central, no documento e na etapa
   * daquela tarefa. É a MESMA função que o Kanban, a visão global e as
   * notificações usam — a fila não monta rota própria.
   */
  const abrirOTrabalho = useCallback((l: LinhaOperacional) => {
    router.push(urlOperacionalDaTarefa({ taskId: l.taskId, processoId: l.processoId }))
  }, [router])

  /**
   * A AÇÃO PRINCIPAL DO CARTÃO — assumir e ir trabalhar, no mesmo gesto.
   *
   *   INICIAR    assume o trabalho e LEVA à etapa. Quem clica em "Iniciar" está
   *              indo trabalhar agora; parar na fila obrigaria um segundo clique
   *              para chegar onde o trabalho acontece.
   *   CONTINUAR  só navega. Não reinicia nada, não escreve nada.
   *
   * A NAVEGAÇÃO SÓ ACONTECE DEPOIS DO SUCESSO CONFIRMADO. Navegar junto com o
   * pedido — ou apesar dele — levaria a pessoa para a etapa acreditando que
   * assumiu um trabalho que continuou de ninguém.
   *
   * Tarefa que perdeu a causa não é iniciada: ela precisa de decisão, e tratá-la
   * como trabalho normal seria responder à pergunta errada.
   */
  const irParaOTrabalho = useCallback(async (l: LinhaOperacional) => {
    const acao = acaoPrincipal(l)
    if (acao.comando === "iniciar") {
      const ok = await comandar(l.taskId, { acao: "iniciar" }, "Tarefa iniciada.")
      if (!ok) return
    }
    abrirOTrabalho(l)
  }, [comandar, abrirOTrabalho])

  const contagem = useMemo(() => linhas?.length ?? 0, [linhas])

  const abas: Array<{ id: Visao; rotulo: string }> = [
    ...(podeDistribuir ? [{ id: "sem_responsavel" as const, rotulo: "Sem responsável" }] : []),
    { id: "minha_fila", rotulo: "Minha fila" },
  ]

  return (
    <div className="mx-auto w-full max-w-5xl">
      <div className="mb-3 flex items-end justify-between">
        <div className="flex gap-1">
          {abas.map((a) => (
            <button
              key={a.id}
              onClick={() => setVisao(a.id)}
              className={`rounded-t border-b-2 px-3 py-1.5 text-[12px] transition-colors ${
                visao === a.id
                  ? "border-sky-400/70 text-white/90"
                  : "border-transparent text-[var(--text-muted)] hover:text-white/70"
              }`}
            >
              {a.rotulo}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-3 pb-1.5">
          {!carregando && linhas != null && (
            <span className="text-[11px] tabular-nums text-[var(--text-muted)]">
              {contagem} tarefa{contagem === 1 ? "" : "s"}
            </span>
          )}
          <div className="flex gap-1">
            {(["lista", "calendario"] as const).map((m) => (
              <button
                key={m}
                onClick={() => setModo(m)}
                className={`rounded px-2 py-0.5 text-[10px] transition-colors ${
                  modo === m ? "bg-[var(--surface-primary)] text-white/80" : "text-[var(--text-muted)] hover:text-white/60"
                }`}
              >
                {m === "lista" ? "Lista" : "Calendário"}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* FILTROS DA FILA — recortes derivados, sem criar estado novo. Cada um
          mostra a contagem, para o funcionário saber onde está o volume antes
          de clicar. */}
      {visao === "minha_fila" && linhas != null && linhas.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1">
          {FILTROS.map((f) => {
            const n = linhas.filter(f.aplica).length
            if (n === 0 && f.id !== "todas") return null
            return (
              <button
                key={f.id}
                onClick={() => setFiltro(f.id)}
                className={`rounded border px-2 py-1 text-[11px] transition-colors ${
                  filtro === f.id
                    ? "border-[var(--border-strong)] bg-[var(--surface-primary)] text-white/85"
                    : "border-[var(--border-default)] text-[var(--text-secondary)] hover:text-white/75"
                }`}
              >
                {f.rotulo} <span className="tabular-nums text-[var(--text-muted)]">{n}</span>
              </button>
            )
          })}
        </div>
      )}

      {/* O QUE ACONTECEU — sucesso E erro, na mesma altura da tela.
          O erro só era exibido DENTRO do seletor de responsável, que nem chega a
          existir quando se clica em "Iniciar tarefa". Resultado: um 403, um 409
          ou uma resposta perdida no caminho não apareciam em lugar nenhum — a
          pessoa clicava, nada mudava, e o botão parecia morto. Falha silenciosa
          é pior do que falha: ela ensina a desconfiar do que funciona. */}
      {erroComando && (
        <div
          role="alert"
          className="mb-2 flex items-start justify-between gap-3 rounded border border-red-200 bg-red-400/[0.08] px-3 py-2 text-[11px] text-red-100/90"
        >
          <span>{erroComando}</span>
          <button
            onClick={() => setErroComando(null)}
            className="shrink-0 text-red-700/60 transition-colors hover:text-red-100"
            aria-label="Fechar aviso de erro"
          >
            ✕
          </button>
        </div>
      )}
      {aviso && (
        <div className="mb-2 rounded border border-sky-200 bg-sky-400/[0.07] px-3 py-2 text-[11px] text-sky-100/85">
          {aviso}
        </div>
      )}

      <div className="overflow-hidden rounded-lg border border-white/[0.08] bg-[var(--surface-primary)]">
        {falhou && <Estado tipo="erro" mensagem="Não foi possível carregar as tarefas." aoTentar={carregar} />}
        {carregando && <Estado tipo="carregando" mensagem="Carregando tarefas…" />}
        {!falhou && linhas?.length === 0 && (
          <Estado
            tipo="vazio"
            mensagem={
              visao === "sem_responsavel"
                ? "Nenhuma tarefa aguardando distribuição."
                : "Você não tem tarefas em aberto."
            }
          />
        )}
        {modo === "calendario" && linhas != null && linhas.length > 0 &&
          agruparPorDia(linhas).map((grupo) => (
            <div key={grupo.dia}>
              <div className="sticky top-0 border-b border-white/[0.06] bg-[var(--surface-overlay)] px-4 py-1.5 text-[10px] uppercase tracking-wide text-[var(--text-muted)]">
                {grupo.rotulo} · {grupo.linhas.length}
              </div>
              {grupo.linhas.map((l) => (
                <Linha key={l.taskId} l={l} aoAbrir={() => abrirOTrabalho(l)} />
              ))}
            </div>
          ))}

        {/* MINHA FILA: cockpit. O cartão diz estado, etapa, prazo e a ação. */}
        {modo === "lista" && visao === "minha_fila" && linhas?.filter(
          (l) => FILTROS.find((f) => f.id === filtro)?.aplica(l) ?? true,
        ).map((l) => (
          <CartaoDaFila
            key={l.taskId}
            l={l}
            ocupado={ocupado}
            aoAbrir={() => abrirOTrabalho(l)}
            aoExecutar={() => void irParaOTrabalho(l)}
          />
        ))}

        {modo === "lista" && visao === "sem_responsavel" && linhas?.map((l) => (
          <Linha
            key={l.taskId}
            l={l}
            aoAbrir={() => abrirOTrabalho(l)}
            acao={
              podeDistribuir ? (
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => { setErroComando(null); setAlvo(l) }}
                    className="rounded border border-[var(--border-default)] px-2.5 py-1 text-[11px] text-white/75 transition-colors hover:border-[var(--border-strong)] hover:bg-[var(--surface-primary)]"
                  >
                    {l.responsavelId == null ? "Atribuir" : "Transferir"}
                  </button>
                  {/* RETIRAR fica NA LINHA, junto do trabalho a que se refere.
                      Antes era uma barra flutuante que só aparecia com o
                      seletor aberto — ou seja, para devolver a tarefa à
                      distribuição era preciso primeiro fingir que ia
                      transferi-la. */}
                  {l.responsavelId != null && (
                    <button
                      disabled={ocupado}
                      onClick={() => void comandar(l.taskId, { acao: "devolver_a_fila" }, "Tarefa devolvida para Sem responsável.")}
                      className="rounded px-2 py-1 text-[11px] text-[var(--text-muted)] transition-colors hover:bg-[var(--surface-primary)] hover:text-white/75 disabled:opacity-40"
                      title="Remover o responsável e devolver para distribuição"
                    >
                      Retirar
                    </button>
                  )}
                </div>
              ) : undefined
            }
          />
        ))}
      </div>

      {alvo && (
        <SeletorResponsavel
          titulo={alvo.responsavelId == null ? "Atribuir tarefa" : `Transferir de ${alvo.responsavelNome ?? "—"}`}
          atual={alvo.responsavelId}
          ocupado={ocupado}
          erro={erroComando}
          aoFechar={() => { setAlvo(null); setErroComando(null) }}
          aoEscolher={(responsavelId) =>
            void comandar(
              alvo.taskId,
              // A porta é a mesma; o verbo muda conforme já havia dono. Quem
              // decide isso é o estado da tarefa, não o botão.
              { acao: alvo.responsavelId == null ? "atribuir" : "transferir", responsavelId },
              alvo.responsavelId == null ? "Tarefa atribuída." : "Tarefa transferida.",
            )
          }
        />
      )}

    </div>
  )
}
