"use client"
// src/components/torre/TorrePrecisaDeVoce.tsx — PRECISA DE VOCÊ (Bloco J4; Torre nova, frente B2).
//
// UM componente em DOIS lugares:
//   • a aba própria "Precisa de você" (a 2ª aba) — mostra TODAS as decisões;
//   • EMBUTIDO na Visão geral (`embutido`) — a seção do protótipo, com as 7 primeiras decisões e o rodapé "+ N decisões".
//
// A assinatura é ESTÁVEL (a Visão geral importa este componente): `itens`, `carregando`, `erro` e `irParaAba` são obrigatórios; `embutido`
// e `onRevisar` são opcionais. Sem `onRevisar`, a seção abre a Revisão do dia sozinha sobre os itens que mostra.
//
// O que a seção tem (inventário §1.2): título "Precisa de você · N" e o texto de apoio; "▶ Revisar uma por uma"; os 6 cartões-filtro por tipo
// (número · nome · regra; clicar liga o filtro, clicar de novo desliga, um por vez); a tabela Família · Tipo · Fase · Tarefa · Quantidade ·
// Ação (dois botões por linha; a família é link ao Detalhe do Processo; cada informação aparece uma vez); e o rodapé com a ordem e o "Desfazer".
import { useMemo, useState } from "react"
import Link from "next/link"
import {
  TIPOS_DO_PAINEL, ROTULO_TIPO, PILL_DO_TIPO, COR_DO_NUMERO, regraDoCartao, escaladaAposDos, type ItemPrecisa,
} from "./tipos-precisa"
import { useAcoesDoItem } from "./acoes-do-item"
import { TorreRevisao } from "./TorreRevisao"
import "./precisa.css"

/** Quantas decisões a seção EMBUTIDA mostra sem filtro (o resto vai pelo "Revisar uma por uma" e pela aba própria). */
export const DECISOES_NA_SECAO_EMBUTIDA = 7

export interface PropsPrecisaDeVoce {
  itens: ItemPrecisa[] | null
  carregando: boolean
  erro: string | null
  irParaAba: (aba: "equipe") => void
  /** `true` = a seção da Visão geral (cartão com borda, 7 decisões, âncora `#pdv`). Ausente/`false` = a aba própria. */
  embutido?: boolean
  /** Abre a Revisão do dia. Ausente → a própria seção abre a Revisão sobre as decisões que tem. */
  onRevisar?: () => void
}

const chaveDe = (it: ItemPrecisa, i: number) => `${i}:${it.tipo}:${it.processoId ?? "-"}:${it.tarefaId ?? it.contexto.usuarioId ?? "-"}`

export function TorrePrecisaDeVoce({ itens, carregando, erro, irParaAba, embutido = false, onRevisar }: PropsPrecisaDeVoce) {
  const [tipo, setTipo] = useState<(typeof TIPOS_DO_PAINEL)[number] | null>(null)
  const [ocupado, setOcupado] = useState<string | null>(null)
  // O que acabou de ser resolvido some NA HORA (como no protótipo). Os itens são OBJETOS da leitura: a releitura traz objetos novos, então
  // o que sobrou aqui deixa de valer sozinho — a lista de verdade volta a mandar.
  const [feitos, setFeitos] = useState<ReadonlySet<ItemPrecisa>>(new Set())
  const [revisao, setRevisao] = useState<ItemPrecisa[] | null>(null)
  const { executar, modais } = useAcoesDoItem({ irParaAba, onFeito: (it) => setFeitos((s) => new Set(s).add(it)) })

  const todos = useMemo(() => itens ?? [], [itens])
  const contagem = useMemo(() => Object.fromEntries(TIPOS_DO_PAINEL.map((t) => [t, todos.filter((i) => i.tipo === t).length])) as Record<(typeof TIPOS_DO_PAINEL)[number], number>, [todos])
  const escaladaApos = escaladaAposDos(todos)

  if (erro) return <div className="tor-card pad">{erro}</div>
  if (carregando || itens == null) return <div className="tor-card pad small">Carregando as decisões…</div>

  const doTipo = tipo ? todos.filter((i) => i.tipo === tipo) : todos
  const pendentes = doTipo.filter((i) => !feitos.has(i))
  // Sem filtro, a seção embutida mostra só as primeiras; com filtro mostra o tipo inteiro (nenhuma decisão fica sem caminho).
  const limite = embutido && !tipo ? DECISOES_NA_SECAO_EMBUTIDA : pendentes.length
  const visiveis = pendentes.slice(0, limite)
  const restantes = pendentes.length - visiveis.length

  const rodar = async (item: ItemPrecisa, qual: 1 | 2, chave: string) => {
    setOcupado(chave)
    try { await executar(item, qual) } finally { setOcupado(null) }
  }
  const abrirRevisao = () => (onRevisar ? onRevisar() : setRevisao([...todos]))

  const rodape = tipo
    ? `Mostrando só "${ROTULO_TIPO[tipo]}" · ordenadas do maior risco para o menor · cada ação fica no histórico; as reversíveis têm "Desfazer"`
    : `${restantes > 0 ? `+ ${restantes} ${restantes === 1 ? "decisão" : "decisões"} · ` : ""}ordenadas do maior risco para o menor · cada ação fica no histórico; as reversíveis têm "Desfazer"`

  return (
    <div className="pdv tor" data-pdv={embutido ? "embutido" : "aba"}>
      <div className="pdv-topo">
        <div className="pdv-titulo">Precisa de você · {todos.length}</div>
        <div className="pdv-texto">Itens que só o Marco pode decidir ou destravar.</div>
        <button type="button" className="pdv-revisar" onClick={abrirRevisao} disabled={todos.length === 0}>▶ Revisar uma por uma</button>
      </div>

      <div className="pdv-tipos">
        {TIPOS_DO_PAINEL.map((t) => (
          <button key={t} type="button" className="pdv-tipo" aria-pressed={tipo === t} onClick={() => setTipo(tipo === t ? null : t)}>
            <span className={`pdv-tipo-n ${COR_DO_NUMERO[t]}`}>{contagem[t]}</span>
            <span className="pdv-tipo-t">{ROTULO_TIPO[t]}</span>
            <span className="pdv-tipo-r">{regraDoCartao(t, escaladaApos)}</span>
          </button>
        ))}
      </div>

      <div className="pdv-tab">
        <div className="pdv-hd"><div>Família</div><div>Tipo</div><div>Fase</div><div>Tarefa</div><div>Quantidade</div><div>Ação</div></div>
        {visiveis.map((it, i) => {
          const chave = chaveDe(it, i)
          const c = it.colunas
          return (
            <div key={chave} className="pdv-lin">
              <div className="pdv-fam">
                {it.familiaNome ? <Link href={it.link}>{it.familiaNome}</Link> : <span>—</span>}
                {c?.pais && <span className="pdv-det">{c.pais}</span>}
              </div>
              <div><span className={`tor-p ${PILL_DO_TIPO[it.tipo]}`}>{ROTULO_TIPO[it.tipo] ?? it.tipo}</span></div>
              <div className="pdv-t13">{c?.fase ?? "—"}</div>
              <div className="pdv-quem">
                {it.familiaNome ? <span>{c?.tarefa ?? it.titulo}</span> : <Link href={it.link}>{c?.tarefa ?? it.titulo}</Link>}
                {c?.complemento && <span className="pdv-det">{c.complemento}</span>}
              </div>
              <div className="pdv-qtd">
                <b>{c?.quantidade != null ? c.quantidade : "—"}</b>
                {c?.quantidade != null && c.unidade && <span className="pdv-det">{c.unidade}</span>}
              </div>
              <div className="pdv-acoes">
                <button type="button" className="pdv-b1" disabled={ocupado === chave} onClick={() => void rodar(it, 1, chave)}>{it.acao1.rotulo}</button>
                <button type="button" className="pdv-b2" disabled={ocupado === chave} onClick={() => void rodar(it, 2, chave)}>{it.acao2.rotulo}</button>
              </div>
            </div>
          )
        })}
        <div className="pdv-rodape">{rodape}</div>
      </div>

      {modais}
      {revisao && <TorreRevisao itens={revisao} irParaAba={(a) => { setRevisao(null); irParaAba(a) }} onSair={() => setRevisao(null)} />}
    </div>
  )
}
