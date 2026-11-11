import { useEffect, useMemo, useState } from 'react'
import { LayoutDashboard, Plus, ShieldCheck } from 'lucide-react'
import { ProjectHubJiraImport, ProjectHubArchitecture, ProjectHubQuality, ProjectHubTeam } from './ProjectHubDesignViews'
import ProjectHubDelegationRunner from './ProjectHubDelegationRunner'
import ProjectHubIntelligencePanel from './ProjectHubIntelligencePanel'
import ProjectHubOverview from './ProjectHubOverview'
import ProjectHubNativeAgentPreview from './ProjectHubNativeAgentPreview'
import ProjectHubMathPreview from './ProjectHubMathPreview'
import ProjectHubTaskLinks from './ProjectHubTaskLinks'
import { useAppStore } from '@/store'
import { useProjectHostSetupProjection, useRepoById } from '@/store/selectors'
import { getProjectIdentityKey } from '../../../../shared/project-host-setup-projection'
import { resolveHubProjectId } from '../../../../shared/project-hub-project-id'
import { setHubBacklogItemArchived } from '../../../../shared/project-hub-backlog-archive'
import {
  PROJECT_HUB_PHASES, PROJECT_HUB_STATUSES, approveHubPhase, hasHubPhaseEvidence,
  type HubDocument, type HubItem, type HubStatus
} from '../../../../shared/project-hub-types'

type Tab = 'summary' | 'backlog' | 'blueprint' | 'delegate' | 'intelligence' | 'architecture' | 'qa' | 'team'
const STATUS_LABELS: Record<HubStatus,string> = {
  backlog:'Backlog',ready:'Ready',doing:'En progreso',review:'Revisión / QA',blocked:'Bloqueado',done:'Terminado'
}

/** Fail closed if the host provides multiple different project owners for a workspace. */
export default function ProjectHubPanel(): React.JSX.Element {
  const worktree=useAppStore(s=>s.activeWorktreeId ? s.getKnownWorktreeById(s.activeWorktreeId) : null)
  const repo=useRepoById(worktree?.repoId??null)
  const projection=useProjectHostSetupProjection()
  const projectId=useMemo(()=> worktree && repo ? resolveHubProjectId({
    projectId:worktree.projectId,repoId:worktree.repoId,hostId:worktree.hostId,
    projects:projection.projects,setups:projection.setups,fallback:getProjectIdentityKey(repo)
  }):null,[worktree,repo,projection])
  const projectName=projection.projects.find(p=>p.id===projectId)?.displayName ?? repo?.displayName ?? 'Proyecto'
  const [tab,setTab]=useState<Tab>('summary')
  const [doc,setDoc]=useState<HubDocument|null>(null)
  const [busy,setBusy]=useState(false)
  const [error,setError]=useState('')
  const [loading,setLoading]=useState(true)
  const [itemTitle,setItemTitle]=useState('')
  const [itemAcceptance,setItemAcceptance]=useState('')
  const [itemToRemove,setItemToRemove]=useState<string|null>(null)
  const [approvalNote,setApprovalNote]=useState('')
  const [approveChecked,setApproveChecked]=useState(false)

  useEffect(()=>{
    let live=true
    setDoc(null);setError('');setLoading(true);setApproveChecked(false);setItemToRemove(null)
    if(!projectId){setLoading(false);return ()=>{live=false}}
    void window.api.projectHub.read(projectId).then(data=>{
      if(live){setDoc(data);setLoading(false)}
    }).catch(e=>{if(live){setError(String(e));setLoading(false)}})
    return ()=>{live=false}
  },[projectId])

  const shown=doc?.projectId===projectId ? doc : null
  const archivedItems=shown?.items.filter(item=>item.archived)??[]
  async function save(next:HubDocument):Promise<boolean> {
    if(!projectId||!shown||next.projectId!==projectId||busy) { return false }
    setBusy(true);setError('')
    try {
      const saved=await window.api.projectHub.save({projectId,document:next,expectedRevision:shown.revision})
      setDoc(current=>current?.projectId===saved.projectId ? saved : current)
      return true
    } catch(e) {setError(String(e));return false}
    finally {setBusy(false)}
  }
  async function addStory():Promise<void>{
    if(!shown||!itemTitle.trim()) { return }
    const nextId=`PH-${String(Math.max(0,...shown.items.map(i=>Number(/^PH-(\d+)$/.exec(i.id)?.[1]??0)))+1).padStart(3,'0')}`
    const item:HubItem={id:nextId,title:itemTitle.trim().slice(0,160),type:'story',status:'backlog',
      phase:shown.phase,source:'local',acceptance:itemAcceptance.slice(0,2000),description:''}
    if(await save({...shown,items:[...shown.items,item]})) {
      setItemTitle('');setItemAcceptance('')
    }
  }
  async function archiveStory(id:string, archived:boolean):Promise<void> {
    if(!shown||busy) { return }
    try {
      const next=setHubBacklogItemArchived(shown,id,archived)
      if(await save(next)) { setItemToRemove(null) }
    } catch(e) { setError(String(e)) }
  }
  if(!projectId) { return <div className="p-4 text-sm text-muted-foreground">
    Selecciona un worktree perteneciente a un proyecto de Orca para abrir Project Hub.
  </div> }
  if(loading) { return <div className="p-4 text-xs text-muted-foreground">Cargando datos del proyecto…</div> }
  return <section className="flex h-full min-h-0 flex-col overflow-y-auto bg-background text-foreground">
    <header className="sticky top-0 z-10 border-b border-border bg-background px-4 py-3">
      <div className="flex items-center gap-2 text-xs text-primary"><LayoutDashboard className="h-4 w-4"/> PROJECT HUB · NATIVO</div>
      <h2 className="mt-1 text-base font-semibold">{projectName}</h2>
      <p className="truncate text-xs text-muted-foreground">{worktree?.displayName} · {worktree?.branch}</p>
      <div className="mt-3 flex gap-2 overflow-x-auto">
        {([['summary','Resumen'],['backlog','Backlog'],['delegate','Orquestación'],['intelligence','Inteligencia'],['architecture','Arquitectura'],['qa','QA'],['blueprint','Blueprint'],['team','Equipo']] as const).map(([key,label])=>
          <button key={key} type="button" onClick={()=>setTab(key)}
            className={`rounded-md px-3 py-1.5 text-xs ${tab===key?'bg-primary text-primary-foreground':'bg-muted text-muted-foreground'}`}>{label}</button>)}
      </div>
    </header>
    {error && <p role="alert" className="m-3 rounded border border-destructive p-2 text-xs text-destructive">{error} <button type="button" className="underline" onClick={()=>projectId&&window.api.projectHub.read(projectId).then(setDoc).catch(e=>setError(String(e)))}>Recargar</button></p>}
    {!shown ? <p className="p-4 text-sm">No se pudieron leer los datos del proyecto.</p> :
    <div className="space-y-3 p-3">
      <div className="rounded-lg border border-border bg-card p-3">
        <div className="mb-2 text-xs font-semibold">Fase {shown.phase}/10 · {PROJECT_HUB_PHASES[shown.phase-1]}</div>
        <div className="grid grid-cols-10 gap-1" aria-label="Progreso de las 10 fases">
          {PROJECT_HUB_PHASES.map((name,i)=><div key={name} title={name}
            className={`h-2 rounded ${i<shown.phase?'bg-primary':'bg-muted'}`}/>)}
        </div>
      </div>
      {tab==='summary'&&<>
        <ProjectHubOverview doc={shown}/>
        <div className="rounded-lg border border-border bg-card p-3">
          <h3 className="mb-2 text-sm font-medium">Aprobación de fase</h3>
          <p className="mb-2 text-xs text-muted-foreground">Aprobación humana: completa las cuatro evidencias en QA. Esto no sustituye un CI real.</p>
          <textarea value={approvalNote} onChange={e=>setApprovalNote(e.target.value)} maxLength={500} disabled={busy}
            placeholder="Evidencia revisada, responsable y justificación…" className="min-h-20 w-full rounded border border-border bg-background p-2 text-xs"/>
          <label className="mt-2 flex items-start gap-2 text-xs"><input type="checkbox" checked={approveChecked} onChange={e=>setApproveChecked(e.target.checked)}/>
            Confirmo que revisé las evidencias y asumo esta aprobación manual</label>
          <button type="button" disabled={busy||!approveChecked||approvalNote.trim().length<5||shown.phase>=10||!hasHubPhaseEvidence(shown)}
            className="mt-3 flex items-center gap-2 rounded bg-primary px-3 py-2 text-xs text-primary-foreground disabled:opacity-40"
            onClick={()=>{void save(approveHubPhase(shown,approvalNote,new Date().toISOString())).then(ok=>{if(ok){setApprovalNote('');setApproveChecked(false)}})}}>
            <ShieldCheck className="h-4 w-4"/> Registrar aprobación y avanzar
          </button>
          <div className="mt-3 space-y-1 text-xs text-muted-foreground">{shown.approvals.slice(-4).toReversed().map(a=>
            <p key={a.at}>{a.from} → {a.to}: {a.note}</p>)}</div>
        </div>
      </>}
      {tab==='backlog'&&<>
        <div className="space-y-2">{PROJECT_HUB_STATUSES.map(status=>
          <div key={status} className="rounded-lg border border-border bg-card p-3">
            <h3 className="mb-2 text-xs font-medium">{STATUS_LABELS[status]}</h3>
            {shown.items.filter(i=>i.status===status&&!i.archived).map(item=>
              <div key={item.id} className="mb-2 rounded border border-border p-2 text-xs">
                <div className="text-muted-foreground">{item.id} · Fase {item.phase}</div>
                <div className="my-1 font-medium">{item.title}</div>
                <select value={item.status} disabled={busy} aria-label={`Estado ${item.id}`}
                  onChange={e=>{void save({...shown,items:shown.items.map(i=>i.id===item.id?{...i,status:e.target.value as HubStatus}:i)})}}
                  className="w-full rounded border border-border bg-background p-1">
                  {PROJECT_HUB_STATUSES.map(x=><option key={x} value={x}>{STATUS_LABELS[x]}</option>)}
                </select>
                {(status==='backlog'||status==='ready')&&<div className="mt-2">
                  {itemToRemove===item.id ? <div className="space-y-2 rounded border border-border bg-muted p-2">
                    <p>¿Quitar {item.id} del backlog? Podrás restaurarlo. Su historial y vínculos se conservarán.</p>
                    <div className="flex flex-wrap gap-2">
                      <button type="button" disabled={busy}
                        aria-label={`Confirmar quitar ${item.id}`}
                        onClick={()=>void archiveStory(item.id,true)}
                        className="rounded bg-destructive px-2 py-1 text-destructive-foreground disabled:opacity-40">
                        Confirmar quitar
                      </button>
                      <button type="button" disabled={busy} onClick={()=>setItemToRemove(null)}
                        className="rounded bg-muted px-2 py-1 disabled:opacity-40">
                        Cancelar
                      </button>
                    </div>
                  </div> : <button type="button" disabled={busy}
                    aria-label={`Quitar ${item.id} del backlog`}
                    onClick={()=>setItemToRemove(item.id)}
                    className="rounded border border-border px-2 py-1 text-muted-foreground disabled:opacity-40">
                    Quitar del backlog
                  </button>}
                </div>}
              </div>)}
            {!shown.items.some(i=>i.status===status&&!i.archived)&&<p className="text-xs text-muted-foreground">Sin elementos</p>}
          </div>)}</div>
        {archivedItems.length>0&&<section aria-label="Historias quitadas del backlog"
          className="space-y-2 rounded-lg border border-border bg-card p-3">
          <h3 className="text-xs font-semibold">Quitados del backlog ({archivedItems.length})</h3>
          <p className="text-xs text-muted-foreground">
            Ocultos de las listas activas. Se conservan los IDs, planes y vínculos históricos.
          </p>
          {archivedItems.map(item=><div key={item.id}
            className="flex flex-wrap items-center justify-between gap-2 rounded border border-border p-2 text-xs">
            <span>{item.id} · {item.title}</span>
            <button type="button" disabled={busy}
              aria-label={`Restaurar ${item.id} al backlog`}
              onClick={()=>void archiveStory(item.id,false)}
              className="rounded border border-border px-2 py-1 disabled:opacity-40">
              Restaurar
            </button>
          </div>)}
        </section>}
        <ProjectHubTaskLinks doc={shown} busy={busy} onSave={save}/>
        <div className="rounded-lg border border-border bg-card p-3">
          <h3 className="mb-2 flex items-center gap-2 text-sm font-medium"><Plus className="h-4 w-4"/> Crear historia</h3>
          <input value={itemTitle} onChange={e=>setItemTitle(e.target.value)} maxLength={160}
            placeholder="Como usuario necesito…" className="mb-2 w-full rounded border border-border bg-background p-2 text-xs"/>
          <textarea value={itemAcceptance} onChange={e=>setItemAcceptance(e.target.value)} maxLength={2000}
            placeholder="Criterios de aceptación" className="min-h-16 w-full rounded border border-border bg-background p-2 text-xs"/>
          <button type="button" disabled={busy||!itemTitle.trim()||shown.items.length>=300}
            onClick={()=>{void addStory()}} className="mt-2 rounded bg-primary px-3 py-2 text-xs text-primary-foreground disabled:opacity-40">Agregar al backlog</button>
        </div>
        <ProjectHubJiraImport doc={shown} busy={busy} branch={worktree?.branch??''} onSave={save}/>
      </>}
      {tab==='blueprint'&&<div className="space-y-3 rounded-lg border border-border bg-card p-3">
        {([['idea','Idea'],['problem','Problema'],['users','Usuarios'],['success','Indicadores de éxito']] as const).map(([key,label])=>
          <label key={key} className="block text-xs">{label}
            <textarea value={shown.blueprint[key]} maxLength={2500} disabled={busy}
              onChange={e=>setDoc({...shown,blueprint:{...shown.blueprint,[key]:e.target.value}})}
              className="mt-1 min-h-20 w-full rounded border border-border bg-background p-2"/>
          </label>)}
        <button type="button" disabled={busy} onClick={()=>void save(shown)}
          className="rounded bg-primary px-3 py-2 text-xs text-primary-foreground disabled:opacity-40">Guardar blueprint</button>
      </div>}
      {tab==='delegate'&&<div className="space-y-3">
        <ProjectHubNativeAgentPreview doc={shown} worktreeId={worktree?.id??''}
          hostId={worktree?.hostId??''} gitHead={worktree?.head??''}/>
        <ProjectHubMathPreview doc={shown}/>
        <ProjectHubDelegationRunner key={`${projectId}:${worktree?.id ?? ''}`}
          document={shown} repoId={worktree?.repoId??''}
          hostId={worktree?.hostId??''} branch={worktree?.branch??''}
          onSave={save}/>
      </div>}
      {tab==='intelligence'&&<ProjectHubIntelligencePanel key={`${projectId}:${worktree?.id ?? ''}`}
        doc={shown} busy={busy} onSave={save}
        gitContext={worktree ? {
          worktreeId: worktree.id, worktreePath: worktree.path, hostId: worktree.hostId ?? ''
        } : undefined}/>}
      {tab==='architecture'&&<ProjectHubArchitecture doc={shown} busy={busy} branch={worktree?.branch??''} onSave={save}/>}
      {tab==='qa'&&<ProjectHubQuality doc={shown} busy={busy} branch={worktree?.branch??''} onSave={save}/>}
      {tab==='team'&&<ProjectHubTeam doc={shown} busy={busy} branch={worktree?.branch??''} onSave={save}/>}
    </div>}
  </section>
}
