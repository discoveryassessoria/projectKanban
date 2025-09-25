"use client"

import { useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { PersonFormDialog } from "@/src/components/person-form-dialog"
import { TreePine, User, Users, Heart, ArrowRight, CheckCircle } from "lucide-react"
import type { Arvore } from "@/src/types/genealogy"

interface TreeOnboardingWizardProps {
  arvore: Arvore
  onComplete: () => void
}

type OnboardingStep = "welcome" | "add-self" | "add-parents" | "add-spouse" | "complete"

export function TreeOnboardingWizard({ arvore, onComplete }: TreeOnboardingWizardProps) {
  const [currentStep, setCurrentStep] = useState<OnboardingStep>("welcome")
  const [showPersonDialog, setShowPersonDialog] = useState(false)
  const [dialogConfig, setDialogConfig] = useState({
    title: "",
    description: "",
    onSubmit: async () => {},
  })

  const steps = [
    { id: "welcome", title: "Bem-vindo", progress: 0 },
    { id: "add-self", title: "Adicionar Você", progress: 25 },
    { id: "add-parents", title: "Adicionar Pais", progress: 50 },
    { id: "add-spouse", title: "Adicionar Cônjuge", progress: 75 },
    { id: "complete", title: "Concluído", progress: 100 },
  ]

  const currentStepData = steps.find((step) => step.id === currentStep)

  const handleAddSelf = () => {
    setDialogConfig({
      title: "Adicione Você à Árvore",
      description: "Comece sua árvore genealógica adicionando suas informações pessoais.",
      onSubmit: async (data) => {
        const response = await fetch("/api/pessoas", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...data, arvoreId: arvore.id }),
        })
        if (response.ok) {
          setCurrentStep("add-parents")
        }
      },
    })
    setShowPersonDialog(true)
  }

  const handleAddParent = (parentType: "pai" | "mae") => {
    setDialogConfig({
      title: `Adicionar ${parentType === "pai" ? "Pai" : "Mãe"}`,
      description: `Adicione informações sobre ${parentType === "pai" ? "seu pai" : "sua mãe"} à árvore genealógica.`,
      onSubmit: async (data) => {
        // Assumindo que a primeira pessoa é o usuário
        const selfPerson = arvore.pessoas?.[0]
        if (!selfPerson) return

        const parentData = {
          ...data,
          arvoreId: arvore.id,
        }

        const response = await fetch("/api/pessoas", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(parentData),
        })

        if (response.ok) {
          const parent = await response.json()
          // Atualizar a pessoa para referenciar o pai/mãe
          await fetch(`/api/pessoas/${selfPerson.id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              ...selfPerson,
              [parentType === "pai" ? "paiId" : "maeId"]: parent.id,
            }),
          })
        }
      },
    })
    setShowPersonDialog(true)
  }

  const handleAddSpouse = () => {
    setDialogConfig({
      title: "Adicionar Cônjuge",
      description: "Adicione informações sobre seu cônjuge à árvore genealógica.",
      onSubmit: async (data) => {
        const selfPerson = arvore.pessoas?.[0]
        if (!selfPerson) return

        const response = await fetch("/api/pessoas", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...data, arvoreId: arvore.id }),
        })

        if (response.ok) {
          const spouse = await response.json()
          // Criar união entre o usuário e o cônjuge
          await fetch("/api/unioes", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              pessoa1Id: selfPerson.id,
              pessoa2Id: spouse.id,
              tipo: "Casamento",
            }),
          })
          setCurrentStep("complete")
        }
      },
    })
    setShowPersonDialog(true)
  }

  const renderStepContent = () => {
    switch (currentStep) {
      case "welcome":
        return (
          <div className="text-center space-y-6">
            <div className="mx-auto w-20 h-20 bg-[#123C73] rounded-full flex items-center justify-center">
              <TreePine className="h-10 w-10 text-white" />
            </div>
            <div>
              <h2 className="text-2xl font-bold text-[#123C73] mb-2">Bem-vindo à sua Árvore Genealógica!</h2>
              <p className="text-[#9AA0A6] text-lg">
                Vamos começar construindo sua história familiar. Este processo levará apenas alguns minutos.
              </p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-8">
              <div className="text-center p-4">
                <User className="h-8 w-8 text-[#123C73] mx-auto mb-2" />
                <h3 className="font-semibold text-[#123C73]">Adicione Você</h3>
                <p className="text-sm text-[#9AA0A6]">Comece com suas informações</p>
              </div>
              <div className="text-center p-4">
                <Users className="h-8 w-8 text-[#123C73] mx-auto mb-2" />
                <h3 className="font-semibold text-[#123C73]">Adicione Família</h3>
                <p className="text-sm text-[#9AA0A6]">Pais, cônjuges e filhos</p>
              </div>
              <div className="text-center p-4">
                <TreePine className="h-8 w-8 text-[#123C73] mx-auto mb-2" />
                <h3 className="font-semibold text-[#123C73]">Visualize</h3>
                <p className="text-sm text-[#9AA0A6]">Veja sua árvore crescer</p>
              </div>
            </div>
            <Button
              onClick={() => setCurrentStep("add-self")}
              className="bg-[#123C73] hover:bg-[#0f2d5a] text-white"
              size="lg"
            >
              Começar
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </div>
        )

      case "add-self":
        return (
          <div className="text-center space-y-6">
            <div className="mx-auto w-16 h-16 bg-[#123C73] rounded-full flex items-center justify-center">
              <User className="h-8 w-8 text-white" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-[#123C73] mb-2">Adicione Suas Informações</h2>
              <p className="text-[#9AA0A6]">Comece sua árvore genealógica adicionando suas informações pessoais.</p>
            </div>
            <Button onClick={handleAddSelf} className="bg-[#123C73] hover:bg-[#0f2d5a] text-white" size="lg">
              Adicionar Minhas Informações
            </Button>
          </div>
        )

      case "add-parents":
        return (
          <div className="text-center space-y-6">
            <div className="mx-auto w-16 h-16 bg-[#123C73] rounded-full flex items-center justify-center">
              <Users className="h-8 w-8 text-white" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-[#123C73] mb-2">Adicione Seus Pais</h2>
              <p className="text-[#9AA0A6]">
                Adicione informações sobre seus pais para expandir sua árvore genealógica.
              </p>
            </div>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Button
                onClick={() => handleAddParent("pai")}
                variant="outline"
                className="border-[#123C73] text-[#123C73] hover:bg-[#123C73] hover:text-white"
              >
                Adicionar Pai
              </Button>
              <Button
                onClick={() => handleAddParent("mae")}
                variant="outline"
                className="border-[#123C73] text-[#123C73] hover:bg-[#123C73] hover:text-white"
              >
                Adicionar Mãe
              </Button>
            </div>
            <Button
              onClick={() => setCurrentStep("add-spouse")}
              variant="ghost"
              className="text-[#9AA0A6] hover:text-[#123C73]"
            >
              Pular esta etapa
            </Button>
          </div>
        )

      case "add-spouse":
        return (
          <div className="text-center space-y-6">
            <div className="mx-auto w-16 h-16 bg-[#123C73] rounded-full flex items-center justify-center">
              <Heart className="h-8 w-8 text-white" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-[#123C73] mb-2">Adicione Seu Cônjuge</h2>
              <p className="text-[#9AA0A6]">Se você é casado(a), adicione informações sobre seu cônjuge.</p>
            </div>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Button onClick={handleAddSpouse} className="bg-[#123C73] hover:bg-[#0f2d5a] text-white">
                Adicionar Cônjuge
              </Button>
              <Button
                onClick={() => setCurrentStep("complete")}
                variant="outline"
                className="border-[#9AA0A6] text-[#9AA0A6] hover:bg-[#9AA0A6] hover:text-white"
              >
                Pular esta etapa
              </Button>
            </div>
          </div>
        )

      case "complete":
        return (
          <div className="text-center space-y-6">
            <div className="mx-auto w-16 h-16 bg-[#2ECC71] rounded-full flex items-center justify-center">
              <CheckCircle className="h-8 w-8 text-white" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-[#123C73] mb-2">Parabéns!</h2>
              <p className="text-[#9AA0A6]">
                Sua árvore genealógica foi criada com sucesso. Agora você pode continuar adicionando mais familiares e
                explorando sua história.
              </p>
            </div>
            <Button onClick={onComplete} className="bg-[#2ECC71] hover:bg-[#27AE60] text-white" size="lg">
              Ver Minha Árvore
              <TreePine className="ml-2 h-4 w-4" />
            </Button>
          </div>
        )

      default:
        return null
    }
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <Card className="w-full max-w-2xl">
        <CardHeader className="text-center">
          <div className="mb-4">
            <Progress value={currentStepData?.progress || 0} className="w-full" />
            <p className="text-sm text-[#9AA0A6] mt-2">
              Etapa {steps.findIndex((s) => s.id === currentStep) + 1} de {steps.length}
            </p>
          </div>
          <CardTitle className="text-[#123C73]">{arvore.nome}</CardTitle>
        </CardHeader>
        <CardContent>{renderStepContent()}</CardContent>
      </Card>

      <PersonFormDialog
        open={showPersonDialog}
        onOpenChange={setShowPersonDialog}
        title={dialogConfig.title}
        description={dialogConfig.description}
        onSubmit={dialogConfig.onSubmit}
      />
    </div>
  )
}
