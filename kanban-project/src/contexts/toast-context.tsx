"use client"

import React, { useState, useEffect } from 'react'
import { CheckCircle, XCircle, X } from 'lucide-react'

interface Toast {
  id: string
  type: 'success' | 'error'
  message: string
}

interface ToastContextType {
  showToast: (message: string, type: 'success' | 'error') => void
}

const ToastContext = React.createContext<ToastContextType | undefined>(undefined)

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])

  const showToast = (message: string, type: 'success' | 'error') => {
    const id = Math.random().toString(36).substr(2, 9)
    const newToast = { id, message, type }
    
    setToasts(prev => [...prev, newToast])
    
    // Remove toast após 5 segundos
    setTimeout(() => {
      setToasts(prev => prev.filter(toast => toast.id !== id))
    }, 5000)
  }

  const removeToast = (id: string) => {
    setToasts(prev => prev.filter(toast => toast.id !== id))
  }

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      
      {/* Toast Container */}
      <div className="fixed top-4 right-4 z-50 space-y-2">
        {toasts.map(toast => (
          <div
            key={toast.id}
            className={`
              flex items-center p-4 rounded-lg shadow-lg max-w-sm
              ${toast.type === 'success' 
                ? 'bg-green-50 text-green-800 border border-green-200 dark:bg-green-900/20 dark:text-green-400 dark:border-green-800' 
                : 'bg-red-50 text-red-800 border border-red-200 dark:bg-red-900/20 dark:text-red-400 dark:border-red-800'
              }
              animate-in slide-in-from-right-4
            `}
          >
            {toast.type === 'success' ? (
              <CheckCircle className="h-5 w-5 mr-3 flex-shrink-0" />
            ) : (
              <XCircle className="h-5 w-5 mr-3 flex-shrink-0" />
            )}
            
            <p className="text-sm font-medium flex-grow">{toast.message}</p>
            
            <button
              onClick={() => removeToast(toast.id)}
              className="ml-2 flex-shrink-0 opacity-70 hover:opacity-100"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export const useToast = () => {
  const context = React.useContext(ToastContext)
  
  // Em ambiente de servidor, sempre retorna função vazia
  if (typeof window === 'undefined') {
    return {
      showToast: () => {}
    }
  }
  
  // No cliente, se não há context, também retorna função vazia temporariamente
  if (context === undefined) {
    return {
      showToast: () => {}
    }
  }
  
  return context
}