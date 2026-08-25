"use client"

import * as React from "react"
import { CalendarIcon, ChevronLeft, ChevronRight } from "lucide-react"
import { format, getDaysInMonth, startOfMonth, getDay } from "date-fns"

import { Input } from "@/components/ui/input"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"

interface DatePickerFieldProps {
  value?: Date | string
  onChange?: (value: string) => void
  placeholder?: string
  className?: string
  disabled?: boolean
  fromYear?: number
  toYear?: number
}

const MESES = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"
]

const DIAS_SEMANA = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"]

// ✅ CORREÇÃO: Aceitar anos desde 1500
function parseDate(dateStr: string, minYear: number = 1500, maxYear: number = 2100): Date | null {
  if (dateStr.length !== 10) return null
  
  const parts = dateStr.split("/")
  if (parts.length !== 3) return null
  
  const day = parseInt(parts[0], 10)
  const month = parseInt(parts[1], 10) - 1
  const year = parseInt(parts[2], 10)
  
  if (isNaN(day) || isNaN(month) || isNaN(year)) return null
  if (day < 1 || day > 31) return null
  if (month < 0 || month > 11) return null
  if (year < minYear || year > maxYear) return null
  
  const date = new Date(year, month, day)
  
  if (date.getDate() !== day || date.getMonth() !== month || date.getFullYear() !== year) {
    return null
  }
  
  return date
}

interface CalendarDay {
  day: number
  isCurrentMonth: boolean
  month: number
  year: number
}

export function DatePickerField({ 
  value, 
  onChange, 
  placeholder = "dd/mm/aaaa",
  className,
  disabled = false,
  fromYear = 1500,  // ✅ CORREÇÃO: Padrão agora é 1500
  toYear = new Date().getFullYear(),
}: DatePickerFieldProps) {
  const [open, setOpen] = React.useState(false)
  const dateValue = React.useMemo(() => {
    if (!value) return undefined
    if (value instanceof Date) return value
    const parsed = new Date(value + 'T00:00:00')
    return isNaN(parsed.getTime()) ? undefined : parsed
  }, [value])

  // O texto do campo e o mês/ano do calendário são RASCUNHOS sobre o valor que veio
  // de fora. Antes um efeito reescrevia os três estados a cada mudança de `value`;
  // era o padrão "prop copiada para estado", com o defeito clássico: por um render
  // a tela mostrava o texto antigo com o valor novo.
  //
  // Aqui o rascunho carrega a BASE em que ele foi digitado. Enquanto a base é a
  // atual, vale o que o usuário fez; quando `value` muda, a base deixa de casar e o
  // rascunho é descartado por construção — sem efeito e sem render intermediário.
  const textoDoValor = dateValue ? format(dateValue, "dd/MM/yyyy") : ""
  const [rascunhoTexto, setRascunhoTexto] = React.useState<{ base: string; texto: string } | null>(null)
  const [rascunhoVista, setRascunhoVista] = React.useState<{ base: string; mes: number; ano: number } | null>(null)

  const inputValue = rascunhoTexto?.base === textoDoValor ? rascunhoTexto.texto : textoDoValor
  const hoje = new Date()
  const vistaDoValor = { mes: dateValue?.getMonth() ?? hoje.getMonth(), ano: dateValue?.getFullYear() ?? hoje.getFullYear() }
  const vistaAtual = rascunhoVista?.base === textoDoValor
    ? { mes: rascunhoVista.mes, ano: rascunhoVista.ano }
    : vistaDoValor
  const viewMonth = vistaAtual.mes
  const viewYear = vistaAtual.ano

  // Mês e ano viraram UM estado, então os dois setters têm de COMPOR: "mês anterior"
  // chama `setViewMonth(11)` e `setViewYear(ano - 1)` no mesmo handler, e a segunda
  // chamada não pode reintroduzir o mês do render anterior. Por isso a atualização é
  // funcional — ela lê o valor já atualizado pela primeira.
  const aplicarVista = (mudar: (v: { mes: number; ano: number }) => { mes: number; ano: number }) =>
    setRascunhoVista((atual) => {
      const efetiva = atual?.base === textoDoValor ? { mes: atual.mes, ano: atual.ano } : vistaDoValor
      return { base: textoDoValor, ...mudar(efetiva) }
    })

  // Mesmos nomes de antes: os ~20 pontos que já chamavam estes setters continuam
  // valendo, e a mudança fica contida aqui.
  const setInputValue = (texto: string) => setRascunhoTexto({ base: textoDoValor, texto })
  const setViewMonth = (mes: number) => aplicarVista((v) => ({ ...v, mes }))
  const setViewYear = (ano: number) => aplicarVista((v) => ({ ...v, ano }))

  // ✅ CORREÇÃO: Gerar todos os anos disponíveis para permitir navegação completa
  const years = React.useMemo(() => {
    const arr = []
    for (let y = toYear; y >= fromYear; y--) {
      arr.push(y)
    }
    return arr
  }, [fromYear, toYear])

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    let val = e.target.value.replace(/\D/g, "")
    
    if (val.length >= 2) {
      val = val.slice(0, 2) + "/" + val.slice(2)
    }
    if (val.length >= 5) {
      val = val.slice(0, 5) + "/" + val.slice(5)
    }
    if (val.length > 10) {
      val = val.slice(0, 10)
    }
    
    setInputValue(val)
    
    if (val.length > 0 && !open) {
      setOpen(true)
    }
    
    if (val.length === 10) {
      const parsed = parseDate(val, fromYear, toYear)
      if (parsed) {
        const isoDate = format(parsed, "yyyy-MM-dd")
        onChange?.(isoDate)
        setViewMonth(parsed.getMonth())
        setViewYear(parsed.getFullYear())
      }
    }
    
    // ✅ CORREÇÃO: Permitir limpar a data quando o campo estiver vazio
    if (val.length === 0) {
      onChange?.("")
    }
    
    if (val.length >= 7) {
      const parts = val.split("/")
      if (parts.length >= 2) {
        const month = parseInt(parts[1], 10) - 1
        if (!isNaN(month) && month >= 0 && month <= 11) {
          setViewMonth(month)
        }
      }
      if (parts.length >= 3 && parts[2].length === 4) {
        const year = parseInt(parts[2], 10)
        if (!isNaN(year) && year >= fromYear && year <= toYear) {
          setViewYear(year)
        }
      }
    }
  }

  const handleInputBlur = () => {
    // ✅ CORREÇÃO: Permitir limpar a data quando o campo estiver vazio
    if (inputValue.length === 0) {
      onChange?.("")
      return
    }
    
    if (inputValue.length === 10) {
      const parsed = parseDate(inputValue, fromYear, toYear)
      if (parsed) {
        const isoDate = format(parsed, "yyyy-MM-dd")
        onChange?.(isoDate)
      } else {
        if (dateValue) {
          setInputValue(format(dateValue, "dd/MM/yyyy"))
        } else {
          setInputValue("")
          onChange?.("")
        }
      }
    } else if (inputValue.length > 0 && inputValue.length < 10) {
      if (dateValue) {
        setInputValue(format(dateValue, "dd/MM/yyyy"))
      } else {
        setInputValue("")
        onChange?.("")
      }
    }
  }

  const handleInputFocus = () => {
    setOpen(true)
  }

  const handleDateSelect = (calDay: CalendarDay) => {
    const newDate = new Date(calDay.year, calDay.month, calDay.day)
    const isoDate = format(newDate, "yyyy-MM-dd")
    onChange?.(isoDate)
    
    // Se clicou em dia de outro mês, atualiza a visualização
    if (!calDay.isCurrentMonth) {
      setViewMonth(calDay.month)
      setViewYear(calDay.year)
    }
    
    setOpen(false)
  }

  const handleMonthChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setViewMonth(parseInt(e.target.value))
  }

  const handleYearChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setViewYear(parseInt(e.target.value))
  }

  const handlePrevMonth = () => {
    if (viewMonth === 0) {
      setViewMonth(11)
      setViewYear(viewYear - 1)
    } else {
      setViewMonth(viewMonth - 1)
    }
  }

  const handleNextMonth = () => {
    if (viewMonth === 11) {
      setViewMonth(0)
      setViewYear(viewYear + 1)
    } else {
      setViewMonth(viewMonth + 1)
    }
  }

  // Generate calendar days including previous and next month days
  const calendarDays = React.useMemo(() => {
    const firstDay = startOfMonth(new Date(viewYear, viewMonth))
    const daysInMonth = getDaysInMonth(firstDay)
    const startWeekday = getDay(firstDay)
    
    // Previous month info
    const prevMonth = viewMonth === 0 ? 11 : viewMonth - 1
    const prevYear = viewMonth === 0 ? viewYear - 1 : viewYear
    const daysInPrevMonth = getDaysInMonth(new Date(prevYear, prevMonth))
    
    // Next month info
    const nextMonth = viewMonth === 11 ? 0 : viewMonth + 1
    const nextYear = viewMonth === 11 ? viewYear + 1 : viewYear
    
    const days: CalendarDay[] = []
    
    // Add days from previous month
    for (let i = startWeekday - 1; i >= 0; i--) {
      days.push({
        day: daysInPrevMonth - i,
        isCurrentMonth: false,
        month: prevMonth,
        year: prevYear
      })
    }
    
    // Add days of current month
    for (let d = 1; d <= daysInMonth; d++) {
      days.push({
        day: d,
        isCurrentMonth: true,
        month: viewMonth,
        year: viewYear
      })
    }
    
    // Add days from next month only to complete the last week
    const remainingDays = days.length % 7 === 0 ? 0 : 7 - (days.length % 7)
    for (let d = 1; d <= remainingDays; d++) {
      days.push({
        day: d,
        isCurrentMonth: false,
        month: nextMonth,
        year: nextYear
      })
    }
    
    return days
  }, [viewMonth, viewYear])

  const isSelectedDay = (calDay: CalendarDay) => {
    if (!dateValue) return false
    return (
      dateValue.getDate() === calDay.day &&
      dateValue.getMonth() === calDay.month &&
      dateValue.getFullYear() === calDay.year
    )
  }

  const isToday = (calDay: CalendarDay) => {
    const today = new Date()
    return (
      today.getDate() === calDay.day &&
      today.getMonth() === calDay.month &&
      today.getFullYear() === calDay.year
    )
  }

  return (
    <Popover open={open} onOpenChange={setOpen} modal={true}>
      <div className="relative">
        <Input
          value={inputValue}
          onChange={handleInputChange}
          onBlur={handleInputBlur}
          onFocus={handleInputFocus}
          placeholder={placeholder}
          disabled={disabled}
          className={`pr-10 h-[42px] rounded-lg text-sm ${className || "bg-[var(--surface-primary)] border-gray-300 text-[var(--text-primary)] placeholder:text-[var(--text-muted)] disabled:bg-[var(--surface-tertiary)]"}`}
        />
        <PopoverTrigger asChild>
          <button
            type="button"
            disabled={disabled}
            aria-label="Abrir calendário"
            className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            onClick={() => setOpen(true)}
          >
            <CalendarIcon className="h-4 w-4" />
          </button>
        </PopoverTrigger>
      </div>
      
      <PopoverContent 
        className="w-auto p-3" 
        align="start"
        side="top"
        sideOffset={4}
        style={{ zIndex: 99999 }}
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        {/* Header with month/year dropdowns */}
        <div className="flex items-center justify-between mb-3">
          <button
            type="button"
            onClick={handlePrevMonth}
            aria-label="Mês anterior"
            className="p-1.5 hover:bg-[var(--surface-tertiary)] rounded-md transition-colors text-[var(--text-secondary)] hover:text-[var(--text-secondary)]"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          
          <div className="flex items-center justify-center gap-1 flex-1">
            <select
              value={viewMonth}
              onChange={handleMonthChange}
              className="py-1.5 text-sm bg-transparent border-0 text-[var(--text-secondary)] font-normal focus:outline-none focus:ring-0 cursor-pointer hover:bg-[var(--surface-secondary)] rounded text-center w-24"
              style={{ textAlignLast: 'center' }}
            >
              {MESES.map((mes, idx) => (
                <option key={mes} value={idx}>{mes}</option>
              ))}
            </select>
            
            <select
              value={viewYear}
              onChange={handleYearChange}
              className="py-1.5 text-sm bg-transparent border-0 text-[var(--text-secondary)] font-normal focus:outline-none focus:ring-0 cursor-pointer hover:bg-[var(--surface-secondary)] rounded text-center w-20"
              style={{ textAlignLast: 'center' }}
            >
              {years.map(year => (
                <option key={year} value={year}>{year}</option>
              ))}
            </select>
          </div>
          
          <button
            type="button"
            onClick={handleNextMonth}
            aria-label="Mês seguinte"
            className="p-1.5 hover:bg-[var(--surface-tertiary)] rounded-md transition-colors text-[var(--text-secondary)] hover:text-[var(--text-secondary)]"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
        
        {/* Weekday headers */}
        <div className="grid grid-cols-7 mb-1">
          {DIAS_SEMANA.map(dia => (
            <div key={dia} className="text-center text-xs text-[var(--text-muted)] py-1 font-normal">
              {dia}
            </div>
          ))}
        </div>
        
        {/* Calendar days */}
        <div className="grid grid-cols-7 gap-0.5">
          {calendarDays.map((calDay, idx) => (
            <div key={idx} className="aspect-square p-0.5">
              <button
                type="button"
                onClick={() => handleDateSelect(calDay)}
                className={`
                  w-full h-full flex items-center justify-center text-sm rounded transition-colors
                  ${isSelectedDay(calDay) 
                    ? 'bg-[var(--action-primary)] text-white' 
                    : isToday(calDay)
                      ? 'bg-[var(--surface-tertiary)] text-[var(--text-primary)] font-medium'
                      : calDay.isCurrentMonth
                        ? 'text-[var(--text-secondary)] hover:bg-[var(--surface-tertiary)]'
                        : 'text-[var(--text-muted)] hover:bg-[var(--surface-secondary)]'
                  }
                `}
              >
                {calDay.day}
              </button>
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}