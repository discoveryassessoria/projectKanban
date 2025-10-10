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
      'destructive': 'bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-800',
      'orange': 'bg-orange-50 dark:bg-orange-950/30 border-orange-200 dark:border-orange-800',
      'yellow': 'bg-yellow-50 dark:bg-yellow-950/30 border-yellow-200 dark:border-yellow-800',
      'blue': 'bg-blue-50 dark:bg-blue-950/30 border-blue-200 dark:border-blue-800',
      'green': 'bg-green-50 dark:bg-green-950/30 border-green-200 dark:border-green-800',
      'secondary': 'bg-gray-50 dark:bg-gray-800 border-gray-200 dark:border-gray-700'
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
              <CardTitle className="text-sm font-semibold text-gray-900 dark:text-gray-100">
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