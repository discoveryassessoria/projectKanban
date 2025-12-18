"use client"

import { Suspense } from "react"
import { KanbanContent } from "./kanban-content"

export default function ProcessosPage() {
  return (
    <Suspense fallback={<LoadingScreen />}>
      <KanbanContent />
    </Suspense>
  )
}

function LoadingScreen() {
  return (
    <div className="relative min-h-screen text-white overflow-x-hidden overscroll-none">
      <div className="pointer-events-none fixed inset-0 -z-10 bg-[url('/espanha.jpg')] bg-cover bg-center bg-no-repeat" />
      <div className="min-h-screen bg-black/40 backdrop-blur-sm flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin h-12 w-12 border-4 border-white border-t-transparent rounded-full mx-auto mb-4" />
          <p className="text-white/70">Carregando...</p>
        </div>
      </div>
    </div>
  )
}