"use client"
// src/components/torre/ProcessoCertidoes.tsx — o cartão "Certidões da fase atual · N" do Detalhe do Processo: selects Pessoa / Status /
// Ordenar (funcionam de verdade, ao contrário do exemplo do protótipo), a tabela (por padrão só as ATIVAS: abertas e concluídas; as
// CANCELADA / NÃO EXIGIDA, com "Motivo" e "Reabrir", entram quando o bloco ou o filtro de status as pedem), a linha-resumo "+ N certidões iguais a estas" e o "Atribuir" por linha.
// Os dados são `d.tabela` (montados em `torre-foco.ts` a partir das MESMAS linhas da aba Tarefas); aqui só se filtra, ordena e desenha.
import { TEXTO_DA_REGRA_DE_ORDEM } from "@/lib/operacional/ordem-certidoes"
import { Fragment, useMemo, useState } from "react"
import { AcoesDeAtribuicaoEmLote, type LoteDeAtribuicao } from "./lote-atribuicao"
import { urlOperacionalDaTarefa } from "@/lib/operacional/navegacao"
import { diaMesDoPrazo } from "@/src/lib/tarefa/texto-prazo"
import {
  OPCOES_DE_STATUS, filtrarEOrdenar, pessoasDaTabela, resumirIguais, rotuloQuando, rotuloDia, tituloDaTabela,
  type FiltroDeStatusDaTabela, type LinhaDaTabela,
} from "@/lib/operacional/torre-processo-puro"
import type { DetalheDoProcesso } from "@/lib/operacional/torre-foco"

const PILL: Record<string, string> = { CONCLUIDA: "verde", EM_ANDAMENTO: "azul", BLOQUEADA: "vermelho", CANCELADA: "fora", NAO_EXIGIDA: "fora" }
const TOM_PRAZO = { critico: "tpr-c-verm", atencao: "tpr-c-amb", ritmo: "", } as const

const descricaoDaIgual = (l: LinhaDaTabela): string =>
  [l.passo ? `${l.passo.rotulo}${l.passo.total ? ` · ${l.passo.ordem}/${l.passo.total}` : ""}` : null, l.statusRotulo, l.responsavelNome ?? "sem responsável", l.dataPrazo ? diaMesDoPrazo(l.dataPrazo) : null].filter(Boolean).join(" · ")

export function ProcessoCertidoes({ d, agora, status, onStatus, podeAtribuir, ocupado, onAtribuir, lote, onMotivo, onReabrir, onVerHistorico, onHistorico }: {
  d: DetalheDoProcesso; agora: Date; podeAtribuir: boolean; ocupado: boolean
  /** O filtro de status vive na página: o bloco "Cancelada / não exigida" e este select mexem no MESMO estado. */
  status: FiltroDeStatusDaTabela; onStatus: (s: FiltroDeStatusDaTabela) => void
  onAtribuir: (tarefaId: number) => void
  /** As ações em lote de atribuição — o MESMO código da aba Tarefas (`lote-atribuicao.tsx`): Atribuir a…, Remover responsável, Atribuir às sugeridas. */
  lote: LoteDeAtribuicao
  onMotivo: (l: LinhaDaTabela) => void
  onReabrir: (l: LinhaDaTabela) => void
  onVerHistorico: () => void
  /** "Histórico" da certidão: abre o Histórico completo já filtrado nela (só leitura). */
  onHistorico: (l: LinhaDaTabela) => void
}) {
  const [pessoaId, setPessoaId] = useState<number | null>(null)
  const [expandido, setExpandido] = useState(false)
  const [marcadas, setMarcadas] = useState<ReadonlySet<string>>(new Set())

  const pessoas = useMemo(() => pessoasDaTabela(d.tabela), [d.tabela])
  const linhas = useMemo(() => filtrarEOrdenar(d.tabela, { pessoaId, status }), [d.tabela, pessoaId, status])
  const trabalho = linhas.filter((l) => l.tipo === "ABERTA" || l.tipo === "CONCLUIDA")
  const fora = linhas.filter((l) => l.tipo === "CANCELADA" || l.tipo === "NAO_EXIGIDA")
  // A linha-resumo só vale na visão sem filtro (todas as pessoas; ativas, ou ativas + canceladas / não exigidas): filtrado, mostra tudo o que casou.
  const resumo = resumirIguais(trabalho, descricaoDaIgual)
  const semFiltroDeStatus = status === "ATIVAS" || status === "TODOS"
  const colapsa = !expandido && pessoaId == null && semFiltroDeStatus && resumo.ocultas.length > 0
  const visiveis = colapsa ? resumo.visiveis : trabalho

  // Qualquer tarefa ABERTA é selecionável (com ou sem responsável): dá para atribuir, transferir ou remover o responsável em lote.
  const marcaveis = trabalho.filter((l) => l.tipo === "ABERTA" && l.tarefaId != null)
  const todasMarcadas = marcaveis.length > 0 && marcaveis.every((l) => marcadas.has(l.chave))
  const alternar = (chave: string) => setMarcadas((m) => { const n = new Set(m); if (n.has(chave)) n.delete(chave); else n.add(chave); return n })
  const marcadasAtribuiveis = marcaveis.filter((l) => marcadas.has(l.chave))
  // O número do título é SEMPRE o das linhas da lista (as que casam com pessoa e status).
  const titulo = tituloDaTabela(d.tabela, (l) => l.documentoId != null, linhas)

  const linhaDeTrabalho = (l: LinhaDaTabela) => {
    const nomePessoa = l.pessoa ?? "Processo inteiro"
    const aberta = l.tipo === "ABERTA"
    return (
      <div key={l.chave} className="tpr-grade tpr-tr" data-linha={l.chave}>
        <div>{l.tipo === "ABERTA" && l.tarefaId != null
          ? <input type="checkbox" className="tpr-chk" aria-label="Selecionar" checked={marcadas.has(l.chave)} onChange={() => alternar(l.chave)} />
          : null}</div>
        <div className="cert"><b>{l.titulo}</b><span>{nomePessoa}{l.geracao ? ` · ${l.geracao}` : ""}</span></div>
        <div className="tpr-c-mut">{l.fase?.label ?? "—"}</div>
        <div>{l.passo ? <>{l.passo.rotulo}{l.passo.total ? <span className="tpr-c-mut"> · {l.passo.ordem}/{l.passo.total}</span> : null}</> : <span className="tpr-c-mut">—</span>}</div>
        <div><span className={`tpr-pill ${PILL[l.status] ?? ""}`}>{l.statusRotulo}</span></div>
        <div className={l.responsavelNome ? "" : aberta ? "tpr-c-verm" : "tpr-c-mut"}>{l.responsavelNome ?? (aberta ? "sem responsável" : "—")}</div>
        <div className="tpr-c-mut" title={l.iniciouEm ? undefined : "Não há registro de quando o trabalho começou"}>{l.iniciouEm ? rotuloQuando(l.iniciouEm, agora) : "—"}</div>
        <div className={aberta && l.risco ? TOM_PRAZO[l.risco] : "tpr-c-mut"}>
          {aberta ? (l.dataPrazo ? diaMesDoPrazo(l.dataPrazo) : "sem prazo") : l.concluidaEm ? `concl. ${rotuloDia(l.concluidaEm, agora)}` : "—"}
        </div>
        <div className="tpr-c-mut">{l.bola ?? "—"}</div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <button type="button" className="tpr-linkbtn" onClick={() => onHistorico(l)} title="Abre o Histórico completo só com os fatos desta certidão">Histórico</button>
          {l.podeAtribuir && l.tarefaId != null
            ? <button type="button" className="tpr-btn peq" disabled={ocupado || !podeAtribuir} onClick={() => onAtribuir(l.tarefaId!)}>Atribuir</button>
            : l.tarefaId != null
              ? <a className="tpr-btn peq" href={urlOperacionalDaTarefa({ taskId: l.tarefaId, processoId: d.processoId })}>Abrir</a>
              : null}
        </div>
      </div>
    )
  }

  const linhaFora = (l: LinhaDaTabela) => (
    <div key={l.chave} className="tpr-grade tpr-tr fora" data-linha={l.chave} data-fora={l.tipo === "NAO_EXIGIDA" ? "nao_exigida" : "cancelada"}>
      <div />
      <div className="cert"><b>{l.titulo}</b><span>{l.pessoa ?? "Processo inteiro"}{l.geracao ? ` · ${l.geracao}` : ""} · {l.encerramentoTexto}</span></div>
      <div className="tpr-c-mut">{l.fase?.label ?? "—"}</div>
      <div>—</div>
      <div><span className="tpr-pill fora">{l.statusRotulo}</span></div>
      <div>—</div><div>—</div><div>—</div><div>—</div>
      <div style={{ display: "flex", gap: 8 }}>
        <button type="button" className="tpr-linkbtn" onClick={() => onMotivo(l)}>Motivo</button>
        <button type="button" className="tpr-linkbtn" onClick={() => onHistorico(l)} title="Abre o Histórico completo só com os fatos desta certidão">Histórico</button>
        {l.reabrivel && <button type="button" className="tpr-linkbtn" disabled={ocupado || !podeAtribuir} onClick={() => onReabrir(l)}>Reabrir</button>}
      </div>
    </div>
  )

  return (
    <div className="tpr-tab">
      <div className="tpr-tab-cab">
        <div className="t">{titulo}</div>
        <div className="filtros">
          <select className="tpr-sel" aria-label="Pessoa" value={pessoaId ?? ""} onChange={(e) => setPessoaId(e.target.value === "" ? null : Number(e.target.value))}>
            <option value="">Todas as pessoas</option>
            {pessoas.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
          </select>
          <select className="tpr-sel" aria-label="Status" value={status} onChange={(e) => onStatus(e.target.value as FiltroDeStatusDaTabela)}>
            {OPCOES_DE_STATUS.map((o) => <option key={o.valor} value={o.valor}>{o.rotulo}</option>)}
          </select>
          <span className="tpr-ordem-fixa" title={TEXTO_DA_REGRA_DE_ORDEM}>Ordem fixa: geração · linha reta · nascimento · Nascimento, Casamento, Óbito</span>
        </div>
      </div>

      {marcadasAtribuiveis.length > 0 && (
        <div className="tpr-lote" role="status">
          <b>{marcadasAtribuiveis.length}</b> {marcadasAtribuiveis.length === 1 ? "selecionada" : "selecionadas"}
          {podeAtribuir && <AcoesDeAtribuicaoEmLote lote={lote} ids={marcadasAtribuiveis.map((l) => l.tarefaId!)} ocupado={ocupado} comSugeridas depois={() => setMarcadas(new Set())} />}
          <button type="button" className="tpr-btn peq" onClick={() => setMarcadas(new Set())}>Limpar seleção</button>
        </div>
      )}

      <div className="tpr-scroll">
        <div className="tpr-grade tpr-th">
          <div><input type="checkbox" className="tpr-chk" aria-label="Selecionar todas" disabled={marcaveis.length === 0} checked={todasMarcadas}
            onChange={() => setMarcadas(todasMarcadas ? new Set() : new Set(marcaveis.map((l) => l.chave)))} /></div>
          <div>Certidão · pessoa</div><div>Fase</div><div>Passo atual</div><div>Status</div><div>Responsável</div><div>Iniciou em</div><div>Prazo</div><div>Aguardando</div><div>Ação</div>
        </div>

        {linhas.length === 0 && (
          <div className="tpr-vazio">{d.tabela.length === 0 ? "Nenhuma tarefa nesta fase ainda." : "Nada corresponde a este filtro."}</div>
        )}
        {visiveis.map((l, i) => {
          // GRUPO POR FASE (a mais antiga primeiro): o cabeçalho aparece quando a fase muda.
          const novaFase = i === 0 || (visiveis[i - 1].fase?.key ?? null) !== (l.fase?.key ?? null)
          const n = novaFase ? visiveis.filter((x) => (x.fase?.key ?? null) === (l.fase?.key ?? null) && x.tipo === "ABERTA").length : 0
          return (
            <Fragment key={l.chave}>
              {novaFase && <div className="tpr-grupo-fase" data-testid="grupo-fase">{l.fase?.label ?? "Sem fase"}<span>{n} {n === 1 ? "aberta" : "abertas"}</span></div>}
              {linhaDeTrabalho(l)}
            </Fragment>
          )
        })}
        {colapsa && (
          <div className="tpr-resumo">
            <span>+ {resumo.ocultas.length} {resumo.ocultas.every((l) => l.documentoId != null) ? (resumo.ocultas.length === 1 ? "certidão igual" : "certidões iguais") : (resumo.ocultas.length === 1 ? "tarefa igual" : "tarefas iguais")} a estas{resumo.nomes.length ? ` (${resumo.nomes.join(", ")})` : ""} · todas &ldquo;{resumo.descricao}&rdquo;</span>
            <button type="button" onClick={() => setExpandido(true)}>ver todas</button>
          </div>
        )}
        {!colapsa && expandido && resumo.ocultas.length > 0 && pessoaId == null && semFiltroDeStatus && (
          <div className="tpr-resumo"><button type="button" onClick={() => setExpandido(false)}>mostrar menos</button></div>
        )}
        {fora.map(linhaFora)}
      </div>

    </div>
  )
}
