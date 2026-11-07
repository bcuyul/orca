/** Hermes-inspired human-gated multi-story CLI launcher.
 * Uses Orca's own replay-safe runtime, never writes prompts to an arbitrary shell.
 * Launches are persisted BEFORE side effects; ambiguous outcomes require reconciliation. */
import { useState } from 'react'
import { Bot, GitBranch, PlayCircle, ShieldAlert } from 'lucide-react'
import type { HubDocument } from '../../../../shared/project-hub-types'
import {
  HUB_CLI_AGENTS, prepareHubDelegation,
  type HubCliAgent
} from '../../../../shared/project-hub-delegation'
import { createStructuredAgentSessionOperationId } from '../../../../shared/structured-agent-session-mutation'
import { createBrowserUuid } from '@/lib/browser-uuid'
import {
  HUB_AGENT_PROFILES, HUB_AGENT_PROFILE_LABELS, type HubAgentProfile
} from '../../../../shared/project-hub-agent-profiles'
import { summarizeHubDelegationCapacity } from '../../../../shared/project-hub-delegation-capacity'
import {
  estimateHubDelegationTokens, getHubProviderQuota, shareOfPlannedTokenBudget,
  HUB_MAX_TASK_TOKENS, HUB_TOKEN_SCENARIOS,
  type HubTokenScenario, type HubDelegationTokenEstimate
} from '../../../../shared/project-hub-delegation-quota'
import { useAppStore } from '@/store'

type Props={
  document:HubDocument
  repoId:string
  hostId:string
  branch:string
  onSave:(next:HubDocument)=>Promise<boolean>
}
const names:Record<HubCliAgent,string>={opencode:'OpenCode CLI',codex:'Codex CLI',claude:'Claude Code CLI',hermes:'Hermes CLI'}
const button='rounded-md border border-border bg-muted px-3 py-2 text-xs disabled:opacity-40'
const freshTimestamp = (): string => new Date().toISOString()
const statuses={
  planned:'Preparado, sin ejecutar',
  launching:'Lanzamiento reservado / resultado pendiente',
  launched:'CLI iniciado; instrucciones entregadas; trabajo sin verificar',
  unconfirmed:'Resultado desconocido: requiere conciliación'
} as const

export default function ProjectHubDelegationRunner({document,repoId,hostId,branch,onSave}:Props):React.JSX.Element{
  const [selected,setSelected]=useState<string[]>([])
  const [worker,setWorker]=useState<HubCliAgent>('opencode')
  const [profile,setProfile]=useState<HubAgentProfile>('forge')
  const [reviewer,setReviewer]=useState<HubCliAgent|'human'>('codex')
  const [limit,setLimit]=useState(2)
  const [busy,setBusy]=useState(false)
  const [notice,setNotice]=useState('')
  const [workloads,setWorkloads]=useState<Record<string,HubTokenScenario>>({})
  const [manualEstimates,setManualEstimates]=useState<Record<string,string>>({})
  const [tokenBudgetText,setTokenBudgetText]=useState('')
  const [quotaBusy,setQuotaBusy]=useState(false)
  const rateLimits=useAppStore(state=>state.rateLimits)
  const local=hostId==='local'
  const rows=document.delegations??[]
  const available=document.items.filter(item=>
    ['backlog','ready'].includes(item.status)&&!rows.some(d=>d.storyId===item.id)
  )
  const capacity=summarizeHubDelegationCapacity(rows,repoId,hostId,limit)
  const pending=rows.filter(d=>d.status==='planned'&&d.repoId===repoId&&d.hostId===hostId)
  const quota=getHubProviderQuota(worker,hostId,rateLimits)
  const selectedStories=available.filter(item=>selected.includes(item.id))
  const taskEstimates=selectedStories.map(item=>{
    const scenario=workloads[item.id]??'standard'
    const raw=manualEstimates[item.id]?.trim()??''
    try{
      if(raw&&!/^[1-9]\d{0,6}$/.test(raw)){
        throw new Error('Introduce una cantidad entera entre 1 y 5.000.000')
      }
      const estimate=estimateHubDelegationTokens(item,scenario,raw?Number(raw):undefined)
      return {id:item.id,item,estimate,error:''}
    }catch(error){
      return {id:item.id,item,estimate:null as HubDelegationTokenEstimate|null,error:String(error)}
    }
  })
  const invalidEstimate=taskEstimates.some(row=>row.error!=='')
  const plannedTotal=taskEstimates.reduce((sum,row)=>sum+(row.estimate?.totalTokens??0),0)
  const budgetIsValid=!tokenBudgetText.trim()||
    (/^[1-9]\d{0,7}$/.test(tokenBudgetText.trim())&&Number(tokenBudgetText)<=50_000_000)
  const tokenBudget=budgetIsValid&&tokenBudgetText.trim()?Number(tokenBudgetText):null
  const budgetShare=budgetIsValid?shareOfPlannedTokenBudget(plannedTotal,tokenBudget):null
  const overBudget=tokenBudget!==null&&plannedTotal>tokenBudget

  async function refreshQuota():Promise<void>{
    if(quotaBusy){return}
    setQuotaBusy(true)
    try{await useAppStore.getState().refreshRateLimits()}
    finally{setQuotaBusy(false)}
  }

  async function prepare():Promise<void>{
    if(busy||invalidEstimate||!budgetIsValid||overBudget){return}
    setBusy(true)
    setNotice('')
    try{
      const tokenEstimates:Record<string,HubDelegationTokenEstimate>={}
      for(const row of taskEstimates){
        if(!row.estimate){throw new Error('Completa las estimaciones de tokens')}
        tokenEstimates[row.id]=row.estimate
      }
      const next=prepareHubDelegation({document,storyIds:selected,agent:worker,reviewer,profile,
        tokenEstimates,
        ...(tokenBudget!==null?{tokenBudget}:{}),
        baseBranch:branch,repoId,hostId,now:freshTimestamp(),
        mint:()=>{
          const uuid=createBrowserUuid().replaceAll('-','').toLowerCase()
          return {id:`hub-${uuid}`,operationId:createStructuredAgentSessionOperationId(createBrowserUuid)}
        }})
      if(await onSave(next)){
        setSelected([])
        setNotice('Lote y estimaciones de tokens guardados. No se inició ningún agente.')
      }
    }catch(e){setNotice(`No se pudo preparar: ${String(e)}`)}
    finally{setBusy(false)}
  }


  return <section className="space-y-3 rounded-lg border border-border bg-card p-3">
    <h3 className="flex items-center gap-2 text-sm font-semibold"><Bot className="h-4 w-4"/> Planificación de delegaciones</h3>
    <p className="text-xs text-muted-foreground">
      Selecciona historias y guarda un plan de asignación para revisión.
      Esta versión no crea worktrees, no inicia sesiones CLI y no envía instrucciones a agentes.
      El registro de un plan no constituye una autorización de ejecución.
    </p>
    <p role="alert" className="text-xs text-destructive">
      Ejecución de agentes deshabilitada en esta integración: falta consentimiento autenticado del host y sandbox verificable. La planificación sigue disponible.
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
    <label className="block text-xs">SOUL.md del ejecutor (perfil fijo, sin permisos adicionales)
      <select className="mt-1 w-full rounded border border-border bg-background p-2"
        value={profile} disabled={busy}
        onChange={e=>setProfile(e.target.value as HubAgentProfile)}>
        {HUB_AGENT_PROFILES.map(id=><option key={id} value={id}>{HUB_AGENT_PROFILE_LABELS[id]}</option>)}
      </select>
    </label>
    <p className="text-xs text-muted-foreground">
      El revisor queda registrado en el plan. Su sesión y la revisión automática se habilitarán en una fase posterior.
    </p>
    <section className="space-y-2 rounded border border-border p-2 text-xs"
      aria-label="Tokens y cuota estimados para delegación">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <strong>Estimación de tokens y cuota</strong>
        <button className={button} type="button" disabled={quotaBusy||!local}
          onClick={()=>void refreshQuota()}>
          {quotaBusy?'Actualizando…':'Actualizar cuota del proveedor'}
        </button>
      </div>
      <p className="text-muted-foreground">
        Cuota real = porcentaje usado en ventanas temporales del proveedor.
        No se convierte a tokens: la tarifa de consumo depende del plan, modelo y tipo de operación.
      </p>
      {quota.kind==='verified'?<div role="status" className="space-y-1">
        <p>Cuenta {quota.providerLabel} configurada en Orca (asociación al CLI pendiente de comprobar):</p>
        {quota.windows.map(window=><p key={window.name}>
          {window.name}: <strong>{window.usedPercent}% usado</strong> · {window.remainingPercent}% restante
        </p>)}
        <p className="text-muted-foreground">{quota.note}</p>
      </div>:<p className="text-muted-foreground" role="status">
        {quota.providerLabel}: cuota no verificable. {quota.note}
      </p>}
      <label className="block">Presupuesto de tokens del lote (opcional, definido por ti)
        <input className="mt-1 w-full rounded border border-border bg-background p-2"
          type="number" min={1} max={50000000} step={1}
          aria-label="Presupuesto de tokens del lote" placeholder="Sin límite configurado"
          value={tokenBudgetText} disabled={busy}
          onChange={event=>setTokenBudgetText(event.target.value)}/>
      </label>
      {!budgetIsValid&&<p role="alert" className="text-destructive">
        El presupuesto debe ser un entero positivo, máximo 50.000.000 tokens.
      </p>}
      {taskEstimates.map(row=><div className="space-y-1 rounded border border-border p-2"
        key={row.id}>
        <strong>{row.id} · {row.item.title}</strong>
        <div className="grid grid-cols-2 gap-2">
          <label>Esfuerzo estimado
            <select className="mt-1 w-full rounded border border-border bg-background p-2"
              value={workloads[row.id]??'standard'} disabled={busy}
              aria-label={`${row.id} Esfuerzo estimado`}
              onChange={event=>setWorkloads(previous=>({
                ...previous,[row.id]:event.target.value as HubTokenScenario
              }))}>
              {HUB_TOKEN_SCENARIOS.map(level=><option key={level} value={level}>
                {level==='small'?'Pequeño':level==='standard'?'Mediano':'Grande'}
              </option>)}
            </select>
          </label>
          <label>Tokens estimados (editable)
            <input className="mt-1 w-full rounded border border-border bg-background p-2"
              type="number" min={1} max={HUB_MAX_TASK_TOKENS} step={1}
              value={manualEstimates[row.id]??''} disabled={busy}
              aria-label={`${row.id} Tokens estimados`}
              placeholder={row.estimate?.totalTokens.toLocaleString('es-CL')??'Sin estimar'}
              onChange={event=>setManualEstimates(previous=>({
                ...previous,[row.id]:event.target.value
              }))}/>
          </label>
        </div>
        {row.estimate?<p className="text-muted-foreground">
          <strong>{row.estimate.totalTokens.toLocaleString('es-CL')} tokens previstos</strong>
          {' '}· texto del encargo aprox. {row.estimate.promptTokens.toLocaleString('es-CL')}
          {' '}· {row.estimate.source==='manual'?'ajustado manualmente':'escenario orientativo'}
          {tokenBudget!==null?` · ${shareOfPlannedTokenBudget(row.estimate.totalTokens,tokenBudget)}% del presupuesto del lote`:''}
        </p>:<p role="alert" className="text-destructive">{row.error}</p>}
      </div>)}
      <p className="font-medium">
        Total del lote: {plannedTotal.toLocaleString('es-CL')} tokens orientativos
        {budgetShare!==null?` · ${budgetShare}% del presupuesto manual`:''}
      </p>
      {overBudget&&<p role="alert" className="text-destructive">
        El lote supera el presupuesto manual: reduce las estimaciones o aumenta el límite antes de prepararlo.
      </p>}
      <p className="text-muted-foreground">
        Valores de referencia, no predicción verificada ni consumo real.
        El agente puede usar más tokens por repositorio, pruebas, herramientas y reintentos.
        No conceden permisos ni garantizan cuota.
      </p>
    </section>
    <div className="flex flex-wrap items-end gap-2">
      <label className="text-xs">Máximo de agentes simultáneos
        <select className="mt-1 block rounded border border-border bg-background p-2"
          value={limit} onChange={e=>setLimit(Number(e.target.value))} disabled={busy}>
          {[1,2,3].map(n=><option key={n} value={n}>{n}</option>)}
        </select>
      </label>
      <button type="button" className={button} disabled={busy||selected.length===0||selected.length>10||reviewer===worker||invalidEstimate||!budgetIsValid||overBudget}
        onClick={()=>void prepare()}>Preparar {selected.length||''} historia(s)</button>
    </div>
    <p className="flex items-center gap-1 text-xs text-muted-foreground">
      <GitBranch className="h-3.5 w-3.5"/> Rama seleccionada: {branch.replace(/^refs\/heads\//,'')} · Cupos retenidos: {capacity.held}/{limit}
    </p>
    <div className="space-y-1 rounded border border-border p-2 text-xs" aria-label="Estado de delegaciones en este repositorio y host">
      <p>Inicios confirmados: <strong>{capacity.launched}</strong> <span className="text-muted-foreground">· trabajo no verificado</span></p>
      <p>En lanzamiento: <strong>{capacity.launching}</strong> <span className="text-muted-foreground">· sin recibo final</span></p>
      <p>Por conciliar: <strong>{capacity.unconfirmed}</strong> <span className="text-muted-foreground">· no equivale a agente activo</span></p>
    </div>
    {rows.length>0&&<div className="space-y-2">
      <h4 className="text-xs font-semibold">Plan registrado</h4>
      {rows.map(d=><div key={d.id} className="rounded border border-border bg-background p-2 text-xs">
        <strong>{d.storyId}</strong> · {names[d.agent]} · SOUL {d.profile??'forge (heredado)'} · {statuses[d.status]}
        <p className="break-all text-muted-foreground">{d.name} · repo {d.repoId} · host {d.hostId}{d.worktreeId?` · ${d.worktreeId}`:''}</p>
        <p className="break-all text-muted-foreground">Rama base registrada: {d.baseBranch}</p>
        {d.tokenEstimate&&<p className="text-muted-foreground">
          Tokens planeados: {d.tokenEstimate.totalTokens.toLocaleString('es-CL')}
          {' '}· {d.tokenEstimate.source==='manual'?'estimación manual':'escenario orientativo'}
          {' '}· sin consumo real acreditado
        </p>}
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
    {pending.length>0&&<button type="button" className={button} disabled>
      <PlayCircle className="mr-1 inline h-4 w-4"/> Iniciar y enviar instrucciones (requiere autorización del host)
    </button>}
    {capacity.held>0&&<p className="flex items-start gap-2 text-xs text-muted-foreground">
      <ShieldAlert className="h-4 w-4 shrink-0"/>
      Para liberar cupos hará falta conciliación con sesiones vivas y revisión; cerrar una pestaña no equivale a completar el trabajo.
    </p>}
    {notice&&<p role="status" className="text-xs">{notice}</p>}
  </section>
}
