import { glyph, label, setAttrs, type KitDefinition } from './jsx'
import type { KitTheme } from './theme'
import { DISSOLVE, INSTANT, QUICK, type KitWiring } from './wire'

/**
 * Controls that move between views of themselves: tabs, an accordion, a wizard's steps,
 * pagination, a carousel, and a file dropzone. Each view is a variant, so the selected tab,
 * open section, or current slide draws exactly as designed, and Smart Animate slides between.
 */

const range = (count: number) => Array.from({ length: count }, (_, index) => index + 1)
const dir = (theme: KitTheme) => (theme.rtl ? 'flow="rtl"' : '')

/** Arrow keys and an action on each item move between the numbered variants of a set. */
function wireSteps(
  w: KitWiring,
  property: string,
  count: number,
  keys: { next: string; previous: string },
  wrap: boolean
) {
  for (const current of range(count)) {
    const root = w.layer(`${property}=${current}`)
    const next = wrap ? (current % count) + 1 : Math.min(count, current + 1)
    const previous = wrap ? ((current + count - 2) % count) + 1 : Math.max(1, current - 1)
    if (next !== current)
      w.on(root, { type: 'key', key: keys.next }, [w.changeTo(`${property}=${next}`)])
    if (previous !== current)
      w.on(root, { type: 'key', key: keys.previous }, [w.changeTo(`${property}=${previous}`)])
  }
}

const tabs: KitDefinition = {
  kind: 'tabs',
  name: 'Kit/Tabs',
  insert: 'Tab=1',
  jsx: (theme) => {
    const names = theme.labels.tabs
    const variant = (active: number) => {
      const triggers = names
        .map(
          (name, index) =>
            `<Frame name="Tab ${index + 1}" flex="col" gap={6} px={12} pt={8} items="center">${label(theme, 'Label', name, { weight: index + 1 === active ? 600 : 400, color: index + 1 === active ? theme.primary : theme.muted })}<Frame name="${index + 1 === active ? 'Indicator' : 'Rest'}" w="fill" h={2} bg=${index + 1 === active ? theme.primary : '"#FFFFFF00"'} /></Frame>`
        )
        .join('')
      return `<Component name="Tab=${active}" flex="col" gap={12} w={360}>
        <Frame name="List" flex="row" ${dir(theme)} w="fill" strokeWeights={{ bottom: 1 }} stroke=${theme.border}>${triggers}</Frame>
        <Frame name="Panel" flex="col" w="fill" p={4} ${theme.rtl ? 'items="end"' : ''}>${label(theme, 'Body', theme.labels.tabBody[active - 1])}</Frame>
      </Component>`
    }
    return `<ComponentSet ${setAttrs('Kit/Tabs')}>${range(names.length).map(variant).join('')}</ComponentSet>`
  },
  wire: (w, theme) => {
    const count = theme.labels.tabs.length
    for (const shown of range(count))
      for (const target of range(count))
        if (target !== shown)
          w.on(w.layer(`Tab=${shown}`, `List/Tab ${target}`), { type: 'click' }, [
            w.changeTo(`Tab=${target}`)
          ])
    wireSteps(
      w,
      'Tab',
      count,
      theme.rtl
        ? { next: 'ArrowLeft', previous: 'ArrowRight' }
        : { next: 'ArrowRight', previous: 'ArrowLeft' },
      true
    )
  }
}

const accordion: KitDefinition = {
  kind: 'accordion',
  name: 'Kit/Accordion',
  insert: 'Open=1',
  jsx: (theme) => {
    const sections = theme.labels.sections
    const variant = (open: number) => {
      const items = sections
        .map((section, index) => {
          const isOpen = index + 1 === open
          return `<Frame name="Section ${index + 1}" flex="col" w="fill" strokeWeights={{ bottom: 1 }} stroke=${theme.border}>
            <Frame name="Header" flex="row" ${dir(theme)} w="fill" py={12} items="center">${label(theme, 'Title', section, { weight: 600, extra: 'grow={1}' })}${glyph(isOpen ? 'chevronUp' : 'chevronDown', theme.muted, { layer: 'Chevron' })}</Frame>
            ${isOpen ? `<Frame name="Content" flex="col" w="fill" pb={12} ${theme.rtl ? 'items="end"' : ''}>${label(theme, 'Body', theme.labels.sectionBody, { color: theme.muted })}</Frame>` : ''}
          </Frame>`
        })
        .join('')
      return `<Component name="Open=${open}" flex="col" w={360}>${items}</Component>`
    }
    return `<ComponentSet ${setAttrs('Kit/Accordion')}>${[0, ...range(sections.length)].map(variant).join('')}</ComponentSet>`
  },
  wire: (w, theme) => {
    const count = theme.labels.sections.length
    for (const open of [0, ...range(count)])
      for (const section of range(count))
        w.on(w.layer(`Open=${open}`, `Section ${section}/Header`), { type: 'click' }, [
          w.changeTo(`Open=${open === section ? 0 : section}`, QUICK)
        ])
  }
}

const stepper: KitDefinition = {
  kind: 'stepper',
  name: 'Kit/Stepper',
  insert: 'Step=1',
  jsx: (theme) => {
    const steps = theme.labels.steps
    const variant = (current: number) => {
      const markers = steps
        .map((step, index) => {
          const done = index + 1 < current
          const active = index + 1 === current
          const fill = done || active ? theme.primary : theme.subtle
          return `<Frame name="Step ${index + 1}" flex="col" gap={6} items="center" w={72}>
            <Frame name="Dot" w={28} h={28} rounded={14} flex="row" items="center" justify="center" bg=${fill}>${done ? glyph('check', theme.onPrimary, { size: 14, layer: 'Mark' }) : label(theme, 'Number', String(index + 1), { size: 12, weight: 600, color: active ? theme.onPrimary : theme.muted })}</Frame>
            ${label(theme, 'Label', step, { size: 12, color: active ? theme.text : theme.muted })}
          </Frame>`
        })
        .join('')
      const last = current === steps.length
      return `<Component name="Step=${current}" flex="col" gap={20} w={360}>
        <Frame name="Steps" flex="row" ${dir(theme)} w="fill" justify="between">${markers}</Frame>
        <Frame name="Actions" flex="row" ${dir(theme)} gap={8} w="fill" justify="between">
          <Frame name="Back" flex="row" px={14} py={8} rounded={8} stroke=${theme.border} opacity={${current === 1 ? 0.4 : 1}}>${label(theme, 'Label', theme.labels.back)}</Frame>
          <Frame name="Next" flex="row" px={14} py={8} rounded={8} bg=${theme.primary} opacity={${last ? 0.4 : 1}}>${label(theme, 'Label', theme.labels.next, { weight: 600, color: theme.onPrimary })}</Frame>
        </Frame>
      </Component>`
    }
    return `<ComponentSet ${setAttrs('Kit/Stepper')}>${range(steps.length).map(variant).join('')}</ComponentSet>`
  },
  wire: (w, theme) => {
    const count = theme.labels.steps.length
    for (const current of range(count)) {
      if (current < count)
        w.on(w.layer(`Step=${current}`, 'Actions/Next'), { type: 'click' }, [
          w.changeTo(`Step=${current + 1}`)
        ])
      if (current > 1)
        w.on(w.layer(`Step=${current}`, 'Actions/Back'), { type: 'click' }, [
          w.changeTo(`Step=${current - 1}`)
        ])
    }
  }
}

const PAGES = 5

const pagination: KitDefinition = {
  kind: 'pagination',
  name: 'Kit/Pagination',
  insert: 'Page=1',
  jsx: (theme) => {
    const variant = (current: number) => {
      const pages = range(PAGES)
        .map(
          (page) =>
            `<Frame name="Page ${page}" w={32} h={32} rounded={8} flex="row" items="center" justify="center" bg=${page === current ? theme.primary : '"#FFFFFF00"'}>${label(theme, 'Number', String(page), { weight: 600, color: page === current ? theme.onPrimary : theme.text })}</Frame>`
        )
        .join('')
      const arrow = (name: string, glyphName: 'chevronLeft' | 'chevronRight', off: boolean) =>
        `<Frame name="${name}" w={32} h={32} rounded={8} flex="row" items="center" justify="center" stroke=${theme.border} opacity={${off ? 0.4 : 1}}>${glyph(glyphName, theme.text, { layer: 'Glyph' })}</Frame>`
      const [previous, next] = theme.rtl
        ? (['chevronRight', 'chevronLeft'] as const)
        : (['chevronLeft', 'chevronRight'] as const)
      return `<Component name="Page=${current}" flex="row" ${dir(theme)} gap={4} items="center">${arrow('Previous', previous, current === 1)}${pages}${arrow('Next', next, current === PAGES)}</Component>`
    }
    return `<ComponentSet ${setAttrs('Kit/Pagination')}>${range(PAGES).map(variant).join('')}</ComponentSet>`
  },
  wire: (w) => {
    for (const current of range(PAGES)) {
      for (const page of range(PAGES))
        if (page !== current)
          w.on(w.layer(`Page=${current}`, `Page ${page}`), { type: 'click' }, [
            w.changeTo(`Page=${page}`, INSTANT)
          ])
      if (current > 1)
        w.on(w.layer(`Page=${current}`, 'Previous'), { type: 'click' }, [
          w.changeTo(`Page=${current - 1}`, INSTANT)
        ])
      if (current < PAGES)
        w.on(w.layer(`Page=${current}`, 'Next'), { type: 'click' }, [
          w.changeTo(`Page=${current + 1}`, INSTANT)
        ])
    }
  }
}

const SLIDE_COLORS = ['"#6366F1"', '"#0EA5E9"', '"#10B981"'] as const

const carousel: KitDefinition = {
  kind: 'carousel',
  name: 'Kit/Carousel',
  insert: 'Slide=1',
  jsx: (theme) => {
    const slides = theme.labels.slides
    const variant = (current: number) => {
      const dots = range(slides.length)
        .map(
          (slide) =>
            `<Frame name="Dot ${slide}" w={${slide === current ? 20 : 8}} h={8} rounded={4} bg=${slide === current ? theme.primary : theme.border} />`
        )
        .join('')
      return `<Component name="Slide=${current}" flex="col" gap={12} w={360} items="center">
        <Frame name="Viewport" w={360} h={200} rounded={12} overflow="hidden" flex="row" items="center" justify="center" bg=${SLIDE_COLORS[(current - 1) % SLIDE_COLORS.length]}>
          ${label(theme, 'Caption', slides[current - 1], { size: 20, weight: 700, color: '"#FFFFFF"' })}
        </Frame>
        <Frame name="Dots" flex="row" ${dir(theme)} gap={6} items="center">${dots}</Frame>
      </Component>`
    }
    return `<ComponentSet ${setAttrs('Kit/Carousel')}>${range(slides.length).map(variant).join('')}</ComponentSet>`
  },
  wire: (w, theme) => {
    const count = theme.labels.slides.length
    const forward: 'left' | 'right' = theme.rtl ? 'right' : 'left'
    for (const current of range(count)) {
      const next = (current % count) + 1
      const push = {
        type: 'push' as const,
        direction: forward,
        duration: 350,
        easing: 'ease-in-out' as const
      }
      w.on(w.layer(`Slide=${current}`, 'Viewport'), { type: 'click' }, [
        w.changeTo(`Slide=${next}`, push)
      ])
      w.on(w.layer(`Slide=${current}`, 'Viewport'), { type: 'drag' }, [
        w.changeTo(`Slide=${next}`, push)
      ])
      w.on(w.layer(`Slide=${current}`), { type: 'after-delay', delay: 4000 }, [
        w.changeTo(`Slide=${next}`, push)
      ])
      for (const dot of range(count))
        if (dot !== current)
          w.on(w.layer(`Slide=${current}`, `Dots/Dot ${dot}`), { type: 'click' }, [
            w.changeTo(`Slide=${dot}`, DISSOLVE)
          ])
    }
  }
}

const UPLOAD_STATES = ['Idle', 'Hover', 'Uploading', 'Processing', 'Done'] as const

const fileUpload: KitDefinition = {
  kind: 'file-upload',
  name: 'Kit/File upload',
  insert: 'State=Idle',
  jsx: (theme) => {
    const variant = (state: (typeof UPLOAD_STATES)[number]) => {
      const busy = state === 'Uploading' || state === 'Processing'
      let text: string = theme.labels.upload
      if (busy) text = theme.labels.uploading
      if (state === 'Done') text = theme.labels.uploaded
      const bar = busy
        ? `<Frame name="Track" w={240} h={6} rounded={3} bg=${theme.subtle}><Frame name="Bar" ${theme.rtl ? `x={${state === 'Uploading' ? 168 : 0}}` : 'x={0}'} y={0} w={${state === 'Uploading' ? 72 : 240}} h={6} rounded={3} bg=${theme.primary} /></Frame>`
        : ''
      return `<Component name="State=${state}" flex="col" gap={10} p={24} w={320} items="center" rounded={12} bg=${state === 'Hover' ? theme.subtle : theme.surface} stroke=${state === 'Hover' ? theme.primary : theme.border} strokeWidth={1.5} dashPattern={[6, 4]}>
        ${glyph(state === 'Done' ? 'check' : 'upload', state === 'Done' ? theme.success : theme.primary, { size: 24, layer: 'Icon' })}
        ${label(theme, 'Message', text, { color: theme.muted, extra: 'textAlign="center"' })}
        ${bar}
      </Component>`
    }
    return `<ComponentSet ${setAttrs('Kit/File upload')}>${UPLOAD_STATES.map(variant).join('')}</ComponentSet>`
  },
  wire: (w) => {
    w.on(w.layer('State=Idle'), { type: 'hover' }, [w.changeTo('State=Hover', DISSOLVE)])
    for (const state of ['Idle', 'Hover'])
      w.on(w.layer(`State=${state}`), { type: 'click' }, [w.changeTo('State=Uploading', DISSOLVE)])
    w.on(w.layer('State=Uploading'), { type: 'after-delay', delay: 100 }, [
      w.changeTo('State=Processing', {
        type: 'smart-animate',
        direction: 'left',
        duration: 1200,
        easing: 'ease-in-out'
      })
    ])
    w.on(w.layer('State=Processing'), { type: 'after-delay', delay: 1300 }, [
      w.changeTo('State=Done', DISSOLVE)
    ])
    w.on(w.layer('State=Done'), { type: 'click' }, [w.changeTo('State=Idle', DISSOLVE)])
  }
}

export const NAVIGATION_KITS: readonly KitDefinition[] = [
  tabs,
  accordion,
  stepper,
  pagination,
  carousel,
  fileUpload
]
