import {
  analyzeClusters,
  analyzeColors,
  analyzeOverlaps,
  analyzeSpacing,
  analyzeTypography,
  diffApply,
  diffShow,
  lint,
  lintFix
} from '#core/tools/analyze'
import { designToComponentMap, designToTokens, importDesignTokens } from '#core/tools/codegen'
import { addComment, getComments, replyToComment, resolveComment } from '#core/tools/comments'
import {
  createComponent,
  createInstance,
  createPage,
  createConnectorTool,
  createShape,
  createSlice,
  createVector,
  exposeInstanceSwap,
  combineAsVariants,
  createSlot,
  fetchIconsTool,
  getBehaviour,
  importMermaid,
  importSVG,
  insertIcon,
  searchIconsTool,
  setBehaviour
} from '#core/tools/create'
import { buildDesignSystemTool } from '#core/tools/design-system'
import { diffVersions, listVersions, restoreVersion, saveVersion } from '#core/tools/history'
import { inspectLayerTool } from '#core/tools/inspect'
import {
  createDeviceMockup,
  createSocialPost,
  listMockupPresets,
  resizeForPlatforms,
  resizeForScreens
} from '#core/tools/mockup'
import {
  setBlend,
  setConstraints,
  setEffects,
  setFont,
  setFontRange,
  setImageFill,
  setLocked,
  setMinMax,
  setOpacity,
  setRotation,
  setStrokeAlign,
  setTextResize,
  setVisible
} from '#core/tools/modify'
import { setImageAdjustments } from '#core/tools/photo'
import {
  clonePixels,
  fillPixels,
  maskFromSelection,
  paintPixels,
  samplePixelColor
} from '#core/tools/pixels'
import { runFigmaPlugin } from '#core/tools/plugins'
import { convertToDieline, createPrintTemplate, listPrintProducts } from '#core/tools/print'
import {
  addInteraction,
  autoPrototype,
  getPrototype,
  setFlow,
  setInteractions,
  setScrollBehavior
} from '#core/tools/prototype'
import {
  applyMasterPageTool,
  createMasterPageTool,
  insertPageNumberTool,
  linkTextFramesTool
} from '#core/tools/publisher'
import {
  getComponents,
  getCurrentPage,
  getFontStatus,
  getPageTree,
  insertLibraryComponent,
  listAvailableFonts,
  listFonts,
  listLibraries,
  listPages,
  pageBounds,
  queryNodes,
  selectNodes,
  switchPage
} from '#core/tools/read'
import { createRoom, inviteToRoom, listRooms, setRoomAccess } from '#core/tools/rooms'
import type { ToolDef } from '#core/tools/schema'
import { getStatuses, setStatus } from '#core/tools/statuses'
import {
  arrangeNodes,
  cloneNode,
  flattenNodes,
  groupNodes,
  nodeAncestors,
  nodeBindings,
  nodeBounds,
  nodeChildren,
  nodeMove,
  nodeReplaceWith,
  nodeToComponent,
  nodeTree,
  renameNode,
  ungroupNode
} from '#core/tools/structure'
import {
  bindVariable,
  createCollection,
  createVariable,
  deleteCollection,
  deleteVariable,
  findVariables,
  getCollection,
  getVariable,
  listCollections,
  listVariables,
  setVariable,
  unbindVariable
} from '#core/tools/variables'
import {
  booleanExclude,
  booleanIntersect,
  booleanSubtract,
  booleanUnion,
  exportImage,
  exportPDF,
  exportSVG,
  pathFlip,
  pathGet,
  pathMove,
  pathScale,
  pathSet,
  blendShapes,
  envelopeMesh,
  imageTrace,
  offsetPath,
  outlineStroke,
  setPatternFill,
  warpShape,
  widthProfile,
  shapeBuilder,
  shapeBuilderRegionsTool,
  viewportGet,
  viewportSet
} from '#core/tools/vector'
import { editDocument, readDocument, writeDocument } from '#core/tools/writer'

/**
 * Extended tools not in CORE_TOOLS — variables, vector ops, analysis,
 * codegen, advanced structure, path manipulation, etc.
 */
export const EXTENDED_TOOLS: ToolDef[] = [
  // Lawha Cloud rooms
  listRooms,
  createRoom,
  inviteToRoom,
  setRoomAccess,
  // Documents (the document editor)
  readDocument,
  writeDocument,
  editDocument,
  // Mockups & social posts
  listMockupPresets,
  createSocialPost,
  resizeForPlatforms,
  createDeviceMockup,
  resizeForScreens,
  // Print
  listPrintProducts,
  createPrintTemplate,
  convertToDieline,
  // Design system
  buildDesignSystemTool,
  // Dev Mode
  inspectLayerTool,
  // Photo
  setImageAdjustments,
  paintPixels,
  fillPixels,
  samplePixelColor,
  maskFromSelection,
  clonePixels,
  // Plugins
  runFigmaPlugin,
  // Publisher
  createMasterPageTool,
  applyMasterPageTool,
  insertPageNumberTool,
  linkTextFramesTool,
  // Prototype
  getPrototype,
  setInteractions,
  addInteraction,
  setFlow,
  autoPrototype,
  setScrollBehavior,
  // Read (advanced)
  getPageTree,
  getCurrentPage,
  listPages,
  selectNodes,
  queryNodes,
  getComponents,
  listLibraries,
  insertLibraryComponent,
  switchPage,
  pageBounds,
  getComments,
  addComment,
  replyToComment,
  resolveComment,
  getStatuses,
  setStatus,
  getFontStatus,
  listFonts,
  listAvailableFonts,
  // Create (advanced)
  createShape,
  searchIconsTool,
  insertIcon,
  fetchIconsTool,
  combineAsVariants,
  createComponent,
  createInstance,
  exposeInstanceSwap,
  createSlot,
  getBehaviour,
  setBehaviour,
  createPage,
  createVector,
  createSlice,
  createConnectorTool,
  importSVG,
  importMermaid,
  // Modify (advanced)
  setEffects,
  setOpacity,
  setFont,
  setVisible,
  setConstraints,
  setRotation,
  setMinMax,
  setFontRange,
  setTextResize,
  setBlend,
  setLocked,
  setStrokeAlign,
  setImageFill,
  // Structure (advanced)
  cloneNode,
  nodeMove,
  renameNode,
  groupNodes,
  ungroupNode,
  flattenNodes,
  nodeToComponent,
  nodeBounds,
  nodeAncestors,
  nodeChildren,
  nodeTree,
  nodeBindings,
  nodeReplaceWith,
  arrangeNodes,
  // Variables
  listVariables,
  listCollections,
  getVariable,
  findVariables,
  createVariable,
  setVariable,
  deleteVariable,
  bindVariable,
  unbindVariable,
  getCollection,
  createCollection,
  deleteCollection,
  // Vector & export
  booleanUnion,
  booleanSubtract,
  booleanIntersect,
  booleanExclude,
  shapeBuilderRegionsTool,
  shapeBuilder,
  warpShape,
  envelopeMesh,
  imageTrace,
  offsetPath,
  outlineStroke,
  widthProfile,
  blendShapes,
  setPatternFill,
  pathGet,
  pathSet,
  pathScale,
  pathFlip,
  pathMove,
  viewportGet,
  viewportSet,
  exportSVG,
  exportPDF,
  exportImage,
  // Analyze & diff
  analyzeColors,
  analyzeTypography,
  lint,
  lintFix,
  analyzeSpacing,
  analyzeClusters,
  analyzeOverlaps,
  diffShow,
  diffApply,
  // Version history of the open design or document
  listVersions,
  saveVersion,
  restoreVersion,
  diffVersions,
  // Codegen
  designToTokens,
  importDesignTokens,
  designToComponentMap
]
