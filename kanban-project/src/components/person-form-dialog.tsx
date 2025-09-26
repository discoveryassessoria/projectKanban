"use client"

import React from "react"

import { useState } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import * as z from "zod"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { GenealogyDatePicker } from "@/src/components/genealogy-date-picker"
import { Loader2 } from "lucide-react"
import type { Pessoa } from "@prisma/client"

const personSchema = z.object({
  nome: z.string().min(1, "Nome é obrigatório"),
  sobrenome: z.string().optional(),
  data_nasc: z.date().optional(),
  local_nasc: z.string().optional(),
  data_obito: z.date().optional(),
  batizado: z.string().optional(),
})

export type PersonFormData = z.infer<typeof personSchema>

interface PersonFormDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (data: PersonFormData) => Promise<void>
  person?: Pessoa
  title: string
  description: string
}

export function PersonFormDialog({ open, onOpenChange, onSubmit, person, title, description }: PersonFormDialogProps) {
  const [isSubmitting, setIsSubmitting] = useState(false)

  const form = useForm<PersonFormData>({
    resolver: zodResolver(personSchema),
    defaultValues: {
      nome: person?.nome || "",
      sobrenome: person?.sobrenome || "",
      data_nasc: person?.data_nasc ? new Date(person.data_nasc) : undefined,
      local_nasc: person?.local_nasc || "",
      data_obito: person?.data_obito ? new Date(person.data_obito) : undefined,
      batizado: person?.batizado || "",
    },
  })

  React.useEffect(() => {
    if (open) {
      form.reset({
        nome: person?.nome || "",
        sobrenome: person?.sobrenome || "",
        data_nasc: person?.data_nasc ? new Date(person.data_nasc) : undefined,
        local_nasc: person?.local_nasc || "",
        data_obito: person?.data_obito ? new Date(person.data_obito) : undefined,
        batizado: person?.batizado || "",
      })
    }
  }, [open, person, form])

  const handleSubmit = async (data: PersonFormData) => {
    setIsSubmitting(true)
    try {
      await onSubmit(data)
      form.reset()
      onOpenChange(false)
    } catch (error) {
      console.error("Erro ao salvar pessoa:", error)
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-[#123C73]">{title}</DialogTitle>
          <DialogDescription className="text-[#9AA0A6]">{description}</DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
            <div className="space-y-4">
              <FormField
                control={form.control}
                name="nome"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Nome *</FormLabel>
                    <FormControl>
                      <Input placeholder="Digite o nome" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="sobrenome"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Sobrenome</FormLabel>
                    <FormControl>
                      <Input placeholder="Digite o sobrenome" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="data_nasc"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Data de Nascimento</FormLabel>
                    <FormControl>
                      <GenealogyDatePicker
                        value={field.value}
                        onChange={field.onChange}
                        placeholder="Selecione a data de nascimento"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="local_nasc"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Local de Nascimento</FormLabel>
                    <FormControl>
                      <Input placeholder="Cidade, Estado" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="data_obito"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Data de Falecimento</FormLabel>
                    <FormControl>
                      <GenealogyDatePicker value={field.value} onChange={field.onChange} placeholder="Ainda vivo" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="batizado"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Status de Batismo</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Selecione" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="Sim">Batizado</SelectItem>
                        <SelectItem value="Não">Não Batizado</SelectItem>
                        <SelectItem value="Desconhecido">Desconhecido</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
                Cancelar
              </Button>
              <Button type="submit" className="bg-[#123C73] hover:bg-[#0f2d5a] text-white" disabled={isSubmitting}>
                {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {person ? "Atualizar" : "Adicionar"} Pessoa
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
