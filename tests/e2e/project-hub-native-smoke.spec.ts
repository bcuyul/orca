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

  await orcaPage.getByRole('button', { name: 'Orquestación' }).evaluate((element) => {
    (element as HTMLButtonElement).click()
  })
  await expect(orcaPage.getByRole('alert').filter({
    hasText: 'Ejecución de agentes deshabilitada'
  })).toBeVisible()
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
