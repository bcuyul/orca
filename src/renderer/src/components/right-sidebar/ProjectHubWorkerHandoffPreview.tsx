/** Advisory one-task Run → CLI draft. Clipboard only; no model, session or Dispatch. */
import { useEffect, useMemo, useState } from 'react'
import { useAppStore } from '@/store'
import type { HubDocument } from '../../../../shared/project-hub-types'
import type { NativePlanPreview } from '../../../../shared/native-plan-preview'
import type { HubWorkerReadiness } from '../../../../shared/project-hub-worker-readiness'
import type { HubDispatchRecoveryReport } from '../../../../shared/project-hub-worker-dispatch-recovery'
import type { NativeAgentInventoryStatus } from '../../../../shared/project-hub-native-agent-routing'
import type { TuiAgent } from '../../../../shared/tui-agent'
import { previewHubWorkerHandoff } from '../../../../shared/project-hub-worker-handoff-preview'

type Props = {
  doc: HubDocument
  preview: NativePlanPreview
  readiness: HubWorkerReadiness
  dispatchRecovery: HubDispatchRecoveryReport | null
  baseSha: string | null
  hostId: string
  worktreeId: string
}

const control = 'rounded border border-border bg-muted px-3 py-2 text-xs disabled:opacity-40'

export default function ProjectHubWorkerHandoffPreview({
  doc, preview, readiness, dispatchRecovery, baseSha, hostId, worktreeId
}: Props): React.JSX.Element {
  const inventories = useAppStore(state => state.localDetectedAgentIdsByContext)
  const detecting = useAppStore(state => state.isDetectingLocalAgentsByContext)
  const refreshing = useAppStore(state => state.isRefreshingLocalAgentsByContext)
  const disabled = useAppStore(state => state.settings?.disabledTuiAgents)
  const [preferred, setPreferred] = useState<TuiAgent | null>(null)
  const [notice, setNotice] = useState('')
  const local = hostId === 'local' && Boolean(worktreeId)

  useEffect(() => {
    if (!local) { return }
    // Existing Orca passive inventory; does not launch a CLI or wake WSL.
    void useAppStore.getState().ensureDetectedAgents(worktreeId)
  }, [local, worktreeId])

  const inventory = useMemo(() => local
    ? useAppStore.getState().readLocalAgentInventory(worktreeId)
    : { ids: null, state: 'pending' as const },
  [local, worktreeId, inventories, detecting, refreshing])
  const inventoryStatus: NativeAgentInventoryStatus = local
    ? inventory.state : 'unsupported-host'
  const handoff = useMemo(() => previewHubWorkerHandoff({
    document: doc, preview, readiness, dispatchRecovery, baseSha,
    inventoryStatus, detectedAgents: inventory.ids,
    disabledAgents: disabled ?? [], preferredAgent: preferred
  }), [
    doc, preview, readiness, dispatchRecovery, baseSha, inventoryStatus,
    inventory.ids, disabled, preferred
  ])

  async function copyDraft(): Promise<void> {
    if (handoff.status !== 'draft-only' || !handoff.prompt) { return }
    try {
      await window.api.ui.writeClipboardText(handoff.prompt)
      setNotice('Encargo copiado para revisión manual. No se inició ningún agente.')
    } catch {
      setNotice('No se pudo copiar el encargo. Ningún agente fue iniciado.')
    }
  }

  return <section aria-label="Preparación del traspaso de worker sin tokens"
    className="space-y-2 rounded border border-border p-3">
    <h5 className="font-semibold">Traspaso Run → CLI · solo propuesta</h5>
    <p className="text-muted-foreground">
      Vincula el Run/Task verificado con el inventario de agentes de Orca.
      Sugiere un CLI, pero NO verifica una sesión ni autoriza enviar instrucciones.
    </p>
    {handoff.runId && <p>Run: <code>{handoff.runId}</code></p>}
    {handoff.nativeTaskId && <p>Task raíz: <code>{handoff.taskId}</code> → <code>{handoff.nativeTaskId}</code></p>}
    {handoff.waitingFor.length > 0 && <p className="text-muted-foreground">
      QA/tareas dependientes: {handoff.waitingFor.map(t =>
        `${t.taskId} espera ${t.dependsOn.join(', ')}`).join('; ')}
    </p>}
    <p className="text-muted-foreground">
      Inventario de CLI: {inventoryStatus === 'successful'
        ? `${handoff.agentOptions.length} habilitados detectados`
        : inventoryStatus === 'failed' ? 'detección fallida'
          : inventoryStatus === 'unsupported-host' ? 'host no admitido'
            : 'detección pendiente'}
    </p>
    {handoff.agentOptions.length > 0 && <label className="block space-y-1">
      CLI sugerido (no es sesión autenticada)
      <select className="w-full rounded border border-border bg-background p-2"
        value={preferred ?? ''} onChange={e => {
          setPreferred(e.target.value ? e.target.value as TuiAgent : null)
          setNotice('')
        }}>
        <option value="">Automático · orden nativo de Orca</option>
        {handoff.agentOptions.map(agent =>
          <option key={agent} value={agent}>{agent}</option>)}
      </select>
    </label>}
    {handoff.selectedAgent && <p>
      Proveedor sugerido: <strong>{handoff.selectedAgent}</strong> · sin sesión asignada
    </p>}
    {handoff.status === 'draft-only' && handoff.prompt && <div className="space-y-2">
      <label className="block space-y-1">
        Encargo previsto para revisión (solo texto)
        <textarea className="w-full rounded border border-border bg-background p-2"
          rows={5} readOnly value={handoff.prompt}/>
      </label>
      <button type="button" className={control} onClick={() => void copyDraft()}>
        Copiar encargo del worker (sin ejecutar)
      </button>
    </div>}
    {handoff.blockers.length > 0 && <ul className="ml-4 list-disc text-muted-foreground">
      {handoff.blockers.map(text => <li key={text}>{text}</li>)}
    </ul>}
    {notice && <p role="status">{notice}</p>}
    <p className="font-medium">
      Ejecución y envío automático: bloqueados. Llamadas a modelos: 0.
    </p>
  </section>
}
