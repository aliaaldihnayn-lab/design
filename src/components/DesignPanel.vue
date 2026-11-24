<script setup lang="ts">
import { computed } from 'vue'

import { getNodeEditCapability } from '@lawha/core'
import { useEditorCommands } from '@lawha/vue/editor/commands'
import { useSelectionState } from '@lawha/vue/editor/selection-state'
import { useI18n } from '@lawha/vue/i18n'
import { useSceneComputed } from '@lawha/vue/internal/scene-computed'
import { vTestId } from '@lawha/vue/testing'

import { useEditorStore } from '@/app/editor/active-store'
import { describePanelSelection, takesPathEffects } from '@/app/editor/properties-panel/selection'
import {
  panelSections,
  PANEL_SECTION_TABS,
  type PanelSection,
  type SectionTab
} from '@/app/editor/properties-panel/tabs'
import { openVariablesDialog } from '@/app/editor/tokens/dialog'
import { openLibraryReview, useLibraryService } from '@/app/libraries'
import ConnectorSection from '@/components/figjam/connector/ConnectorSection.vue'
import ShapeWithTextSection from '@/components/figjam/shape-with-text/ShapeWithTextSection.vue'
import StickySection from '@/components/figjam/sticky/StickySection.vue'
import { COMPONENT_TYPES, sceneNodeIcon } from '@/components/icons'
import IconButton from '@/components/ui/button/IconButton.vue'
import Tip from '@/components/ui/overlay/Tip.vue'
import PanelHeader from '@/components/ui/panel/PanelHeader.vue'

import AdaptSection from './properties/AdaptSection.vue'
import AppearanceSection from './properties/AppearanceSection.vue'
import BehaviourPanel from './properties/component-properties/behaviour/BehaviourPanel.vue'
import ComponentPropertiesSection from './properties/component-properties/ComponentPropertiesSection.vue'
import ComponentPropertyListSection from './properties/component-properties/ComponentPropertyListSection.vue'
import InstanceUpdateAction from './properties/component-properties/instance-update/InstanceUpdateAction.vue'
import PropertyBindButton from './properties/component-properties/PropertyBindButton.vue'
import PropertyBoundField from './properties/component-properties/PropertyBoundField.vue'
import SlotAuthoringSection from './properties/component-properties/slot/SlotAuthoringSection.vue'
import { usePropertyBinding } from './properties/component-properties/usePropertyBinding'
import VariantAuthoringSection from './properties/component-properties/variant/VariantAuthoringSection.vue'
import ConstraintsSection from './properties/constraints/ConstraintsSection.vue'
import DesignSystemSection from './properties/DesignSystemSection.vue'
import DocumentSection from './properties/DocumentSection.vue'
import EffectsSection from './properties/EffectsSection.vue'
import ExportSection from './properties/ExportSection.vue'
import FillSection from './properties/FillSection.vue'
import FramePresetSelect from './properties/frame-presets/FramePresetSelect.vue'
import FramePresetsSection from './properties/frame-presets/FramePresetsSection.vue'
import IconSection from './properties/IconSection.vue'
import LayerTypeMenu from './properties/LayerTypeMenu.vue'
import LayoutGridSection from './properties/layout/guides/LayoutGridSection.vue'
import LayoutSection from './properties/layout/LayoutSection.vue'
import MaskSection from './properties/MaskSection.vue'
import PageSection from './properties/PageSection.vue'
import RetainedPanel from './properties/panel/RetainedPanel.vue'
import PathEffectsSection from './properties/paths/PathEffectsSection.vue'
import PositionSection from './properties/PositionSection.vue'
import PrototypeSection from './properties/prototype/PrototypeSection.vue'
import SelectionColorsSection from './properties/selection/SelectionColorsSection.vue'
import SelectionLayoutSection from './properties/selection/SelectionLayoutSection.vue'
import SelectionActionsControl from './properties/SelectionActionsControl.vue'
import StatusesSection from './properties/status/StatusesSection.vue'
import StatusSection from './properties/status/StatusSection.vue'
import StrokeSection from './properties/stroke/StrokeSection.vue'
import TextContentControl from './properties/text-content/TextContentControl.vue'
import TextContentSection from './properties/text-content/TextContentSection.vue'
import TypographySection from './properties/TypographySection.vue'
import VariablesSection from './properties/VariablesSection.vue'

/** The tab this panel draws; without one it draws every section, as the mobile drawer does. */
const { tab } = defineProps<{ tab?: SectionTab }>()

const store = useEditorStore()
const libraryService = useLibraryService()
const activeTool = computed(() => store.state.activeTool)
const { selectedNode: node, selectedCount: multiCount } = useSelectionState()
const swapBinding = usePropertyBinding('INSTANCE_SWAP')
const swapLinked = computed(() => !!swapBinding.definition.value)
const showBooleanOperations = computed(() => multiCount.value >= 2)
const { getCommand } = useEditorCommands()
const goToMainComponent = getCommand('selection.goToMainComponent')
const detachInstance = getCommand('selection.detachInstance')
const isComponentType = computed(() => {
  const type = node.value?.type
  return type ? COMPONENT_TYPES.has(type) : false
})
// A library's components are edited in the library, so Add variant has nothing to change here.
const canAddVariant = computed(
  () => !!node.value && getNodeEditCapability(store.graph, node.value.id).editable
)
const selectedIcon = computed(() => (node.value ? sceneNodeIcon(node.value) : undefined))
function openSelectedInstanceReview() {
  const instance = node.value
  if (instance?.type !== 'INSTANCE' || !instance.componentId) return
  const component = store.graph.getNode(instance.componentId)
  const identity = component?.librarySource?.identity
  if (!identity) return
  openLibraryReview({
    libraryId: identity.libraryId,
    assetKey: identity.assetKey,
    instanceIds: [instance.id],
    initialInstanceId: instance.id
  })
}
const pathEffectIds = useSceneComputed(() => {
  const nodes = store.getSelectedNodes()
  return nodes.length > 0 && nodes.every(takesPathEffects)
    ? nodes.map((selected) => selected.id)
    : []
})
const { panels } = useI18n()

const sections = useSceneComputed(() => {
  const all = panelSections(
    describePanelSelection(store.graph, store.getSelectedNodes(), activeTool.value === 'FRAME')
  )
  return new Set(tab ? all.filter((id) => PANEL_SECTION_TABS[id] === tab) : all)
})
const has = (id: PanelSection) => sections.value.has(id)
/** Whether the tab has anything of the selection's own to draw, beside the Frame tool's presets. */
const showsSelection = computed(() => [...sections.value].some((id) => id !== 'framePresets'))
/** Design keeps the panel's original test ids; other tabs name theirs after the tab. */
const testId = (mode: 'single' | 'multi' | 'empty') => `${tab ?? 'design'}-panel-${mode}`
</script>

<template>
  <!-- Frame tool presets replace the layer's Design sections, matching Figma. -->
  <div
    v-if="has('framePresets')"
    data-panel-section="framePresets"
    class="scrollbar-thin flex-1 overflow-x-hidden overflow-y-auto pb-4"
  >
    <FramePresetsSection />
  </div>

  <!-- Multi-select summary; each section's holder names it for the tab that draws it. -->
  <div
    v-else-if="multiCount > 1 && showsSelection"
    v-test-id="testId('multi')"
    class="scrollbar-thin flex-1 overflow-x-hidden overflow-y-auto pb-4"
  >
    <div v-if="has('header')" data-panel-section="header" class="contents">
      <PanelHeader>
        <template #icon>
          <icon-lucide-layers-3 class="size-3.5" aria-hidden="true" />
        </template>
        <span role="heading" aria-level="2">
          {{ panels.selectedCount({ count: String(multiCount) }) }}
        </span>
        <template #actions>
          <SelectionActionsControl :show-boolean-operations="showBooleanOperations" />
        </template>
      </PanelHeader>
    </div>
    <div v-if="has('status')" data-panel-section="status" class="contents">
      <StatusSection />
    </div>
    <div
      v-if="has('componentProperties')"
      data-panel-section="componentProperties"
      class="contents"
    >
      <ComponentPropertiesSection />
    </div>
    <div v-if="has('position')" data-panel-section="position" class="contents">
      <PositionSection />
    </div>
    <div v-if="has('constraints')" data-panel-section="constraints" class="contents">
      <ConstraintsSection />
    </div>
    <div v-if="has('selectionLayout')" data-panel-section="selectionLayout" class="contents">
      <SelectionLayoutSection />
    </div>
    <div v-if="has('appearance')" data-panel-section="appearance" class="contents">
      <AppearanceSection />
    </div>
    <div v-if="has('typography')" data-panel-section="typography" class="contents">
      <TypographySection />
    </div>
    <div v-if="has('fill')" data-panel-section="fill" class="contents">
      <FillSection />
    </div>
    <div v-if="has('stroke')" data-panel-section="stroke" class="contents">
      <StrokeSection />
    </div>
    <div v-if="has('effects')" data-panel-section="effects" class="contents">
      <EffectsSection />
    </div>
    <div v-if="has('selectionColors')" data-panel-section="selectionColors" class="contents">
      <SelectionColorsSection />
    </div>
    <div v-if="has('layoutGuides')" data-panel-section="layoutGuides" class="contents">
      <LayoutGridSection />
    </div>
    <div v-if="has('pathEffects')" data-panel-section="pathEffects" class="contents">
      <PathEffectsSection :node-ids="pathEffectIds" />
    </div>
    <div v-if="has('export')" data-panel-section="export" class="contents">
      <ExportSection />
    </div>
  </div>

  <!-- Single selection: retain one paused subtree while frame presets are shown. -->
  <RetainedPanel :active="!has('framePresets') && multiCount === 1 && !!node && showsSelection">
    <div
      v-if="node"
      v-test-id="testId('single')"
      class="scrollbar-thin flex-1 overflow-x-hidden overflow-y-auto pb-4"
    >
      <div v-if="has('header')" data-panel-section="header" class="contents">
        <PanelHeader :component="isComponentType">
          <template #icon>
            <LayerTypeMenu
              v-if="node.type === 'FRAME' || node.type === 'GROUP' || node.type === 'SECTION'"
              :node="node"
              :icon="selectedIcon"
            />
            <Tip v-else :label="node.type">
              <span role="img" :aria-label="node.type" class="contents">
                <component :is="selectedIcon" class="size-3.5" />
              </span>
            </Tip>
          </template>
          <span role="heading" aria-level="2" class="min-w-0">
            <!-- A swap linked to a property shows the property in place of the layer, as Figma does. -->
            <PropertyBoundField v-if="swapLinked" field="INSTANCE_SWAP" compact />
            <template v-else>{{ node.name }}</template>
          </span>
          <template #actions>
            <IconButton
              v-if="node.type === 'COMPONENT' || node.type === 'COMPONENT_SET'"
              :label="panels.addVariant"
              data-test-id="add-variant"
              :disabled="!canAddVariant"
              @click="store.addVariant(node.id)"
            >
              <icon-lucide-diamond-plus class="size-3.5" />
            </IconButton>
            <PropertyBindButton v-if="node.type === 'INSTANCE'" field="INSTANCE_SWAP" />
            <TextContentControl v-if="node.type === 'TEXT'" :node-id="node.id" :text="node.text" />
            <InstanceUpdateAction
              v-if="node.type === 'INSTANCE'"
              :node="node"
              :editor="store"
              :service="libraryService"
              @review="openSelectedInstanceReview"
            />
            <SelectionActionsControl />
            <template v-if="node.type === 'INSTANCE'">
              <IconButton
                :label="goToMainComponent.label"
                data-test-id="instance-go-to-main"
                @click="goToMainComponent.run()"
              >
                <icon-lucide-crosshair class="size-3.5" />
              </IconButton>
              <IconButton
                :label="detachInstance.label"
                data-test-id="instance-detach"
                @click="detachInstance.run()"
              >
                <icon-lucide-unlink class="size-3.5" />
              </IconButton>
            </template>
          </template>
        </PanelHeader>
      </div>
      <div v-if="has('textContent')" data-panel-section="textContent" class="contents">
        <TextContentSection :node-id="node.id" />
      </div>
      <div v-if="has('status')" data-panel-section="status" class="contents">
        <StatusSection />
      </div>
      <div
        v-if="has('componentProperties')"
        data-panel-section="componentProperties"
        class="contents"
      >
        <ComponentPropertiesSection />
      </div>
      <div v-if="has('variantAuthoring')" data-panel-section="variantAuthoring" class="contents">
        <VariantAuthoringSection />
      </div>
      <div
        v-if="has('componentPropertyList')"
        data-panel-section="componentPropertyList"
        class="contents"
      >
        <ComponentPropertyListSection />
      </div>
      <div v-if="has('slotAuthoring')" data-panel-section="slotAuthoring" class="contents">
        <SlotAuthoringSection />
      </div>
      <div v-if="has('behaviours')" data-panel-section="behaviours" class="contents">
        <BehaviourPanel />
      </div>
      <div v-if="has('framePreset')" data-panel-section="framePreset" class="contents">
        <FramePresetSelect />
      </div>
      <div v-if="has('icon')" data-panel-section="icon" class="contents">
        <IconSection />
      </div>
      <div v-if="has('sticky')" data-panel-section="sticky" class="contents">
        <StickySection />
      </div>
      <div v-if="has('shapeWithText')" data-panel-section="shapeWithText" class="contents">
        <ShapeWithTextSection />
      </div>
      <div v-if="has('connector')" data-panel-section="connector" class="contents">
        <ConnectorSection />
      </div>
      <div v-if="has('position')" data-panel-section="position" class="contents">
        <PositionSection />
      </div>
      <div v-if="has('constraints')" data-panel-section="constraints" class="contents">
        <ConstraintsSection />
      </div>
      <div v-if="has('layout')" data-panel-section="layout" class="contents">
        <LayoutSection />
      </div>
      <div v-if="has('appearance')" data-panel-section="appearance" class="contents">
        <AppearanceSection />
      </div>
      <div v-if="has('mask')" data-panel-section="mask" class="contents">
        <MaskSection />
      </div>
      <div v-if="has('typography')" data-panel-section="typography" class="contents">
        <TypographySection />
      </div>
      <div v-if="has('fill')" data-panel-section="fill" class="contents">
        <FillSection />
      </div>
      <div v-if="has('stroke')" data-panel-section="stroke" class="contents">
        <StrokeSection />
      </div>
      <div v-if="has('effects')" data-panel-section="effects" class="contents">
        <EffectsSection />
      </div>
      <div v-if="has('selectionColors')" data-panel-section="selectionColors" class="contents">
        <SelectionColorsSection />
      </div>
      <div v-if="has('layoutGuides')" data-panel-section="layoutGuides" class="contents">
        <LayoutGridSection />
      </div>
      <div v-if="has('pathEffects')" data-panel-section="pathEffects" class="contents">
        <PathEffectsSection :node-ids="pathEffectIds" />
      </div>
      <div v-if="has('adapt')" data-panel-section="adapt" class="contents">
        <AdaptSection :node-id="node.id" />
      </div>
      <div v-if="has('prototype')" data-panel-section="prototype" class="contents">
        <PrototypeSection :node-id="node.id" />
      </div>
      <div v-if="has('designSystem')" data-panel-section="designSystem" class="contents">
        <DesignSystemSection scope="selection" />
      </div>
      <div v-if="has('export')" data-panel-section="export" class="contents">
        <ExportSection />
      </div>
    </div>
  </RetainedPanel>

  <div
    v-if="!has('framePresets') && multiCount <= 1 && !node && showsSelection"
    v-test-id="testId('empty')"
    class="scrollbar-thin flex-1 overflow-x-hidden overflow-y-auto pb-4"
  >
    <div v-if="has('page')" data-panel-section="page" class="contents">
      <PageSection />
    </div>
    <div v-if="has('variables')" data-panel-section="variables" class="contents">
      <VariablesSection @open-dialog="openVariablesDialog(store)" />
    </div>
    <div v-if="has('statuses')" data-panel-section="statuses" class="contents">
      <StatusesSection />
    </div>
    <div v-if="has('document')" data-panel-section="document" class="contents">
      <DocumentSection />
    </div>
    <div v-if="has('prototype')" data-panel-section="prototype" class="contents">
      <PrototypeSection />
    </div>
    <div v-if="has('designSystem')" data-panel-section="designSystem" class="contents">
      <DesignSystemSection scope="page" />
    </div>
    <div v-if="has('export')" data-panel-section="export" class="contents">
      <ExportSection />
    </div>
  </div>
</template>
