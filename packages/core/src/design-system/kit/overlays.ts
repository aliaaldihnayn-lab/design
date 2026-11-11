import type { SceneNode } from '@lawha/scene-graph'

import type { Transition } from '#core/prototype/model'

import { glyph, label, setAttrs, type KitDefinition } from './jsx'
import type { KitTheme } from './theme'
import { DISSOLVE, QUICK, type KitWiring } from './wire'

/**
 * Layers that appear over the frame: a dialog and a bottom sheet open as overlays from their
 * trigger, a popover and a tooltip are variants of their trigger, and a toast slides in and
 * leaves on its own.
 */

const SPRING: Transition = {
  type: 'move-in',
  direction: 'up',
  duration: 400,
  easing: 'custom-spring',
  spring: { stiffness: 320, damping: 28, mass: 1 }
}

function triggerButton(theme: KitTheme, name: string, text: string): string {
  return `<Component name="${name}" flex="row" ${theme.rtl ? 'flow="rtl"' : ''} gap={8} px={18} py={10} items="center" rounded={8} bg=${theme.primary}>${label(theme, 'Label', text, { weight: 600, color: theme.onPrimary })}</Component>`
}

function actionButton(theme: KitTheme, name: string, text: string, primary: boolean): string {
  const look = primary ? `bg=${theme.danger}` : `bg=${theme.surface} stroke=${theme.border}`
  return `<Frame name="${name}" flex="row" px={16} py={8} items="center" rounded={8} ${look}>${label(theme, 'Label', text, { weight: 600, color: primary ? theme.onPrimary : theme.text })}</Frame>`
}

function requireSet(sets: ReadonlyMap<string, SceneNode>, name: string): SceneNode {
  const node = sets.get(name)
  if (!node) throw new Error(`The kit drew no ${name}`)
  return node
}

function wireOverlay(
  trigger: string,
  surface: string,
  closers: readonly string[],
  overlay: { position: 'center' | 'bottom' | 'top'; background?: string; transition: Transition }
) {
  return (w: KitWiring, _theme: KitTheme, sets: ReadonlyMap<string, SceneNode>) => {
    const destination = requireSet(sets, surface)
    w.on(requireSet(sets, trigger), { type: 'click' }, [
      {
        type: 'overlay',
        destination: destination.id,
        position: overlay.position,
        closeOnOutside: overlay.background !== undefined,
        ...(overlay.background ? { background: overlay.background } : {}),
        transition: overlay.transition
      }
    ])
    for (const path of closers)
      w.on(w.below(destination, path), { type: 'click' }, [{ type: 'close-overlay' }])
    w.on(destination, { type: 'key', key: 'Escape' }, [{ type: 'close-overlay' }])
  }
}

const modal: KitDefinition = {
  kind: 'modal',
  name: 'Kit/Modal',
  insert: 'Kit/Modal',
  jsx: (theme) => `<Frame name="Kit modal" flex="col" gap={24}>
    ${triggerButton(theme, 'Kit/Modal', theme.labels.openDialog)}
    <Component name="Kit/Dialog" flex="col" gap={12} p={24} w={360} rounded={16} bg=${theme.surface} shadow="0 24 48 #00000033">
      <Frame name="Header" flex="row" ${theme.rtl ? 'flow="rtl"' : ''} w="fill" items="center">
        ${label(theme, 'Title', theme.labels.dialogTitle, { size: 18, weight: 700, extra: 'grow={1}' })}
        <Frame name="Close" w={24} h={24} flex="row" items="center" justify="center">${glyph('close', theme.muted, { layer: 'Glyph' })}</Frame>
      </Frame>
      ${label(theme, 'Body', theme.labels.dialogBody, { color: theme.muted })}
      <Frame name="Actions" flex="row" ${theme.rtl ? 'flow="rtl"' : ''} gap={8} w="fill" justify="end">
        ${actionButton(theme, 'Cancel', theme.labels.cancel, false)}
        ${actionButton(theme, 'Confirm', theme.labels.confirm, true)}
      </Frame>
    </Component>
  </Frame>`,
  wire: wireOverlay(
    'Kit/Modal',
    'Kit/Dialog',
    ['Header/Close', 'Actions/Cancel', 'Actions/Confirm'],
    {
      position: 'center',
      background: '#00000066',
      transition: { ...DISSOLVE, duration: 200 }
    }
  )
}

const drawer: KitDefinition = {
  kind: 'drawer',
  name: 'Kit/Drawer',
  insert: 'Kit/Drawer',
  jsx: (theme) => `<Frame name="Kit drawer" flex="col" gap={24}>
    ${triggerButton(theme, 'Kit/Drawer', theme.labels.openDrawer)}
    <Component name="Kit/Sheet" flex="col" gap={16} p={20} w={390} roundedTL={20} roundedTR={20} bg=${theme.surface} shadow="0 -8 32 #00000026" items="center">
      <Frame name="Handle" w={40} h={4} rounded={2} bg=${theme.border} />
      <Frame name="Header" flex="row" ${theme.rtl ? 'flow="rtl"' : ''} w="fill" items="center">
        ${label(theme, 'Title', theme.labels.drawerTitle, { size: 18, weight: 700, extra: 'grow={1}' })}
        <Frame name="Close" w={24} h={24} flex="row" items="center" justify="center">${glyph('close', theme.muted, { layer: 'Glyph' })}</Frame>
      </Frame>
      ${theme.labels.options.map((option) => `<Frame name="Row" flex="row" ${theme.rtl ? 'flow="rtl"' : ''} w="fill" py={10}>${label(theme, 'Label', option)}</Frame>`).join('')}
    </Component>
  </Frame>`,
  wire: wireOverlay('Kit/Drawer', 'Kit/Sheet', ['Header/Close', 'Handle'], {
    position: 'bottom',
    background: '#00000059',
    transition: SPRING
  })
}

const popover: KitDefinition = {
  kind: 'popover',
  name: 'Kit/Popover',
  insert: 'State=Closed',
  jsx: (theme) => {
    const trigger = `<Frame name="Trigger" flex="row" ${theme.rtl ? 'flow="rtl"' : ''} gap={6} px={14} py={8} items="center" rounded={8} bg=${theme.surface} stroke=${theme.border}>${label(theme, 'Label', theme.labels.more, { weight: 600 })}</Frame>`
    const bubble = `<Frame name="Popover" flex="col" gap={6} p={14} w={220} rounded={10} bg=${theme.surface} stroke=${theme.border} shadow="0 8 24 #0000001F">${label(theme, 'Body', theme.labels.popover)}</Frame>`
    return `<ComponentSet ${setAttrs('Kit/Popover')}>
      <Component name="State=Closed" flex="col" gap={8} items="${theme.rtl ? 'end' : 'start'}">${trigger}</Component>
      <Component name="State=Open" flex="col" gap={8} items="${theme.rtl ? 'end' : 'start'}">${trigger}${bubble}</Component>
    </ComponentSet>`
  },
  wire: (w) => {
    w.on(w.layer('State=Closed', 'Trigger'), { type: 'click' }, [w.changeTo('State=Open', QUICK)])
    w.on(w.layer('State=Open', 'Trigger'), { type: 'click' }, [w.changeTo('State=Closed', QUICK)])
    w.on(w.layer('State=Open'), { type: 'key', key: 'Escape' }, [w.changeTo('State=Closed', QUICK)])
  }
}

const tooltip: KitDefinition = {
  kind: 'tooltip',
  name: 'Kit/Tooltip',
  insert: 'State=Default',
  jsx: (theme) => {
    const trigger = `<Frame name="Trigger" flex="row" px={14} py={8} items="center" rounded={8} stroke=${theme.border} bg=${theme.surface}>${label(theme, 'Label', theme.labels.hover)}</Frame>`
    const tip = `<Frame name="Tip" position="absolute" x={0} y={-40} flex="row" px={10} py={6} rounded={6} bg=${theme.text}>${label(theme, 'Text', theme.labels.tooltip, { size: 12, color: theme.surface })}</Frame>`
    return `<ComponentSet ${setAttrs('Kit/Tooltip')} pt={64}>
      <Component name="State=Default" flex="col">${trigger}</Component>
      <Component name="State=Hover" flex="col">${trigger}${tip}</Component>
    </ComponentSet>`
  },
  wire: (w) => {
    // While the pointer rests on the trigger the tip shows; it goes when the pointer leaves.
    w.on(w.layer('State=Default'), { type: 'hover' }, [
      w.changeTo('State=Hover', { ...DISSOLVE, duration: 120 })
    ])
  }
}

const toast: KitDefinition = {
  kind: 'toast',
  name: 'Kit/Toast trigger',
  insert: 'Kit/Toast trigger',
  jsx: (theme) => `<Frame name="Kit toast" flex="col" gap={24}>
    ${triggerButton(theme, 'Kit/Toast trigger', theme.labels.showToast)}
    <Component name="Kit/Toast" flex="row" ${theme.rtl ? 'flow="rtl"' : ''} gap={10} px={16} py={12} w={320} items="center" rounded={10} bg=${theme.text} shadow="0 8 24 #00000033">
      ${glyph('check', theme.success, { layer: 'Icon' })}
      ${label(theme, 'Message', theme.labels.toast, { color: theme.surface, extra: 'grow={1}' })}
      <Frame name="Close" w={20} h={20} flex="row" items="center" justify="center">${glyph('close', theme.surface, { size: 14, layer: 'Glyph' })}</Frame>
    </Component>
  </Frame>`,
  wire: (w, theme, sets) => {
    wireOverlay('Kit/Toast trigger', 'Kit/Toast', ['Close'], {
      position: 'top',
      transition: { type: 'move-in', direction: 'down', duration: 260, easing: 'ease-out-back' }
    })(w, theme, sets)
    // It leaves on its own after a moment.
    w.on(requireSet(sets, 'Kit/Toast'), { type: 'after-delay', delay: 2500 }, [
      { type: 'close-overlay' }
    ])
  }
}

export const OVERLAY_KITS: readonly KitDefinition[] = [modal, drawer, popover, tooltip, toast]
