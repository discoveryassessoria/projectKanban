"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { User, MapPin, Phone, CreditCard } from "lucide-react"
import { applyCPFMask, applyRGMask, applyTelefoneMask, removeMask } from "@/src/utils/masks"
import { CamposPersonalizadosEditor } from "./campos-personalizados-editor"
import { CampoPersonalizado, CamposPersonalizados } from "@/src/types/campoPersonalizado"
import { Separator } from "@/components/ui/separator"

interface Requerente {
  id: number
  nome: string
  cpf?: string | null
  rg?: string | null
  endereco?: string | null
  telefone?: string | null
  campos_personalizados?: any
}

interface RequerenteModalProps {
  requerente: Requerente | null
  isOpen: boolean
  onClose: () => void
  onSave?: (requerente: Omit<Requerente, 'id'>) => void
  mode: 'view' | 'create' | 'edit'
}

export function RequerenteModal({ 
  requerente, 
  isOpen, 
  onClose, 
  onSave,
  mode 
}: RequerenteModalProps) {
  const [formData, setFormData] = useState({
    nome: requerente?.nome || '',
    cpf: requerente?.cpf ? (mode === 'view' ? requerente.cpf : applyCPFMask(requerente.cpf)) : '',
    rg: requerente?.rg ? (mode === 'view' ? requerente.rg : applyRGMask(requerente.rg)) : '',
    endereco: requerente?.endereco || '',
    telefone: requerente?.telefone ? (mode === 'view' ? requerente.telefone : applyTelefoneMask(requerente.telefone)) : '',
  })

  const [camposPersonalizados, setCamposPersonalizados] = useState<CampoPersonalizado[]>([])

  // Atualizar campos personalizados quando o requerente, mode ou isOpen mudarem
  useEffect(() => {
    if (isOpen) {
      if (requerente?.campos_personalizados && (mode === 'view' || mode === 'edit')) {
        try {
          const dados = typeof requerente.campos_personalizados === 'string' 
            ? JSON.parse(requerente.campos_personalizados)
            : requerente.campos_personalizados
          
          if (dados?.campos && Array.isArray(dados.campos)) {
            setCamposPersonalizados(dados.campos)
          } else {
            setCamposPersonalizados([])
          }
        } catch (error) {
          console.error('Erro ao parsear campos personalizados:', error)
          setCamposPersonalizados([])
        }
      } else {
        // Resetar campos personalizados para modo de criação ou se não houver dados
        setCamposPersonalizados([])
      }
    }
  }, [requerente, mode, isOpen])

  // Atualizar formData quando requerente, mode ou isOpen mudarem
  useEffect(() => {
    if (isOpen) {
      if (requerente && (mode === 'view' || mode === 'edit')) {
        setFormData({
          nome: requerente.nome || '',
          cpf: requerente.cpf ? (mode === 'view' ? requerente.cpf : applyCPFMask(requerente.cpf)) : '',
          rg: requerente.rg ? (mode === 'view' ? requerente.rg : applyRGMask(requerente.rg)) : '',
          endereco: requerente.endereco || '',
          telefone: requerente.telefone ? (mode === 'view' ? requerente.telefone : applyTelefoneMask(requerente.telefone)) : '',
        })
      } else if (mode === 'create') {
        // Resetar formulário para modo de criação
        setFormData({
          nome: '',
          cpf: '',
          rg: '',
          endereco: '',
          telefone: '',
        })
      }
    }
  }, [requerente, mode, isOpen])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (onSave && formData.nome.trim()) {
      const campos_personalizados: CamposPersonalizados | undefined = 
        camposPersonalizados.length > 0 
          ? { campos: camposPersonalizados }
          : undefined

      onSave({
        nome: formData.nome.trim(),
        cpf: formData.cpf ? removeMask(formData.cpf) : null,
        rg: formData.rg ? removeMask(formData.rg) : null,
        endereco: formData.endereco.trim() || null,
        telefone: formData.telefone ? removeMask(formData.telefone) : null,
        campos_personalizados,
      })
      onClose()
    }
  }

  const handleClose = () => {
    setFormData({
      nome: '',
      cpf: '',
      rg: '',
      endereco: '',
      telefone: '',
    })
    setCamposPersonalizados([])
    onClose()
  }

  const handleCPFChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const masked = applyCPFMask(e.target.value)
    setFormData(prev => ({ ...prev, cpf: masked }))
  }

  const handleRGChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const masked = applyRGMask(e.target.value)
    setFormData(prev => ({ ...prev, rg: masked }))
  }

  const handleTelefoneChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const masked = applyTelefoneMask(e.target.value)
    setFormData(prev => ({ ...prev, telefone: masked }))
  }

  const isViewMode = mode === 'view'
  const isCreateMode = mode === 'create'

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[550px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <User className="h-5 w-5 text-green-600" />
            <DialogTitle>
              {isCreateMode ? 'Novo Requerente' : 
               isViewMode ? 'Informações do Requerente' : 'Editar Requerente'}
            </DialogTitle>
          </div>
          <DialogDescription>
            {isCreateMode ? 'Cadastre um novo requerente para o sistema.' :
             isViewMode ? 'Visualize as informações do requerente.' : 
             'Edite as informações do requerente.'}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="nome" className="flex items-center gap-2">
              <User className="h-4 w-4" />
              Nome *
            </Label>
            <Input
              id="nome"
              value={formData.nome}
              onChange={(e) => setFormData(prev => ({ ...prev, nome: e.target.value }))}
              placeholder="Digite o nome do requerente"
              required
              readOnly={isViewMode}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="cpf" className="flex items-center gap-2">
                <CreditCard className="h-4 w-4" />
                CPF
              </Label>
              <Input
                id="cpf"
                value={isViewMode ? applyCPFMask(formData.cpf) : formData.cpf}
                onChange={handleCPFChange}
                placeholder="000.000.000-00"
                readOnly={isViewMode}
                maxLength={14}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="rg">RG</Label>
              <Input
                id="rg"
                value={isViewMode ? applyRGMask(formData.rg) : formData.rg}
                onChange={handleRGChange}
                placeholder="00.000.000-0"
                readOnly={isViewMode}
                maxLength={12}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="endereco" className="flex items-center gap-2">
              <MapPin className="h-4 w-4" />
              Endereço
            </Label>
            <Input
              id="endereco"
              value={formData.endereco}
              onChange={(e) => setFormData(prev => ({ ...prev, endereco: e.target.value }))}
              placeholder="Digite o endereço completo"
              readOnly={isViewMode}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="telefone" className="flex items-center gap-2">
              <Phone className="h-4 w-4" />
              Telefone
            </Label>
            <Input
              id="telefone"
              value={isViewMode ? applyTelefoneMask(formData.telefone) : formData.telefone}
              onChange={handleTelefoneChange}
              placeholder="(00) 00000-0000"
              readOnly={isViewMode}
              maxLength={15}
            />
          </div>

          <Separator className="my-4" />

          <CamposPersonalizadosEditor
            campos={camposPersonalizados}
            onChange={setCamposPersonalizados}
            disabled={isViewMode}
          />

          <DialogFooter>
            <Button type="button" variant="outline" onClick={handleClose}>
              {isViewMode ? 'Fechar' : 'Cancelar'}
            </Button>
            {!isViewMode && (
              <Button type="submit" disabled={!formData.nome.trim()}>
                {isCreateMode ? 'Cadastrar' : 'Salvar'}
              </Button>
            )}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}