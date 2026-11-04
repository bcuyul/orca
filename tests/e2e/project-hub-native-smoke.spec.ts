import { expect, test } from './helpers/orca-app'
import { waitForStartupWorktreeRefresh } from './helpers/store'

test('Project Hub opens in isolated Electron, persists backlog and keeps CLI launch disabled @project-hub-smoke', async ({ orcaPage }) => {
  test.setTimeout(180_000)

  await waitForStartupWorktreeRefresh(orcaPage)

  // The fixture has a disposable Git repository, Orca profile and Electron process.
  // Navigate using the same Zustand route as the native right activity bar.
  await orcaPage.evaluate(() => {
    const store = window.__store
    if (!store) {
      throw new Error('Orca renderer store was not exposed by the E2E build')
    }
    const state = store.getState()
    if (!state.rightSidebarOpen) {
      state.toggleRightSidebar()
    }
    state.setRightSidebarTab('project-hub')
  })

  await expect(orcaPage.getByText('PROJECT HUB · NATIVO')).toBeVisible({
    timeout: 30_000
  })
  await expect(orcaPage.getByText('Fase 1/10', { exact: false })).toBeVisible()

  await orcaPage.getByRole('button', { name: 'Backlog', exact: true }).evaluate((element) => {
    (element as HTMLButtonElement).click()
  })
  await orcaPage.getByPlaceholder('Como usuario necesito…').fill('Historia de smoke test')
  await orcaPage.getByPlaceholder('Criterios de aceptación').fill(
    'La historia debe persistir en el proyecto aislado'
  )
  // Electron's headless sidebar may remount during pointer-stability polling on Windows.
  // Dispatch the same button click on the currently rendered DOM node.
  await orcaPage.getByRole('button', { name: 'Agregar al backlog' }).evaluate((element) => {
    (element as HTMLButtonElement).click()
  })
  await expect(orcaPage.getByText('Historia de smoke test')).toBeVisible()

  // A different right-sidebar view unmounts ProjectHubPanel. Returning reads
  // the same document from main-process IPC and disk rather than React state.
  await orcaPage.evaluate(() => {
    window.__store?.getState().setRightSidebarTab('explorer')
  })
  await expect(orcaPage.getByText('PROJECT HUB · NATIVO')).toHaveCount(0)
  await orcaPage.evaluate(() => {
    window.__store?.getState().setRightSidebarTab('project-hub')
  })
  await orcaPage.getByRole('button', { name: 'Backlog', exact: true }).evaluate((element) => {
    (element as HTMLButtonElement).click()
  })
  await expect(orcaPage.getByText('Historia de smoke test')).toBeVisible()

  // The headless right sidebar can replace the active tab during workspace hydration.
  // Retry navigation (a harmless idempotent selection), not the mutation or launch.
  // Fail if the actual renderer never displays the host-authorization warning.
  const launchWarning = orcaPage.getByRole('alert').filter({
    hasText: 'Ejecución de agentes deshabilitada'
  })
  await expect.poll(async () => {
    if (await launchWarning.isVisible()) {
      return true
    }
    await orcaPage.evaluate(() => {
      const tab = Array.from(document.querySelectorAll('button')).find(
        (button) => button.textContent?.trim() === 'Orquestación'
      )
      tab?.click()
    })
    return launchWarning.isVisible()
  }, {
    timeout: 30_000,
    intervals: [250, 500, 1_000],
    message: 'Project Hub Orquestación tab must display the execution quarantine'
  }).toBe(true)
  await orcaPage.getByRole('checkbox').first().evaluate((element) => {
    (element as HTMLInputElement).click()
  })
  await orcaPage.getByRole('button', { name: /Preparar 1 historia/ }).evaluate((element) => {
    (element as HTMLButtonElement).click()
  })
  await expect(orcaPage.getByText('Lote preparado y guardado.')).toBeVisible({
    timeout: 15_000
  })
  await expect(orcaPage.getByRole('button', {
    name: /Iniciar y enviar instrucciones/
  })).toBeDisabled()
})

test('Project Hub remains selected during native window and sidebar resize @project-hub-resize', async ({
  electronApp,
  orcaPage
}) => {
  test.setTimeout(180_000)
  await waitForStartupWorktreeRefresh(orcaPage)
  await orcaPage.evaluate(() => {
    const state = window.__store?.getState()
    if (!state) {
      throw new Error('The isolated Electron renderer store is unavailable')
    }
    state.setRightSidebarOpen(true)
    state.setRightSidebarTab('project-hub')
  })
  const hub = orcaPage.getByText('PROJECT HUB · NATIVO')
  await expect(hub).toBeVisible()

  const assertHubSelected = async (where: string): Promise<void> => {
    await expect(hub, where).toBeVisible()
    const route = await orcaPage.evaluate(() => {
      const state = window.__store?.getState()
      return {
        requested: state?.rightSidebarTab,
        effective: state?.rightSidebarEffectiveTab,
        open: state?.rightSidebarOpen
      }
    })
    expect(route, where).toEqual({
      requested: 'project-hub',
      effective: 'project-hub',
      open: true
    })
  }

  // Reproduce the Windows desktop trace: an IPC UI sync publishes a stale
  // Explorer tab after the user selected Project Hub (with the same route
  // request ID). Resize itself is a separate check below.
  const routeRequests = await orcaPage.evaluate(async () => {
    const state = window.__store?.getState()
    if (!state?.persistedUIReady) {
      throw new Error('Persisted UI hydration must finish before the sync test')
    }
    const before = state.rightSidebarRouteRequestId
    const stale = await window.api.ui.get()
    window.__store?.getState().hydratePersistedUI(
      { ...stale, rightSidebarTab: 'explorer' },
      'sync'
    )
    return { before, after: window.__store?.getState().rightSidebarRouteRequestId }
  })
  await assertHubSelected('stale Explorer preference broadcast')
  expect(routeRequests.after).toBe(routeRequests.before)

  for (const [width, height] of [[1120, 760], [1440, 900], [980, 720]] as const) {
    await electronApp.evaluate(({ BrowserWindow }, size) => {
      const window = BrowserWindow.getAllWindows().find((candidate) => !candidate.isDestroyed())
      if (!window) {
        throw new Error('Missing Electron desktop window')
      }
      window.setSize(size[0], size[1])
    }, [width, height])
    await assertHubSelected(`Electron window ${width}x${height}`)
  }

  // Reproduce the user's manual operation: drag the LEFT resize edge of the
  // right sidebar, then move it back. Neither operation chooses a new tab.
  const handle = orcaPage.getByTestId('right-sidebar-resize-handle')
  await expect(handle).toBeVisible()
  for (const delta of [-100, 100]) {
    const bounds = await handle.boundingBox()
    if (!bounds) {
      throw new Error('Right sidebar resize handle has no screen bounds')
    }
    const x = bounds.x + bounds.width / 2
    const y = bounds.y + Math.min(110, bounds.height / 2)
    await orcaPage.mouse.move(x, y)
    await orcaPage.mouse.down()
    await orcaPage.mouse.move(x + delta, y, { steps: 8 })
    await orcaPage.mouse.up()
    await assertHubSelected(`right sidebar drag delta ${delta}`)
  }
})

test('Atlas DAG approval → trusted IPC preview without a CLI launch @project-hub-plan-preview', async ({ orcaPage }) => {
  test.setTimeout(180_000)
  await waitForStartupWorktreeRefresh(orcaPage)
  await orcaPage.evaluate(() => {
    const state = window.__store?.getState()
    if (!state) { throw new Error('Missing isolated Electron store') }
    state.setRightSidebarOpen(true)
    state.setRightSidebarTab('project-hub')
  })
  await expect(orcaPage.getByText('PROJECT HUB · NATIVO')).toBeVisible()
  await orcaPage.getByRole('button', { name: 'Inteligencia', exact: true }).evaluate((element) => {
    (element as HTMLButtonElement).click()
  })
  const proposal = {
    objective: 'Deliver an isolated sample feature',
    rationale: 'Verify the DAG from UI to native projection',
    tasks: [
      { id: 'qa-check', title: 'Verify feature', role: 'qa',
        dependsOn: ['forge-build'], acceptance: 'All tests pass' },
      { id: 'forge-build', title: 'Build feature', role: 'forge',
        dependsOn: ['data-store'], acceptance: 'Feature works' },
      { id: 'data-store', title: 'Persist feature', role: 'data',
        dependsOn: [], acceptance: 'Records persist' }
    ]
  }
  await orcaPage.getByRole('textbox', { name: 'Propuesta JSON de Atlas (no ejecutable)' })
    .fill(JSON.stringify(proposal))
  await orcaPage.getByRole('button', { name: 'Validar DAG y guardar propuesta' })
    .evaluate((element) => { (element as HTMLButtonElement).click() })
  await expect(orcaPage.getByText('Propuesta DAG guardada; aún NO es un Run de Orca.'))
    .toBeVisible()
  await orcaPage.getByRole('textbox', { name: /Justificación de la decisión/ })
    .fill('Reviewed task dependencies and acceptance criteria')
  await orcaPage.getByRole('checkbox', { name: /Confirmo que revisé esta propuesta/ }).check()
  await orcaPage.getByRole('button', { name: 'Aprobar plan' })
    .evaluate((element) => { (element as HTMLButtonElement).click() })
  await expect(orcaPage.getByText('Aprobado manualmente', { exact: false })).toBeVisible()
  await orcaPage.getByRole('button', { name: 'Inspeccionar conversión nativa (sin ejecutar)' })
    .evaluate((element) => { (element as HTMLButtonElement).click() })
  await expect(orcaPage.getByText('Vista previa del Run de Orca')).toBeVisible()
  await expect(orcaPage.getByText('Solo lectura: no se creó Run, Task ni Dispatch.', { exact: false }))
    .toBeVisible()
  const order = await orcaPage.locator('div[role="status"] ol li').allTextContents()
  expect(order.map((line) => line.split(' · ')[0])).toEqual([
    'data-store', 'forge-build', 'qa-check'
  ])
})


test('Atlas-approved Forge evidence is linked to QA without any agent execution @project-hub-handoff', async ({ orcaPage }) => {
  test.setTimeout(180_000)
  await waitForStartupWorktreeRefresh(orcaPage)
  await orcaPage.evaluate(() => {
    const state=window.__store?.getState()
    if (!state) { throw new Error('Isolated renderer is missing') }
    state.setRightSidebarOpen(true)
    state.setRightSidebarTab('project-hub')
  })
  await expect(orcaPage.getByText('PROJECT HUB · NATIVO')).toBeVisible()
  await orcaPage.getByRole('button',{name:'Inteligencia',exact:true}).evaluate(el=>{
    (el as HTMLButtonElement).click()
  })
  const proposal={
    objective:'Trace the Forge handoff into QA',
    rationale:'Keep external artifact IDs and human decisions linked',
    tasks:[{
      id:'forge-example',title:'Build the traceable example',role:'forge',
      dependsOn:[],acceptance:'Artifact is reviewed by independent QA'
    }]
  }
  await orcaPage.getByRole('textbox',{name:'Propuesta JSON de Atlas (no ejecutable)'})
    .fill(JSON.stringify(proposal))
  await orcaPage.getByRole('button',{name:'Validar DAG y guardar propuesta'}).evaluate(el=>{
    (el as HTMLButtonElement).click()
  })
  await expect(orcaPage.getByText('Propuesta DAG guardada; aún NO es un Run de Orca.'))
    .toBeVisible()
  await orcaPage.getByRole('textbox',{name:/Justificación de la decisión/})
    .fill('Reviewed this one-task plan and its acceptance criteria')
  await orcaPage.getByRole('checkbox',{name:/Confirmo que revisé esta propuesta/}).check()
  await orcaPage.getByRole('button',{name:'Aprobar plan'}).evaluate(el=>{
    (el as HTMLButtonElement).click()
  })
  await expect(orcaPage.getByText('Aprobado manualmente',{exact:false})).toBeVisible()

  await orcaPage.getByRole('combobox',{name:'Plan para entrega Forge'}).selectOption({index:1})
  await orcaPage.getByRole('combobox',{name:'Tarea para entrega Forge'}).selectOption('forge-example')
  await expect(orcaPage.getByText('Entrega externa pendiente')).toBeVisible()
  await orcaPage.getByRole('textbox',{name:'SHA base de Forge'}).fill('a'.repeat(40))
  await orcaPage.getByRole('textbox',{name:'SHA de entrega Forge'}).fill('b'.repeat(40))
  await orcaPage.getByRole('textbox',{name:'Evidencia de Forge'}).fill('diff:forge-example')
  await orcaPage.getByRole('textbox',{name:'Pruebas de Forge'}).fill('Vitest executed externally, not verified by Orca')
  await orcaPage.getByRole('button',{name:'Registrar entrega externa (declaración)'}).evaluate(el=>{
    (el as HTMLButtonElement).click()
  })
  await expect(orcaPage.getByText('Entrega externa declarada; falta comprobar diff y CI mediante QA.')).toBeVisible()
  await expect(orcaPage.getByText('Pendiente de QA independiente')).toBeVisible()
  await orcaPage.getByRole('textbox',{name:'Evidencia de QA'}).fill('Manual review of diff only')
  await orcaPage.getByRole('textbox',{name:'Hallazgos QA'}).fill('Reviewed independent diff; CI result not authenticated')
  await orcaPage.getByRole('combobox',{name:'Resultado QA de entrega'}).selectOption('approved')
  await orcaPage.getByRole('button',{name:'Registrar QA vinculado (declaración)'}).evaluate(el=>{
    (el as HTMLButtonElement).click()
  })
  await expect(orcaPage.getByText('QA registrado como declaración humana para el commit indicado, no como CI verificado.'))
    .toBeVisible()
  await expect(orcaPage.getByText('QA aprobó (declarado; CI no verificado)',{exact:false}))
    .toBeVisible()
  await expect(orcaPage.getByText('Ejecución: bloqueada. Ningún estado concede un grant.')).toBeVisible()

  await orcaPage.evaluate(() => window.__store?.getState().setRightSidebarTab('explorer'))
  await orcaPage.evaluate(() => window.__store?.getState().setRightSidebarTab('project-hub'))
  await orcaPage.getByRole('button',{name:'Inteligencia',exact:true}).evaluate(el=>{
    (el as HTMLButtonElement).click()
  })
  await orcaPage.getByRole('combobox',{name:'Plan para entrega Forge'}).selectOption({index:1})
  await expect(orcaPage.getByText('QA aprobó (declarado; CI no verificado)',{exact:false}))
    .toBeVisible()
})


test('Project Hub native draft requires explicit user action @project-hub-native-draft', async ({ orcaPage }) => {
  test.setTimeout(180_000)
  await waitForStartupWorktreeRefresh(orcaPage)
  await orcaPage.evaluate(() => {
    const state = window.__store?.getState()
    if (!state) { throw new Error('Missing isolated renderer store') }
    state.setRightSidebarOpen(true)
    state.setRightSidebarTab('project-hub')
  })
  await expect(orcaPage.getByText('PROJECT HUB · NATIVO')).toBeVisible()
  await orcaPage.getByRole('button', { name: 'Inteligencia', exact: true })
    .evaluate(element => { (element as HTMLButtonElement).click() })
  const panel = orcaPage.getByRole('region', {
    name: 'Project Hub borrador en chat nativo'
  })
  await expect(panel).toBeVisible()
  await expect(panel.getByRole('textbox', { name: 'Borrador preparado' }))
    .toHaveValue(/Atlas: propose a plan/)
  await expect(panel.getByRole('button', { name: 'Abrir borrador en chat nativo' }))
    .toBeDisabled()
  await expect(panel.getByRole('button', { name: 'Coordinator: ejecución bloqueada' }))
    .toBeDisabled()
  await expect(panel.getByRole('checkbox', { name: /Revisé el encargo/ }))
    .not.toBeChecked()
})
