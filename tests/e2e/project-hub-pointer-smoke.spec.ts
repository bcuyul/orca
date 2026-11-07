import type { Locator, Page } from '@stablyai/playwright-test'
import { expect, test } from './helpers/orca-app'
import { waitForStartupWorktreeRefresh } from './helpers/store'

/**
 * Unlike the planning-only DOM smoke, exercise actual pointer events on the
 * rendered Electron window. No agent runtime or production repository is used.
 * Every test owns an isolated profile and seeded disposable Git repository.
 */
async function pointerClick(page: Page, element: Locator): Promise<void> {
  await expect(element).toBeVisible()
  await element.scrollIntoViewIfNeeded()
  const bounds = await element.boundingBox()
  if (!bounds || bounds.width < 1 || bounds.height < 1) {
    throw new Error('Visible Electron control has no pointer target')
  }
  await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
}

test('Project Hub accepts native mouse clicks while refusing CLI execution @project-hub-pointer', async ({
  orcaPage
}) => {
  test.setTimeout(180_000)
  await waitForStartupWorktreeRefresh(orcaPage)

  await orcaPage.evaluate(() => {
    const state = window.__store?.getState()
    if (!state) {
      throw new Error('Expected isolated Electron E2E renderer store')
    }
    if (!state.rightSidebarOpen) {
      state.toggleRightSidebar()
    }
    state.setRightSidebarTab('explorer')
  })

  await pointerClick(orcaPage, orcaPage.getByRole('button', { name: 'Project Hub', exact: true }))
  await expect(orcaPage.getByText('PROJECT HUB · NATIVO')).toBeVisible()
  await expect(orcaPage.getByText('Fase 1/10', { exact: false })).toBeVisible()

  await pointerClick(orcaPage, orcaPage.getByRole('button', { name: 'Backlog', exact: true }))
  await expect(orcaPage.getByPlaceholder('Como usuario necesito…')).toBeVisible()
  await orcaPage.getByPlaceholder('Como usuario necesito…').fill('Historia validada con mouse')
  await orcaPage.getByPlaceholder('Criterios de aceptación').fill(
    'La interfaz permite guardar una historia sin lanzar agentes'
  )
  await pointerClick(orcaPage, orcaPage.getByRole('button', { name: 'Agregar al backlog' }))
  await expect(orcaPage.getByText('Historia validada con mouse')).toBeVisible()

  await pointerClick(orcaPage, orcaPage.getByRole('button', { name: 'Orquestación' }))
  await expect(orcaPage.getByRole('alert').filter({
    hasText: 'Ejecución de agentes deshabilitada'
  })).toBeVisible()

  // Playwright's check() performs a real mouse action while verifying that the
  // checkbox receives events. Bare bounding-box clicks can hit the sticky
  // Project Hub navigation on Windows after the sidebar scrolls.
  const storyCheckbox = orcaPage.getByRole('checkbox', {
    name: 'PH-001 · Historia validada con mouse'
  })
  const prepareButton = orcaPage.getByRole('button', { name: /Preparar 1 historia/ })
  await storyCheckbox.check()
  await expect(storyCheckbox).toBeChecked()
  await expect(prepareButton).toBeEnabled()
  await pointerClick(orcaPage, prepareButton)
  await expect(orcaPage.getByText('Lote y estimaciones de tokens guardados.', { exact: false })).toBeVisible()
  await expect(orcaPage.getByText('Tokens planeados:', { exact: false })).toBeVisible()
  await expect(orcaPage.getByRole('button', {
    name: /Iniciar y enviar instrucciones/
  })).toBeDisabled()
})
