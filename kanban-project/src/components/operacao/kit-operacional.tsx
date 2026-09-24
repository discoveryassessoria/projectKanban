// src/components/operacao/kit-operacional.tsx
// ============================================================================
// O KIT DA OPERAÇÃO — o vocabulário compartilhado das superfícies de Tarefa:
// Central de Distribuição, Minha Fila e a visão gerencial global.
//
// Nada aqui é novo. É o que a Central já usava, EXTRAÍDO para que a visão
// global reutilize em vez de reimplementar. Uma segunda implementação do
// seletor de responsável significaria, mais cedo ou mais tarde, duas regras
// diferentes para "quem pode receber trabalho".
//
// `LinhaDeFila` mora aqui pelo mesmo motivo: é o contrato de leitura da
// projeção canônica, e as três telas leem o MESMO contrato.
//
// ─── NADA AQUI ESCREVE ──────────────────────────────────────────────────────
// O seletor DEVOLVE a escolha (`aoEscolher`); quem comanda é a tela, e sempre
// por `POST /api/tarefas/{id}/comando`.
// ============================================================================
"use client"

import { useEffect, useState, useSyncExternalStore } from "react"
import { labelDaFasePorPhaseKey } from "@/src/lib/process-stage/fases-catalog"
// O CONTRATO DE LEITURA É UM SÓ — antes esta interface era uma SEGUNDA
// declaração (mesmo nome, campos DIVERGENTES: sem `proximoAcontecimento`, sem
// `passoAtual`) da que `lib/operacional/tarefa-projecoes.ts` já definia e a
// API já devolvia. A tela recebia os campos e o tipo não sabia — reexportar o
// tipo canônico (import type, apagado no build do client) fecha a divergência
// em vez de perpetuá-la numa terceira tela.
export type { LinhaDeFila } from "@/lib/operacional/tarefa-projecoes"
import type { ColunaKanban, LinhaDeFila } from "@/lib/operacional/tarefa-projecoes"

/**
 * A LINHA ENRIQUECIDA DA OPERAÇÃO — a MESMA leitura de Minha Fila/Distribuição/
 * Tarefas e Projetos (`visaoGerencial`/`minhaFila`, ambas devolvem este
 * formato). Vivia duplicada em `central-tarefas.tsx` (órfão, removido
 * 24/09/2026) e sob o nome `LinhaGerencial` em `visao-global.tsx` — mesmo
 * shape, dois nomes. Esta é a declaração canônica; novas telas importam
 * daqui, nunca reescrevem os mesmos 7 campos pela terceira vez.
 */
export interface LinhaOperacional extends LinhaDeFila {
  venceHoje: boolean
  coluna: ColunaKanban
  esperandoDe: "terceiro" | "cliente" | null
  esperandoDesde: string | null
  esperandoHaDias: number | null
  motivoBloqueio: string | null
  concluidaEm: string | null
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

interface Funcionario {
  id: number
  nome: string
  email?: string
  tarefasAtivas: number
  atrasadas: number
}

interface Funcionario {
  id: number
  nome: string
  tarefasAtivas: number
  atrasadas: number
}

export const auth = () => ({
  "Content-Type": "application/json",
  Authorization: `Bearer ${typeof window !== "undefined" ? localStorage.getItem("authToken") ?? "" : ""}`,
})

export /** pt-BR curto. Sem prazo é ausência de informação, não "hoje". */
function dataCurta(iso: string | null): string {
  if (!iso) return "—"
  return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" })
}

/**
 * O ESTADO OPERACIONAL EM PORTUGUÊS — o MESMO vocabulário da Central e do filtro.
 *
 * `NAO_INICIADA` aparecia como "Não iniciada" no cartão enquanto o filtro logo
 * acima dizia "A fazer" e a Central, sobre a MESMA tarefa, também dizia "A
 * fazer". Três nomes para um estado obrigam cada pessoa a montar o próprio
 * dicionário — e quem monta dicionário erra.
 *
 * "A fazer" ganha porque é o que o operador faz com a informação: é trabalho
 * que espera por ele. "Não iniciada" descreve o passado da tarefa, não o que
 * ela pede.
 */
export const ROTULO_STATUS: Record<string, string> = {
  NAO_INICIADA: "A fazer",
  EM_ANDAMENTO: "Em andamento",
  AGUARDANDO_TERCEIRO: "Aguardando terceiro",
  AGUARDANDO_CLIENTE: "Aguardando cliente",
  BLOQUEADA: "Bloqueada",
  CONCLUIDO_RECEBIDO: "Concluída",
  CONCLUIDO_NAO_POSSUI: "Concluída",
  CANCELADA: "Cancelada",
  SUPERSEDIDA: "Substituída",
}
export const ROTULO_PRIORIDADE: Record<string, string> = { URGENTE: "Urgente", ALTA: "Alta", MEDIA: "Média", BAIXA: "Baixa" }

/**
 * O RÓTULO DA COLUNA — a MESMA leitura em toda tela que mostra o estado de
 * UMA tarefa, nunca `ROTULO_STATUS[statusTarefa]` cru.
 *
 * `statusTarefa` sozinho não sabe que `BLOQUEADA` com
 * `motivoCodigo === "AGUARDANDO_TERCEIRO"` é espera de terceiro — só `coluna`
 * (derivada por `colunaDaTarefa`, mesma semântica de `ehEsperaExterna`) sabe.
 * Usar o rótulo cru aqui fazia a MESMA tarefa dizer "Bloqueada" numa tela e
 * "Aguardando terceiro" na tela ao lado, para o idêntico par
 * status+motivoCodigo.
 */
export const ROTULO_COLUNA: Record<ColunaKanban, string> = {
  SEM_RESPONSAVEL: "Sem responsável",
  A_FAZER: "A fazer",
  EM_ANDAMENTO: "Em andamento",
  AGUARDANDO_TERCEIRO: "Aguardando terceiro",
  BLOQUEADA: "Bloqueada",
  CONCLUIDA: "Concluída",
  CANCELADA: "Cancelada",
}

// CADASTRO DO GERENCIAMENTO, em cache compartilhado — mesma precedência do
// resolvedor canônico do servidor (resolverRotuloDaFase): catálogo de código
// primeiro, cadastro depois. Sem isto, qualquer fase cadastrada fora das 10
// canônicas (ex.: TESTEVIS_fase) caía no "troca `_` por espaço" — é como
// virava "TESTEVIS fase" na Operação enquanto o processo já mostrava "Fase de
// Teste Visual" via /api/processos/[id] (achado real, 20/09/2026). Módulo
// carrega uma vez (fetch de GET /api/fases/rotulos) e todo consumidor de
// `rotularFase` num componente que chame `useRotulosDeFaseProntos()` reage
// quando o cadastro chega.
let mapaFasesCadastro: Record<string, string> = {}
let statusMapaFasesCadastro: "idle" | "carregando" | "pronto" = "idle"
const ouvintesMapaFasesCadastro = new Set<() => void>()
function notificarOuvintesMapaFasesCadastro() { ouvintesMapaFasesCadastro.forEach((fn) => fn()) }
function carregarMapaFasesCadastroUmaVez() {
  if (statusMapaFasesCadastro !== "idle") return
  statusMapaFasesCadastro = "carregando"
  const t = typeof window !== "undefined" ? localStorage.getItem("authToken") : null
  fetch("/api/fases/rotulos", { headers: t ? { Authorization: `Bearer ${t}` } : {} })
    .then((r) => (r.ok ? r.json() : null))
    .then((j) => { if (j?.rotulos) mapaFasesCadastro = j.rotulos })
    .catch(() => {})
    .finally(() => { statusMapaFasesCadastro = "pronto"; notificarOuvintesMapaFasesCadastro() })
}
/** Chamar uma vez no componente de topo de cada tela que usa `rotularFase`,
 *  para a tela re-renderizar quando o cadastro terminar de carregar (o valor
 *  de retorno não importa — é só o gatilho de reatividade). */
export function useRotulosDeFaseProntos(): boolean {
  const status = useSyncExternalStore(
    (cb) => { ouvintesMapaFasesCadastro.add(cb); return () => ouvintesMapaFasesCadastro.delete(cb) },
    () => statusMapaFasesCadastro,
    () => "idle" as const,
  )
  useEffect(() => { carregarMapaFasesCadastroUmaVez() }, [])
  return status === "pronto"
}

/**
 * A fase vem como chave técnica; a tela mostra gente, não `faseMacroKey`.
 *
 * O nome vem do CATÁLOGO publicado (10 fases canônicas) ou, se a fase foi
 * cadastrada no Gerenciamento fora dele, do cadastro em si — NUNCA mais
 * "desenrolar o underscore": isso inventava rótulo em vez de mostrar o
 * cadastrado. Sem nenhuma das duas fontes, mostra erro controlado — nunca a
 * chave técnica crua disfarçada de nome.
 */
export function rotularFase(k: string | null): string | null {
  if (!k) return null
  carregarMapaFasesCadastroUmaVez()
  return labelDaFasePorPhaseKey(k) ?? mapaFasesCadastro[k] ?? `⚠ Fase não cadastrada (${k})`
}

/**
 * A ETIQUETA — pílula semântica, nos MESMOS tokens de tile/tinta do DS
 * (`--success-tile`/`--warning-tile`/`--danger-tile`/`--info-tile` +
 * seus pares `-text`) que `home-primitives.tsx` já usa. Nunca cor
 * inventada por tela: quem lê "alerta" vê o mesmo âmbar em qualquer canto
 * do produto.
 */
export function Etiqueta({ tom, children }: { tom: "neutro" | "alerta" | "critico" | "acento" | "sucesso"; children: React.ReactNode }) {
  const cores = {
    neutro: "bg-[var(--surface-tertiary)] text-[var(--text-secondary)]",
    alerta: "bg-[var(--warning-tile)] text-[var(--warning-text)]",
    critico: "bg-[var(--danger-tile)] text-[var(--danger-text)]",
    acento: "bg-[var(--info-tile)] text-[var(--info-text)]",
    sucesso: "bg-[var(--success-tile)] text-[var(--success-text)]",
  }[tom]
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium leading-4 ${cores}`}>
      {children}
    </span>
  )
}

export function Estado({ tipo, mensagem, aoTentar }: { tipo: "carregando" | "vazio" | "erro"; mensagem: string; aoTentar?: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-4 py-16 text-center">
      {tipo === "carregando" && <div className="h-6 w-6 animate-spin rounded-full border-2 border-[var(--border-strong)] border-t-transparent" />}
      <p className="text-[13px] text-[var(--text-secondary)]">{mensagem}</p>
      {tipo === "erro" && aoTentar && (
        <button
          onClick={aoTentar}
          className="rounded-lg border border-[var(--border-default)] bg-[var(--surface-elevated)] px-3.5 py-1.5 text-[12px] font-medium text-[var(--text-primary)] shadow-[var(--elev-1)] transition-colors hover:bg-[var(--surface-secondary)]"
        >
          Tentar novamente
        </button>
      )}
    </div>
  )
}

/**
 * O SELETOR DE FUNCIONÁRIO.
 *
 * Mostra nome e, discretamente, a carga atual vinda da projeção canônica — não
 * é recomendação nem balanceamento, é informação para quem decide. A lista vem
 * do servidor filtrada por PERMISSÃO de executar tarefa: atribuir a quem não
 * pode executar cria uma tarefa que nasce travada.
 */
export function SeletorResponsavel({
  titulo,
  atual,
  aoEscolher,
  aoFechar,
  ocupado,
  erro,
}: {
  titulo: string
  atual: number | null
  aoEscolher: (id: number) => void
  aoFechar: () => void
  ocupado: boolean
  erro: string | null
}) {
  // O RESULTADO CARREGA A CHAVE DO PEDIDO QUE O PRODUZIU.
  //
  // "Carregando" vira DERIVAÇÃO (`resultado.chave !== chave`) em vez de um
  // `setState(null)` no corpo do efeito. Além de não disparar render em
  // cascata, isso mata a corrida clássica: a resposta de um pedido antigo não
  // consegue se passar pela do pedido atual.
  const [resultado, setResultado] = useState<{ chave: number; lista: Funcionario[] | null } | null>(null)
  const [tentativa, setTentativa] = useState(0)

  useEffect(() => {
    let vivo = true
    fetch("/api/operacao/atribuiveis", { headers: auth() })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: { funcionarios?: Funcionario[] }) => { if (vivo) setResultado({ chave: tentativa, lista: d.funcionarios ?? [] }) })
      .catch(() => { if (vivo) setResultado({ chave: tentativa, lista: null }) })
    return () => { vivo = false }
  }, [tentativa])

  const carregando = resultado?.chave !== tentativa
  const funcionarios = carregando ? null : resultado?.lista ?? null
  const falhou = !carregando && funcionarios == null
  const carregar = () => setTentativa((n) => n + 1)

  return (
    // z-index da SSOT de camadas (`src/lib/ui/layers.ts`) — `z-[60]` cravado
    // não respeitava a régua do shell (HeaderBar cria stacking context próprio
    // via `backdrop-blur`); um modal fora dessa régua pode renderizar atrás
    // do header em vez de acima.
    <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-[var(--overlay-modal)] p-4" onClick={aoFechar}>
      <div
        className="w-full max-w-sm overflow-hidden rounded-lg border border-[var(--border-default)] bg-[var(--surface-overlay)] shadow-[var(--elev-3)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-white/[0.08] px-4 py-3">
          <h2 className="text-[13px] font-medium text-white/90">{titulo}</h2>
        </div>

        {erro && <div className="border-b border-[var(--border-default)] bg-[var(--surface-secondary)] px-4 py-2 text-[11px] text-red-700/90">{erro}</div>}

        <div className="max-h-72 overflow-y-auto">
          {falhou && <Estado tipo="erro" mensagem="Não foi possível carregar os funcionários." aoTentar={carregar} />}
          {carregando && <Estado tipo="carregando" mensagem="Carregando funcionários…" />}
          {!falhou && funcionarios?.length === 0 && (
            <Estado tipo="vazio" mensagem="Ninguém tem permissão para executar tarefas." />
          )}
          {funcionarios?.map((f) => (
            <button
              key={f.id}
              disabled={ocupado || f.id === atual}
              onClick={() => aoEscolher(f.id)}
              className="flex w-full items-center justify-between border-b border-white/[0.05] px-4 py-2.5 text-left transition-colors last:border-b-0 hover:bg-[var(--surface-primary)] disabled:opacity-40"
            >
              <span className="min-w-0">
                <span className="block truncate text-[12px] text-white/85">{f.nome}</span>
                {/* Discreto, mas presente: dois funcionários de mesmo nome eram
                    duas linhas idênticas no seletor. */}
                {f.email && <span className="block truncate text-[10px] text-[var(--text-muted)]">{f.email}</span>}
              </span>
              <span className="text-[10px] tabular-nums text-[var(--text-muted)]">
                {f.tarefasAtivas} ativa{f.tarefasAtivas === 1 ? "" : "s"}
                {f.atrasadas > 0 && <span className="text-red-700/70"> · {f.atrasadas} atrasada{f.atrasadas === 1 ? "" : "s"}</span>}
                {f.id === atual && <span className="text-[var(--text-secondary)]"> · atual</span>}
              </span>
            </button>
          ))}
        </div>

        <div className="flex justify-end border-t border-white/[0.08] px-4 py-2.5">
          <button onClick={aoFechar} className="rounded px-3 py-1.5 text-[11px] text-[var(--text-secondary)] transition-colors hover:text-white/80">
            Cancelar
          </button>
        </div>
      </div>
    </div>
  )
}

