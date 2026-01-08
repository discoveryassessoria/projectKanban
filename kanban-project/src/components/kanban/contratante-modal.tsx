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
import { Building2, User, MapPin, Phone, CreditCard, AlertTriangle } from "lucide-react"
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
  onSave?: (contratante: Omit<Contratante, 'id'>) => Promise<{ success: boolean; error?: string; campo?: string }>
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
  
  const [errors, setErrors] = useState<{ nome?: string; cpf?: string; geral?: string }>({})
  const [isSubmitting, setIsSubmitting] = useState(false)

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
      setErrors({})
    }
  }, [contratante, mode, isOpen])

  // Limpar erro do campo quando usuário digita
  const clearFieldError = (field: 'nome' | 'cpf') => {
    if (errors[field]) {
      setErrors(prev => ({ ...prev, [field]: undefined }))
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setErrors({})

    // Validação local
    const newErrors: typeof errors = {}
    
    if (!formData.nome.trim()) {
      newErrors.nome = "Nome é obrigatório"
    }
    
    if (!formData.cpf.trim()) {
      newErrors.cpf = "CPF é obrigatório"
    } else if (removeMask(formData.cpf).length !== 11) {
      newErrors.cpf = "CPF deve ter 11 dígitos"
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors)
      return
    }

    if (onSave) {
      setIsSubmitting(true)
      try {
        const result = await onSave({
          nome: formData.nome.trim(),
          cpf: formData.cpf ? removeMask(formData.cpf) : null,
          rg: formData.rg ? removeMask(formData.rg) : null,
          endereco: formData.endereco.trim() || null,
          telefone: formData.telefone ? removeTelefoneMask(formData.telefone) : null,
        })

        if (result.success) {
          onClose()
        } else if (result.error) {
          // Erro retornado pela API (duplicidade)
          if (result.campo === 'nome') {
            setErrors({ nome: result.error })
          } else if (result.campo === 'cpf') {
            setErrors({ cpf: result.error })
          } else {
            setErrors({ geral: result.error })
          }
        }
      } catch (error) {
        setErrors({ geral: "Erro ao salvar. Tente novamente." })
      } finally {
        setIsSubmitting(false)
      }
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
    setErrors({})
    onClose()
  }

  const handleCPFChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const masked = applyCPFMask(e.target.value)
    setFormData(prev => ({ ...prev, cpf: masked }))
    clearFieldError('cpf')
  }

  const handleRGChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const masked = applyRGMask(e.target.value)
    setFormData(prev => ({ ...prev, rg: masked }))
  }

  const handleTelefoneChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const masked = applyTelefoneMask(e.target.value)
    setFormData(prev => ({ ...prev, telefone: masked }))
  }

  const handleNomeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData(prev => ({ ...prev, nome: e.target.value }))
    clearFieldError('nome')
  }

  const isViewMode = mode === 'view'
  const isCreateMode = mode === 'create'

  // Validação para habilitar botão
  const isFormValid = formData.nome.trim() && formData.cpf.trim() && removeMask(formData.cpf).length === 11

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

        {/* Erro geral */}
        {errors.geral && (
          <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
            <AlertTriangle className="h-4 w-4 flex-shrink-0" />
            <span>{errors.geral}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="nome" className="flex items-center gap-2">
              <User className="h-4 w-4" />
              Nome Completo <span className="text-red-500">*</span>
            </Label>
            <Input
              id="nome"
              value={formData.nome}
              onChange={handleNomeChange}
              placeholder="Digite o nome completo"
              required
              readOnly={isViewMode}
              className={errors.nome ? "border-red-500 focus-visible:ring-red-500" : ""}
            />
            {errors.nome && (
              <p className="text-sm text-red-500 flex items-center gap-1">
                <AlertTriangle className="h-3 w-3" />
                {errors.nome}
              </p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="cpf" className="flex items-center gap-2">
                <CreditCard className="h-4 w-4" />
                CPF <span className="text-red-500">*</span>
              </Label>
              <Input
                id="cpf"
                value={isViewMode ? applyCPFMask(formData.cpf) : formData.cpf}
                onChange={handleCPFChange}
                placeholder="000.000.000-00"
                required
                readOnly={isViewMode}
                maxLength={14}
                className={errors.cpf ? "border-red-500 focus-visible:ring-red-500" : ""}
              />
              {errors.cpf && (
                <p className="text-sm text-red-500 flex items-center gap-1">
                  <AlertTriangle className="h-3 w-3" />
                  {errors.cpf}
                </p>
              )}
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
            <Button type="button" variant="outline" onClick={handleClose} disabled={isSubmitting}>
              {isViewMode ? 'Fechar' : 'Cancelar'}
            </Button>
            {!isViewMode && (
              <Button type="submit" disabled={!isFormValid || isSubmitting}>
                {isSubmitting ? 'Salvando...' : isCreateMode ? 'Cadastrar' : 'Salvar'}
              </Button>
            )}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}