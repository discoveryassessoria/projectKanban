"use client"
// src/components/ui/campo-data-texto.tsx
// ============================================================================
// CAMPO DE DATA COM MÁSCARA FIXA dd/mm/aaaa (e `CampoDataHoraTexto`: dd/mm/aaaa hh:mm) — o que substitui `<input type="date">` em TODO o sistema.
// O valor que entra e sai continua ISO («AAAA-MM-DD» / «AAAA-MM-DDTHH:mm»); o que a pessoa vê e digita é sempre o formato do Brasil, qualquer que seja
// o idioma do navegador. Valida dia/mês/ano reais: enquanto o texto está incompleto ou é uma data inexistente, `onChange` recebe "" (vazio) — o formulário
// que exige a data não deixa gravar — e o campo mostra a mensagem. `min`/`max` (ISO) também valem.
// ============================================================================
import { useState } from "react"
import { mascararData, brParaIso, isoParaBr, brHoraParaIso, isoHoraParaBr, motivoDaDataInvalida } from "@/src/lib/datas-br"

interface Props {
  value: string | null | undefined
  /** ISO quando a data é válida; "" quando vazio, incompleto ou inexistente. */
  onChange: (iso: string) => void
  className?: string
  disabled?: boolean
  id?: string
  placeholder?: string
  /** ISO — datas antes/depois disso são inválidas. */
  min?: string | null
  max?: string | null
  "aria-label"?: string
  required?: boolean
  autoFocus?: boolean
}

function CampoBase({ comHora, value, onChange, className = "", disabled, id, placeholder, min, max, required, autoFocus, ...resto }: Props & { comHora: boolean }) {
  const paraTexto = comHora ? isoHoraParaBr : isoParaBr
  const paraIso = comHora ? brHoraParaIso : brParaIso
  const [texto, setTexto] = useState(() => paraTexto(value))
  const [tocou, setTocou] = useState(false)

  // O pai mudou o valor (carregou, limpou, outro registro): o texto acompanha — mas nunca pisa no que a pessoa está digitando (se o texto já vale
  // o mesmo valor, fica como está). Ajuste durante a renderização, sem efeito.
  const [anterior, setAnterior] = useState(value)
  if (value !== anterior) {
    setAnterior(value)
    if ((value ?? "") !== (paraIso(texto) ?? "")) setTexto(paraTexto(value))
  }

  const iso = paraIso(texto)
  const fora = iso != null && ((min && iso.slice(0, 10) < min.slice(0, 10)) || (max && iso.slice(0, 10) > max.slice(0, 10)))
  const motivo = motivoDaDataInvalida(texto, comHora) ?? (fora ? (min && iso!.slice(0, 10) < min.slice(0, 10) ? `Não pode ser antes de ${isoParaBr(min)}.` : `Não pode ser depois de ${isoParaBr(max)}.`) : null)
  const invalido = tocou && !!motivo

  return (
    <input
      type="text" inputMode="numeric" autoComplete="off" id={id} autoFocus={autoFocus} disabled={disabled} required={required}
      placeholder={placeholder ?? (comHora ? "dd/mm/aaaa hh:mm" : "dd/mm/aaaa")} maxLength={comHora ? 16 : 10}
      value={texto} aria-invalid={invalido || undefined} title={invalido ? motivo ?? undefined : undefined}
      aria-label={resto["aria-label"]}
      className={`${className}${invalido ? " border-[var(--danger)]" : ""}`}
      onChange={(e) => {
        const t = mascararData(e.target.value, comHora)
        setTexto(t)
        const v = paraIso(t)
        const valido = v != null && !(min && v.slice(0, 10) < min.slice(0, 10)) && !(max && v.slice(0, 10) > max.slice(0, 10))
        onChange(t === "" ? "" : valido ? v : "")
      }}
      onBlur={() => setTocou(true)}
    />
  )
}

export function CampoDataTexto(props: Props) { return <CampoBase {...props} comHora={false} /> }
export function CampoDataHoraTexto(props: Props) { return <CampoBase {...props} comHora /> }
