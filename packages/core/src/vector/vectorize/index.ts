export {
  createVectorFrameChildren,
  resolveVectorFramePlacement,
  type VectorFramePlacement
} from './placement'
export {
  preprocessForVectorize,
  type GetCanvasKit,
  type PreprocessForVectorizeResult
} from './preprocess'
export { svgToVectorPaths, type SVGVectorizeResult, type VectorizedPath } from './svg/to-vectors'
export {
  DEFAULT_TRACE_OPTIONS,
  traceImage,
  traceToSVG,
  type TraceOptions,
  type TracePixels,
  type TraceResult
} from './trace'
export { downsample, tracePixelsFromImage } from './trace/pixels'
export {
  TRACE_PRESETS,
  tracePresetIsBlackAndWhite,
  tracePresetSettings,
  type TracePreset
} from './trace/presets'
