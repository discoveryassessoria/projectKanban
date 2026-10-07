"use client"
// src/components/torre/TorreHoje.tsx — HOJE · "O que está pegando hoje?" (consolidação da Torre, 06/10/2026).
// Funde a antiga Visão geral e o "Precisa de você". SÓ ALARMES: no máximo seis números, todos clicáveis (cada um abre exatamente a lista que o
// compõe, pelo MESMO predicado — L3) e as decisões do dia como LINHAS COM LINK para onde se resolve. NENHUM botão de ação aqui (L4: só a aba
// Tarefas atribui; as decisões do processo moram na página do processo).
import Link from "next/link"
import { ALARMES_DE_HOJE, destinoDaDecisao, numeroDoAlarme, urlDoAlarme } from "@/lib/operacional/torre-hoje"
import { PERGUNTA_DA_ABA } from "@/lib/operacional/torre-abas"
import type { LinhaTorre } from "./tipos"
import { ROTULO_TIPO, PILL_DO_TIPO, type ItemPrecisa } from "./tipos-precisa"
import "./visao-geral.css"

export function TorreHoje({ linhas, itens, erroItens, agora, frase, onAlarme }: {
  linhas: LinhaTorre[]; itens: ItemPrecisa[] | null; erroItens: string | null; agora: Date; frase: string
  /** Abre a aba Tarefas já filtrada pelo alarme (o mesmo filtro que o cartão conta). */
  onAlarme: (chave: string) => void
}) {
  return (
    <div className="tor-hoje" data-aba="hoje">
      <div className="tor-aba-pergunta" data-testid="pergunta-da-aba">{PERGUNTA_DA_ABA.hoje}</div>
      {frase && <p className="tor-hoje-frase" data-testid="frase-do-dia">{frase}</p>}

      <div className="tor-hoje-numeros" role="list">
        {ALARMES_DE_HOJE.map((a) => {
          const n = numeroDoAlarme(a, linhas, agora)
          return (
            <Link key={a.chave} href={urlDoAlarme(a)} role="listitem" className={`tor-hoje-num ${a.cor}`} title={a.regra} data-alarme={a.chave}
              onClick={(e) => { e.preventDefault(); onAlarme(a.chave) }}>
              <b>{n}</b><span>{a.rotulo}</span>
            </Link>
          )
        })}
      </div>

      <div className="tor-hoje-decisoes">
        <div className="tor-hoje-titulo">Decisões do dia{itens ? ` · ${itens.length}` : ""}</div>
        {erroItens && <div className="tor-card pad small">{erroItens}</div>}
        {!erroItens && itens == null && <div className="tor-card pad small">Carregando as decisões…</div>}
        {itens != null && itens.length === 0 && <div className="tor-card pad small">Nenhuma decisão pendente.</div>}
        {itens != null && itens.map((it, i) => {
          const d = destinoDaDecisao(it)
          return (
            <div key={`${i}:${it.tipo}:${it.processoId ?? "-"}:${it.tarefaId ?? "-"}`} className="tor-hoje-linha">
              <span className={`tor-p ${PILL_DO_TIPO[it.tipo]}`}>{ROTULO_TIPO[it.tipo] ?? it.tipo}</span>
              <span className="fam">{it.familiaNome ?? "—"}</span>
              <span className="txt">{it.colunas?.tarefa ?? it.titulo}{it.colunas?.complemento ? ` · ${it.colunas.complemento}` : ""}</span>
              <Link className="onde" href={d.href}>{d.rotulo} ›</Link>
            </div>
          )
        })}
      </div>
    </div>
  )
}
