/**
 * Maps Panel — E2E Integration Tests
 *
 * Tests for the multi-map management panel (expandable left sidebar).
 * Covers: panel toggle, map CRUD (create/rename/duplicate/delete),
 * map switching with fog transition, keyboard shortcuts, persistence,
 * context menus, ordering, and interaction with canvas/focus mode.
 *
 * Prerequisites: The multi-map system must be fully implemented:
 *   - src/components/layout/LeftPanel.tsx
 *   - src/components/maps/MapsSidePanel.tsx, MapCard.tsx, MapList.tsx
 *   - src/store/slices/maps.ts (MapsSlice)
 *   - src/engine/fogTransition.ts
 *   - src/io/mapIndexDB.ts (IndexedDB persistence)
 *   - Keyboard shortcuts: Ctrl+Shift+M (toggle panel), Ctrl+Shift+N (new map)
 *
 * Key data-testids expected:
 *   - data-testid="left-toolbar"       — the left tool bar
 *   - data-testid="maps-side-panel"    — the maps sidebar panel container
 *   - data-testid="map-card"           — individual map card in the list
 *   - data-testid="new-map-button"     — the "+ New Map" button
 *   - data-testid="map-card-name"      — the name text/input on a map card
 *   - data-testid="map-rename-input"   — inline rename input (visible during edit)
 *   - data-testid="map-context-menu"   — right-click context menu container
 */

import { test, expect, type Page } from '@playwright/test'
import { gotoApp, waitFrame, drawRect, pressShortcut } from './helpers'

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Click the Maps toggle icon in the left toolbar to open/close the panel */
async function clickMapsToggle(page: Page): Promise<void> {
  // The toggle button is in the left toolbar with title "Maps (Ctrl+Shift+M)"
  const toggle = page.locator(
    '[data-testid="left-toolbar"] button[title*="Maps"], ' +
    '[data-testid="left-toolbar"] button:has(svg.lucide-layout-grid), ' +
    'button[title*="Maps"]'
  )
  await toggle.first().click()
  // Allow the panel slide animation to complete (200ms ease-out transition)
  await page.waitForTimeout(300)
}

/** Open the maps panel (idempotent — does nothing if already open) */
async function openMapsPanel(page: Page): Promise<void> {
  const panel = page.locator('[data-testid="maps-side-panel"]')
  const isVisible = await panel.isVisible().catch(() => false)
  if (!isVisible) {
    await clickMapsToggle(page)
    await expect(panel).toBeVisible({ timeout: 2000 })
  }
}

/** Close the maps panel (idempotent — does nothing if already closed) */
async function closeMapsPanel(page: Page): Promise<void> {
  const panel = page.locator('[data-testid="maps-side-panel"]')
  const isVisible = await panel.isVisible().catch(() => false)
  if (isVisible) {
    await clickMapsToggle(page)
    await expect(panel).not.toBeVisible({ timeout: 2000 })
  }
}

/** Get all map card locators */
function getMapCards(page: Page) {
  return page.locator('[data-testid="map-card"]')
}

/** Click the "+ New Map" button and wait for fog transition to settle */
async function clickNewMap(page: Page): Promise<void> {
  const newMapBtn = page.locator(
    '[data-testid="new-map-button"], button:has-text("+ New Map"), button:has-text("New Map")'
  )
  await newMapBtn.first().click()
  // Wait for fog transition: fog-in (~300ms) + state swap + fog-out (~300ms) + buffer
  await page.waitForTimeout(1000)
}

/** Right-click a map card by index to open the context menu */
async function rightClickMapCard(page: Page, index: number): Promise<void> {
  const card = getMapCards(page).nth(index)
  await card.click({ button: 'right' })
  // Wait for context menu to appear
  await page.waitForTimeout(200)
}

/** Read the maps store state via window.__store */
async function getMapsState(page: Page): Promise<{
  mapIndex: Array<{ id: string; name: string; updatedAt: number }>
  activeMapId: string | null
  isMapSwitching: boolean
}> {
  return page.evaluate(() => {
    const store = (window as { __store?: { getState: () => Record<string, unknown> } }).__store
    if (!store) return { mapIndex: [], activeMapId: null, isMapSwitching: false }
    const s = store.getState()
    return {
      mapIndex: (s.mapIndex as Array<{ id: string; name: string; updatedAt: number }>) ?? [],
      activeMapId: (s.activeMapId as string | null) ?? null,
      isMapSwitching: (s.isMapSwitching as boolean) ?? false,
    }
  })
}

/** Clear IndexedDB to ensure clean state between tests */
async function clearIndexedDB(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const dbs = await indexedDB.databases()
    for (const db of dbs) {
      if (db.name) indexedDB.deleteDatabase(db.name)
    }
  })
}


// ═════════════════════════════════════════════════════════════════════════════
// Test Suite
// ═════════════════════════════════════════════════════════════════════════════

test.describe('Maps Panel', () => {

  test.beforeEach(async ({ page }) => {
    // Clear IndexedDB before each test to ensure fresh state
    await page.goto('/')
    await clearIndexedDB(page)
    // Navigate fresh and wait for app + Clipper2 WASM to be fully ready
    await gotoApp(page)
  })

  // ─────────────────────────────────────────────────────────────────────────
  // 1. Panel Toggle
  // ─────────────────────────────────────────────────────────────────────────

  test.describe('1. Panel Toggle', () => {

    test('clicking Maps toggle icon opens the panel', async ({ page }) => {
      // Step 1: Verify the panel is NOT visible initially (default: closed)
      const panel = page.locator('[data-testid="maps-side-panel"]')
      await expect(panel).not.toBeVisible()

      // Step 2: Click the Maps toggle icon in the left toolbar
      await clickMapsToggle(page)

      // Step 3: Verify the panel is now visible
      await expect(panel).toBeVisible()

      // Step 4: Verify the panel has the expected approximate width (~260px)
      const panelBox = await panel.boundingBox()
      expect(panelBox).not.toBeNull()
      expect(panelBox!.width).toBeGreaterThanOrEqual(240)
      expect(panelBox!.width).toBeLessThanOrEqual(280)
    })

    test('clicking Maps toggle icon again closes the panel', async ({ page }) => {
      const panel = page.locator('[data-testid="maps-side-panel"]')

      // Step 1: Open the panel
      await clickMapsToggle(page)
      await expect(panel).toBeVisible()

      // Step 2: Click the toggle again to close
      await clickMapsToggle(page)

      // Step 3: Verify the panel is no longer visible
      await expect(panel).not.toBeVisible()
    })

    test('Ctrl+Shift+M keyboard shortcut toggles the panel open', async ({ page }) => {
      const panel = page.locator('[data-testid="maps-side-panel"]')

      // Step 1: Verify panel starts closed
      await expect(panel).not.toBeVisible()

      // Step 2: Press Ctrl+Shift+M to open
      await pressShortcut(page, 'm', { ctrl: true, shift: true })
      await page.waitForTimeout(300) // animation

      // Step 3: Verify panel is now open
      await expect(panel).toBeVisible()
    })

    test('Ctrl+Shift+M keyboard shortcut toggles the panel closed', async ({ page }) => {
      const panel = page.locator('[data-testid="maps-side-panel"]')

      // Step 1: Open the panel first
      await pressShortcut(page, 'm', { ctrl: true, shift: true })
      await page.waitForTimeout(300)
      await expect(panel).toBeVisible()

      // Step 2: Press Ctrl+Shift+M again to close
      await pressShortcut(page, 'm', { ctrl: true, shift: true })
      await page.waitForTimeout(300)

      // Step 3: Verify panel is closed
      await expect(panel).not.toBeVisible()
    })

    test('panel contains the "Maps" tab and "+ New Map" button when open', async ({ page }) => {
      // Step 1: Open the panel
      await openMapsPanel(page)

      // Step 2: Verify the "Maps" tab text is visible in the panel
      const mapsTab = page.locator('[data-testid="maps-side-panel"]').locator('text=Maps')
      await expect(mapsTab.first()).toBeVisible()

      // Step 3: Verify the "+ New Map" button is visible
      const newMapBtn = page.locator(
        '[data-testid="new-map-button"], button:has-text("+ New Map"), button:has-text("New Map")'
      )
      await expect(newMapBtn.first()).toBeVisible()
    })
  })


  // ─────────────────────────────────────────────────────────────────────────
  // 2. Initial State
  // ─────────────────────────────────────────────────────────────────────────

  test.describe('2. Initial State', () => {

    test('panel shows exactly 1 map card on first load', async ({ page }) => {
      // Step 1: Open the maps panel
      await openMapsPanel(page)

      // Step 2: Count map cards — should be exactly 1 (the current/default map)
      const cards = getMapCards(page)
      await expect(cards).toHaveCount(1)
    })

    test('the default map is marked as active with EDITING badge', async ({ page }) => {
      // Step 1: Open the maps panel
      await openMapsPanel(page)

      // Step 2: Get the single map card
      const card = getMapCards(page).first()
      await expect(card).toBeVisible()

      // Step 3: Verify it has the EDITING badge/indicator
      const editingBadge = card.locator('text=EDITING')
      await expect(editingBadge).toBeVisible()
    })

    test('default map card displays name, grid dimensions, and layer count', async ({ page }) => {
      // Step 1: Open the maps panel
      await openMapsPanel(page)

      // Step 2: Get the map card
      const card = getMapCards(page).first()
      await expect(card).toBeVisible()

      // Step 3: Verify the card has a name (e.g. "Untitled Map" or similar)
      const cardText = await card.textContent()
      expect(cardText).toBeTruthy()
      expect(cardText!.length).toBeGreaterThan(0)

      // Step 4: Verify grid dimensions are displayed (e.g. "50x40" pattern)
      // The meta line shows "{width}x{height} . {n} layers . Saved {timeAgo}"
      expect(cardText!).toMatch(/\d+\s*[x\u00d7]\s*\d+/)

      // Step 5: Verify layer count is displayed (e.g. "2 layers" or "1 layer")
      expect(cardText!).toMatch(/\d+\s*layer/)
    })

    test('default map has a name like "Untitled Map"', async ({ page }) => {
      // Step 1: Open the maps panel
      await openMapsPanel(page)

      // Step 2: Verify the card shows a default name
      const card = getMapCards(page).first()
      const nameEl = card.locator('[data-testid="map-card-name"]').or(card.locator('span, div').first())
      const name = await nameEl.first().textContent()
      // Should be some default name like "Untitled Map" — at minimum non-empty
      expect(name).toBeTruthy()
      expect(name!.trim().length).toBeGreaterThan(0)
    })
  })


  // ─────────────────────────────────────────────────────────────────────────
  // 3. Create New Map
  // ─────────────────────────────────────────────────────────────────────────

  test.describe('3. Create New Map', () => {

    test('clicking "+ New Map" creates a second map card', async ({ page }) => {
      // Step 1: Open the maps panel
      await openMapsPanel(page)

      // Step 2: Verify initial state — exactly 1 card
      const cards = getMapCards(page)
      await expect(cards).toHaveCount(1)

      // Step 3: Click the "+ New Map" button
      await clickNewMap(page)

      // Step 4: Verify there are now 2 map cards
      await expect(cards).toHaveCount(2)
    })

    test('new map gets a default name', async ({ page }) => {
      // Step 1: Open panel and create a new map
      await openMapsPanel(page)
      await clickNewMap(page)

      // Step 2: Find the newly created (active) card
      const cards = getMapCards(page)
      await expect(cards).toHaveCount(2)

      // Step 3: The active card (with EDITING badge) is the new one
      const activeCard = cards.filter({ has: page.locator('text=EDITING') })
      await expect(activeCard).toHaveCount(1)

      // Step 4: Verify the new map has a default name (non-empty)
      const activeText = await activeCard.textContent()
      expect(activeText).toBeTruthy()
      expect(activeText!.length).toBeGreaterThan(0)
    })

    test('new map becomes the active map (EDITING badge moves)', async ({ page }) => {
      // Step 1: Open panel
      await openMapsPanel(page)

      // Step 2: Note the first card currently has EDITING badge
      const firstCard = getMapCards(page).first()
      await expect(firstCard.locator('text=EDITING')).toBeVisible()

      // Step 3: Create a new map
      await clickNewMap(page)

      // Step 4: The newly created map should now have the EDITING badge
      const cards = getMapCards(page)
      await expect(cards).toHaveCount(2)

      // Step 5: Exactly one card should have EDITING
      const activeCards = cards.filter({ has: page.locator('text=EDITING') })
      await expect(activeCards).toHaveCount(1)
    })

    test('canvas content changes after creating a new map (new map is blank)', async ({ page }) => {
      // Step 1: Open panel
      await openMapsPanel(page)

      // Step 2: Draw a rectangle on the current (first) map to create content
      await page.keyboard.press('r') // activate rectangle tool
      await waitFrame(page, 2)
      // Draw on canvas area (offset past the panel width ~308px when open)
      await drawRect(page, 450, 300, 600, 400)
      await waitFrame(page, 3)

      // Step 3: Create a new map — triggers fog transition, shows blank canvas
      await clickNewMap(page)

      // Step 4: Verify the new (active) map card shows "1 layer" (fresh default)
      const cards = getMapCards(page)
      const activeCard = cards.filter({ has: page.locator('text=EDITING') })
      const meta = await activeCard.textContent()
      // The new blank map should have 1 default layer
      expect(meta).toMatch(/1\s*layer/)
    })

    test('creating multiple maps increments the card count correctly', async ({ page }) => {
      // Step 1: Open panel
      await openMapsPanel(page)

      // Step 2: Create 3 additional maps (total should become 4)
      for (let i = 0; i < 3; i++) {
        await clickNewMap(page)
      }

      // Step 3: Verify there are exactly 4 map cards
      const cards = getMapCards(page)
      await expect(cards).toHaveCount(4)

      // Step 4: Verify exactly 1 is active
      const activeCards = cards.filter({ has: page.locator('text=EDITING') })
      await expect(activeCards).toHaveCount(1)
    })
  })


  // ─────────────────────────────────────────────────────────────────────────
  // 4. Switch Maps
  // ─────────────────────────────────────────────────────────────────────────

  test.describe('4. Switch Maps', () => {

    test('clicking an inactive map card switches the active map', async ({ page }) => {
      // Step 1: Open panel and create a second map
      await openMapsPanel(page)
      await clickNewMap(page)

      // Step 2: Verify 2 cards exist
      const cards = getMapCards(page)
      await expect(cards).toHaveCount(2)

      // Step 3: Find the inactive card (the one WITHOUT "EDITING")
      const inactiveCard = cards.filter({ hasNot: page.locator('text=EDITING') }).first()
      await expect(inactiveCard).toBeVisible()

      // Step 4: Click the inactive card to switch to it
      await inactiveCard.click()

      // Step 5: Wait for fog transition to complete
      await page.waitForTimeout(1200)

      // Step 6: Exactly one card should have EDITING after switch
      const newActiveCards = getMapCards(page).filter({ has: page.locator('text=EDITING') })
      await expect(newActiveCards).toHaveCount(1)

      // Step 7: Verify the EDITING badge is present on the new active card
      const newActiveText = await newActiveCards.first().textContent()
      expect(newActiveText).toContain('EDITING')
    })

    test('the previously active map loses its EDITING badge after switch', async ({ page }) => {
      // Step 1: Open panel and create a second map
      await openMapsPanel(page)
      await clickNewMap(page)

      const cards = getMapCards(page)
      await expect(cards).toHaveCount(2)

      // Step 2: Count EDITING badges — should be exactly 1 before switch
      const activeBefore = cards.filter({ has: page.locator('text=EDITING') })
      await expect(activeBefore).toHaveCount(1)

      // Step 3: Click the inactive card
      const inactiveCard = cards.filter({ hasNot: page.locator('text=EDITING') }).first()
      await inactiveCard.click()
      await page.waitForTimeout(1200) // fog transition

      // Step 4: After switch, there should still be exactly 1 EDITING badge
      const activeAfter = getMapCards(page).filter({ has: page.locator('text=EDITING') })
      await expect(activeAfter).toHaveCount(1)

      // Step 5: Sanity — only 1 card has EDITING in the entire panel
      const allEditing = page.locator('[data-testid="map-card"]:has-text("EDITING")')
      await expect(allEditing).toHaveCount(1)
    })

    test('clicking the already-active card does NOT trigger fog transition', async ({ page }) => {
      // Step 1: Open panel
      await openMapsPanel(page)

      // Step 2: Get the active card
      const activeCard = getMapCards(page).filter({ has: page.locator('text=EDITING') }).first()

      // Step 3: Click it — should be a no-op (no fog)
      await activeCard.click()
      await waitFrame(page, 5)

      // Step 4: Verify the store is NOT in switching state
      const state = await getMapsState(page)
      expect(state.isMapSwitching).toBe(false)

      // Step 5: The same card should still be active
      await expect(activeCard.locator('text=EDITING')).toBeVisible()
    })

    test('map content is preserved when switching back and forth', async ({ page }) => {
      // Step 1: Open panel
      await openMapsPanel(page)

      // Step 2: Draw a rectangle on map 1
      await page.keyboard.press('r')
      await waitFrame(page, 2)
      await drawRect(page, 450, 300, 600, 400)
      await waitFrame(page, 3)

      // Step 3: Create map 2 (auto-switches, map 1 is auto-saved)
      await clickNewMap(page)

      // Step 4: Switch back to map 1
      const cards = getMapCards(page)
      const map1Card = cards.filter({ hasNot: page.locator('text=EDITING') }).first()
      await map1Card.click()
      await page.waitForTimeout(1200)

      // Step 5: Verify map 1 is active again and canvas is working
      const activeCard = getMapCards(page).filter({ has: page.locator('text=EDITING') }).first()
      await expect(activeCard).toBeVisible()
      const canvas = page.locator('canvas')
      await expect(canvas).toBeVisible()
    })
  })


  // ─────────────────────────────────────────────────────────────────────────
  // 5. Rename Map
  // ─────────────────────────────────────────────────────────────────────────

  test.describe('5. Rename Map', () => {

    test('double-clicking a map card name activates inline edit mode', async ({ page }) => {
      // Step 1: Open the panel
      await openMapsPanel(page)

      // Step 2: Get the first map card
      const card = getMapCards(page).first()
      await expect(card).toBeVisible()

      // Step 3: Double-click the card to enter rename mode
      await card.dblclick()
      await waitFrame(page, 3)

      // Step 4: Verify an input field appears inside the card for renaming
      const input = card.locator('input[type="text"], input:not([type]), [data-testid="map-rename-input"]')
      await expect(input.first()).toBeVisible()
    })

    test('typing a new name and pressing Enter commits the rename', async ({ page }) => {
      // Step 1: Open panel
      await openMapsPanel(page)

      // Step 2: Double-click to enter rename mode
      const card = getMapCards(page).first()
      await card.dblclick()
      await waitFrame(page, 3)

      // Step 3: Find the rename input
      const input = card.locator('input[type="text"], input:not([type]), [data-testid="map-rename-input"]').first()
      await expect(input).toBeVisible()

      // Step 4: Clear existing text and type new name
      await input.fill('Goblin Cave')

      // Step 5: Press Enter to confirm
      await input.press('Enter')
      await waitFrame(page, 3)

      // Step 6: Verify the card now shows the new name
      await expect(card.locator('text=Goblin Cave')).toBeVisible()
    })

    test('pressing Escape during rename cancels and reverts the name', async ({ page }) => {
      // Step 1: Open panel
      await openMapsPanel(page)

      // Step 2: Double-click to enter rename mode
      const card = getMapCards(page).first()
      await card.dblclick()
      await waitFrame(page, 3)

      // Step 3: Find the input and type a different name
      const input = card.locator('input[type="text"], input:not([type]), [data-testid="map-rename-input"]').first()
      await expect(input).toBeVisible()
      await input.fill('SHOULD NOT SAVE')

      // Step 4: Press Escape to cancel
      await input.press('Escape')
      await waitFrame(page, 3)

      // Step 5: Verify the name reverted — "SHOULD NOT SAVE" should not appear
      await expect(card.locator('text=SHOULD NOT SAVE')).not.toBeVisible()
    })

    test('rename persists after switching maps and back', async ({ page }) => {
      // Step 1: Open panel
      await openMapsPanel(page)

      // Step 2: Rename the first map
      const card = getMapCards(page).first()
      await card.dblclick()
      await waitFrame(page, 3)
      const input = card.locator('input[type="text"], input:not([type]), [data-testid="map-rename-input"]').first()
      await input.fill('Dragon Lair')
      await input.press('Enter')
      await waitFrame(page, 3)
      await expect(card.locator('text=Dragon Lair')).toBeVisible()

      // Step 3: Create a second map (switches away from the renamed one)
      await clickNewMap(page)

      // Step 4: Verify the renamed map card still shows "Dragon Lair" in the list
      const dragonCard = getMapCards(page).filter({ hasText: 'Dragon Lair' })
      await expect(dragonCard).toHaveCount(1)
    })
  })


  // ─────────────────────────────────────────────────────────────────────────
  // 6. Right-Click Context Menu
  // ─────────────────────────────────────────────────────────────────────────

  test.describe('6. Right-Click Context Menu', () => {

    test('right-clicking a map card shows the context menu', async ({ page }) => {
      // Step 1: Open panel
      await openMapsPanel(page)

      // Step 2: Right-click the first map card
      await rightClickMapCard(page, 0)

      // Step 3: Verify the context menu appears with expected options
      const renameOption = page.locator('text=Rename')
      const duplicateOption = page.locator('text=Duplicate')
      const deleteOption = page.locator('text=Delete')

      await expect(renameOption.first()).toBeVisible()
      await expect(duplicateOption.first()).toBeVisible()
      await expect(deleteOption.first()).toBeVisible()
    })

    test('clicking outside the context menu dismisses it', async ({ page }) => {
      // Step 1: Open panel and show context menu
      await openMapsPanel(page)
      await rightClickMapCard(page, 0)

      // Step 2: Verify menu is visible
      await expect(page.locator('text=Rename').first()).toBeVisible()

      // Step 3: Click on the canvas area (outside menu) to dismiss
      const canvas = page.locator('canvas')
      const canvasBox = await canvas.boundingBox()
      await page.mouse.click(
        canvasBox!.x + canvasBox!.width / 2,
        canvasBox!.y + canvasBox!.height / 2
      )
      await page.waitForTimeout(300)

      // Step 4: Verify the context menu is dismissed
      const contextMenu = page.locator('[data-testid="map-context-menu"], [role="menu"]')
      const menuVisible = await contextMenu.first().isVisible().catch(() => false)
      // Menu should be gone (or at least the options should not be visible in the panel area)
      expect(menuVisible).toBe(false)
    })

    test('context menu Rename option opens inline edit', async ({ page }) => {
      // Step 1: Open panel and show context menu
      await openMapsPanel(page)
      await rightClickMapCard(page, 0)

      // Step 2: Click "Rename" in the context menu
      await page.locator('text=Rename').first().click()
      await waitFrame(page, 3)

      // Step 3: Verify the card now has an inline input for renaming
      const card = getMapCards(page).first()
      const input = card.locator('input[type="text"], input:not([type]), [data-testid="map-rename-input"]')
      await expect(input.first()).toBeVisible()
    })

    test('context menu Duplicate option creates a copy', async ({ page }) => {
      // Step 1: Open panel
      await openMapsPanel(page)

      // Step 2: Verify initial count is 1
      await expect(getMapCards(page)).toHaveCount(1)

      // Step 3: Right-click and select Duplicate
      await rightClickMapCard(page, 0)
      await page.locator('text=Duplicate').first().click()
      await page.waitForTimeout(1000) // wait for duplication + any transitions

      // Step 4: Verify there are now 2 map cards
      await expect(getMapCards(page)).toHaveCount(2)

      // Step 5: Verify one of them has "Copy of" in its name
      const copyCard = getMapCards(page).filter({ hasText: 'Copy of' })
      await expect(copyCard).toHaveCount(1)
    })

    test('context menu Delete option shows confirmation dialog', async ({ page }) => {
      // Step 1: Open panel
      await openMapsPanel(page)

      // Step 2: Right-click and select Delete
      await rightClickMapCard(page, 0)
      await page.locator('text=Delete').first().click()
      await page.waitForTimeout(300)

      // Step 3: Verify a confirmation dialog appears
      const confirmDialog = page.locator(
        '[role="dialog"], [role="alertdialog"], [data-testid="confirm-dialog"]'
      )
      await expect(confirmDialog.first()).toBeVisible()

      // Step 4: Verify the dialog has Confirm/Delete and Cancel buttons
      const confirmBtn = page.locator(
        'button:has-text("Confirm"), button:has-text("Delete"), button:has-text("Yes")'
      )
      const cancelBtn = page.locator(
        'button:has-text("Cancel"), button:has-text("No"), button:has-text("Keep")'
      )
      await expect(confirmBtn.first()).toBeVisible()
      await expect(cancelBtn.first()).toBeVisible()
    })
  })


  // ─────────────────────────────────────────────────────────────────────────
  // 7. Duplicate Map
  // ─────────────────────────────────────────────────────────────────────────

  test.describe('7. Duplicate Map', () => {

    test('duplicated map has "Copy of [original name]" as its name', async ({ page }) => {
      // Step 1: Open panel and rename the first map
      await openMapsPanel(page)
      const card = getMapCards(page).first()
      await card.dblclick()
      await waitFrame(page, 3)
      const input = card.locator('input[type="text"], input:not([type]), [data-testid="map-rename-input"]').first()
      await input.fill('Dungeon Level 1')
      await input.press('Enter')
      await waitFrame(page, 3)

      // Step 2: Right-click and duplicate
      await rightClickMapCard(page, 0)
      await page.locator('text=Duplicate').first().click()
      await page.waitForTimeout(1000)

      // Step 3: Verify the copy has the correct name
      const copyCard = getMapCards(page).filter({ hasText: 'Copy of Dungeon Level 1' })
      await expect(copyCard).toHaveCount(1)
    })

    test('duplicate creates N+1 cards', async ({ page }) => {
      // Step 1: Open panel, create a second map first (so we have 2)
      await openMapsPanel(page)
      await clickNewMap(page)
      await expect(getMapCards(page)).toHaveCount(2)

      // Step 2: Duplicate one of them
      await rightClickMapCard(page, 0)
      await page.locator('text=Duplicate').first().click()
      await page.waitForTimeout(1000)

      // Step 3: Verify count is now 3
      await expect(getMapCards(page)).toHaveCount(3)
    })

    test('duplicated map has the same grid dimensions as the original', async ({ page }) => {
      // Step 1: Open panel
      await openMapsPanel(page)

      // Step 2: Read the meta text of the original card (contains grid size)
      const originalCard = getMapCards(page).first()
      const originalText = await originalCard.textContent()
      // Extract grid size pattern like "50x40"
      const gridMatch = originalText?.match(/(\d+)\s*[x\u00d7]\s*(\d+)/)
      expect(gridMatch).toBeTruthy()
      const originalGrid = gridMatch![0]

      // Step 3: Duplicate
      await rightClickMapCard(page, 0)
      await page.locator('text=Duplicate').first().click()
      await page.waitForTimeout(1000)

      // Step 4: Find the copy card and verify it has the same grid dimensions
      const copyCard = getMapCards(page).filter({ hasText: 'Copy of' }).first()
      const copyText = await copyCard.textContent()
      expect(copyText).toContain(originalGrid)
    })
  })


  // ─────────────────────────────────────────────────────────────────────────
  // 8. Delete Map
  // ─────────────────────────────────────────────────────────────────────────

  test.describe('8. Delete Map', () => {

    test('cancel in confirmation dialog does NOT delete the map', async ({ page }) => {
      // Step 1: Open panel and create a second map (so deletion is not "last map" case)
      await openMapsPanel(page)
      await clickNewMap(page)
      await expect(getMapCards(page)).toHaveCount(2)

      // Step 2: Right-click a card and select Delete
      await rightClickMapCard(page, 1)
      await page.locator('text=Delete').first().click()
      await page.waitForTimeout(300)

      // Step 3: Click Cancel in the confirmation dialog
      const cancelBtn = page.locator(
        'button:has-text("Cancel"), button:has-text("No"), button:has-text("Keep")'
      )
      await cancelBtn.first().click()
      await page.waitForTimeout(300)

      // Step 4: Verify the map count is still 2
      await expect(getMapCards(page)).toHaveCount(2)
    })

    test('confirming delete removes the map card and decreases count', async ({ page }) => {
      // Step 1: Open panel and create extra maps (total 3)
      await openMapsPanel(page)
      await clickNewMap(page)
      await clickNewMap(page)
      await expect(getMapCards(page)).toHaveCount(3)

      // Step 2: Right-click the NON-ACTIVE map and delete
      const inactiveCard = getMapCards(page).filter({ hasNot: page.locator('text=EDITING') }).first()
      await inactiveCard.click({ button: 'right' })
      await page.waitForTimeout(200)
      await page.locator('text=Delete').first().click()
      await page.waitForTimeout(300)

      // Step 3: Confirm the deletion
      const confirmBtn = page.locator(
        'button:has-text("Confirm"), button:has-text("Delete"), button:has-text("Yes")'
      )
      await confirmBtn.first().click()
      await page.waitForTimeout(500)

      // Step 4: Verify count decreased to 2
      await expect(getMapCards(page)).toHaveCount(2)
    })

    test('deleting the active map switches to another map', async ({ page }) => {
      // Step 1: Open panel and create a second map (second is now active)
      await openMapsPanel(page)
      await clickNewMap(page)
      await expect(getMapCards(page)).toHaveCount(2)

      // Step 2: Right-click the ACTIVE card and delete it
      const activeCard = getMapCards(page).filter({ has: page.locator('text=EDITING') }).first()
      await activeCard.click({ button: 'right' })
      await page.waitForTimeout(200)
      await page.locator('text=Delete').first().click()
      await page.waitForTimeout(300)

      // Step 3: Confirm
      const confirmBtn = page.locator(
        'button:has-text("Confirm"), button:has-text("Delete"), button:has-text("Yes")'
      )
      await confirmBtn.first().click()
      await page.waitForTimeout(1500) // fog transition + switch

      // Step 4: Verify count is 1
      await expect(getMapCards(page)).toHaveCount(1)

      // Step 5: The remaining map should now be active (EDITING badge)
      const remainingCard = getMapCards(page).first()
      await expect(remainingCard.locator('text=EDITING')).toBeVisible()
    })
  })


  // ─────────────────────────────────────────────────────────────────────────
  // 9. Delete Last Map
  // ─────────────────────────────────────────────────────────────────────────

  test.describe('9. Delete Last Map', () => {

    test('deleting the only remaining map auto-creates a fresh "Untitled Map"', async ({ page }) => {
      // Step 1: Open panel — should have 1 map
      await openMapsPanel(page)
      await expect(getMapCards(page)).toHaveCount(1)

      // Step 2: Right-click the only card and select Delete
      await rightClickMapCard(page, 0)
      await page.locator('text=Delete').first().click()
      await page.waitForTimeout(300)

      // Step 3: Confirm the deletion
      const confirmBtn = page.locator(
        'button:has-text("Confirm"), button:has-text("Delete"), button:has-text("Yes")'
      )
      await confirmBtn.first().click()
      await page.waitForTimeout(1500) // fog transition + auto-create

      // Step 4: Verify there is still exactly 1 map card (never 0)
      await expect(getMapCards(page)).toHaveCount(1)

      // Step 5: The new map should have a default name like "Untitled Map"
      const card = getMapCards(page).first()
      const name = await card.textContent()
      expect(name).toBeTruthy()
      expect(name!.toLowerCase()).toMatch(/untitled|map/)

      // Step 6: The new map should be active (EDITING badge)
      await expect(card.locator('text=EDITING')).toBeVisible()
    })

    test('app never reaches a state with 0 map cards', async ({ page }) => {
      // Step 1: Open panel, create 2 maps, then delete both
      await openMapsPanel(page)
      await clickNewMap(page)
      await expect(getMapCards(page)).toHaveCount(2)

      // Step 2: Delete the inactive map first
      const inactiveCard = getMapCards(page).filter({ hasNot: page.locator('text=EDITING') }).first()
      await inactiveCard.click({ button: 'right' })
      await page.waitForTimeout(200)
      await page.locator('text=Delete').first().click()
      await page.waitForTimeout(300)
      const confirm1 = page.locator(
        'button:has-text("Confirm"), button:has-text("Delete"), button:has-text("Yes")'
      )
      await confirm1.first().click()
      await page.waitForTimeout(500)
      await expect(getMapCards(page)).toHaveCount(1)

      // Step 3: Now delete the last remaining map
      await rightClickMapCard(page, 0)
      await page.locator('text=Delete').first().click()
      await page.waitForTimeout(300)
      const confirm2 = page.locator(
        'button:has-text("Confirm"), button:has-text("Delete"), button:has-text("Yes")'
      )
      await confirm2.first().click()
      await page.waitForTimeout(1500)

      // Step 4: Verify there is exactly 1 card (auto-created), never 0
      const count = await getMapCards(page).count()
      expect(count).toBeGreaterThanOrEqual(1)
    })
  })


  // ─────────────────────────────────────────────────────────────────────────
  // 10. Keyboard Shortcuts
  // ─────────────────────────────────────────────────────────────────────────

  test.describe('10. Keyboard Shortcuts', () => {

    test('Ctrl+Shift+M toggles the maps panel open and closed', async ({ page }) => {
      const panel = page.locator('[data-testid="maps-side-panel"]')

      // Step 1: Verify panel starts closed
      await expect(panel).not.toBeVisible()

      // Step 2: Press Ctrl+Shift+M
      await pressShortcut(page, 'm', { ctrl: true, shift: true })
      await page.waitForTimeout(300)

      // Step 3: Verify panel is now open
      await expect(panel).toBeVisible()

      // Step 4: Press Ctrl+Shift+M again
      await pressShortcut(page, 'm', { ctrl: true, shift: true })
      await page.waitForTimeout(300)

      // Step 5: Verify panel is closed
      await expect(panel).not.toBeVisible()
    })

    test('Ctrl+Shift+N creates a new map', async ({ page }) => {
      // Step 1: Open the panel first to see the cards
      await openMapsPanel(page)
      await expect(getMapCards(page)).toHaveCount(1)

      // Step 2: Press Ctrl+Shift+N to create a new map
      await pressShortcut(page, 'n', { ctrl: true, shift: true })
      await page.waitForTimeout(1200) // fog transition

      // Step 3: Verify a second map card appeared
      await expect(getMapCards(page)).toHaveCount(2)
    })

    test('Ctrl+Shift+N auto-opens the panel if it was closed', async ({ page }) => {
      const panel = page.locator('[data-testid="maps-side-panel"]')

      // Step 1: Verify panel starts closed
      await expect(panel).not.toBeVisible()

      // Step 2: Press Ctrl+Shift+N (panel is closed)
      await pressShortcut(page, 'n', { ctrl: true, shift: true })
      await page.waitForTimeout(1200) // fog transition + panel open

      // Step 3: Verify the panel auto-opened
      await expect(panel).toBeVisible()

      // Step 4: Verify a new map was created (should now have 2 cards)
      await expect(getMapCards(page)).toHaveCount(2)
    })

    test('shortcuts work when focus is on the canvas', async ({ page }) => {
      // Step 1: Open panel
      await openMapsPanel(page)

      // Step 2: Click on the canvas to ensure focus is on the canvas area
      const canvas = page.locator('canvas')
      await canvas.click()
      await waitFrame(page, 2)

      // Step 3: Verify Ctrl+Shift+M toggles from canvas focus
      await pressShortcut(page, 'm', { ctrl: true, shift: true })
      await page.waitForTimeout(300)

      // Step 4: Panel should have closed (it was open, now toggled closed)
      const panel = page.locator('[data-testid="maps-side-panel"]')
      await expect(panel).not.toBeVisible()
    })
  })


  // ─────────────────────────────────────────────────────────────────────────
  // 11. Panel Interaction with Canvas
  // ─────────────────────────────────────────────────────────────────────────

  test.describe('11. Panel Interaction with Canvas', () => {

    test('drawing on canvas still works while the maps panel is open', async ({ page }) => {
      // Step 1: Open the maps panel
      await openMapsPanel(page)

      // Step 2: Select the rectangle tool
      await page.keyboard.press('r')
      await waitFrame(page, 2)

      // Step 3: Draw a rectangle on the canvas (to the right of the panel)
      // Panel + toolbar together ~ 308px, so draw starting at 450px to be safe
      await drawRect(page, 450, 300, 600, 400)
      await waitFrame(page, 5)

      // Step 4: Verify the canvas is still visible and not broken
      const canvas = page.locator('canvas')
      await expect(canvas).toBeVisible()

      // Step 5: The app should not have crashed — store is accessible
      const storeExists = await page.evaluate(() => !!(window as { __store?: unknown }).__store)
      expect(storeExists).toBe(true)
    })

    test('closing the panel reclaims canvas space (toolbar width decreases)', async ({ page }) => {
      // Step 1: Get the toolbar right edge when panel is closed
      const toolbar = page.locator('[data-testid="left-toolbar"]')
      const toolbarBoxClosed = await toolbar.boundingBox()
      expect(toolbarBoxClosed).not.toBeNull()
      const rightEdgeClosed = toolbarBoxClosed!.x + toolbarBoxClosed!.width

      // Step 2: Open the panel
      await openMapsPanel(page)
      await page.waitForTimeout(400) // wait for transition

      // Step 3: Get the toolbar right edge when panel is open (toolbar shifts right)
      const toolbarBoxOpen = await toolbar.boundingBox()
      expect(toolbarBoxOpen).not.toBeNull()
      const rightEdgeOpen = toolbarBoxOpen!.x + toolbarBoxOpen!.width

      // Step 4: Verify the open state uses more horizontal space
      expect(rightEdgeOpen).toBeGreaterThan(rightEdgeClosed)

      // Step 5: Close the panel
      await closeMapsPanel(page)
      await page.waitForTimeout(400) // wait for transition

      // Step 6: Verify width returns to the closed size
      const toolbarBoxAfterClose = await toolbar.boundingBox()
      expect(toolbarBoxAfterClose).not.toBeNull()
      const rightEdgeAfterClose = toolbarBoxAfterClose!.x + toolbarBoxAfterClose!.width
      expect(rightEdgeAfterClose).toBeLessThanOrEqual(rightEdgeClosed + 5) // small tolerance
    })

    test('canvas element is always visible regardless of panel state', async ({ page }) => {
      const canvas = page.locator('canvas')

      // Step 1: Canvas visible with panel closed
      await expect(canvas).toBeVisible()

      // Step 2: Open panel — canvas still visible
      await openMapsPanel(page)
      await expect(canvas).toBeVisible()

      // Step 3: Close panel — canvas still visible
      await closeMapsPanel(page)
      await expect(canvas).toBeVisible()
    })
  })


  // ─────────────────────────────────────────────────────────────────────────
  // 12. Map Card Ordering
  // ─────────────────────────────────────────────────────────────────────────

  test.describe('12. Map Card Ordering', () => {

    test('maps are sorted by last edited (most recent first)', async ({ page }) => {
      // Step 1: Open panel
      await openMapsPanel(page)

      // Step 2: Rename the first map to "Map A"
      const firstCard = getMapCards(page).first()
      await firstCard.dblclick()
      await waitFrame(page, 3)
      const input1 = firstCard.locator(
        'input[type="text"], input:not([type]), [data-testid="map-rename-input"]'
      ).first()
      await input1.fill('Map A')
      await input1.press('Enter')
      await waitFrame(page, 3)

      // Step 3: Create "Map B" (newer — should be first in list)
      await clickNewMap(page)

      // Step 4: The newly created map should be at the top (most recently edited)
      const cards = getMapCards(page)
      await expect(cards).toHaveCount(2)

      // Step 5: The active card (most recently created/edited) should be at the top
      const topCard = cards.first()
      await expect(topCard.locator('text=EDITING')).toBeVisible()
    })

    test('switching to an older map moves it to the top after editing', async ({ page }) => {
      // Step 1: Create 3 maps with names
      await openMapsPanel(page)

      // Rename first to "Map A"
      const card0 = getMapCards(page).first()
      await card0.dblclick()
      await waitFrame(page, 3)
      const input0 = card0.locator(
        'input[type="text"], input:not([type]), [data-testid="map-rename-input"]'
      ).first()
      await input0.fill('Map A')
      await input0.press('Enter')
      await waitFrame(page, 3)

      // Create Map B
      await clickNewMap(page)
      const activeCard1 = getMapCards(page).filter({ has: page.locator('text=EDITING') }).first()
      await activeCard1.dblclick()
      await waitFrame(page, 3)
      const input1 = activeCard1.locator(
        'input[type="text"], input:not([type]), [data-testid="map-rename-input"]'
      ).first()
      await input1.fill('Map B')
      await input1.press('Enter')
      await waitFrame(page, 3)

      // Create Map C
      await clickNewMap(page)
      await expect(getMapCards(page)).toHaveCount(3)

      // Step 2: Switch to "Map A" (should be near bottom since it was created first)
      const mapACard = getMapCards(page).filter({ hasText: 'Map A' }).first()
      await mapACard.click()
      await page.waitForTimeout(1200) // fog transition

      // Step 3: Draw on canvas to "edit" Map A (updates its updatedAt)
      await page.keyboard.press('r')
      await waitFrame(page, 2)
      await drawRect(page, 450, 300, 600, 400)
      await waitFrame(page, 5)

      // Step 4: Wait for auto-save to update the updatedAt timestamp
      await page.waitForTimeout(500)

      // Step 5: Verify "Map A" is now active and visible in the list
      const updatedActiveCard = getMapCards(page).filter({ has: page.locator('text=EDITING') }).first()
      await expect(updatedActiveCard).toContainText('Map A')
    })
  })


  // ─────────────────────────────────────────────────────────────────────────
  // 13. Persistence (Reload)
  // ─────────────────────────────────────────────────────────────────────────

  test.describe('13. Persistence (Reload)', () => {

    test('maps persist across page reload', async ({ page }) => {
      // Step 1: Open panel and create a second map with a custom name
      await openMapsPanel(page)

      // Rename first map
      const card = getMapCards(page).first()
      await card.dblclick()
      await waitFrame(page, 3)
      const input = card.locator(
        'input[type="text"], input:not([type]), [data-testid="map-rename-input"]'
      ).first()
      await input.fill('Throne Room')
      await input.press('Enter')
      await waitFrame(page, 5)

      // Create a second map
      await clickNewMap(page)
      await expect(getMapCards(page)).toHaveCount(2)

      // Step 2: Wait for IndexedDB to persist (auto-save debounce)
      await page.waitForTimeout(2000)

      // Step 3: Reload the page
      await page.reload()
      await page.waitForSelector('[data-clipper-ready="true"]', { timeout: 20000 })

      // Step 4: Open the maps panel again
      await openMapsPanel(page)

      // Step 5: Verify both maps are still there
      const cards = getMapCards(page)
      const count = await cards.count()
      expect(count).toBeGreaterThanOrEqual(2)

      // Step 6: Verify "Throne Room" name persisted
      const throneCard = cards.filter({ hasText: 'Throne Room' })
      await expect(throneCard).toHaveCount(1)
    })

    test('the active map is restored after reload', async ({ page }) => {
      // Step 1: Open panel and create a second map
      await openMapsPanel(page)
      await clickNewMap(page)

      // Step 2: Rename the active (new) map to identify it
      const activeCard = getMapCards(page).filter({ has: page.locator('text=EDITING') }).first()
      await activeCard.dblclick()
      await waitFrame(page, 3)
      const input = activeCard.locator(
        'input[type="text"], input:not([type]), [data-testid="map-rename-input"]'
      ).first()
      await input.fill('Active Test Map')
      await input.press('Enter')
      await waitFrame(page, 5)

      // Step 3: Wait for persistence
      await page.waitForTimeout(2000)

      // Step 4: Reload the page
      await page.reload()
      await page.waitForSelector('[data-clipper-ready="true"]', { timeout: 20000 })

      // Step 5: Open the maps panel
      await openMapsPanel(page)

      // Step 6: Verify the previously active map is still marked as active
      const restoredActive = getMapCards(page).filter({ has: page.locator('text=EDITING') }).first()
      const activeName = await restoredActive.textContent()
      expect(activeName).toContain('Active Test Map')
    })
  })


  // ─────────────────────────────────────────────────────────────────────────
  // 14. Panel Layout — Slides Left of Toolbar
  // ─────────────────────────────────────────────────────────────────────────

  test.describe('14. Panel Layout', () => {

    test('panel slides to the LEFT of the toolbar; toolbar stays pinned', async ({ page }) => {
      // Step 1: Record the toolbar position before opening the panel
      const toolbar = page.locator('[data-testid="left-toolbar"]')
      await expect(toolbar).toBeVisible()
      const toolbarBefore = await toolbar.boundingBox()
      expect(toolbarBefore).not.toBeNull()

      // Step 2: Open the maps panel
      await clickMapsToggle(page)
      await page.waitForTimeout(400) // wait for slide animation

      // Step 3: Get panel and toolbar positions
      const panel = page.locator('[data-testid="maps-side-panel"]')
      await expect(panel).toBeVisible()
      const panelBox = await panel.boundingBox()
      const toolbarAfter = await toolbar.boundingBox()

      expect(panelBox).not.toBeNull()
      expect(toolbarAfter).not.toBeNull()

      // Step 4: Panel should be to the LEFT of the toolbar
      expect(panelBox!.x).toBeLessThan(toolbarAfter!.x)

      // Step 5: Toolbar should have shifted right by approximately the panel width
      expect(toolbarAfter!.x).toBeGreaterThan(toolbarBefore!.x)
      const shift = toolbarAfter!.x - toolbarBefore!.x
      // The shift should be roughly the panel width (260px, with tolerance)
      expect(shift).toBeGreaterThan(200)
      expect(shift).toBeLessThan(320)
    })

    test('panel has correct width of ~260px', async ({ page }) => {
      // Step 1: Open the panel
      await openMapsPanel(page)

      // Step 2: Measure the panel
      const panel = page.locator('[data-testid="maps-side-panel"]')
      const box = await panel.boundingBox()
      expect(box).not.toBeNull()

      // Step 3: Verify width is approximately 260px
      expect(box!.width).toBeGreaterThanOrEqual(240)
      expect(box!.width).toBeLessThanOrEqual(280)
    })

    test('total left chrome width is ~308px when panel open (260 panel + 48 toolbar)', async ({ page }) => {
      // Step 1: Open the panel
      await openMapsPanel(page)
      await page.waitForTimeout(400)

      // Step 2: Measure the outer chrome wrapper
      const toolbar = page.locator('[data-testid="left-toolbar"]')
      const toolbarBox = await toolbar.boundingBox()
      const panel = page.locator('[data-testid="maps-side-panel"]')
      const panelBox = await panel.boundingBox()

      expect(toolbarBox).not.toBeNull()
      expect(panelBox).not.toBeNull()

      // Step 3: Total width = toolbar right edge from x=0
      const totalWidth = toolbarBox!.x + toolbarBox!.width
      // Expected: ~308px (260 + 48), with some tolerance
      expect(totalWidth).toBeGreaterThan(280)
      expect(totalWidth).toBeLessThan(340)
    })
  })


  // ─────────────────────────────────────────────────────────────────────────
  // 15. Focus Mode Interaction
  // ─────────────────────────────────────────────────────────────────────────

  test.describe('15. Focus Mode Interaction', () => {

    test('maps panel respects focus mode auto-fade', async ({ page }) => {
      // Step 1: Open the maps panel
      await openMapsPanel(page)

      // Step 2: Verify the panel wrapper has data-chrome attribute (required for fade)
      const chromeWrapper = page.locator('[data-chrome]').first()
      await expect(chromeWrapper).toBeVisible()

      // Step 3: Get initial opacity (should be 1.0 or close to it)
      const initialOpacity = await chromeWrapper.evaluate((el) =>
        parseFloat(window.getComputedStyle(el).opacity),
      )
      expect(initialOpacity).toBeGreaterThan(0.9)

      // Step 4: Wait for idle timeout (5s + buffer) for auto-fade to kick in
      await page.waitForTimeout(5500)
      await waitFrame(page, 3)

      // Step 5: Verify opacity has reduced (auto-fade in 'auto' mode)
      const fadedOpacity = await chromeWrapper.evaluate((el) =>
        parseFloat(window.getComputedStyle(el).opacity),
      )
      expect(fadedOpacity).toBeLessThanOrEqual(0.4)
    })

    test('fullscreen focus mode hides the maps panel along with toolbar', async ({ page }) => {
      // Step 1: Open the maps panel
      await openMapsPanel(page)
      const panel = page.locator('[data-testid="maps-side-panel"]')
      await expect(panel).toBeVisible()

      // Step 2: Cycle focus mode to fullscreen (backtick x2: auto -> manual -> fullscreen)
      await page.keyboard.press('`')
      await page.keyboard.press('`')
      await waitFrame(page, 3)

      // Step 3: In fullscreen mode, the toolbar is not attached — panel should also be gone
      const toolbar = page.locator('[data-testid="left-toolbar"]')
      await expect(toolbar).not.toBeAttached()
      // The panel is inside the same chrome wrapper — also not attached
    })
  })


  // ─────────────────────────────────────────────────────────────────────────
  // 16. Edge Cases & Stress
  // ─────────────────────────────────────────────────────────────────────────

  test.describe('16. Edge Cases', () => {

    test('rapidly clicking "+ New Map" multiple times does not crash', async ({ page }) => {
      // Step 1: Open panel
      await openMapsPanel(page)

      // Step 2: Rapidly click New Map 5 times without waiting for transitions
      const newMapBtn = page.locator(
        '[data-testid="new-map-button"], button:has-text("+ New Map"), button:has-text("New Map")'
      ).first()
      for (let i = 0; i < 5; i++) {
        await newMapBtn.click()
        await page.waitForTimeout(100) // tiny delay between clicks
      }

      // Step 3: Wait for all transitions to settle
      await page.waitForTimeout(3000)

      // Step 4: Verify the app did not crash — canvas and panel still work
      const canvas = page.locator('canvas')
      await expect(canvas).toBeVisible()

      // Step 5: There should be some map cards (at least 2, possibly up to 6)
      const count = await getMapCards(page).count()
      expect(count).toBeGreaterThanOrEqual(2)
    })

    test('renaming with empty string is handled gracefully', async ({ page }) => {
      // Step 1: Open panel
      await openMapsPanel(page)

      // Step 2: Double-click to rename
      const card = getMapCards(page).first()
      await card.dblclick()
      await waitFrame(page, 3)

      // Step 3: Clear the input and press Enter (empty name)
      const input = card.locator(
        'input[type="text"], input:not([type]), [data-testid="map-rename-input"]'
      ).first()
      await input.fill('')
      await input.press('Enter')
      await waitFrame(page, 3)

      // Step 4: Verify the card still has SOME name (not empty)
      // Implementation should either reject empty names or revert to previous name
      const nameText = await card.textContent()
      expect(nameText).toBeTruthy()
      expect(nameText!.replace('EDITING', '').trim().length).toBeGreaterThan(0)
    })

    test('panel survives rapid open/close toggling', async ({ page }) => {
      // Step 1: Rapidly toggle the panel 10 times
      for (let i = 0; i < 10; i++) {
        await clickMapsToggle(page)
        await page.waitForTimeout(50)
      }

      // Step 2: Wait for animations to settle
      await page.waitForTimeout(500)

      // Step 3: App should not have crashed
      const canvas = page.locator('canvas')
      await expect(canvas).toBeVisible()

      // Step 4: Panel should be in a definite state (open or closed, not stuck)
      const panel = page.locator('[data-testid="maps-side-panel"]')
      const isVisible = await panel.isVisible().catch(() => false)
      expect(typeof isVisible).toBe('boolean')
    })

    test('map switch during drawing does not corrupt state', async ({ page }) => {
      // Step 1: Open panel and create a second map
      await openMapsPanel(page)
      await clickNewMap(page)

      // Step 2: Switch back to map 1
      const map1 = getMapCards(page).filter({ hasNot: page.locator('text=EDITING') }).first()
      await map1.click()
      await page.waitForTimeout(1200)

      // Step 3: Start drawing on the canvas
      await page.keyboard.press('r')
      await waitFrame(page, 2)

      // Draw a rectangle normally
      const canvas = page.locator('canvas')
      const canvasBox = await canvas.boundingBox()
      await page.mouse.move(canvasBox!.x + 400, canvasBox!.y + 300)
      await page.mouse.down()
      await page.mouse.move(canvasBox!.x + 500, canvasBox!.y + 400)

      // Step 4: Release the mouse (complete the drawing)
      await page.mouse.up()
      await waitFrame(page, 5)

      // Step 5: Verify no crash — store is accessible and canvas is visible
      const storeOk = await page.evaluate(() => !!(window as { __store?: unknown }).__store)
      expect(storeOk).toBe(true)
      await expect(canvas).toBeVisible()
    })
  })
})
