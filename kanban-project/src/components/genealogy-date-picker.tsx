"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { CalendarIcon } from "lucide-react"
import { cn } from "@/lib/utils"

interface GenealogyDatePickerProps {
  value?: Date
  onChange: (date: Date | undefined) => void
  placeholder?: string
  className?: string
}

const months = [
  { value: "1", label: "Janeiro" },
  { value: "2", label: "Fevereiro" },
  { value: "3", label: "Março" },
  { value: "4", label: "Abril" },
  { value: "5", label: "Maio" },
  { value: "6", label: "Junho" },
  { value: "7", label: "Julho" },
  { value: "8", label: "Agosto" },
  { value: "9", label: "Setembro" },
  { value: "10", label: "Outubro" },
  { value: "11", label: "Novembro" },
  { value: "12", label: "Dezembro" },
]

export function GenealogyDatePicker({
  value,
  onChange,
  placeholder = "Selecione a data",
  className,
}: GenealogyDatePickerProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [year, setYear] = useState(value?.getFullYear()?.toString() || "")
  const [month, setMonth] = useState(value ? (value.getMonth() + 1).toString() : "")
  const [day, setDay] = useState(value?.getDate()?.toString() || "")

  const currentYear = new Date().getFullYear()
  const minYear = 1800

  // Generate array of years from current year back to 1800
  const years = Array.from({ length: currentYear - minYear + 1 }, (_, i) => currentYear - i)

  // Generate days based on selected month and year
  const getDaysInMonth = (month: number, year: number) => {
    return new Date(year, month, 0).getDate()
  }

  const days =
    year && month
      ? Array.from({ length: getDaysInMonth(Number.parseInt(month), Number.parseInt(year)) }, (_, i) => i + 1)
      : Array.from({ length: 31 }, (_, i) => i + 1)

  const formatDate = (date: Date) => {
    return date.toLocaleDateString("pt-BR")
  }

  const handleApply = () => {
    if (year) {
      const selectedYear = Number.parseInt(year)
      const selectedMonth = month ? Number.parseInt(month) - 1 : 0
      const selectedDay = day ? Number.parseInt(day) : 1

      const newDate = new Date(selectedYear, selectedMonth, selectedDay)
      onChange(newDate)
    } else {
      onChange(undefined)
    }
    setIsOpen(false)
  }

  const handleClear = () => {
    setYear("")
    setMonth("")
    setDay("")
    onChange(undefined)
    setIsOpen(false)
  }

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          className={cn("w-full justify-start text-left font-normal", !value && "text-muted-foreground", className)}
        >
          {value ? formatDate(value) : placeholder}
          <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-4" align="start" side="bottom" sideOffset={4}>
        <div className="space-y-4">
          <div className="text-sm font-medium text-[#123C73]">Selecionar Data</div>

          <div className="grid grid-cols-3 gap-2 min-w-[280px]">
            <div>
              <label className="text-xs text-[#9AA0A6] mb-1 block">Ano *</label>
              <Select value={year} onValueChange={setYear}>
                <SelectTrigger className="h-9">
                  <SelectValue placeholder="Ano" />
                </SelectTrigger>
                <SelectContent className="max-h-[200px]">
                  {years.map((y) => (
                    <SelectItem key={y} value={y.toString()}>
                      {y}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <label className="text-xs text-[#9AA0A6] mb-1 block">Mês</label>
              <Select value={month} onValueChange={setMonth} disabled={!year}>
                <SelectTrigger className="h-9">
                  <SelectValue placeholder="Mês" />
                </SelectTrigger>
                <SelectContent>
                  {months.map((m) => (
                    <SelectItem key={m.value} value={m.value}>
                      {m.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <label className="text-xs text-[#9AA0A6] mb-1 block">Dia</label>
              <Select value={day} onValueChange={setDay} disabled={!year || !month}>
                <SelectTrigger className="h-9">
                  <SelectValue placeholder="Dia" />
                </SelectTrigger>
                <SelectContent className="max-h-[200px]">
                  {days.map((d) => (
                    <SelectItem key={d} value={d.toString()}>
                      {d}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="text-xs text-[#9AA0A6]">
            * Apenas o ano é obrigatório. Deixe mês e dia em branco se não souber.
          </div>

          <div className="flex justify-between gap-2">
            <Button variant="outline" size="sm" onClick={handleClear}>
              Limpar
            </Button>
            <Button
              size="sm"
              onClick={handleApply}
              className="bg-[#123C73] hover:bg-[#0f2d5a] text-white"
              disabled={!year}
            >
              Aplicar
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}
