import { createHash } from 'node:crypto'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { writeSecureFile } from '../../shared/secure-file'
import { emptyProjectHub, isHubDocument, type HubDocument } from '../../shared/project-hub-types'

const LIMIT = 512 * 1024
export function hubFilePath(root: string, projectId: string): string {
  if (!projectId || projectId.length>500) throw new Error('Invalid Orca Project.id')
  return join(root,'project-hub','v1',createHash('sha256').update(projectId).digest('hex')+'.json')
}
export class ProjectHubStore {
  constructor(private readonly userData: string) {}
  read(projectId: string): HubDocument {
    const file=hubFilePath(this.userData,projectId)
    if(!existsSync(file)) return emptyProjectHub(projectId)
    if(statSync(file).size>LIMIT) throw new Error('Project Hub document too large')
    const data: unknown = JSON.parse(readFileSync(file,'utf8'))
    if(!isHubDocument(data)||data.projectId!==projectId)
      throw new Error('Invalid/cross-project Project Hub document: refusing overwrite')
    return data
  }
  save(projectId: string, incoming: HubDocument, expectedRevision: number): HubDocument {
    if(!isHubDocument(incoming)||incoming.projectId!==projectId) throw new Error('Invalid Project Hub document')
    const prev=this.read(projectId)
    if(!Number.isSafeInteger(expectedRevision)||prev.revision!==expectedRevision||incoming.revision!==expectedRevision)
      throw new Error('Conflict: reload Project Hub before saving')
    const next: HubDocument={...incoming,revision:prev.revision+1,updatedAt:new Date().toISOString()}
    const text=JSON.stringify(next,null,2)
    if(Buffer.byteLength(text,'utf8')>LIMIT) throw new Error('Project Hub document too large')
    if(!writeSecureFile(hubFilePath(this.userData,projectId),text,{durable:true}))
      throw new Error('Unable to secure Project Hub data for this user')
    return next
  }
}
