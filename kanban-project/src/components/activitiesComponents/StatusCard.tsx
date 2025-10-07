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

  const getHeaderColor = () => {
    const colorMap = {
      'destructive': 'bg-red-50 border-red-200',
      'orange': 'bg-orange-50 border-orange-200',
      'yellow': 'bg-yellow-50 border-yellow-200',
      'blue': 'bg-blue-50 border-blue-200',
      'green': 'bg-green-50 border-green-200',
      'secondary': 'bg-gray-50 border-gray-200'
    }
    return colorMap[color as keyof typeof colorMap] || colorMap.secondary
  }

  const getBadgeVariant = () => {
    const variantMap = {
      'destructive': 'destructive' as const,
      'orange': 'secondary' as const,
      'yellow': 'secondary' as const,
      'blue': 'secondary' as const,
      'green': 'secondary' as const,
      'secondary': 'secondary' as const
    }
    return variantMap[color as keyof typeof variantMap] || 'secondary'
  }

  return (
    <div className="flex flex-col h-full min-w-[300px] max-w-[350px]">
      <Card className={`
        flex flex-col h-full transition-all duration-200
        ${isDropTarget ? 'ring-2 ring-blue-400 shadow-lg' : ''}
      `}>
        <CardHeader className={`${getHeaderColor()} pb-3`}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CardTitle className="text-sm font-semibold">
                {label}
              </CardTitle>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant={getBadgeVariant()} className="text-xs">
                {activityCount}
              </Badge>
              {canManage && (onEdit || onDelete) && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button 
                      variant="ghost" 
                      size="sm" 
                      className="h-6 w-6 p-0 hover:bg-white/50"
                    >
                      <MoreHorizontal className="h-3 w-3" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-32">
                    {onEdit && (
                      <DropdownMenuItem onClick={onEdit} className="text-xs">
                        <Edit className="h-3 w-3 mr-2" />
                        Editar
                      </DropdownMenuItem>
                    )}
                    {onDelete && (
                      <DropdownMenuItem 
                        onClick={onDelete} 
                        className="text-xs text-destructive focus:text-destructive"
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
            <p className="text-xs text-muted-foreground mt-1">
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
              <div className="text-center py-8 text-muted-foreground">
                <p className="text-sm">Nenhuma atividade</p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}