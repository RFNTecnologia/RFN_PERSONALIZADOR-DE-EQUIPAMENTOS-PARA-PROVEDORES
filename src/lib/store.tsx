import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { api, lerConexao } from './api'
import {
  brandingSeed,
  clientesSeed,
  equipamentosSeed,
  logsSeed,
  perfisSeed,
  politicaSeed,
} from './seed'
import type {
  Branding,
  Equipamento,
  EstadoApp,
  EventoLog,
  Perfil,
  PoliticaRestore,
  StatusCPE,
} from './types'

const CHAVE = 'rfn.estado.v1'

type Acoes = {
  atualizarBranding: (patch: Partial<Branding>) => void
  atualizarPerfil: (id: string, patch: Partial<Perfil>) => void
  atualizarPolitica: (patch: Partial<PoliticaRestore>) => void
  atualizarEquipamento: (id: string, patch: Partial<Equipamento>) => void
  registrarLog: (evento: Omit<EventoLog, 'id' | 'em'>) => void
  aplicarEstadoServidor: (dados: Partial<EstadoApp>) => void
  reiniciarDados: () => void
}

const Ctx = createContext<(EstadoApp & Acoes) | null>(null)

function estadoInicial(): EstadoApp {
  const base: EstadoApp = {
    branding: brandingSeed,
    perfis: perfisSeed,
    clientes: clientesSeed,
    equipamentos: equipamentosSeed,
    logs: logsSeed,
    politica: politicaSeed,
  }
  if (typeof window === 'undefined') return base
  try {
    const bruto = window.localStorage.getItem(CHAVE)
    if (!bruto) return base
    const salvo = JSON.parse(bruto) as Partial<EstadoApp>
    return {
      ...base,
      branding: salvo.branding ?? base.branding,
      perfis: salvo.perfis ?? base.perfis,
      politica: salvo.politica ?? base.politica,
    }
  } catch {
    return base
  }
}

export function ProvedorEstado({ children }: { children: ReactNode }) {
  const [estado, setEstado] = useState<EstadoApp>(estadoInicial)

  useEffect(() => {
    try {
      window.localStorage.setItem(
        CHAVE,
        JSON.stringify({
          branding: estado.branding,
          perfis: estado.perfis,
          politica: estado.politica,
        }),
      )
    } catch {
      /* persistência indisponível: a sessão segue apenas em memória */
    }
  }, [estado.branding, estado.perfis, estado.politica])

  // Sincronizacao automatica: quando ha servidor configurado, cada mudanca de
  // branding, perfis ou politica chega ao ACS em poucos segundos. Sem servidor,
  // o painel continua operando em modo local.
  useEffect(() => {
    const config = lerConexao()
    if (!config.token || !config.urlBase) return
    const id = window.setTimeout(() => {
      api
        .salvarEstado(config, { branding: estado.branding, perfis: estado.perfis, politica: estado.politica })
        .catch(() => {
          /* servidor fora do ar: o painel segue em modo local */
        })
    }, 900)
    return () => window.clearTimeout(id)
  }, [estado.branding, estado.perfis, estado.politica])

  const registrarLog = useCallback((evento: Omit<EventoLog, 'id' | 'em'>) => {
    setEstado((atual) => ({
      ...atual,
      logs: [
        {
          ...evento,
          id: `l${Date.now()}${Math.floor(Math.random() * 1000)}`,
          em: new Date().toISOString(),
        },
        ...atual.logs,
      ],
    }))
  }, [])

  const atualizarEquipamento = useCallback((id: string, patch: Partial<Equipamento>) => {
    setEstado((atual) => ({
      ...atual,
      equipamentos: atual.equipamentos.map((eq) =>
        eq.id === id ? { ...eq, ...patch } : eq,
      ),
    }))
  }, [])

  const aplicarEstadoServidor = useCallback((dados: Partial<EstadoApp>) => {
    setEstado((atual) => ({
      ...atual,
      branding: dados.branding ?? atual.branding,
      perfis: dados.perfis ?? atual.perfis,
      clientes: dados.clientes ?? atual.clientes,
      equipamentos: dados.equipamentos ?? atual.equipamentos,
      logs: dados.logs ?? atual.logs,
      politica: dados.politica ?? atual.politica,
    }))
  }, [])

  const valor = useMemo<EstadoApp & Acoes>(
    () => ({
      ...estado,
      atualizarBranding: (patch) =>
        setEstado((atual) => ({
          ...atual,
          branding: { ...atual.branding, ...patch },
        })),
      atualizarPerfil: (id, patch) =>
        setEstado((atual) => ({
          ...atual,
          perfis: atual.perfis.map((p) => (p.id === id ? { ...p, ...patch } : p)),
        })),
      atualizarPolitica: (patch) =>
        setEstado((atual) => ({
          ...atual,
          politica: { ...atual.politica, ...patch },
        })),
      atualizarEquipamento,
      registrarLog,
      aplicarEstadoServidor,
      reiniciarDados: () => setEstado(estadoInicial()),
    }),
    [estado, registrarLog, atualizarEquipamento, aplicarEstadoServidor],
  )

  return <Ctx.Provider value={valor}>{children}</Ctx.Provider>
}

export function useEstado() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useEstado precisa estar dentro de ProvedorEstado')
  return ctx
}

export const rotuloStatus: Record<StatusCPE, string> = {
  online: 'Online',
  offline: 'Offline',
  provisionando: 'Provisionando',
  atualizando: 'Atualizando',
  'em-recuperacao': 'Em recuperação',
}
