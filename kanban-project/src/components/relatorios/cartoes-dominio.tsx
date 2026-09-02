// src/components/relatorios/cartoes-dominio.tsx
//
// A GRADE DE DOMÍNIOS — a porta de entrada dos Relatórios.
//
// O número que aparece no cartão é `ordem`, DECLARADA no domínio. Não é o
// índice do laço: se um domínio novo nascer com ordem 6, ele é o 6 aqui sem
// ninguém renumerar nada, e nenhum outro cartão muda de número por acidente.
//
// O ícone é DESENHO, não identidade — mesma regra da bandeira de país. O mapa
// abaixo é o conjunto de figuras que este componente sabe desenhar; domínio sem
// figura cai no genérico e continua existindo, aparecendo e funcionando.

"use client"

import {
  Folder, User, Users, Network, FileText, Files, CheckCircle2, Stamp,
  CalendarCheck, SlidersHorizontal, DollarSign, Truck, Tag, Landmark,
  TrendingUp, Archive, ShieldAlert, ChevronRight, BarChart3,
  type LucideIcon,
} from "lucide-react"

export interface DominioCartao {
  key: string; rotulo: string; descricao: string; ordem: number
}

/** figura + tinta. A tinta é alfa sobre a superfície, para ler nos dois temas. */
const FIGURA: Record<string, { icone: LucideIcon; cor: string }> = {
  processos:    { icone: Folder,             cor: "59 130 246" },
  requerentes:  { icone: User,               cor: "34 197 94" },
  familias:     { icone: Users,              cor: "168 85 247" },
  genealogia:   { icone: Network,            cor: "20 184 166" },
  certidoes:    { icone: FileText,           cor: "245 158 11" },
  documentos:   { icone: Files,              cor: "37 99 235" },
  completude:   { icone: CheckCircle2,       cor: "22 163 74" },
  protocolos:   { icone: Stamp,              cor: "139 92 246" },
  tarefas:      { icone: CalendarCheck,      cor: "249 115 22" },
  workflow:     { icone: SlidersHorizontal,  cor: "99 102 241" },
  financeiro:   { icone: DollarSign,         cor: "21 128 61" },
  fornecedores: { icone: Truck,              cor: "234 88 12" },
  servicos:     { icone: Tag,                cor: "14 165 233" },
  orgaos:       { icone: Landmark,           cor: "100 116 139" },
  equipe:       { icone: TrendingUp,         cor: "236 72 153" },
  arquivos:     { icone: Archive,            cor: "120 113 108" },
  qualidade:    { icone: ShieldAlert,        cor: "239 68 68" },
}

const GENERICO = { icone: BarChart3, cor: "100 116 139" }

export function CartoesDominio({
  dominios, aoAbrir,
}: { dominios: DominioCartao[]; aoAbrir: (key: string) => void }) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
      {dominios.map((d) => {
        const { icone: Icone, cor } = FIGURA[d.key] ?? GENERICO
        return (
          <button
            key={d.key}
            type="button"
            onClick={() => aoAbrir(d.key)}
            className="group flex h-full items-start gap-3 rounded-[14px] border border-[var(--border-default)] bg-[var(--surface-primary)] p-4 text-left shadow-[var(--elev-1)] transition-all hover:-translate-y-px hover:border-[var(--action-primary)] hover:shadow-[var(--elev-2)]"
          >
            <span
              className="grid h-11 w-11 shrink-0 place-items-center rounded-[12px]"
              style={{ background: `rgb(${cor} / 0.12)`, color: `rgb(${cor})` }}
            >
              <Icone className="h-5 w-5" strokeWidth={2} />
            </span>

            <span className="min-w-0 flex-1">
              <span className="block text-[14px] font-semibold text-[var(--text-primary)] group-hover:text-[var(--action-primary)]">
                {d.ordem}. {d.rotulo}
              </span>
              {/* Duas linhas e para: descrição longa não pode empurrar a altura
                  de um cartão e desalinhar a fileira inteira. Sem `block` de
                  propósito — ele sobrescreveria o display que o clamp precisa. */}
              <span className="mt-1 line-clamp-2 text-[12.5px] leading-snug text-[var(--text-secondary)]" title={d.descricao}>
                {d.descricao}
              </span>
            </span>

            <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-[var(--text-muted)] transition-transform group-hover:translate-x-0.5 group-hover:text-[var(--action-primary)]" />
          </button>
        )
      })}
    </div>
  )
}
