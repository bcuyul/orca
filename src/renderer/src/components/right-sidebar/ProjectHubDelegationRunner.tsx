/** Hermes-inspired human-gated multi-story CLI launcher.
 * Uses Orca's own replay-safe runtime, never writes prompts to an arbitrary shell.
 * Launches are persisted BEFORE side effects; ambiguous outcomes require reconciliation. */
import { useState } from 'react'
import { Bot, GitBranch, PlayCircle, ShieldAlert } from 'lucide-react'
import type { HubDocument } from '../../../../shared/project-hub-types'
import {
  HUB_CLI_AGENTS, prepareHubDelegation, renderHubWorkerPrompt, parseHubLaunchReceipt,
  type HubCliAgent, type HubDelegation
} from '../../../../shared/project-hub-delegation'
import { createStructuredAgentSessionOperationId } from '../../../../shared/structured-agent-session-mutation'
import { createBrowserUuid } from '@/lib/browser-uuid'
import { summarizeHubDelegationCapacity } from '../../../../shared/project-hub-delegation-capacity'

type Props={
  document:HubDocument
  repoId:string
  hostId:string
  branch:string
  onSave:(next:HubDocument)=>Promise<boolean>
  onUpdated:(next:HubDocument)=>void
}
const names:Record<HubCliAgent,string>={opencode:'OpenCode CLI',codex:'Codex CLI',claude:'Claude Code CLI',hermes:'Hermes CLI'}
const button='rounded-md border border-border bg-muted px-3 py-2 text-xs disabled:opacity-40'
const statuses={
  planned:'Preparado, sin ejecutar',
  launching:'Lanzamiento reservado / resultado pendiente',
  launched:'CLI iniciado; instrucciones entregadas; trabajo sin verificar',
  unconfirmed:'Resultado desconocido: requiere conciliación'
} as const

export default function ProjectHubDelegationRunner({document,repoId,hostId,branch,onSave,onUpdated}:Props):React.JSX.Element{
  const [selected,setSelected]=useState<string[]>([])
  const [worker,setWorker]=useState<HubCliAgent>('opencode')
  const [reviewer,setReviewer]=useState<HubCliAgent|'human'>('codex')
  const [limit,setLimit]=useState(2)
  const [approved,setApproved]=useState(false)
  const [busy,setBusy]=useState(false)
  const [notice,setNotice]=useState('')
  const local=hostId==='local'
  const rows=document.delegations??[]
  const available=document.items.filter(item=>
    ['backlog','ready'].includes(item.status)&&!rows.some(d=>d.storyId===item.id)
  )
  const capacity=summarizeHubDelegationCapacity(rows,repoId,hostId,limit)
  const pending=rows.filter(d=>d.status==='planned'&&d.repoId===repoId&&d.hostId===hostId)
  const slots=capacity.available

  async function prepare():Promise<void>{
    setNotice('')
    try{
      const next=prepareHubDelegation({document,storyIds:selected,agent:worker,reviewer,
        baseBranch:branch,repoId,hostId,now:new Date().toISOString(),
        mint:()=>{
          const uuid=createBrowserUuid().replaceAll('-','').toLowerCase()
          return {id:`hub-${uuid}`,operationId:createStructuredAgentSessionOperationId(createBrowserUuid)}
        }})
      if(await onSave(next)){setSelected([]);setApproved(false);setNotice('Lote preparado y guardado. Todavía no se inició ningún agente.')}
    }catch(e){setNotice(`No se pudo preparar: ${String(e)}`)}
  }

  /** Every iteration awaits the durable reserve and the host receipt; worker processes themselves run in parallel. */
  async function launchBatch():Promise<void>{
    if(!approved||!local||busy||slots<=0){return}
    setBusy(true);setNotice('')
    const targetProject=document.projectId
    const targetRepo=repoId
    const targetHost=hostId
    let created=0
    try{
      for(const planned of pending.slice(0,slots)){
        const fresh=await window.api.projectHub.read(targetProject)
        const current=fresh.delegations?.find(x=>x.id===planned.id)
        if(!current||current.status!=='planned'||current.operationId!==planned.operationId||
           current.repoId!==targetRepo||current.hostId!==targetHost){
          throw new Error('Plan modified by another window. Reload before launching.')
        }
        const reserved:HubDocument={...fresh,delegations:(fresh.delegations??[]).map(row=>
          row.id===current.id?{...row,status:'launching' as const}:row)}
        const checkpoint=await window.api.projectHub.save({
          projectId:targetProject,document:reserved,expectedRevision:fresh.revision
        })
        onUpdated(checkpoint)
        let result:Awaited<ReturnType<typeof window.api.runtime.call>>|null=null
        let failure=''
        try {
          result=await window.api.runtime.call({
            method:'agent.launchReplay',
            params:{
              operationId:current.operationId,
              agent:current.agent,
              target:{kind:'create-worktree',create:{
                repo:repoId,repoHostId:hostId,name:current.name,baseBranch:current.baseBranch,
                runHooks:false,activate:false,noParent:true,clientMutationId:current.operationId
              }},
              prompt:{text:renderHubWorkerPrompt(checkpoint,current),delivery:'submit'},
              surface:'terminal',
              presentation:'background',
              launchSource:'project-hub'
            }
          })
        }catch(e){failure=String(e)}
        const latest=await window.api.projectHub.read(targetProject)
        const reservedRecord=latest.delegations?.find(x=>x.id===current.id)
        if(reservedRecord?.status!=='launching'||reservedRecord.operationId!==current.operationId){
          throw new Error('Launch reservation changed; inspect Orca sessions before retrying')
        }
        const receipt=result?.ok?parseHubLaunchReceipt(result.result):null
        const payload=result?.ok&&typeof result.result==='object'&&result.result!==null
          ? result.result as {prompt?:{outcome?:string}}:null
        const delivered=payload?.prompt?.outcome==='handed-to-terminal'
        const outcome:HubDelegation=receipt&&delivered
          ?{...reservedRecord,status:'launched',worktreeId:receipt.worktreeId,
              terminalHandle:receipt.terminalHandle,...(receipt.warning?{warning:receipt.warning}:{})}
          :{...reservedRecord,status:'unconfirmed',warning:(
            failure||(result&&!result.ok?result.error.message:
            'Host receipt or initial prompt delivery not confirmed; do not launch again with a new ID')
          ).slice(0,1000)}
        const committed=await window.api.projectHub.save({
          projectId:targetProject,
          document:{...latest,delegations:latest.delegations?.map(d=>d.id===outcome.id?outcome:d)},
          expectedRevision:latest.revision
        })
        onUpdated(committed)
        if(outcome.status==='unconfirmed'){
          throw new Error('At least one launch is unconfirmed. Inspect the Orca session before proceeding.')
        }
        created++
      }
      setNotice(`${created} agente(s) CLI iniciado(s) en worktrees nuevos. No se han verificado tareas ni CI.`)
    }catch(e){setNotice(`Lote detenido después de ${created} confirmaciones: ${String(e)}`)}
    finally{setBusy(false);setApproved(false)}
  }

  return <section className="space-y-3 rounded-lg border border-border bg-card p-3">
    <h3 className="flex items-center gap-2 text-sm font-semibold"><Bot className="h-4 w-4"/> Centro de ejecución</h3>
    <p className="text-xs text-muted-foreground">
      Selecciona historias y autoriza el inicio. Orca creará un worktree y una sesión CLI por historia,
      enviando las instrucciones automáticamente al agente asignado, sin copiar ni pegar.
      El estado indica entrega inicial, no finalización ni aprobación.
    </p>
    {!local&&<p role="alert" className="text-xs text-destructive">
      Lanzamiento deshabilitado en hosts remotos: falta enlace RPC específico al host. Solo planificación permitida.
    </p>}
    <div className="space-y-1">
      {available.map(item=><label key={item.id} className="flex items-start gap-2 rounded p-1.5 text-xs">
        <input type="checkbox" checked={selected.includes(item.id)} disabled={busy}
          onChange={e=>setSelected(ids=>e.target.checked?[...ids,item.id]:ids.filter(id=>id!==item.id))}/>
        <span><strong>{item.id}</strong> · {item.title}</span>
      </label>)}
      {!available.length&&<p className="text-xs text-muted-foreground">No hay historias nuevas elegibles para este lote.</p>}
    </div>
    <div className="grid grid-cols-2 gap-2">
      <label className="text-xs">Ejecutor CLI
        <select className="mt-1 w-full rounded border border-border bg-background p-2" value={worker}
          disabled={busy} onChange={e=>{const next=e.target.value as HubCliAgent;setWorker(next);if(reviewer===next){setReviewer('human')}}}>
          {HUB_CLI_AGENTS.map(a=><option key={a} value={a}>{names[a]}</option>)}
        </select>
      </label>
      <label className="text-xs">Revisor independiente
        <select className="mt-1 w-full rounded border border-border bg-background p-2" value={reviewer}
          disabled={busy} onChange={e=>setReviewer(e.target.value as HubCliAgent|'human')}>
          <option value="human">Humano</option>
          {HUB_CLI_AGENTS.filter(a=>a!==worker).map(a=><option key={a} value={a}>{names[a]}</option>)}
        </select>
      </label>
    </div>
    <p className="text-xs text-muted-foreground">
      El revisor queda registrado en el plan. Su sesión y la revisión automática se habilitarán en una fase posterior.
    </p>
    <div className="flex flex-wrap items-end gap-2">
      <label className="text-xs">Máximo de agentes simultáneos
        <select className="mt-1 block rounded border border-border bg-background p-2"
          value={limit} onChange={e=>setLimit(Number(e.target.value))} disabled={busy}>
          {[1,2,3].map(n=><option key={n} value={n}>{n}</option>)}
        </select>
      </label>
      <button type="button" className={button} disabled={busy||selected.length===0||selected.length>10||reviewer===worker}
        onClick={()=>void prepare()}>Preparar {selected.length||''} historia(s)</button>
    </div>
    <p className="flex items-center gap-1 text-xs text-muted-foreground">
      <GitBranch className="h-3.5 w-3.5"/> Rama seleccionada: {branch.replace(/^refs\/heads\//,'')} · Cupos retenidos: {capacity.held}/{limit}
    </p>
    <div className="grid grid-cols-3 gap-2 rounded border border-border p-2 text-xs" aria-label="Estado de delegaciones en este repositorio y host">
      <p>Inicios confirmados: <strong>{capacity.launched}</strong><span className="block text-muted-foreground">Trabajo no verificado</span></p>
      <p>En lanzamiento: <strong>{capacity.launching}</strong><span className="block text-muted-foreground">Sin recibo final</span></p>
      <p>Por conciliar: <strong>{capacity.unconfirmed}</strong><span className="block text-muted-foreground">No equivale a agente activo</span></p>
    </div>
    {rows.length>0&&<div className="space-y-2">
      <h4 className="text-xs font-semibold">Plan registrado</h4>
      {rows.map(d=><div key={d.id} className="rounded border border-border bg-background p-2 text-xs">
        <strong>{d.storyId}</strong> · {names[d.agent]} · {statuses[d.status]}
        <p className="break-all text-muted-foreground">{d.name} · repo {d.repoId} · host {d.hostId}{d.worktreeId?` · ${d.worktreeId}`:''}</p>
        <p className="break-all text-muted-foreground">Rama base registrada: {d.baseBranch}</p>
        {(d.status==='launching'||d.status==='unconfirmed')&&
          <p className="mt-1 break-all font-mono text-[11px] text-muted-foreground">
            ID de operación (conservar): {d.operationId}
          </p>}
        {d.warning&&<p role="alert" className="text-destructive">{d.warning}</p>}
        {d.status==='unconfirmed'&&<p role="alert" className="mt-1 text-xs text-destructive">
          Evidencia de lanzamiento insuficiente: operación pendiente de conciliación manual.
          No implica agente activo ni autoriza nuevos intentos. Conserva el ID y comprueba el registro duradero, los worktrees y las sesiones.
        </p>}
      </div>)}
    </div>}
    {pending.length>0&&<>
      <label className="flex items-start gap-2 text-xs">
        <input type="checkbox" checked={approved} disabled={busy} onChange={e=>setApproved(e.target.checked)}/>
        Autorizo crear nuevos worktrees y ejecutar los agentes CLI seleccionados. No autorizo merge ni despliegue.
      </label>
      <button type="button" className={button} disabled={!approved||busy||!local||slots<1}
        onClick={()=>void launchBatch()}>
        <PlayCircle className="mr-1 inline h-4 w-4"/> Iniciar y enviar instrucciones a {Math.min(slots,pending.length)} agente(s)
      </button>
    </>}
    {capacity.held>0&&<p className="flex items-start gap-2 text-xs text-muted-foreground">
      <ShieldAlert className="h-4 w-4 shrink-0"/>
      Para liberar cupos hará falta conciliación con sesiones vivas y revisión; cerrar una pestaña no equivale a completar el trabajo.
    </p>}
    {notice&&<p role="status" className="text-xs">{notice}</p>}
  </section>
}
