import { useEffect, useMemo, useState } from 'react'
import { ClipboardCheck, Database, FileCode2, Users } from 'lucide-react'
import type { HubDocument, HubItem } from '../../../../shared/project-hub-types'

type Props = { doc: HubDocument; busy: boolean; branch: string; onSave: (next: HubDocument)=>Promise<boolean> }
const inputClass='w-full rounded-md border border-border bg-background p-2 text-xs text-foreground'
const actionClass='rounded-md bg-primary px-3 py-2 text-xs font-medium text-primary-foreground disabled:opacity-40'
const secondaryClass='rounded-md border border-border bg-muted px-3 py-2 text-xs text-foreground disabled:opacity-40'

/** Manual Jira JSON import; issue descriptions are never executed or interpreted as commands. */
export function ProjectHubJiraImport({doc,busy,onSave}: Props): React.JSX.Element {
  const [json,setJson]=useState('')
  const [message,setMessage]=useState('')
  async function importJson():Promise<void> {
    try {
      if (json.length>100_000) throw new Error('JSON demasiado grande')
      const input:unknown=JSON.parse(json)
      const arr=Array.isArray(input)?input:(input && typeof input==='object' && 'issues' in input
        ?(input as {issues: unknown}).issues:null)
      if(!Array.isArray(arr)) throw new Error('Se requiere un arreglo de issues')
      const items:HubItem[]=[...doc.items]
      let count=0
      for(const issue of arr.slice(0,100)){
        if(items.length>=300)break
        if(!issue || typeof issue!=='object')continue
        const raw=issue as Record<string,unknown>
        const fields=raw.fields && typeof raw.fields==='object' ? raw.fields as Record<string,unknown> : {}
        const id=String(raw.key??raw.id??'').slice(0,80)
        const title=String(fields.summary??raw.title??'').slice(0,160).trim()
        if(!/^[A-Za-z0-9_-]{2,80}$/.test(id)||!title||items.some(x=>x.id===id)) continue
        const ty=fields.issuetype && typeof fields.issuetype==='object' ?
          String((fields.issuetype as Record<string,unknown>).name??'') : ''
        items.push({id,title,type:/bug/i.test(ty)?'bug':/story/i.test(ty)?'story':'ticket',
          status:'backlog',phase:doc.phase,source:id,description:'',acceptance:''})
        count++
      }
      if(!count){setMessage('No se encontraron tickets nuevos.');return}
      const saved = await onSave({...doc,items})
      if(!saved){setMessage('No se guardaron los tickets. Revisa el error del panel.');return}
      setMessage(count+' tickets guardados. Jira no se modificó.')
      setJson('')
    }catch(e){setMessage('Importación rechazada: '+String(e))}
  }
  return <section className="rounded-lg border border-border bg-card p-3">
    <h3 className="mb-2 text-sm font-semibold">Importar JSON de Jira</h3>
    <p className="mb-2 text-xs text-muted-foreground">Solo lectura: acepta issues[] e ignora IDs repetidos. No sincroniza Jira.</p>
    <textarea value={json} onChange={e=>setJson(e.target.value)} rows={3} disabled={busy}
      placeholder='{"issues":[{"key":"DEMO-1","fields":{"summary":"Historia"}}]}' className={inputClass}/>
    <button type="button" onClick={()=>void importJson()} disabled={busy||!json.trim()} className={'mt-2 '+secondaryClass}>Importar tickets</button>
    {message && <p role="status" className="mt-2 text-xs text-muted-foreground">{message}</p>}
  </section>
}

export function ProjectHubArchitecture({doc,busy,onSave}: Props): React.JSX.Element {
  const [nodes,setNodes]=useState('')
  const [edges,setEdges]=useState('')
  const [notes,setNotes]=useState('')
  const [message,setMessage]=useState('')
  useEffect(()=>{
    setNodes(doc.architecture.nodes.map(x=>x.name+' | '+x.kind).join('\n'))
    setEdges(doc.architecture.edges.map(x=>x.from+' -> '+x.to).join('\n'))
    setNotes(doc.architecture.notes)
  },[doc.projectId,doc.revision])
  const graph=useMemo(()=>{
    const known=new Set<string>()
    const parsed=nodes.split('\n').map(line=>line.trim()).filter(Boolean).slice(0,30)
      .map(line=>{const [name='',kind='componente']=line.split('|').map(x=>x.trim());return {name:name.slice(0,60),kind:kind.slice(0,40)}})
      .filter(n=>{if(!n.name||known.has(n.name))return false;known.add(n.name);return true})
    const links=edges.split('\n').map(line=>line.split('->').map(x=>x.trim()))
      .filter(pair=>pair.length===2 && known.has(pair[0])&&known.has(pair[1])).slice(0,60)
      .map(pair=>({from:pair[0],to:pair[1]}))
    return {nodes:parsed,edges:links,notes:notes.slice(0,4000)}
  },[nodes,edges,notes])
  async function copyMermaid():Promise<void>{
    const keys=new Map(graph.nodes.map((n,i)=>[n.name,'N'+i]))
    const text=['flowchart LR',...graph.nodes.map(n=>'  '+keys.get(n.name)+'["'+n.name.replace(/["\\]/g,' ')+'"]'),
      ...graph.edges.map(e=>'  '+keys.get(e.from)+' --> '+keys.get(e.to))].join('\n')
    try{await window.api.ui.writeClipboardText(text);setMessage('Diagrama Mermaid copiado.')}
    catch(e){setMessage('No se pudo copiar: '+String(e))}
  }
  return <div className="space-y-3">
    <section className="rounded-lg border border-border bg-card p-3">
      <div className="mb-2 flex items-center gap-2 text-sm font-semibold"><FileCode2 className="h-4 w-4"/> Arquitectura de la solución</div>
      <div className="flex gap-2 overflow-x-auto pb-3">
        {graph.nodes.map(n=><div key={n.name} className="min-w-28 shrink-0 rounded-md border border-primary/50 bg-muted p-3 text-center text-xs">
          <div className="font-medium">{n.name}</div><div className="text-muted-foreground">{n.kind}</div>
          <div className="mt-1 text-[10px] text-muted-foreground">{graph.edges.filter(e=>e.from===n.name).map(e=>'→ '+e.to).join(' · ')}</div>
        </div>)}
        {!graph.nodes.length && <p className="text-xs text-muted-foreground">Define componentes para mostrar el diagrama.</p>}
      </div>
      <p className="text-xs text-muted-foreground">Vista de dependencias. No representa un C4 certificado ni refleja automáticamente el código.</p>
    </section>
    <section className="space-y-2 rounded-lg border border-border bg-card p-3">
      <label className="block text-xs">Componentes — Nombre | tipo
        <textarea rows={4} value={nodes} onChange={e=>setNodes(e.target.value)} disabled={busy} className={'mt-1 '+inputClass}/>
      </label>
      <label className="block text-xs">Conexiones — Origen → Destino
        <textarea rows={3} value={edges} onChange={e=>setEdges(e.target.value)} disabled={busy} className={'mt-1 '+inputClass}/>
      </label>
      <label className="block text-xs">Decisiones / ADR
        <textarea rows={3} value={notes} onChange={e=>setNotes(e.target.value)} disabled={busy} className={'mt-1 '+inputClass}/>
      </label>
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={busy} className={actionClass} onClick={()=>void onSave({...doc,architecture:graph})}>Guardar arquitectura</button>
        <button type="button" className={secondaryClass} onClick={()=>void copyMermaid()}>Copiar Mermaid</button>
      </div>
      {message && <p role="status" className="text-xs text-muted-foreground">{message}</p>}
    </section>
  </div>
}

export function ProjectHubQuality({doc,busy,onSave}: Props): React.JSX.Element {
  const [gate,setGate]=useState<'acceptance'|'flow'|'ci'|'owner'>('acceptance')
  const [status,setStatus]=useState<'verified'|'not-applicable'>('verified')
  const [note,setNote]=useState('')
  const [message,setMessage]=useState('')
  const keys=['acceptance','flow','ci','owner'] as const
  const names={
    acceptance:'Criterios de aceptación revisados',
    flow:'Flujo principal validado',
    ci:'Pruebas / CI: evidencia o excepción',
    owner:'Aprobación del responsable'
  }
  async function recordEvidence():Promise<void>{
    if(note.trim().length<5){setMessage('Escribe una justificación de al menos cinco caracteres.');return}
    const key=doc.phase+':'+gate
    const saved=await onSave({...doc,qualityEvidence:{
      ...(doc.qualityEvidence??{}),
      [key]:{status,note:note.trim().slice(0,500),at:new Date().toISOString()}
    }})
    setMessage(saved?'Evidencia manual registrada.':'No se guardó. Revisa el error en el panel.')
    if(saved)setNote('')
  }
  return <div className="space-y-3">
    <section className="rounded-lg border border-border bg-card p-3">
      <h3 className="flex items-center gap-2 text-sm font-semibold"><ClipboardCheck className="h-4 w-4"/> Evidencias de la fase {doc.phase}/10</h3>
      <p className="mt-2 text-xs text-muted-foreground">
        Estas evidencias son declaraciones manuales. Hasta conectar CI, nunca se muestran como pruebas automáticas aprobadas.
      </p>
      <div className="mt-3 space-y-2">
        {keys.map(key=>{
          const record=doc.qualityEvidence?.[doc.phase+':'+key]
          return <div key={key} className="rounded-md border border-border p-2 text-xs">
            <div className="flex items-start justify-between gap-2">
              <strong>{names[key]}</strong>
              <span className={'shrink-0 '+(record?'text-primary':'text-muted-foreground')}>
                {record?record.status==='verified'?'Verificación manual':'No aplica':'Pendiente'}
              </span>
            </div>
            {record&&<p className="mt-1 break-words text-muted-foreground">{record.note}</p>}
          </div>
        })}
      </div>
    </section>
    <section className="space-y-2 rounded-lg border border-border bg-card p-3">
      <h3 className="text-sm font-semibold">Registrar evidencia</h3>
      <label className="block text-xs">Comprobación
        <select value={gate} onChange={e=>setGate(e.target.value as typeof gate)} disabled={busy} className={'mt-1 '+inputClass}>
          {keys.map(key=><option key={key} value={key}>{names[key]}</option>)}
        </select>
      </label>
      <label className="block text-xs">Resultado declarado
        <select value={status} onChange={e=>setStatus(e.target.value as typeof status)} disabled={busy} className={'mt-1 '+inputClass}>
          <option value="verified">Verificado manualmente</option>
          <option value="not-applicable">No aplica (requiere justificación)</option>
        </select>
      </label>
      <label className="block text-xs">Evidencia / referencia / justificación
        <textarea rows={3} maxLength={500} value={note} onChange={e=>setNote(e.target.value)} disabled={busy}
          placeholder="Referencia al resultado o motivo por el que no aplica" className={'mt-1 '+inputClass}/>
      </label>
      <button type="button" disabled={busy||note.trim().length<5} className={actionClass} onClick={()=>void recordEvidence()}>
        Guardar evidencia manual
      </button>
      {message&&<p role="status" className="text-xs text-muted-foreground">{message}</p>}
    </section>
    <section className="rounded-lg border border-border bg-card p-3">
      <h3 className="flex items-center gap-2 text-sm font-semibold"><Database className="h-4 w-4"/> Estado de pruebas e integraciones</h3>
      <p className="mt-2 text-xs text-muted-foreground">Jira en vivo, CI, PR y cobertura: desconectados. Sus resultados nunca se deducen del estado de una historia.</p>
      <p className="mt-2 text-xs">{doc.items.filter(x=>x.status!=='done').length} historias aún no marcadas como terminadas.</p>
    </section>
  </div>
}

export function ProjectHubTeam({doc,branch}: Props): React.JSX.Element {
  return <div className="space-y-3">
    <section className="rounded-lg border border-border bg-card p-3">
      <h3 className="flex items-center gap-2 text-sm font-semibold"><Users className="h-4 w-4"/> Perfiles propuestos</h3>
      <p className="mb-3 text-xs text-muted-foreground">Roles de planificación inspirados en Hermes. No representan sesiones ni conexiones activas.</p>
      {[
        ['Atlas','Arquitectura, definición y coordinación','Claude Code / Hermes'],
        ['Forge','Implementación full-stack en worktree','Claude Code'],
        ['Reviewer','Revisión independiente de diffs','Codex'],
        ['QA','Pruebas, seguridad, smoke y regresiones','Codex / Hermes']
      ].map(([name,description,cli])=><div key={name} className="mb-2 rounded-md border border-border p-3 text-xs">
        <strong>{name}</strong><p className="text-muted-foreground">{description}</p><p className="mt-1 text-muted-foreground">Herramienta sugerida: {cli}</p>
      </div>)}
      <div className="text-xs text-muted-foreground">Proyecto: {doc.projectId} · Worktree actual: {branch}</div>
    </section>
  </div>
}
