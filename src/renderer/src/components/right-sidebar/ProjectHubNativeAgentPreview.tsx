/** Orca's own agent detector feeds a read-only Project Hub candidate list. */
import { useEffect, useMemo } from 'react'
import type { HubDocument } from '../../../../shared/project-hub-types'
import type { NativeAgentInventoryStatus } from '../../../../shared/project-hub-native-agent-routing'
import { previewNativeAgentRouting } from '../../../../shared/project-hub-native-agent-routing'
import { useAppStore } from '@/store'

type Props = {
  doc: HubDocument
  worktreeId: string
  hostId: string
  gitHead: string
}

export default function ProjectHubNativeAgentPreview({
  doc, worktreeId, hostId, gitHead
}: Props): React.JSX.Element {
  const inventories = useAppStore(state => state.localDetectedAgentIdsByContext)
  const detecting = useAppStore(state => state.isDetectingLocalAgentsByContext)
  const refreshing = useAppStore(state => state.isRefreshingLocalAgentsByContext)
  const disabled = useAppStore(state => state.settings?.disabledTuiAgents)
  const local = hostId === 'local' && Boolean(worktreeId)

  useEffect(() => {
    if (!local) { return }
    // Passive native detection does not wake WSL or launch any worker.
    void useAppStore.getState().ensureDetectedAgents(worktreeId)
  }, [local, worktreeId])

  const inventory = useMemo(() => local
    ? useAppStore.getState().readLocalAgentInventory(worktreeId)
    : { ids: null, state: 'pending' as const },
  [local, worktreeId, inventories, detecting, refreshing])
  const status: NativeAgentInventoryStatus = local
    ? inventory.state : 'unsupported-host'
  const preview = useMemo(() =>
    previewNativeAgentRouting(doc, status, inventory.ids, disabled ?? []),
  [doc, status, inventory.ids, disabled])

  return <section className="space-y-2 rounded-lg border border-border bg-card p-3 text-xs"
    aria-label="Vista previa de agentes nativos">
    <h3 className="text-sm font-semibold">Agentes Orca · enrutamiento en solo lectura</h3>
    <p className="text-muted-foreground">
      {status === 'successful'
        ? String(preview.installedAgents.length) + ' agentes habilitados detectados'
        : status === 'failed' ? 'Detección fallida; inventario no confirmado'
          : status === 'unsupported-host'
            ? 'Host remoto: falta inventario asociado al host'
            : 'Detección pendiente'}
    </p>
    {preview.installedAgents.length > 0 && <p className="break-words text-muted-foreground">
      {preview.installedAgents.join(' · ')}
    </p>}
    <p className="break-all text-muted-foreground">
      Worktree: {worktreeId} · HEAD de catálogo: {gitHead.slice(0, 12) || 'desconocido'}
      {' '}(puede estar desactualizado).
    </p>
    {!preview.approvedPlanId && <p>Sin plan de Atlas aprobado para enrutar.</p>}
    {preview.tasks.length > 0 && <div className="space-y-2">
      <p className="font-medium">Plan aprobado: {preview.approvedPlanId}</p>
      {preview.tasks.map(task => <div key={task.id} className="rounded border border-border p-2">
        <p className="font-medium">{task.id} · {task.title} ({task.role})</p>
        <p className="text-muted-foreground">
          Dependencias: {task.dependsOn.join(', ') || 'sin dependencias'}
        </p>
        <p className="text-muted-foreground">
          CLI detectados para evaluar: {task.agentCandidates.length}; capacidades sin verificar
        </p>
        <p className="text-muted-foreground">
          Sesión/worktree: conciliación pendiente. {task.reason}
        </p>
      </div>)}
    </div>}
    <p role="status" className="rounded border border-border p-2 text-muted-foreground">
      Sin envío ni creación de sesiones o worktrees. Falta un recibo reciente del host
      para Git, sesiones, memoria, permisos y aislamiento. Plan aprobado no concede ejecución.
    </p>
  </section>
}
