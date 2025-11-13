"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Plus, Trash2, Type } from "lucide-react"
import { 
  CampoPersonalizado, 
  TipoCampoPersonalizado, 
  MAX_CAMPOS_PERSONALIZADOS,
  getTipoCampoLabel,
  getTipoCampoPlaceholder
} from "@/src/types/campoPersonalizado"
import { applyTelefoneMask, removeMask } from "@/src/utils/masks"

interface CamposPersonalizadosEditorProps {
  campos: CampoPersonalizado[]
  onChange: (campos: CampoPersonalizado[]) => void
  disabled?: boolean
}

export function CamposPersonalizadosEditor({ 
  campos, 
  onChange,
  disabled = false 
}: CamposPersonalizadosEditorProps) {
  const [editingField, setEditingField] = useState<string | null>(null)

  const handleAddCampo = () => {
    if (campos.length >= MAX_CAMPOS_PERSONALIZADOS) {
      return
    }

    const novoCampo: CampoPersonalizado = {
      id: `campo_${Date.now()}`,
      nome: '',
      tipo: 'texto',
      valor: null
    }

    onChange([...campos, novoCampo])
    setEditingField(novoCampo.id)
  }

  const handleRemoveCampo = (id: string) => {
    onChange(campos.filter(c => c.id !== id))
  }

  const handleUpdateCampo = (id: string, updates: Partial<CampoPersonalizado>) => {
    onChange(campos.map(c => c.id === id ? { ...c, ...updates } : c))
  }

  const handleTipoChange = (id: string, novoTipo: TipoCampoPersonalizado) => {
    handleUpdateCampo(id, { 
      tipo: novoTipo,
      valor: novoTipo === 'boolean' ? false : null
    })
  }

  const renderInputByCampoTipo = (campo: CampoPersonalizado) => {
    const commonProps = {
      disabled,
      className: "flex-1"
    }

    switch (campo.tipo) {
      case 'numero':
        return (
          <Input
            {...commonProps}
            type="number"
            value={campo.valor?.toString() || ''}
            onChange={(e) => handleUpdateCampo(campo.id, { 
              valor: e.target.value ? parseFloat(e.target.value) : null 
            })}
            placeholder={getTipoCampoPlaceholder(campo.tipo)}
          />
        )
      
      case 'data':
        return (
          <Input
            {...commonProps}
            type="date"
            value={campo.valor?.toString() || ''}
            onChange={(e) => handleUpdateCampo(campo.id, { valor: e.target.value || null })}
          />
        )
      
      case 'email':
        return (
          <Input
            {...commonProps}
            type="email"
            value={campo.valor?.toString() || ''}
            onChange={(e) => handleUpdateCampo(campo.id, { valor: e.target.value || null })}
            placeholder={getTipoCampoPlaceholder(campo.tipo)}
          />
        )
      
      case 'telefone':
        return (
          <Input
            {...commonProps}
            type="text"
            value={disabled 
              ? applyTelefoneMask(campo.valor?.toString() || '') 
              : applyTelefoneMask(campo.valor?.toString() || '')
            }
            onChange={(e) => {
              const masked = applyTelefoneMask(e.target.value)
              handleUpdateCampo(campo.id, { valor: removeMask(masked) || null })
            }}
            placeholder={getTipoCampoPlaceholder(campo.tipo)}
            maxLength={15}
          />
        )
      
      case 'boolean':
        return (
          <Select
            disabled={disabled}
            value={campo.valor?.toString() || ''}
            onValueChange={(value) => handleUpdateCampo(campo.id, { 
              valor: value === 'true' ? true : value === 'false' ? false : null 
            })}
          >
            <SelectTrigger className="flex-1">
              <SelectValue placeholder="Selecione" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="">Não informado</SelectItem>
              <SelectItem value="true">Sim</SelectItem>
              <SelectItem value="false">Não</SelectItem>
            </SelectContent>
          </Select>
        )
      
      case 'texto':
      default:
        return (
          <Input
            {...commonProps}
            type="text"
            value={campo.valor?.toString() || ''}
            onChange={(e) => handleUpdateCampo(campo.id, { valor: e.target.value || null })}
            placeholder={getTipoCampoPlaceholder(campo.tipo)}
          />
        )
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Label className="flex items-center gap-2 text-sm font-medium">
          <Type className="h-4 w-4" />
          Campos Personalizados (opcional)
        </Label>
        {!disabled && campos.length < MAX_CAMPOS_PERSONALIZADOS && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleAddCampo}
            className="h-7 text-xs"
          >
            <Plus className="h-3 w-3 mr-1" />
            Adicionar Campo
          </Button>
        )}
      </div>

      {campos.length === 0 && (
        <p className="text-sm text-muted-foreground italic">
          Nenhum campo personalizado adicionado. Você pode adicionar até {MAX_CAMPOS_PERSONALIZADOS} campos.
        </p>
      )}

      <div className="space-y-3">
        {campos.map((campo) => (
          <div key={campo.id} className="border rounded-lg p-3 space-y-2 bg-muted/30">
            <div className="flex gap-2">
              <div className="flex-1">
                <Input
                  type="text"
                  value={campo.nome}
                  onChange={(e) => handleUpdateCampo(campo.id, { nome: e.target.value })}
                  placeholder="Nome do campo"
                  disabled={disabled}
                  className="font-medium"
                />
              </div>
              <Select
                disabled={disabled}
                value={campo.tipo}
                onValueChange={(value) => handleTipoChange(campo.id, value as TipoCampoPersonalizado)}
              >
                <SelectTrigger className="w-[140px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="texto">Texto</SelectItem>
                  <SelectItem value="numero">Número</SelectItem>
                  <SelectItem value="data">Data</SelectItem>
                  <SelectItem value="email">E-mail</SelectItem>
                  <SelectItem value="telefone">Telefone</SelectItem>
                  <SelectItem value="boolean">Sim/Não</SelectItem>
                </SelectContent>
              </Select>
              {!disabled && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => handleRemoveCampo(campo.id)}
                  className="h-10 w-10 text-destructive hover:text-destructive"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              )}
            </div>
            
            {campo.nome && (
              <div className="flex items-center gap-2">
                <Label className="text-xs text-muted-foreground min-w-fit">
                  Valor:
                </Label>
                {renderInputByCampoTipo(campo)}
              </div>
            )}
          </div>
        ))}
      </div>

      {!disabled && campos.length > 0 && campos.length < MAX_CAMPOS_PERSONALIZADOS && (
        <p className="text-xs text-muted-foreground">
          {MAX_CAMPOS_PERSONALIZADOS - campos.length} {MAX_CAMPOS_PERSONALIZADOS - campos.length === 1 ? 'campo disponível' : 'campos disponíveis'}
        </p>
      )}
    </div>
  )
}
