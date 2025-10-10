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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { GenealogyDatePicker } from "@/src/components/genealogy-date-picker"
import { Loader2 } from "lucide-react"
import type { Pessoa } from "@prisma/client"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import type { PessoaWithRelations } from "@/src/types/pessoa"

const personSchema = z.object({
  nome: z.string().min(1, "Nome é obrigatório"),
  sobrenome: z.string().optional(),
  sexo: z.string().optional(),
  data_nasc: z.date().optional(),
  local_nasc: z.string().optional(),
  data_obito: z.date().optional(),
  batizado: z.string().optional(),
})

const existingPersonSchema = z.object({
  id: z.number().min(1, "Selecione uma pessoa"),
})

export type PersonFormData = z.infer<typeof personSchema>
export type ExistingPersonFormData = z.infer<typeof existingPersonSchema>

interface PersonFormDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (data: PersonFormData | ExistingPersonFormData) => Promise<void>
  person?: Pessoa
  title: string
  description: string
  pessoas?: PessoaWithRelations[] // Updated to use PessoaWithRelations type
  fixedSexo?: "Masculino" | "Feminino"
  relationshipType?: "pai" | "mae" | "filho" | "conjuge"
  currentPersonId?: number // ID da pessoa atual para filtrar das opções
}

const checkIfDescendant = (
  personId: number,
  ancestorId: number | undefined,
  allPeople: PessoaWithRelations[],
): boolean => {
  if (!ancestorId) return false

  const person = allPeople.find((p) => p.id === personId)
  if (!person) return false

  // Se a pessoa tem como pai ou mãe o ancestorId, é descendente
  if (person.paiId === ancestorId || person.maeId === ancestorId) {
    return true
  }

  // Verificar recursivamente nos pais
  if (person.paiId && checkIfDescendant(person.paiId, ancestorId, allPeople)) {
    return true
  }
  if (person.maeId && checkIfDescendant(person.maeId, ancestorId, allPeople)) {
    return true
  }

  return false
}

export function PersonFormDialog({
  open,
  onOpenChange,
  onSubmit,
  person,
  title,
  description,
  pessoas = [],
  fixedSexo,
  relationshipType,
  currentPersonId,
}: PersonFormDialogProps) {
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [activeTab, setActiveTab] = useState<string>("new")
  const [selectedPersonId, setSelectedPersonId] = useState<string>("")

  const newPersonForm = useForm<PersonFormData>({
    resolver: zodResolver(personSchema),
    defaultValues: {
      nome: person?.nome || "", 
      sobrenome: person?.sobrenome || "", 
      sexo: fixedSexo || person?.sexo || undefined,
      data_nasc: person?.data_nasc ? new Date(person.data_nasc) : undefined,
      local_nasc: person?.local_nasc || "", 
      data_obito: person?.data_obito ? new Date(person.data_obito) : undefined,
      batizado: person?.batizado || undefined,
    },
  })

  const existingPersonForm = useForm<ExistingPersonFormData>({
    resolver: zodResolver(existingPersonSchema),
    defaultValues: {
      id: undefined,
    },
  })

  React.useEffect(() => {
    if (open) {
      setActiveTab("new")
      setSelectedPersonId("")
      newPersonForm.reset({
        nome: person?.nome || "",
        sobrenome: person?.sobrenome || "",
        sexo: fixedSexo || person?.sexo || undefined,
        data_nasc: person?.data_nasc ? new Date(person.data_nasc) : undefined,
        local_nasc: person?.local_nasc || "",
        data_obito: person?.data_obito ? new Date(person.data_obito) : undefined,
        batizado: person?.batizado || undefined,
      })
      existingPersonForm.reset({ id: undefined })
      if (fixedSexo) {
        newPersonForm.setValue("sexo", fixedSexo)
      }
    }
  }, [open, person, fixedSexo, newPersonForm, existingPersonForm])

  const handleNewPersonSubmit = async (data: PersonFormData) => {
    setIsSubmitting(true)
    try {
      await onSubmit(data)
      onOpenChange(false)
    } catch (error) {
      console.error("Erro ao salvar nova pessoa:", error)
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleExistingPersonSubmit = async (data: ExistingPersonFormData) => {
    setIsSubmitting(true)
    try {
      await onSubmit(data)
      onOpenChange(false)
    } catch (error) {
      console.error("Erro ao selecionar pessoa existente:", error)
    } finally {
      setIsSubmitting(false)
    }
  }

  const availablePessoas = pessoas.filter((p: PessoaWithRelations) => {
    // Não mostrar a própria pessoa atual
    if (currentPersonId && p.id === currentPersonId) {
      return false
    }

    // Filtros específicos por tipo de relacionamento
    if (relationshipType === "conjuge") {
      // Para cônjuge, não filtrar por sexo - permitir qualquer sexo
      // Verificar se já tem união com a pessoa atual
      const jaTemUniao =
        p.unioesComoPessoa1?.some((u) => u.pessoa2Id === currentPersonId) ||
        p.unioesComoPessoa2?.some((u) => u.pessoa1Id === currentPersonId)
      if (jaTemUniao) {
        return false
      }
    } else {
      // Para outros relacionamentos (pai/mae), filtrar por sexo se especificado
      if (fixedSexo && p.sexo !== fixedSexo) {
        return false
      }
    }

    if (relationshipType === "pai" || relationshipType === "mae") {
      // Para pais, verificar se a pessoa não é descendente da pessoa atual
      // (evitar loops genealógicos)
      const isDescendant = checkIfDescendant(p.id, currentPersonId, pessoas)
      if (isDescendant) {
        return false
      }
    }

    return true
  })

  const canUseExistingPerson =
    availablePessoas.length > 0 &&
    (relationshipType === "pai" ||
      relationshipType === "mae" ||
      relationshipType === "conjuge" ||
      title.toLowerCase().includes("pai") ||
      title.toLowerCase().includes("mãe") ||
      title.toLowerCase().includes("cônjuge"))

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-[#123C73]">{title}</DialogTitle>
          <DialogDescription className="text-[#9AA0A6]">{description}</DialogDescription>
        </DialogHeader>

        {canUseExistingPerson ? (
          <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="new">Nova Pessoa</TabsTrigger>
              <TabsTrigger value="existing">Pessoa Existente</TabsTrigger>
            </TabsList>
            
            <TabsContent value="new" className="space-y-4 mt-4">
              <Form {...newPersonForm}>
                <form onSubmit={newPersonForm.handleSubmit(handleNewPersonSubmit)} className="space-y-4">
                  <FormField
                    control={newPersonForm.control}
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
                    control={newPersonForm.control}
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

                  {!fixedSexo && (
                    <FormField
                      control={newPersonForm.control}
                      name="sexo"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Sexo</FormLabel>
                          <Select onValueChange={field.onChange} value={field.value || undefined}>
                            <FormControl>
                              <SelectTrigger>
                                <SelectValue placeholder="Selecione o sexo" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              <SelectItem value="Masculino">Masculino</SelectItem>
                              <SelectItem value="Feminino">Feminino</SelectItem>
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  )}

                  {fixedSexo && (
                    <div>
                      <Label>Sexo</Label>
                      <div className="text-sm text-gray-600 bg-gray-50 p-2 rounded border">
                        {fixedSexo}
                      </div>
                    </div>
                  )}

                  <FormField
                    control={newPersonForm.control}
                    name="data_nasc"
                    render={({ field }) => (
                      <FormItem className="flex flex-col">
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
                    control={newPersonForm.control}
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
                    control={newPersonForm.control}
                    name="data_obito"
                    render={({ field }) => (
                      <FormItem className="flex flex-col">
                        <FormLabel>Data de Falecimento</FormLabel>
                        <FormControl>
                          <GenealogyDatePicker
                            value={field.value}
                            onChange={field.onChange}
                            placeholder="Ainda vivo"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={newPersonForm.control}
                    name="batizado"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Status de Batismo</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value || undefined}>
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder="Selecione" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="Sim">Batizado</SelectItem>
                            <SelectItem value="Não">Não batizado</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <DialogFooter>
                    <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
                      Cancelar
                    </Button>
                    <Button
                      type="submit"
                      className="bg-[#123C73] hover:bg-[#0f2d5a] text-white"
                      disabled={isSubmitting}
                    >
                      {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                      {person ? "Atualizar" : "Adicionar"} Pessoa
                    </Button>
                  </DialogFooter>
                </form>
              </Form>
            </TabsContent>

            <TabsContent value="existing" className="space-y-4 mt-4">
              <Form {...existingPersonForm}>
                <form onSubmit={existingPersonForm.handleSubmit(handleExistingPersonSubmit)} className="space-y-4">
                  <div className="space-y-4 p-4 bg-blue-50 rounded-lg border border-blue-200">
                    <FormField
                      control={existingPersonForm.control}
                      name="id"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-blue-700 font-semibold">Selecione a Pessoa</FormLabel>
                          <Select
                            onValueChange={(value) => {
                              field.onChange(Number.parseInt(value, 10))
                              setSelectedPersonId(value)
                            }}
                            value={selectedPersonId}
                          >
                            <FormControl>
                              <SelectTrigger className="border-blue-300 focus:border-blue-500 bg-white">
                                <SelectValue placeholder="Selecione uma pessoa da árvore" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent className="max-h-60">
                              {availablePessoas.map((p) => (
                                <SelectItem key={p.id} value={p.id.toString()}>
                                  <div className="flex items-center gap-2 py-1">
                                    <span className="font-medium">
                                      {p.nome} {p.sobrenome || ""}
                                    </span>
                                    {p.sexo && (
                                      <span
                                        className={`text-xs px-2 py-1 rounded-full ${
                                          p.sexo === "Masculino" ? "bg-blue-100 text-blue-700" : "bg-pink-100 text-pink-700"
                                        }`}
                                      >
                                        {p.sexo}
                                      </span>
                                    )}
                                    {p.data_nasc && (
                                      <span className="text-xs text-gray-500 bg-gray-100 px-2 py-1 rounded">
                                        {new Date(p.data_nasc).getFullYear()}
                                      </span>
                                    )}
                                  </div>
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          {availablePessoas.length === 0 && (
                            <div className="flex items-center gap-2 p-3 bg-yellow-50 border border-yellow-200 rounded-md">
                              <span className="text-sm text-yellow-700">
                                ⚠️ Nenhuma pessoa disponível para este relacionamento.
                              </span>
                            </div>
                          )}
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>

                  <DialogFooter>
                    <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
                      Cancelar
                    </Button>
                    <Button
                      type="submit"
                      className="bg-[#123C73] hover:bg-[#0f2d5a] text-white"
                      disabled={isSubmitting}
                    >
                      {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                      Selecionar Pessoa
                    </Button>
                  </DialogFooter>
                </form>
              </Form>
            </TabsContent>
          </Tabs>
        ) : (
          <Form {...newPersonForm}>
            <form onSubmit={newPersonForm.handleSubmit(handleNewPersonSubmit)} className="space-y-4">
              <FormField
                control={newPersonForm.control}
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
                control={newPersonForm.control}
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
                control={newPersonForm.control}
                name="sexo"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Sexo</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value || undefined} disabled={!!fixedSexo || isSubmitting}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Selecione o sexo" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="Masculino">Masculino</SelectItem>
                        <SelectItem value="Feminino">Feminino</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={newPersonForm.control}
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
                control={newPersonForm.control}
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
                control={newPersonForm.control}
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
                control={newPersonForm.control}
                name="batizado"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Status de Batismo</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value || undefined}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Selecione" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="Sim">Batizado</SelectItem>
                        <SelectItem value="Não">Não Batizado</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
                  Cancelar
                </Button>
                <Button
                  type="submit"
                  className="bg-[#123C73] hover:bg-[#0f2d5a] text-white"
                  disabled={isSubmitting}
                >
                  {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  {person ? "Atualizar" : "Adicionar"} Pessoa
                </Button>
              </DialogFooter>
            </form>
          </Form>
        )}
      </DialogContent>
    </Dialog>
  )
}
