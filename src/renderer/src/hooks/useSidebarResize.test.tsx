// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { useSidebarResize } from './useSidebarResize'

function ResizeHarness(): React.JSX.Element {
  const { containerRef, onResizeStart } = useSidebarResize<HTMLDivElement>({
    isOpen: true,
    width: 400,
    minWidth: 220,
    maxWidth: 800,
    deltaSign: -1,
    setWidth: () => {}
  })
  return (
    <div ref={containerRef}>
      <div data-testid="resize-grip" onMouseDown={onResizeStart} />
    </div>
  )
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

it('keeps the drag shield through mouseup, swallows the trailing click and then cleans up', () => {
  let nextFrame: FrameRequestCallback | undefined
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
    nextFrame = callback
    return 1
  })
  const { getByTestId } = render(<ResizeHarness />)
  const onDocumentClick = vi.fn()
  document.addEventListener('click', onDocumentClick)
  try {
    fireEvent.mouseDown(getByTestId('resize-grip'), { clientX: 500 })
    const overlay = document.querySelector<HTMLElement>('[data-sidebar-resize-overlay]')
    expect(overlay).not.toBeNull()

    fireEvent.mouseUp(window)
    // A release click is synthesized after mouseup. The old implementation
    // removed this overlay immediately, allowing click-through navigation.
    expect(document.querySelector('[data-sidebar-resize-overlay]')).toBe(overlay)
    const releaseClick = new MouseEvent('click', { bubbles: true, cancelable: true })
    overlay!.dispatchEvent(releaseClick)
    expect(releaseClick.defaultPrevented).toBe(true)
    expect(onDocumentClick).not.toHaveBeenCalled()

    expect(nextFrame).toBeDefined()
    act(() => { nextFrame?.(0) })
    expect(document.querySelector('[data-sidebar-resize-overlay]')).toBeNull()
  } finally {
    document.removeEventListener('click', onDocumentClick)
  }
})

it('removes a drag shield immediately when the resizer unmounts', () => {
  const { getByTestId, unmount } = render(<ResizeHarness />)
  fireEvent.mouseDown(getByTestId('resize-grip'), { clientX: 400 })
  expect(document.querySelector('[data-sidebar-resize-overlay]')).not.toBeNull()
  unmount()
  expect(document.querySelector('[data-sidebar-resize-overlay]')).toBeNull()
})
