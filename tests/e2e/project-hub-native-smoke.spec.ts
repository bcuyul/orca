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
