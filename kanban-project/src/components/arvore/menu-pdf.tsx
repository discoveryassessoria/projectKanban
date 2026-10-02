"use client"

// src/components/arvore/menu-pdf.tsx
// ============================================================================
// BOTÃO PDF COM O IDIOMA DENTRO.
//
// O seletor de idioma do PDF saiu da barra de ferramentas: ele só importa no
// instante de exportar, então mora onde a exportação acontece. O botão "PDF"
// abre um menu com os idiomas e o comando de exportar. O idioma nasce no do país
// do processo (cadastro) — quem decide é a tela, que passa `idioma` já resolvido;
// o operador troca aqui quando o destinatário fala outra língua.
// ============================================================================

import { useState } from "react"
import { Check, ChevronDown, FileDown, Loader2 } from "lucide-react"
import {
  CAMADA_MENU_BARRA,
  CLASSE_BOTAO_BARRA,
  CLASSE_BOTAO_BARRA_ATIVO,
  CLASSE_MENU_BARRA,
  useFecharFora,
} from "./inteligencia/barra-linhagem"

export interface IdiomaPdf {
  codigo: string
  rotulo: string
}

export function MenuPdf({
  idiomas,
  idioma,
  onIdioma,
  onExportar,
  exportando,
  desabilitado,
}: {
  idiomas: IdiomaPdf[]
  idioma: string
  onIdioma: (codigo: string) => void
  onExportar: () => void
  exportando: boolean
  desabilitado: boolean
}) {
  const [aberto, setAberto] = useState(false)
  const ref = useFecharFora(aberto, () => setAberto(false))
  const atual = idiomas.find((i) => i.codigo === idioma)

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        className={aberto ? CLASSE_BOTAO_BARRA_ATIVO : CLASSE_BOTAO_BARRA}
        onClick={() => setAberto((v) => !v)}
        disabled={exportando || desabilitado}
        aria-haspopup="menu"
        aria-expanded={aberto}
        title="Exportar para PDF — escolha o idioma"
      >
        {exportando ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileDown className="h-4 w-4" />}
        <span>{exportando ? "Exportando..." : "PDF"}</span>
        <ChevronDown className="h-3.5 w-3.5 shrink-0" aria-hidden />
      </button>

      {aberto && (
        <div
          role="menu"
          aria-label="Exportar PDF"
          className={`${CLASSE_MENU_BARRA} left-auto right-0 w-[240px] max-w-[calc(100vw-1.5rem)]`}
          style={{ zIndex: CAMADA_MENU_BARRA }}
        >
          <p className="border-b border-[var(--border-default)] px-3 py-2 text-[11px] uppercase tracking-wide text-gray-500">
            Idioma do PDF
          </p>
          <ul className="py-1">
            {idiomas.map((i) => {
              const ativo = i.codigo === idioma
              return (
                <li key={i.codigo}>
                  <button
                    type="button"
                    role="menuitemradio"
                    aria-checked={ativo}
                    onClick={() => onIdioma(i.codigo)}
                    className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] transition hover:bg-[var(--surface-hover)] ${
                      ativo ? "font-medium text-gray-900" : "text-gray-700"
                    }`}
                  >
                    <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center">
                      {ativo && <Check className="h-3.5 w-3.5" aria-hidden />}
                    </span>
                    {i.rotulo}
                  </button>
                </li>
              )
            })}
          </ul>
          <div className="border-t border-[var(--border-default)] p-2">
            <button
              type="button"
              onClick={() => {
                setAberto(false)
                onExportar()
              }}
              className="flex w-full items-center justify-center gap-2 rounded-md bg-[var(--action-primary)] px-3 py-2 text-[13px] font-medium text-[var(--action-primary-ink)] transition hover:bg-[var(--action-primary-hover)]"
            >
              <FileDown className="h-4 w-4" aria-hidden />
              Exportar em {atual?.rotulo ?? idioma}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
