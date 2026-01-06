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
import { Building2, User, MapPin, Phone, CreditCard } from "lucide-react"
import { applyCPFMask, applyRGMask, applyTelefoneMask, removeMask, removeTelefoneMask } from "@/src/utils/masks"

interface Contratante {
  id: number
  nome: string
  cpf?: string | null
  rg?: string | null
  endereco?: string | null
  telefone?: string | null
}

interface ContratanteModalProps {
  contratante: Contratante | null
  isOpen: boolean
  onClose: () => void
  onSave?: (contratante: Omit<Contratante, 'id'>) => void
  mode: 'view' | 'create' | 'edit'
}

export function ContratanteModal({ 
  contratante, 
  isOpen, 
  onClose, 
  onSave,
  mode 
}: ContratanteModalProps) {
  const [formData, setFormData] = useState({
    nome: contratante?.nome || '',
    cpf: contratante?.cpf ? (mode === 'view' ? contratante.cpf : applyCPFMask(contratante.cpf)) : '',
    rg: contratante?.rg ? (mode === 'view' ? contratante.rg : applyRGMask(contratante.rg)) : '',
    endereco: contratante?.endereco || '',
    telefone: contratante?.telefone ? (mode === 'view' ? contratante.telefone : applyTelefoneMask(contratante.telefone)) : '',
  })

  // Sincronizar formData quando contratante ou mode mudam
  useEffect(() => {
    if (isOpen) {
      setFormData({
        nome: contratante?.nome || '',
        cpf: contratante?.cpf ? (mode === 'view' ? contratante.cpf : applyCPFMask(contratante.cpf)) : '',
        rg: contratante?.rg ? (mode === 'view' ? contratante.rg : applyRGMask(contratante.rg)) : '',
        endereco: contratante?.endereco || '',
        telefone: contratante?.telefone ? (mode === 'view' ? contratante.telefone : applyTelefoneMask(contratante.telefone)) : '',
      })
    }
  }, [contratante, mode, isOpen])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (onSave && formData.nome.trim()) {
      onSave({
        nome: formData.nome.trim(),
        cpf: formData.cpf ? removeMask(formData.cpf) : null,
        rg: formData.rg ? removeMask(formData.rg) : null,
        endereco: formData.endereco.trim() || null,
        telefone: formData.telefone ? removeTelefoneMask(formData.telefone) : null,
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
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <Building2 className="h-5 w-5 text-blue-600" />
            <DialogTitle>
              {isCreateMode ? 'Novo Contratante' : 
               isViewMode ? 'Informações do Contratante' : 'Editar Contratante'}
            </DialogTitle>
          </div>
          <DialogDescription>
            {isCreateMode ? 'Cadastre um novo contratante para o sistema.' :
             isViewMode ? 'Visualize as informações do contratante.' : 
             'Edite as informações do contratante.'}
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
              placeholder="Digite o nome do contratante"
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
              placeholder="(00) 00000-0000 ou +XX..."
              readOnly={isViewMode}
              maxLength={20}
            />
          </div>

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