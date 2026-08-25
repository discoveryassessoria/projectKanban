// src/components/financeiro/modals/ModalBase.tsx
"use client"

import { X } from "lucide-react"
import { createPortal } from "react-dom"
import { LAYER } from "@/src/lib/ui/layers"
import { useEffect, useState } from "react"
import { useIsClient } from "@/src/lib/cliente"

interface Props {
  title: string
  subtitle?: string
  icon?: string
  color?: "violet" | "green" | "orange" | "blue" | "red"
  onClose: () => void
  children: React.ReactNode
  footer?: React.ReactNode
  size?: "md" | "lg" | "xl"
}

export function ModalBase({
  title, subtitle, icon = "✨", color = "violet",
  onClose, children, footer, size = "md"
}: Props) {
  const mounted = useIsClient()
  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => { if (e.key === "Escape") onClose() }
    document.addEventListener("keydown", handleEsc)
    return () => document.removeEventListener("keydown", handleEsc)
  }, [onClose])

  const colorClasses = {
    violet: "bg-gradient-to-br from-violet-500 to-violet-700",
    green: "bg-gradient-to-br from-green-500 to-green-700",
    orange: "bg-gradient-to-br from-orange-500 to-orange-700",
    blue: "bg-gradient-to-br from-blue-500 to-blue-700",
    red: "bg-gradient-to-br from-red-500 to-red-700",
  }

  const sizeClasses = { md: "max-w-lg", lg: "max-w-2xl", xl: "max-w-5xl" }

  if (!mounted) return null

  const content = (
    <div className="fixed inset-0 flex items-center justify-center p-4 bg-[var(--overlay-modal)]" style={{ zIndex: LAYER.aboveProcess }}>
      <div className={`bg-[var(--surface-primary)] rounded-2xl shadow-2xl w-full ${sizeClasses[size]} max-h-[90vh] flex flex-col overflow-hidden`}>
        <div className={`${colorClasses[color]} text-white p-4 flex items-center gap-3`}>
          <div className="bg-white/20 rounded-lg h-10 w-10 flex items-center justify-center text-xl">{icon}</div>
          <div className="flex-1">
            <div className="font-bold text-lg">{title}</div>
            {subtitle && <div className="text-sm opacity-90">{subtitle}</div>}
          </div>
          <button onClick={onClose} className="hover:bg-white/20 p-1 rounded">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-6">{children}</div>
        {footer && <div className="border-t p-4 bg-gray-50 flex justify-end gap-2">{footer}</div>}
      </div>
    </div>
  )

  return createPortal(content, document.body)
}