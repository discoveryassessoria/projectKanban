"use client"

import { useState } from "react"
import { Loader2 } from "lucide-react"

interface TreeOnboardingProps {
  arvoreId: number
  onComplete: () => void
}

export function TreeOnboarding({ arvoreId, onComplete }: TreeOnboardingProps) {
  const [sexo, setSexo] = useState<'Masculino' | 'Feminino' | ''>('')
  const [nome, setNome] = useState('')
  const [sobrenome, setSobrenome] = useState('')
  const [saving, setSaving] = useState(false)

  const handleSubmit = async () => {
    if (!nome.trim() || !sexo) return

    setSaving(true)
    try {
      const response = await fetch('/api/pessoas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nome: nome.trim(),
          sobrenome: sobrenome.trim() || null,
          sexo,
          arvoreId,
        })
      })

      if (response.ok) {
        onComplete()
      } else {
        const error = await response.json()
        alert(error.error || 'Erro ao criar pessoa')
      }
    } catch (error) {
      console.error('Erro:', error)
      alert('Erro ao criar pessoa')
    } finally {
      setSaving(false)
    }
  }

  // Cores baseadas no sexo
  const maleColor = '#3B82F6'
  const femaleColor = '#EC4899'
  const neutralColor = '#9CA3AF'

  const getColor = (type: 'filho' | 'pai' | 'mae') => {
    if (!sexo) return neutralColor

    switch (type) {
      case 'filho':
        return sexo === 'Masculino' ? maleColor : femaleColor
      case 'pai':
        return maleColor
      case 'mae':
        return femaleColor
      default:
        return neutralColor
    }
  }

  const canSubmit = nome.trim() && sexo

  return (
    <div className="h-full flex bg-white">
      {/* Lado esquerdo - Formulário */}
      <div className="w-[420px] p-10 flex flex-col justify-center border-r border-gray-200">
        <h2 className="text-2xl font-bold text-gray-900 mb-8">Comece com</h2>

        {/* Seleção de sexo */}
        <div className="flex gap-8 mb-8">
          <label className="flex items-center gap-3 cursor-pointer group">
            <div className="relative">
              <input
                type="radio"
                name="sexo"
                value="Masculino"
                checked={sexo === 'Masculino'}
                onChange={(e) => setSexo(e.target.value as 'Masculino')}
                className="peer sr-only"
              />
              <div className="w-5 h-5 rounded-full border-2 border-gray-300 peer-checked:border-blue-500 transition-colors" />
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-full bg-blue-500 scale-0 peer-checked:scale-100 transition-transform" />
            </div>
            <span className="text-gray-700 group-hover:text-gray-900 transition-colors">Masculino</span>
          </label>
          
          <label className="flex items-center gap-3 cursor-pointer group">
            <div className="relative">
              <input
                type="radio"
                name="sexo"
                value="Feminino"
                checked={sexo === 'Feminino'}
                onChange={(e) => setSexo(e.target.value as 'Feminino')}
                className="peer sr-only"
              />
              <div className="w-5 h-5 rounded-full border-2 border-gray-300 peer-checked:border-pink-500 transition-colors" />
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-full bg-pink-500 scale-0 peer-checked:scale-100 transition-transform" />
            </div>
            <span className="text-gray-700 group-hover:text-gray-900 transition-colors">Feminino</span>
          </label>
        </div>

        {/* Campo Nome */}
        <div className="mb-5">
          <label className="block text-sm text-gray-600 mb-2">Nome(s)</label>
          <input
            type="text"
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent transition-shadow"
            placeholder=""
          />
        </div>

        {/* Campo Sobrenome */}
        <div className="mb-10">
          <label className="block text-sm text-gray-600 mb-2">Sobrenome</label>
          <input
            type="text"
            value={sobrenome}
            onChange={(e) => setSobrenome(e.target.value)}
            className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent transition-shadow"
            placeholder=""
          />
        </div>

        {/* Botão Avançar */}
        <button
          onClick={handleSubmit}
          disabled={!canSubmit || saving}
          className={`w-full py-3.5 rounded-lg font-semibold text-sm tracking-wide transition-all flex items-center justify-center gap-2 ${
            canSubmit 
              ? 'bg-teal-600 text-white hover:bg-teal-700 hover:shadow-lg' 
              : 'bg-gray-200 text-gray-500 cursor-not-allowed'
          }`}
        >
          {saving ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              CRIANDO...
            </>
          ) : (
            'AVANÇAR'
          )}
        </button>
      </div>

      {/* Lado direito - Preview da árvore (simplificado: só Pai, Mãe e Filho) */}
      <div className="flex-1 bg-gray-100 flex items-center justify-center p-8 relative overflow-hidden">
        <div className="relative">
          {/* SVG para linhas de conexão */}
          <svg 
            className="absolute inset-0 w-full h-full pointer-events-none" 
            style={{ width: '400px', height: '320px', left: '-50px', top: '-20px' }}
          >
            {/* Linha horizontal entre pais */}
            <line x1="120" y1="80" x2="280" y2="80" stroke="#D1D5DB" strokeWidth="2" />
            
            {/* Linha vertical do meio (pais para filho) */}
            <line x1="200" y1="80" x2="200" y2="140" stroke="#D1D5DB" strokeWidth="2" />
            
            {/* Linha vertical para filho */}
            <line x1="200" y1="140" x2="200" y2="180" stroke="#D1D5DB" strokeWidth="2" />
          </svg>

          {/* Pais */}
          <div className="flex justify-center gap-20 mb-16 relative z-10">
            <PersonCard label="Pai" color={getColor('pai')} />
            <PersonCard label="Mãe" color={getColor('mae')} />
          </div>

          {/* Filho (pessoa principal) */}
          <div className="flex justify-center relative z-10 mt-4">
            <PersonCard 
              label={nome || 'Filho'}
              color={getColor('filho')}
              isMain
              highlighted={!!nome}
            />
          </div>
        </div>
      </div>
    </div>
  )
}

// Componente de card de pessoa
function PersonCard({ 
  label, 
  color, 
  isMain = false,
  highlighted = false
}: { 
  label: string
  color: string
  isMain?: boolean
  highlighted?: boolean
}) {
  return (
    <div 
      className={`flex flex-col items-center transition-transform ${isMain ? 'scale-110' : ''}`}
    >
      <div 
        className={`w-24 h-28 rounded-lg border-2 flex flex-col items-center justify-center bg-white transition-all ${
          isMain ? 'shadow-lg' : 'shadow-sm'
        } ${highlighted ? 'ring-2 ring-offset-2' : ''}`}
        style={{ 
          borderColor: color,
          ...(highlighted && { ringColor: color })
        }}
      >
        {/* Ícone de pessoa */}
        <svg 
          width="36" 
          height="36" 
          viewBox="0 0 24 24" 
          fill="none"
          className="mb-2"
        >
          {/* Cabeça */}
          <circle 
            cx="12" 
            cy="8" 
            r="4" 
            fill={`${color}30`}
            stroke={color}
            strokeWidth="1.5"
          />
          {/* Corpo */}
          <path 
            d="M4 20c0-4 4-6 8-6s8 2 8 6" 
            fill={`${color}30`}
            stroke={color}
            strokeWidth="1.5"
          />
        </svg>
        
        <span 
          className="text-xs font-medium text-center px-2 leading-tight truncate w-full"
          style={{ color }}
        >
          {label}
        </span>
      </div>
    </div>
  )
}