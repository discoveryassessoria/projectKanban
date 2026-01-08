"use client"

import React, { useCallback, useState, useMemo, useEffect, forwardRef, useImperativeHandle } from "react"
import ReactFlow, {
  addEdge,
  type Connection,
  useNodesState,
  useEdgesState,
  Controls,
  MiniMap,
  Background,
  BackgroundVariant,
  ReactFlowProvider,
  MarkerType,
  type Edge,
  Handle,
  type Node,
  Position,
} from "reactflow"
import "reactflow/dist/style.css"

import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/src/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import {
  Plus,
  Edit3,
  Trash2,
  Users,
  Calendar,
  MapPin,
  Heart,
  Crown,
  User,
  UserPlus,
  TreePine,
  X,
  StickyNote,
  UserPlus2,
} from "lucide-react"
import { cn } from "@/lib/utils"
import type { Pessoa, Arvore, TreeNode } from "@/src/types/genealogy"
import { PersonFormDialog, type PersonFormData, type ExistingPersonFormData } from "@/src/components/person-form-dialog"
import Swal from "sweetalert2"
import withReactContent from "sweetalert2-react-content"
import { DatePickerField } from "@/components/ui/date-picker-field"

const PersonNode = ({ data }: { data: TreeNode["data"] }) => {
  const { pessoa, onAddChild, onAddParent, onAddSpouse, onEdit, onDelete, relationshipType } = data

  const formatDate = (date?: Date) => {
    if (!date) return ""
    return new Date(date).toLocaleDateString("pt-BR", {
      year: "numeric",
      month: "short",
      day: "numeric",
    })
  }

  const getLifeSpan = () => {
    const birth = pessoa.data_nasc ? formatDate(pessoa.data_nasc) : "?"
    const death = pessoa.data_obito ? formatDate(pessoa.data_obito) : ""
    return death ? `${birth} - ${death}` : birth
  }

  const getRelationshipStyle = () => {
    switch (relationshipType) {
      case "pai":
        return "border-blue-500 bg-blue-50 shadow-blue-100"
      case "mae":
        return "border-pink-500 bg-pink-50 shadow-pink-100"
      case "filho":
        return "border-green-500 bg-green-50 shadow-green-100"
      case "conjuge":
        return "border-purple-500 bg-purple-50 shadow-purple-100"
      case "irmao":
        return "border-orange-500 bg-orange-50 shadow-orange-100"
      default:
        return "border-gray-300 bg-white shadow-gray-100"
    }
  }

  const getRelationshipBadge = () => {
    const badges: Record<string, { label: string; icon: React.ElementType; color: string }> = {
      pai: { label: "Pai", icon: User, color: "bg-blue-100 text-blue-800 border-blue-200" },
      mae: { label: "Mãe", icon: User, color: "bg-pink-100 text-pink-800 border-pink-200" },
      filho: { label: "Filho(a)", icon: UserPlus, color: "bg-green-100 text-green-800 border-green-200" },
      conjuge: { label: "Cônjuge", icon: Heart, color: "bg-purple-100 text-purple-800 border-purple-200" },
      irmao: { label: "Irmão(ã)", icon: Users, color: "bg-orange-100 text-orange-800 border-orange-200" },
    }

    if (relationshipType && relationshipType in badges) {
      const badge = badges[relationshipType]
      const Icon = badge.icon
      return (
        <Badge variant="outline" className={`text-xs ${badge.color} mb-2`}>
          <Icon className="h-2 w-2 mr-1" />
          {badge.label}
        </Badge>
      )
    }
    return null
  }

  return (
    <Card
      className={cn(
        "tree-node group relative w-72 p-4 border-2 transition-all duration-300 hover:shadow-lg",
        getRelationshipStyle(),
      )}
    >
      <Handle
        type="target"
        position={Position.Top}
        id="top"
        className="w-3 h-3 bg-blue-500 border-2 border-white shadow-md"
      />
      <Handle
        type="source"
        position={Position.Bottom}
        id="bottom"
        className="w-3 h-3 bg-green-500 border-2 border-white shadow-md"
      />
      <Handle
        type="source"
        position={Position.Right}
        id="right"
        className="w-3 h-3 bg-purple-500 border-2 border-white shadow-md"
      />
      <Handle
        type="target"
        position={Position.Left}
        id="left"
        className="w-3 h-3 bg-purple-500 border-2 border-white shadow-md"
      />

      <div className="absolute -top-3 -right-3 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity z-10">
        <Button
          size="sm"
          variant="outline"
          className="h-7 w-7 p-0 bg-white shadow-md hover:bg-green-500 hover:text-white border-green-200"
          onClick={() => onAddChild(pessoa.id)}
          title="Adicionar Filho"
        >
          <Plus className="h-3 w-3" />
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-7 w-7 p-0 bg-white shadow-md hover:bg-blue-500 hover:text-white border-blue-200"
          onClick={() => onAddParent(pessoa.id, "pai")}
          disabled={!!pessoa.paiId}
          title="Adicionar Pai"
        >
          <User className="h-3 w-3" />
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-7 w-7 p-0 bg-white shadow-md hover:bg-pink-500 hover:text-white border-pink-200"
          onClick={() => onAddParent(pessoa.id, "mae")}
          disabled={!!pessoa.maeId}
          title="Adicionar Mãe"
        >
          <User className="h-3 w-3" />
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-7 w-7 p-0 bg-white shadow-md hover:bg-purple-500 hover:text-white border-purple-200"
          onClick={() => onAddSpouse(pessoa.id)}
          title="Adicionar Cônjuge"
        >
          <Heart className="h-3 w-3" />
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-7 w-7 p-0 bg-white shadow-md hover:bg-yellow-500 hover:text-white border-yellow-200"
          onClick={() => onEdit(pessoa)}
          title="Editar"
        >
          <Edit3 className="h-3 w-3" />
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-7 w-7 p-0 bg-white shadow-md hover:bg-red-500 hover:text-white border-red-200"
          onClick={() => onDelete(pessoa.id)}
          title="Excluir"
        >
          <Trash2 className="h-3 w-3" />
        </Button>
      </div>

      <div className="absolute -top-3 left-1/2 -translate-x-1/2">
        {pessoa.sexo === "Masculino" && <User className="h-5 w-5 text-blue-500" />}
        {pessoa.sexo === "Feminino" && <User className="h-5 w-5 text-pink-500" />}
      </div>

      {getRelationshipBadge()}

      {/* Person Info */}
      <div className="space-y-3">
        <div>
          <h3 className="font-bold text-lg text-gray-800 leading-tight">
            {pessoa.nome} {pessoa.sobrenome || ""}
          </h3>
        </div>

        <div className="space-y-2">
          <div className="flex items-center gap-2 text-sm text-gray-600">
            <Calendar className="h-3 w-3" />
            <span>{getLifeSpan()}</span>
          </div>

          {pessoa.local_nasc && (
            <div className="flex items-center gap-2 text-sm text-gray-600">
              <MapPin className="h-3 w-3" />
              <span className="truncate">{pessoa.local_nasc}</span>
            </div>
          )}
        </div>

        <div className="flex flex-wrap gap-1">
          {pessoa.batizado && (
            <Badge variant="secondary" className="text-xs bg-emerald-100 text-emerald-800 border-emerald-200">
              <Crown className="h-2 w-2 mr-1" />
              Batizado
            </Badge>
          )}

          {(pessoa.unioesComoPessoa1?.length || pessoa.unioesComoPessoa2?.length) && (
            <Badge variant="outline" className="text-xs border-rose-200 text-rose-700 bg-rose-50">
              <Heart className="h-2 w-2 mr-1" />
              Casado
            </Badge>
          )}

          {(pessoa.filhosComoPai?.length || 0) + (pessoa.filhosComoMae?.length || 0) > 0 && (
            <Badge variant="outline" className="text-xs border-indigo-200 text-indigo-700 bg-indigo-50">
              <Users className="h-2 w-2 mr-1" />
              {(pessoa.filhosComoPai?.length || 0) + (pessoa.filhosComoMae?.length || 0)} filhos
            </Badge>
          )}
        </div>
      </div>
    </Card>
  )
}

const CommentNode = ({ data }: { data: { comment: string; onCommentChange: (comment: string) => void } }) => {
  const [isEditing, setIsEditing] = useState(false)
  const [text, setText] = useState(data.comment)

  const handleSave = () => {
    data.onCommentChange(text)
    setIsEditing(false)
  }

  return (
    <Card className="group w-60 bg-yellow-100 border-yellow-300 shadow-lg hover:scale-105 transition-transform">
      <Handle type="target" position={Position.Top} className="!bg-transparent !border-none" />
      <Handle type="source" position={Position.Bottom} className="!bg-transparent !border-none" />
      <div className="p-3">
        <div className="flex justify-between items-center mb-2">
          <h4 className="font-bold text-sm text-yellow-800 flex items-center gap-2">
            <StickyNote className="h-4 w-4" />
            Comentário
          </h4>
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setIsEditing(!isEditing)}>
            <Edit3 className="h-3 w-3 text-yellow-700" />
          </Button>
        </div>
        {isEditing ? (
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onBlur={handleSave}
            className="w-full p-1 border rounded-md text-sm bg-yellow-50"
            rows={4}
            autoFocus
          />
        ) : (
          <p className="text-sm text-yellow-900 whitespace-pre-wrap break-words">{data.comment || "Clique para editar..."}</p>
        )}
      </div>
    </Card>
  )
}

interface GenealogicalTreeProps {
  arvore: Arvore & {
    commentPosX?: number | null
    commentPosY?: number | null
  }
  onUpdate?: () => void
  className?: string
}

export interface GenealogicalTreeHandle {
  addUnlinkedPerson: () => void;
}

const MySwal = withReactContent(Swal)

const GenealogicalTreeComponent = forwardRef<GenealogicalTreeHandle, GenealogicalTreeProps>(
  ({ arvore, onUpdate = () => {}, className }, ref) => {
  const [nodes, setNodes, onNodesChange] = useNodesState([])

  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge[]>([])

  const nodeTypes = useMemo(
    () => ({
      person: PersonNode,
      comment: CommentNode as React.FC,
    }),
    [],
  )

  const isExistingPersonData = (data: PersonFormData | ExistingPersonFormData): data is ExistingPersonFormData => {
    return 'id' in data && typeof data.id === 'number';
  }

  const handleAddChild = useCallback(
    (parentId: number) => {
      setDialogConfig({
        title: "Adicionar Filho",
        description: "Adicione informações sobre o filho desta pessoa.",
        relationshipType: "filho",
        currentPersonId: parentId,
        onSubmit: async (data: PersonFormData | ExistingPersonFormData) => {
          try {
            const parentPerson = arvore.pessoas?.find(p => p.id === parentId);
            const parentRelationship = parentPerson?.sexo === 'Feminino' ? { maeId: parentId } : { paiId: parentId };

            if (isExistingPersonData(data)) {
              // Para pessoa existente, apenas vincula como filho
              const updateResponse = await fetch(`/api/pessoas/${data.id}`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(parentRelationship),
              })
              
              if (updateResponse.ok) {
                onUpdate()
              } else {
                const error = await updateResponse.json()
                MySwal.fire({ title: "Erro", text: error.error || "Erro ao vincular filho(a)", icon: "error", customClass: { popup: "font-sans" } })
              }
            } else {
              // Para pessoa nova, cria e vincula
              const response = await fetch("/api/pessoas", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  ...data,
                  arvoreId: arvore.id,
                  ...parentRelationship,
                }),
              })
              
              if (response.ok) {
                onUpdate()
              } else {
                const error = await response.json()
                MySwal.fire({ title: "Erro", text: error.error || "Erro ao adicionar filho(a)", icon: "error", customClass: { popup: "font-sans" } })
              }
            }
          } catch (error) {
            console.error("Erro ao adicionar filho:", error)
            MySwal.fire({ title: "Erro Inesperado", text: "Ocorreu um erro ao adicionar o filho.", icon: "error", customClass: { popup: "font-sans" } })
          }
        },
      })
      setShowPersonDialog(true)
    },
    [arvore.id, arvore.pessoas, onUpdate],
  )

  const handleAddParent = useCallback(
    (childId: number, parentType: "pai" | "mae") => {
      setDialogConfig({
        title: `Adicionar ${parentType === "pai" ? "Pai" : "Mãe"}`,
        description: `Adicione informações sobre ${parentType === "pai" ? "o pai" : "a mãe"} desta pessoa.`,
        fixedSexo: parentType === "pai" ? "Masculino" : "Feminino",
        relationshipType: parentType,
        currentPersonId: childId,
        onSubmit: async (data: PersonFormData | ExistingPersonFormData) => {
          try {
            let parentId: number

            if (isExistingPersonData(data)) {
              // Usando pessoa existente
              parentId = data.id
            } else {
              // Criando nova pessoa
              const parentData = {
                ...data,
                sexo: parentType === "pai" ? "Masculino" : "Feminino",
                arvoreId: arvore.id,
              }

              const parentResponse = await fetch("/api/pessoas", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(parentData),
              })

              if (!parentResponse.ok) {
                const error = await parentResponse.json()
                console.error("Erro ao criar pai/mãe:", error)
                MySwal.fire({ title: "Erro", text: error.error || `Erro ao adicionar ${parentType}`, icon: "error", customClass: { popup: "font-sans" } })
                return
              }
              const newParent = await parentResponse.json()
              parentId = newParent.id
            }

            // Atualizar o filho para referenciar o pai/mãe
            const updatePayload = {
              [parentType === "pai" ? "paiId" : "maeId"]: parentId,
            }

            const updateResponse = await fetch(`/api/pessoas/${childId}`, {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(updatePayload),
            })

            if (updateResponse.ok) {
              onUpdate()
            } else {
              const error = await updateResponse.json()
              console.error("Erro ao vincular pai/mãe:", error)
              MySwal.fire({ title: "Erro", text: error.error || `Erro ao vincular ${parentType}`, icon: "error", customClass: { popup: "font-sans" } })
            }
          } catch (error) {
            console.error(`Erro ao adicionar ${parentType}:`, error)
            MySwal.fire({ title: "Erro Inesperado", text: `Ocorreu um erro ao adicionar ${parentType}.`, icon: "error", customClass: { popup: "font-sans" } })
          }
        },
      })
      setShowPersonDialog(true)
    },
    [arvore.id, onUpdate],
  )

  const handleAddSpouse = useCallback(
    (personId: number) => {
      setCurrentPersonForSpouse(personId)
      setShowSpouseModal(true)
      // Limpar dados anteriores
      setSpouseSearchTerm("")
      setNewSpouseData({
        nome: "",
        sobrenome: "",
        sexo: "",
        data_nasc: "",
        local_nasc: "",
      })
    },
    [],
  )

  const handleEditPerson = useCallback(
    (pessoa: Pessoa) => {
      setDialogConfig({
        title: "Editar Pessoa",
        description: "Atualize as informações desta pessoa.",
        person: pessoa,
        fixedSexo: undefined,
        onSubmit: async (data: PersonFormData | ExistingPersonFormData) => {
          try {
            // Para edição, sempre usamos PersonFormData (não existem pessoas existentes para editar)
            if (isExistingPersonData(data)) {
              console.error("Erro: tentativa de editar com dados de pessoa existente")
              return
            }
            
            const response = await fetch(`/api/pessoas/${pessoa.id}`, {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(data),
            })
            if (response.ok) {
              onUpdate()
            } else {
              const error = await response.json()
              MySwal.fire({ title: "Erro", text: error.error || "Erro ao atualizar pessoa", icon: "error", customClass: { popup: "font-sans" } })
            }
          } catch (error) {
            console.error("Erro ao atualizar pessoa:", error)
            MySwal.fire({ title: "Erro Inesperado", text: "Ocorreu um erro ao atualizar pessoa.", icon: "error", customClass: { popup: "font-sans" } })
          }
        },
      })
      setShowPersonDialog(true)
    },
    [onUpdate],
  )

  const handleDeletePerson = useCallback(
    (pessoaId: number) => {
      const pessoa = arvore.pessoas?.find((p) => p.id === pessoaId)
      const personName = pessoa ? `${pessoa.nome} ${pessoa.sobrenome || ""}`.trim() : "esta pessoa"

      MySwal.fire({
        title: "Confirmar Exclusão",
        text: `Tem certeza que deseja excluir ${personName}? Esta ação não pode ser desfeita.`,
        icon: "warning",
        customClass: { popup: "font-sans" },
        showCancelButton: true,
        confirmButtonColor: "#d33",
        cancelButtonColor: "#3085d6",
        confirmButtonText: "Sim, excluir!",
        cancelButtonText: "Cancelar",
      }).then(async (result) => {
        if (result.isConfirmed) {
          const response = await fetch(`/api/pessoas/${pessoaId}`, {
            method: "DELETE",
          })

          if (response.ok) {
            MySwal.fire({ title: "Excluído!", text: `${personName} foi excluído(a) da árvore.`, icon: "success", customClass: { popup: "font-sans" } })
            onUpdate()
          } else {
            const error = await response.json()
            let errorMessage = "Erro ao excluir pessoa."

            if (error.error === "Não é possível excluir uma pessoa que possui filhos") {
              errorMessage = "Não é possível excluir uma pessoa que possui filhos. Remova os filhos primeiro."
            } else if (error.error) {
              errorMessage = error.error
            }

            MySwal.fire({ title: "Erro", text: errorMessage, icon: "error", customClass: { popup: "font-sans" } })
          }
        }
      })
    },
    [arvore.pessoas, onUpdate],
  )

  const handleSaveTreeComment = useCallback(async (newComment: string) => {
    try {
      const response = await fetch(`/api/arvore/${arvore.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ descricao: newComment }),
      })
      if (response.ok) {
        onUpdate()
      } else {
        MySwal.fire({ title: "Erro", text: "Não foi possível salvar o comentário.", icon: "error", customClass: { popup: "font-sans" } })
      }
    } catch (error) {
      MySwal.fire({ title: "Erro", text: "Não foi possível salvar o comentário.", icon: "error", customClass: { popup: "font-sans" } })
    }
  }, [arvore.id, onUpdate, MySwal])

  const generateTreeLayout = useCallback(
    (pessoas: Pessoa[]) => {
      const nodeMap = new Map<number, TreeNode>()
      const edgeList: Edge[] = []

      if (!pessoas || pessoas.length === 0) {
        return { nodes: [], edges: [] }
      }

      // Constantes para layout
      const DEFAULT_X_SPACING = 380
      const DEFAULT_Y_SPACING = 250

      // Criar nós
      pessoas.forEach((pessoa) => {
        const node: TreeNode = {
          id: pessoa.id.toString(),
          type: "person",
          position: {
            x: pessoa.x ?? (Math.random() - 0.5) * DEFAULT_X_SPACING,
            y: pessoa.y ?? (Math.random() - 0.5) * DEFAULT_Y_SPACING,
          },
          data: {
            pessoa: pessoa,
            onAddChild: handleAddChild,
            onAddParent: handleAddParent,
            onAddSpouse: handleAddSpouse,
            onEdit: handleEditPerson,
            onDelete: handleDeletePerson,
          },
        }

        nodeMap.set(pessoa.id, node)
      })

      // Criar arestas (conexões)
      pessoas.forEach((pessoa) => {
        // Conexões pai -> filho
        if (pessoa.paiId && nodeMap.has(pessoa.paiId)) {
          edgeList.push({
            id: `edge-pai-${pessoa.id}`,
            source: pessoa.paiId.toString(),
            target: pessoa.id.toString(),
            type: "smoothstep",
            style: { stroke: "#1e40af", strokeWidth: 2 },
            markerEnd: { type: MarkerType.ArrowClosed, color: "#1e40af" },
          })
        }
        if (pessoa.maeId && nodeMap.has(pessoa.maeId)) {
          edgeList.push({
            id: `edge-mae-${pessoa.id}`,
            source: pessoa.maeId.toString(),
            target: pessoa.id.toString(),
            type: "smoothstep",
            style: { stroke: "#db2777", strokeWidth: 2 },
            markerEnd: { type: MarkerType.ArrowClosed, color: "#db2777" },
          })
        }

        // Conexões de casamento
        const unioes = [...(pessoa.unioesComoPessoa1 || []), ...(pessoa.unioesComoPessoa2 || [])]

        unioes.forEach((uniao) => {
          const spouseId = uniao.pessoa1Id === pessoa.id ? uniao.pessoa2Id : uniao.pessoa1Id
          if (nodeMap.has(spouseId)) {
            // Evitar duplicação de arestas
            const edgeExists = edgeList.some(
              (edge) =>
                edge.id === `edge-casamento-${spouseId}-${pessoa.id}` ||
                edge.id === `edge-casamento-${pessoa.id}-${spouseId}`,
            )

            if (!edgeExists) {
              edgeList.push({
                id: `edge-casamento-${pessoa.id}-${spouseId}`,
                source: pessoa.id.toString(),
                target: spouseId.toString(),
                type: "straight",
                style: {
                  stroke: "#dc2626", // Cor vermelha para casamento/união
                  strokeWidth: 3,
                  strokeDasharray: "5 5",
                },
                sourceHandle: "right",
                targetHandle: "left",
              })
            }
          }
        })
      })

      // Adicionar nó de comentário
      const commentNode: Node = {
        id: "tree-comment",
        type: "comment",
        position: { x: arvore.commentPosX ?? -400, y: arvore.commentPosY ?? 0 },
        data: {
          comment: arvore.descricao || "",
          onCommentChange: handleSaveTreeComment,
        },
        draggable: true,
        selectable: true,
      }

      return {
        nodes: [
          ...Array.from(nodeMap.values()),
          commentNode
        ],
        edges: edgeList,
      }
    },
    [
      arvore.commentPosX,
      arvore.commentPosY,
      arvore.descricao,
      arvore.id,
      handleAddChild,
      handleAddParent,
      handleAddSpouse,
      handleEditPerson,
      handleDeletePerson,
      handleSaveTreeComment,
    ],
  )

  const onNodeDragStop = useCallback(
    async (event: React.MouseEvent, node: Node) => {
      if (!node) return
      
      const { id, position } = node

      // Otimisticamente atualiza a UI
      setNodes((nds) => nds.map((n) => (n.id === id ? { ...n, position } : n)))

      if (id === "tree-comment") {
        // Salva a posição do comentário
        await fetch(`/api/arvore/${arvore.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ commentPosX: position.x, commentPosY: position.y }),
        }).catch((error) => console.error("Falha ao salvar a posição do comentário:", error))
      } else {
        // Salva a posição da pessoa
        const personId = Number(id)
        if (isNaN(personId)) return

        await fetch(`/api/pessoas/${personId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ x: position.x, y: position.y }),
        }).catch((error) => console.error("Falha ao salvar a posição do nó:", error))
      }
    },
    [setNodes, arvore.id],
  )

  // Update nodes and edges when pessoas change
  useEffect(() => {
    const { nodes: newNodes, edges: newEdges } = generateTreeLayout(arvore.pessoas || [])
    setNodes(newNodes)
    setEdges(newEdges)
  }, [arvore.pessoas, arvore.descricao, generateTreeLayout, setNodes, setEdges])

  const onConnect = useCallback((params: Connection) => setEdges((eds) => addEdge(params, eds)), [setEdges])

  // Dialog state and config
  const [showPersonDialog, setShowPersonDialog] = useState(false)
  const [dialogConfig, setDialogConfig] = useState<{
    title: string
    description: string
    person?: Pessoa
    fixedSexo?: "Masculino" | "Feminino"
    relationshipType?: "pai" | "mae" | "filho" | "conjuge"
    currentPersonId?: number
    onSubmit: (data: PersonFormData | ExistingPersonFormData) => Promise<void>
  }>({
    title: "",
    description: "",
    person: undefined,
    fixedSexo: undefined,
    relationshipType: undefined,
    currentPersonId: undefined,
    onSubmit: async () => {},
  })

  const handleAddUnlinkedPerson = useCallback(() => {
    setDialogConfig({
      title: "Adicionar Pessoa Avulsa",
      description: "Cadastre uma nova pessoa na árvore. Você poderá criar vínculos familiares depois.",
      person: undefined,
      fixedSexo: undefined,
      onSubmit: async (data: PersonFormData | ExistingPersonFormData) => {
        if (isExistingPersonData(data)) return; // Não deve acontecer
        try {
          const response = await fetch("/api/pessoas", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ...data, arvoreId: arvore.id }),
          });
          if (response.ok) onUpdate();
          else MySwal.fire({ title: "Erro", text: "Não foi possível adicionar a pessoa.", icon: "error", customClass: { popup: "font-sans" } });
        } catch (error) {
          MySwal.fire({ title: "Erro", text: "Ocorreu um erro de conexão.", icon: "error", customClass: { popup: "font-sans" } });
        }
      },
    });
    setShowPersonDialog(true);
  }, [arvore.id, onUpdate, MySwal]);

  useImperativeHandle(ref, () => ({
    addUnlinkedPerson() {
      handleAddUnlinkedPerson();
    }
  }));

  // Estado para modal de cônjuge personalizado
  const [showSpouseModal, setShowSpouseModal] = useState(false)
  const [currentPersonForSpouse, setCurrentPersonForSpouse] = useState<number | null>(null)
  const [spouseSearchTerm, setSpouseSearchTerm] = useState("")
  const [newSpouseData, setNewSpouseData] = useState({
    nome: "",
    sobrenome: "",
    sexo: "",
    data_nasc: "",
    local_nasc: "",
  })

  // Função para criar nova pessoa e união
  const handleCreateNewSpouse = useCallback(async () => {
    if (!currentPersonForSpouse || !newSpouseData.nome) {
      MySwal.fire({ title: "Atenção", text: "O nome do cônjuge é obrigatório.", icon: "warning", customClass: { popup: "font-sans" } })
      return
    }

    try {
      // 1. Criar nova pessoa
      const response = await fetch("/api/pessoas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...newSpouseData,
          data_nasc: newSpouseData.data_nasc ? new Date(newSpouseData.data_nasc) : null,
          arvoreId: arvore.id,
        }),
      })

      if (!response.ok) {
        const error = await response.json()
        MySwal.fire({ title: "Erro", text: "Erro ao criar pessoa: " + error.error, icon: "error", customClass: { popup: "font-sans" } })
        return
      }

      const newPerson = await response.json()

      // 2. Criar união
      const unionResponse = await fetch("/api/unioes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pessoa1Id: currentPersonForSpouse,
          pessoa2Id: newPerson.id,
          tipo: "Casamento",
        }),
      })

      if (!unionResponse.ok) {
        const error = await unionResponse.json()
        MySwal.fire({ title: "Erro", text: "Erro ao criar união: " + error.error, icon: "error", customClass: { popup: "font-sans" } })
        return
      }

      MySwal.fire({ title: "Sucesso!", text: "Cônjuge criado e relacionamento estabelecido com sucesso!", icon: "success", customClass: { popup: "font-sans" } })
      setShowSpouseModal(false)
      onUpdate()
    } catch (error) {
      MySwal.fire({ title: "Erro Inesperado", text: "Ocorreu um erro: " + error, icon: "error", customClass: { popup: "font-sans" } })
    }
  }, [currentPersonForSpouse, newSpouseData, arvore.id, onUpdate])

  // Função para selecionar pessoa existente
  const handleSelectExistingSpouse = useCallback(async (selectedPersonId: number) => {
    if (!currentPersonForSpouse) return
    
    // Fecha o modal de cônjuge antes de abrir o alerta de confirmação
    setShowSpouseModal(false)

    const { isConfirmed } = await MySwal.fire({
      title: 'Confirmar União',
      html: `Deseja criar uma união entre <strong>${arvore.pessoas?.find(p => p.id === currentPersonForSpouse)?.nome}</strong> e <strong>${arvore.pessoas?.find(p => p.id === selectedPersonId)?.nome}</strong>?`,
      icon: 'question',
      customClass: { popup: "font-sans" },
      showCancelButton: true,
      confirmButtonText: 'Sim, criar união',
      cancelButtonText: 'Cancelar'
    });

    if (!isConfirmed) {
      setShowSpouseModal(true) // Reabre o modal se o usuário cancelar
      return
    }

    try {
      const response = await fetch("/api/unioes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pessoa1Id: currentPersonForSpouse,
          pessoa2Id: selectedPersonId,
          tipo: "Casamento",
        }),
      })

      if (response.ok) {
        MySwal.fire({ title: "Sucesso!", text: "Relacionamento criado com sucesso!", icon: "success", customClass: { popup: "font-sans" } })
        onUpdate()
      } else {
        const error = await response.json()
        MySwal.fire({ title: "Erro", text: "Erro ao criar relacionamento: " + (error.error || 'Erro desconhecido'), icon: "error", customClass: { popup: "font-sans" } })
      }
    } catch (error) {
      MySwal.fire({ title: "Erro Inesperado", text: "Ocorreu um erro: " + error, icon: "error", customClass: { popup: "font-sans" } })
    }
  }, [currentPersonForSpouse, arvore.pessoas, onUpdate, MySwal])

  return (
    <div
      className={cn("genealogy-tree w-full bg-gradient-to-br from-slate-50 to-slate-100 relative", className)}
      style={{ height: "calc(100vh - 80px)" }}
    >
      <ReactFlowProvider>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onNodeDragStop={onNodeDragStop}
          nodeTypes={nodeTypes}
          fitView
          fitViewOptions={{
            padding: 0.3,
            includeHiddenNodes: false,
            minZoom: 0.1,
            maxZoom: 1.5,
          }}
          minZoom={0.05}
          maxZoom={2}
          defaultViewport={{ x: 0, y: 0, zoom: 0.6 }}
          className="bg-gradient-to-br from-slate-50 to-slate-100"
        >
          <Controls
            className="bg-white border border-gray-200 rounded-lg shadow-lg"
            showZoom={true}
            showFitView={true}
            showInteractive={true}
          >
             <Button variant="outline" className="react-flow__controls-button" onClick={handleAddUnlinkedPerson} title="Adicionar Pessoa Avulsa">
              <UserPlus2 />
            </Button>
          </Controls>
          <MiniMap
            className="bg-white border border-gray-200 rounded-lg shadow-lg"
            nodeColor={(node) => {
              const relationshipType = node.data?.relationshipType
              switch (relationshipType) {
                case "pai":
                  return "#3b82f6"
                case "mae":
                  return "#ec4899"
                case "filho":
                  return "#10b981"
                case "conjuge":
                  return "#8b5cf6"
                case "irmao":
                  return "#f59e0b"
                default:
                  return "#6b7280"
              }
            }}
            maskColor="rgba(0, 0, 0, 0.1)"
          />
          <Background variant={BackgroundVariant.Dots} gap={25} size={1} color="#e2e8f0" />
        </ReactFlow>
      </ReactFlowProvider>

      <div className="absolute bottom-4 left-4 bg-white rounded-lg shadow-lg border border-gray-200 p-4 z-10 max-w-xs flex flex-col gap-4">
        <div className="flex justify-between items-center">
          <h3 className="font-semibold text-sm text-gray-800 flex items-center gap-2">
            <TreePine className="h-4 w-4 text-gray-600" />
            Legenda
          </h3>
        </div>
        <div className="space-y-3">
          {/* Node Types */}
          <div>
            <h4 className="text-xs font-medium text-gray-700 mb-2">Pessoas</h4>
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <User className="h-4 w-4 text-blue-500" />
                <span className="text-xs text-gray-600">Masculino</span>
              </div>
              <div className="flex items-center gap-2">
                <User className="h-4 w-4 text-pink-500" />
                <span className="text-xs text-gray-600">Feminino</span>
              </div>
            </div>
          </div>

          {/* Line Types */}
          <div className="pt-2 border-t border-gray-200">
            <h4 className="text-xs font-medium text-gray-700 mb-2">Ligações</h4>
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <div className="flex items-center">
                  <div className="w-4 h-0.5 bg-gray-500"></div>
                  <div className="w-0 h-0 border-t-4 border-t-transparent border-l-4 border-l-gray-500 border-b-4 border-b-transparent"></div>
                </div>
                <span className="text-xs text-gray-600">Filiação</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-4 h-0.5 bg-red-600 border-dashed border-t-2 border-red-600"></div>
                <span className="text-xs text-gray-600">União (casamento)</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* PersonFormDialog */}
      <PersonFormDialog
        open={showPersonDialog}
        onOpenChange={setShowPersonDialog}
        title={dialogConfig.title}
        description={dialogConfig.description}
        person={dialogConfig.person}
        onSubmit={dialogConfig.onSubmit}
        pessoas={arvore.pessoas}
        fixedSexo={dialogConfig.fixedSexo}
        relationshipType={dialogConfig.relationshipType}
        currentPersonId={dialogConfig.currentPersonId}
      />

      {/* Modal personalizado para cônjuge */}
      <Dialog open={showSpouseModal} onOpenChange={setShowSpouseModal}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Adicionar Cônjuge</DialogTitle>
          </DialogHeader>
          
          <Tabs defaultValue="new" className="w-full">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="new">Criar Nova Pessoa</TabsTrigger>
              <TabsTrigger value="existing">Selecionar Existente</TabsTrigger>
            </TabsList>
            
            <TabsContent value="new" className="space-y-4">
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="nome">Nome *</Label>
                    <Input
                      id="nome"
                      value={newSpouseData.nome}
                      onChange={(e) => setNewSpouseData(prev => ({...prev, nome: e.target.value}))}
                      placeholder="Nome da pessoa"
                    />
                  </div>
                  <div>
                    <Label htmlFor="sobrenome">Sobrenome</Label>
                    <Input
                      id="sobrenome"
                      value={newSpouseData.sobrenome}
                      onChange={(e) => setNewSpouseData(prev => ({...prev, sobrenome: e.target.value}))}
                      placeholder="Sobrenome"
                    />
                  </div>
                </div>
                
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="sexo">Sexo</Label>
                    <Input
                      id="sexo"
                      value={newSpouseData.sexo}
                      onChange={(e) => setNewSpouseData(prev => ({...prev, sexo: e.target.value}))}
                      placeholder="Masculino/Feminino"
                    />
                  </div>
                  <div>
                    <Label htmlFor="data_nasc">Data de Nascimento</Label>
                    <DatePickerField
                      value={newSpouseData.data_nasc}
                      onChange={(value) => setNewSpouseData(prev => ({...prev, data_nasc: value}))}
                    />
                  </div>
                </div>
                
                <div>
                  <Label htmlFor="local_nasc">Local de Nascimento</Label>
                  <Input
                    id="local_nasc"
                    value={newSpouseData.local_nasc}
                    onChange={(e) => setNewSpouseData(prev => ({...prev, local_nasc: e.target.value}))}
                    placeholder="Cidade, Estado"
                  />
                </div>
                
                <Button onClick={handleCreateNewSpouse} className="w-full">
                  Criar Cônjuge e Relacionamento
                </Button>
              </div>
            </TabsContent>
            
            <TabsContent value="existing" className="space-y-4">
              <div>
                <Label htmlFor="search">Buscar pessoa existente</Label>
                <Input
                  id="search"
                  value={spouseSearchTerm}
                  onChange={(e) => setSpouseSearchTerm(e.target.value)}
                  placeholder="Digite o nome para buscar..."
                />
              </div>
              
              <div className="max-h-60 overflow-y-auto space-y-2">
                {arvore.pessoas
                  ?.filter(p => 
                    p.id !== currentPersonForSpouse &&
                    (p.nome.toLowerCase().includes(spouseSearchTerm.toLowerCase()) ||
                     (p.sobrenome?.toLowerCase().includes(spouseSearchTerm.toLowerCase()) || false))
                  )
                  .map(person => (
                    <div key={person.id} className="flex items-center justify-between p-3 border rounded-lg hover:bg-gray-50">
                      <div>
                        <div className="font-medium">{person.nome} {person.sobrenome}</div>
                        <div className="text-sm text-gray-500">
                          {person.sexo && `${person.sexo} • `}
                          {person.data_nasc && new Date(person.data_nasc).toLocaleDateString("pt-BR")}
                        </div>
                      </div>
                      <Button
                        size="sm"
                        onClick={() => handleSelectExistingSpouse(person.id)}
                      >
                        Selecionar
                      </Button>
                    </div>
                  ))}
              </div>
            </TabsContent>
          </Tabs>
        </DialogContent>
      </Dialog>

    </div>
  )
}
)

export const genealogicalTree = GenealogicalTreeComponent;