"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { MoreHorizontal, Edit, Trash2 } from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { PrazoClassification } from "@/src/utils/prazoUtils"

interface StatusCardProps {
  classification: PrazoClassification
  activities: any[]
  onEdit?: () => void
  onDelete?: () => void
  canManage?: boolean
  children?: React.ReactNode
  isDropTarget?: boolean
  quickAddButton?: React.ReactNode
}

export default function StatusCard({ 
  classification, 
  activities, 
  onEdit, 
  onDelete, 
  canManage = false,
  children,
  isDropTarget = false,
  quickAddButton
}: StatusCardProps) {
  const { label, color, description } = classification
  const activityCount = activities.length

  // Cores para toda a caixa (card inteiro)
  const getCardColor = () => {
    const colorMap = {
      'destructive': 'bg-red-500/20 border-red-500/30',
      'orange': 'bg-orange-500/20 border-orange-500/30',
      'yellow': 'bg-yellow-500/20 border-yellow-500/30',
      'blue': 'bg-blue-500/20 border-blue-500/30',
      'green': 'bg-green-500/20 border-green-500/30',
      'secondary': 'bg-white/10 border-white/20'
    }
    return colorMap[color as keyof typeof colorMap] || colorMap.secondary
  }

  const getBadgeColor = () => {
    const colorMap = {
      'destructive': 'bg-red-500/30 text-red-200 border-red-500/40',
      'orange': 'bg-orange-500/30 text-orange-200 border-orange-500/40',
      'yellow': 'bg-yellow-500/30 text-yellow-200 border-yellow-500/40',
      'blue': 'bg-blue-500/30 text-blue-200 border-blue-500/40',
      'green': 'bg-green-500/30 text-green-200 border-green-500/40',
      'secondary': 'bg-white/20 text-white/80 border-white/30'
    }
    return colorMap[color as keyof typeof colorMap] || colorMap.secondary
  }

  return (
    <div className="flex flex-col h-full min-w-[300px] max-w-[350px]">
      <Card className={`
        flex flex-col h-full transition-all duration-200
        backdrop-blur-xl border
        ${getCardColor()}
        ${isDropTarget ? 'ring-2 ring-white/40 shadow-lg' : ''}
      `}>
        <CardHeader className="pb-3 border-b border-white/10">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CardTitle className="text-sm font-semibold text-white">
                {label}
              </CardTitle>
            </div>
            <div className="flex items-center gap-2">
              <Badge className={`text-xs ${getBadgeColor()}`}>
                {activityCount}
              </Badge>
              {canManage && (onEdit || onDelete) && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button 
                      variant="ghost" 
                      size="sm" 
                      className="h-6 w-6 p-0 hover:bg-white/10 text-white"
                    >
                      <MoreHorizontal className="h-3 w-3" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-32 bg-[#1a1a2e] border-white/20 text-white">
                    {onEdit && (
                      <DropdownMenuItem onClick={onEdit} className="text-xs hover:bg-white/10">
                        <Edit className="h-3 w-3 mr-2" />
                        Editar
                      </DropdownMenuItem>
                    )}
                    {onDelete && (
                      <DropdownMenuItem 
                        onClick={onDelete} 
                        className="text-xs text-red-400 hover:bg-red-500/10 focus:text-red-400"
                      >
                        <Trash2 className="h-3 w-3 mr-2" />
                        Deletar
                      </DropdownMenuItem>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
          </div>
          {description && (
            <p className="text-xs text-white/70 mt-1">
              {description}
            </p>
          )}
          {/* Quick Add Button */}
          {quickAddButton && (
            <div className="mt-3 flex justify-center">
              {quickAddButton}
            </div>
          )}
        </CardHeader>
        <CardContent className="flex-1 p-3 overflow-y-auto">
          <div className="space-y-2">
            {children}
            {activityCount === 0 && (
              <div className="text-center py-8">
                <p className="text-sm text-white/60">Nenhuma atividade</p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}