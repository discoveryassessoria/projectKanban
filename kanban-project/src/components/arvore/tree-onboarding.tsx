"use client"

import { useState } from "react"
import { Loader2, ArrowLeft, Check } from "lucide-react"
import { DatePickerField } from "@/components/ui/date-picker-field"

// ─────────────────────────────────────────────────────────────
// Tipos
// ─────────────────────────────────────────────────────────────

type PersonType = "origin" | "applicant" | "common"

type PaisProcesso = "PORTUGAL" | "ESPANHA" | "ALEMANHA" | "ITALIA"

interface TypePresets {
  isDirectLine: boolean
  lineageRole: string
  numeroLinhagem: number | null
}

interface TreeOnboardingProps {
  arvoreId: number
  /**
   * País do processo (PORTUGAL | ESPANHA | ALEMANHA | ITALIA).
   * Usado para nomear o "ancestral de origem" com a nacionalidade correta.
   * Se ausente, usa label genérico.
   */
  paisProcesso?: PaisProcesso
  onComplete: () => void
}

// ─────────────────────────────────────────────────────────────
// Helpers de país → adjetivo
// ─────────────────────────────────────────────────────────────

const PAIS_ADJETIVO: Record<PaisProcesso, string> = {
  PORTUGAL: "português",
  ESPANHA: "espanhol",
  ALEMANHA: "alemão",
  ITALIA: "italiano",
}

function getOriginLabel(pais?: PaisProcesso): string {
  if (!pais) return "Ancestral estrangeiro de origem"
  const adj = PAIS_ADJETIVO[pais]
  // Capitaliza primeira letra
  return `${adj.charAt(0).toUpperCase()}${adj.slice(1)} de origem (ancestral estrangeiro)`
}

function getOriginRoleLabel(pais?: PaisProcesso): string {
  if (!pais) return "ancestral de origem"
  return `${PAIS_ADJETIVO[pais]} de origem`
}

// ─────────────────────────────────────────────────────────────
// Tipos de pessoa (presets)
// ─────────────────────────────────────────────────────────────

function buildTypeOptions(pais?: PaisProcesso) {
  return [
    {
      value: "origin" as PersonType,
      label: getOriginLabel(pais),
      desc: "Pessoa que originou a transmissão de cidadania.",
      presets: {
        isDirectLine: true,
        lineageRole: "origin_ancestor",
        numeroLinhagem: 1,
      } as TypePresets,
    },
    {
      value: "applicant" as PersonType,
      label: "Requerente (quem está pedindo cidadania)",
      desc: "Pessoa final da linha — quem vai receber o passaporte.",
      presets: {
        isDirectLine: true,
        lineageRole: "applicant",
        numeroLinhagem: 1,
      } as TypePresets,
    },
    {
      value: "common" as PersonType,
      label: "Pessoa comum (sem papel definido)",
      desc: "Adicionar sem decidir agora — você define o papel depois.",
      presets: {
        isDirectLine: false,
        lineageRole: "",
        numeroLinhagem: null,
      } as TypePresets,
    },
  ]
}

function typeRoleLabel(t: PersonType, pais?: PaisProcesso): string {
  switch (t) {
    case "origin":
      return getOriginRoleLabel(pais)
    case "applicant":
      return "requerente"
    case "common":
      return "pessoa comum"
  }
}

// ─────────────────────────────────────────────────────────────
// Componente principal
// ─────────────────────────────────────────────────────────────

export function TreeOnboarding({
  arvoreId,
  paisProcesso,
  onComplete,
}: TreeOnboardingProps) {
  const [step, setStep] = useState<1 | 2>(1)
  const [selectedType, setSelectedType] = useState<PersonType | null>(null)

  if (step === 1) {
    return (
      <Step1TypeSelector
        paisProcesso={paisProcesso}
        selectedType={selectedType}
        onSelect={setSelectedType}
        onContinue={() => {
          if (selectedType) setStep(2)
        }}
      />
    )
  }

  return (
    <Step2PersonForm
      arvoreId={arvoreId}
      paisProcesso={paisProcesso}
      type={selectedType!}
      onBack={() => setStep(1)}
      onComplete={onComplete}
    />
  )
}

// ─────────────────────────────────────────────────────────────
// Step 1: Seletor de tipo
// ─────────────────────────────────────────────────────────────

function Step1TypeSelector({
  paisProcesso,
  selectedType,
  onSelect,
  onContinue,
}: {
  paisProcesso?: PaisProcesso
  selectedType: PersonType | null
  onSelect: (t: PersonType) => void
  onContinue: () => void
}) {
  const options = buildTypeOptions(paisProcesso)

  return (
    <div className="h-full overflow-y-auto bg-gradient-to-b from-gray-50 to-gray-100">
      <div className="min-h-full flex items-center justify-center px-4 py-8">
        <div className="w-full max-w-2xl">
          <div className="text-center mb-6">
            <h2 className="text-2xl font-bold text-gray-900 mb-2">
              Que tipo de pessoa você quer adicionar primeiro?
            </h2>
            <p className="text-sm text-gray-500">
              Isso ajuda o sistema a sugerir o papel correto na linhagem.
            </p>
          </div>

          <div className="space-y-3 mb-6">
            {options.map((opt) => {
            const isSelected = selectedType === opt.value
            return (
              <button
                key={opt.value}
                onClick={() => onSelect(opt.value)}
                className={`w-full text-left p-5 rounded-xl border-2 transition-all ${
                  isSelected
                    ? "border-teal-500 bg-teal-50 shadow-sm"
                    : "border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50"
                }`}
              >
                <div className="flex items-start gap-3">
                  <div
                    className={`mt-0.5 w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-colors ${
                      isSelected ? "border-teal-500 bg-teal-500" : "border-gray-300"
                    }`}
                  >
                    {isSelected && <Check className="w-3 h-3 text-white" strokeWidth={3} />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p
                      className={`font-semibold text-base mb-1 ${
                        isSelected ? "text-teal-900" : "text-gray-900"
                      }`}
                    >
                      {opt.label}
                    </p>
                    <p className="text-sm text-gray-600 leading-relaxed">{opt.desc}</p>
                  </div>
                </div>
              </button>
            )
          })}
        </div>

        <button
          onClick={onContinue}
          disabled={!selectedType}
          className={`w-full py-3.5 rounded-lg font-semibold text-sm tracking-wide transition-all ${
            selectedType
              ? "bg-teal-600 text-white hover:bg-teal-700 hover:shadow-lg"
              : "bg-gray-200 text-gray-500 cursor-not-allowed"
          }`}
        >
          CONTINUAR
        </button>
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// Step 2: Formulário expandido (sem preview à direita)
// ─────────────────────────────────────────────────────────────

function Step2PersonForm({
  arvoreId,
  paisProcesso,
  type,
  onBack,
  onComplete,
}: {
  arvoreId: number
  paisProcesso?: PaisProcesso
  type: PersonType
  onBack: () => void
  onComplete: () => void
}) {
  const [sexo, setSexo] = useState<"Masculino" | "Feminino" | "">("")
  const [nome, setNome] = useState("")
  const [sobrenome, setSobrenome] = useState("")
  const [dataNasc, setDataNasc] = useState("")
  const [paisNasc, setPaisNasc] = useState(defaultPaisNasc(type, paisProcesso))
  const [nacionalidade, setNacionalidade] = useState(defaultNacionalidade(type, paisProcesso))
  const [isFalecido, setIsFalecido] = useState(false)
  const [dataObito, setDataObito] = useState("")
  const [isCasado, setIsCasado] = useState(false)
  const [dataCasamento, setDataCasamento] = useState("")
  const [saving, setSaving] = useState(false)

  const options = buildTypeOptions(paisProcesso)
  const typeOption = options.find((o) => o.value === type)!
  const canSubmit = !!nome.trim() && !!sexo

  const handleSubmit = async () => {
    if (!canSubmit) return

    setSaving(true)
    try {
      const body: Record<string, unknown> = {
        nome: nome.trim(),
        sobrenome: sobrenome.trim() || null,
        sexo,
        arvoreId,
        // Atributos da engine
        vivo: !isFalecido,
        casado: isCasado,
        // Demografia
        data_nasc: dataNasc ? new Date(dataNasc).toISOString() : null,
        pais_nasc: paisNasc.trim() || null,
        nacionalidade: nacionalidade.trim() || null,
        data_obito:
          isFalecido && dataObito ? new Date(dataObito).toISOString() : null,
        // Presets do tipo escolhido (linhagem)
        isDirectLine: typeOption.presets.isDirectLine,
        lineageRole: typeOption.presets.lineageRole || null,
        numeroLinhagem: typeOption.presets.numeroLinhagem,
        requerente: type === "applicant" ? "sim" : "nao",
      }

      const response = await fetch("/api/pessoas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })

      if (!response.ok) {
        const error = await response.json().catch(() => ({}))
        throw new Error(error.error || "Erro ao criar pessoa")
      }

      onComplete()
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : "Erro ao criar pessoa"
      console.error("[TreeOnboarding] erro ao criar pessoa:", error)
      alert(msg)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="h-full overflow-y-auto bg-gradient-to-b from-gray-50 to-gray-100">
      <div className="min-h-full flex items-center justify-center px-4 py-8">
        <div className="w-full max-w-3xl">
          {/* Header */}
          <button
            onClick={onBack}
            className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 transition-colors mb-3"
          >
            <ArrowLeft className="w-4 h-4" />
            Voltar
          </button>

          <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6">
          <h2 className="text-2xl font-bold text-gray-900 mb-1">
            Adicionar {typeRoleLabel(type, paisProcesso)}
          </h2>
          <p className="text-sm text-gray-500 mb-6">
            Mudanças nos atributos disparam reanálise automática dos documentos.
          </p>

          {/* Sexo (radio) */}
          <div className="mb-5">
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
              Sexo *
            </label>
            <div className="flex gap-6">
              <RadioOption
                checked={sexo === "Masculino"}
                onChange={() => setSexo("Masculino")}
                label="Masculino"
                color="blue"
              />
              <RadioOption
                checked={sexo === "Feminino"}
                onChange={() => setSexo("Feminino")}
                label="Feminino"
                color="pink"
              />
            </div>
          </div>

          {/* Nome / Sobrenome */}
          <div className="grid grid-cols-2 gap-4 mb-4">
            <FormField label="Nome *">
              <input
                type="text"
                value={nome}
                onChange={(e) => setNome(e.target.value)}
                className={inputCls}
                placeholder="Ex: João"
                autoFocus
              />
            </FormField>
            <FormField label="Sobrenome">
              <input
                type="text"
                value={sobrenome}
                onChange={(e) => setSobrenome(e.target.value)}
                className={inputCls}
                placeholder="Ex: Silva"
              />
            </FormField>
          </div>

          {/* Data nasc / País nasc / Nacionalidade — 3 colunas */}
          <div className="grid grid-cols-3 gap-4 mb-4">
            <FormField label="Data de Nascimento">
              <DatePickerField value={dataNasc} onChange={setDataNasc} />
            </FormField>
            <FormField label="País de Nascimento">
              <input
                type="text"
                value={paisNasc}
                onChange={(e) => setPaisNasc(e.target.value)}
                className={inputCls}
                placeholder="Brasil"
              />
            </FormField>
            <FormField label="Nacionalidade">
              <input
                type="text"
                value={nacionalidade}
                onChange={(e) => setNacionalidade(e.target.value)}
                className={inputCls}
                placeholder="Brasileira"
              />
            </FormField>
          </div>

          {/* Banner: Atributos da engine */}
          <div className="mb-4 p-3 rounded-lg bg-blue-50 border border-blue-200">
            <p className="text-xs font-semibold text-blue-900 mb-0.5">
              Atributos que alimentam a engine documental
            </p>
            <p className="text-xs text-blue-700 leading-relaxed">
              Estes flags determinam quais documentos serão gerados automaticamente.
            </p>
          </div>

          {/* Estado civil / Status vital */}
          <div className="grid grid-cols-2 gap-4 mb-4">
            <FormField label="Estado Civil">
              <select
                value={isCasado ? "casado" : "solteiro"}
                onChange={(e) => setIsCasado(e.target.value === "casado")}
                className={selectCls}
                style={selectStyle}
              >
                <option value="solteiro">Solteiro(a)</option>
                <option value="casado">Casado(a)</option>
              </select>
            </FormField>
            <FormField label="Status Vital">
              <select
                value={isFalecido ? "falecido" : "vivo"}
                onChange={(e) => setIsFalecido(e.target.value === "falecido")}
                className={selectCls}
                style={selectStyle}
              >
                <option value="vivo">Vivo(a)</option>
                <option value="falecido">Falecido(a)</option>
              </select>
            </FormField>
          </div>

          {/* Data casamento / Data óbito condicionais */}
          {(isCasado || isFalecido) && (
            <div className="grid grid-cols-2 gap-4 mb-4">
              {isCasado ? (
                <FormField label="Data de Casamento">
                  <DatePickerField value={dataCasamento} onChange={setDataCasamento} />
                </FormField>
              ) : (
                <div />
              )}
              {isFalecido ? (
                <FormField label="Data de Falecimento">
                  <DatePickerField value={dataObito} onChange={setDataObito} />
                </FormField>
              ) : (
                <div />
              )}
            </div>
          )}

          {/* Banner do tipo escolhido */}
          {type !== "common" && (
            <div className="mb-6 p-3 rounded-lg bg-teal-50 border-l-4 border-teal-500">
              <p className="text-xs text-teal-800 leading-relaxed">
                Esta pessoa será criada como{" "}
                <strong>{typeRoleLabel(type, paisProcesso)}</strong>{" "}
                na linha direta. A engine documental vai gerar automaticamente os
                documentos obrigatórios (nascimento
                {isCasado ? ", casamento" : ""}
                {isFalecido ? ", óbito" : ""}).
              </p>
            </div>
          )}

            {/* Botões */}
            <div className="flex gap-2 pt-2">
              <button
                onClick={onBack}
                disabled={saving}
                className="px-4 py-3 rounded-lg font-medium text-sm text-gray-600 hover:bg-gray-100 transition-colors disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                onClick={handleSubmit}
                disabled={!canSubmit || saving}
                className={`flex-1 py-3 rounded-lg font-semibold text-sm tracking-wide transition-all flex items-center justify-center gap-2 ${
                  canSubmit
                    ? "bg-teal-600 text-white hover:bg-teal-700 hover:shadow-lg"
                    : "bg-gray-200 text-gray-500 cursor-not-allowed"
                }`}
              >
                {saving ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    CRIANDO...
                  </>
                ) : (
                  "ADICIONAR PESSOA"
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// Defaults inteligentes baseados no tipo escolhido
// ─────────────────────────────────────────────────────────────

function defaultPaisNasc(type: PersonType, paisProcesso?: PaisProcesso): string {
  // Italiano/Português/Espanhol/Alemão de origem provavelmente nasceu no país de origem
  if (type === "origin" && paisProcesso) {
    return PAIS_NOME[paisProcesso]
  }
  return "Brasil"
}

function defaultNacionalidade(type: PersonType, paisProcesso?: PaisProcesso): string {
  if (type === "origin" && paisProcesso) {
    return NACIONALIDADE_ADJ[paisProcesso]
  }
  return "Brasileira"
}

const PAIS_NOME: Record<PaisProcesso, string> = {
  PORTUGAL: "Portugal",
  ESPANHA: "Espanha",
  ALEMANHA: "Alemanha",
  ITALIA: "Itália",
}

const NACIONALIDADE_ADJ: Record<PaisProcesso, string> = {
  PORTUGAL: "Portuguesa",
  ESPANHA: "Espanhola",
  ALEMANHA: "Alemã",
  ITALIA: "Italiana",
}

// ─────────────────────────────────────────────────────────────
// Sub-componentes
// ─────────────────────────────────────────────────────────────

const inputCls =
  "w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500 bg-white text-sm h-[42px]"

const selectCls =
  "w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500 bg-white text-sm h-[42px] appearance-none cursor-pointer"

const selectStyle = {
  backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%239ca3af' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E")`,
  backgroundRepeat: "no-repeat",
  backgroundPosition: "right 12px center",
}

function FormField({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div>
      <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
        {label}
      </label>
      {children}
    </div>
  )
}

function RadioOption({
  checked,
  onChange,
  label,
  color,
}: {
  checked: boolean
  onChange: () => void
  label: string
  color: "blue" | "pink"
}) {
  const checkedColor = color === "blue" ? "border-blue-500" : "border-pink-500"
  const dotColor = color === "blue" ? "bg-blue-500" : "bg-pink-500"
  return (
    <label className="flex items-center gap-2 cursor-pointer group">
      <div className="relative">
        <input
          type="radio"
          checked={checked}
          onChange={onChange}
          className="peer sr-only"
        />
        <div
          className={`w-5 h-5 rounded-full border-2 transition-colors ${
            checked ? checkedColor : "border-gray-300 group-hover:border-gray-400"
          }`}
        />
        {checked && (
          <div
            className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-full ${dotColor}`}
          />
        )}
      </div>
      <span className="text-sm text-gray-700 group-hover:text-gray-900">{label}</span>
    </label>
  )
}