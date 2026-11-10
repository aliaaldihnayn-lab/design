import { escapeText } from 'entities'

import { detectDirection, type WriterComment, type WriterDocument } from '#core/writer/model'

import { contentTypeFor } from './images'
import type { ListDefinition } from './write'
import { DOCUMENT_NAMESPACES, el, NS, XML_HEADER } from './xml'

const OVERRIDES: Record<string, string> = {
  'word/document.xml':
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
  'word/styles.xml': 'application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml',
  'word/settings.xml':
    'application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml',
  'word/numbering.xml':
    'application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml',
  'word/comments.xml':
    'application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml',
  'word/footnotes.xml':
    'application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml',
  'word/header1.xml': 'application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml',
  'word/footer1.xml': 'application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml',
  'docProps/core.xml': 'application/vnd.openxmlformats-package.core-properties+xml'
}

export function contentTypesXML(paths: readonly string[]): string {
  const extensions = new Set(
    paths
      .filter((path) => path.startsWith('word/media/'))
      .map((path) => path.split('.').pop() ?? '')
  )
  const defaults = [
    el('Default', {
      Extension: 'rels',
      ContentType: 'application/vnd.openxmlformats-package.relationships+xml'
    }),
    el('Default', { Extension: 'xml', ContentType: 'application/xml' }),
    ...[...extensions].map((extension) =>
      el('Default', { Extension: extension, ContentType: contentTypeFor(extension) })
    )
  ]
  const overrides = paths
    .filter((path) => OVERRIDES[path])
    .map((path) => el('Override', { PartName: `/${path}`, ContentType: OVERRIDES[path] }))
  return `${XML_HEADER}<Types xmlns="${NS.contentTypes}">${defaults.join('')}${overrides.join('')}</Types>`
}

/** Heading sizes in half-points, as Word's built-in headings. */
const HEADING_SIZES = [32, 26, 24, 22, 22, 22]

function paragraphStyle(id: string, name: string, pPr: string, rPr: string, extra = ''): string {
  return (
    `<w:style w:type="paragraph" w:styleId="${id}">${el('w:name', { 'w:val': name })}` +
    `<w:basedOn w:val="Normal"/><w:next w:val="Normal"/>${extra}<w:qFormat/>` +
    `<w:pPr>${pPr}</w:pPr><w:rPr>${rPr}</w:rPr></w:style>`
  )
}

export function stylesXML(): string {
  const headings = HEADING_SIZES.map((size, index) =>
    paragraphStyle(
      `Heading${index + 1}`,
      `heading ${index + 1}`,
      `<w:keepNext/><w:keepLines/><w:spacing w:before="${index === 0 ? 360 : 240}" w:after="80"/><w:outlineLvl w:val="${index}"/>`,
      `<w:b/><w:bCs/><w:sz w:val="${size}"/><w:szCs w:val="${size}"/>`,
      '<w:uiPriority w:val="9"/>'
    )
  ).join('')
  const toc = [1, 2, 3]
    .map((level) =>
      paragraphStyle(
        `TOC${level}`,
        `toc ${level}`,
        `<w:spacing w:after="100"/><w:ind w:start="${(level - 1) * 220}"/>`,
        ''
      )
    )
    .join('')
  return (
    `${XML_HEADER}<w:styles xmlns:w="${NS.w}">` +
    '<w:docDefaults><w:rPrDefault><w:rPr>' +
    '<w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="Calibri" w:cs="Arial"/>' +
    '<w:sz w:val="22"/><w:szCs w:val="22"/><w:lang w:val="en-US" w:eastAsia="en-US" w:bidi="ar-SA"/>' +
    '</w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="160" w:line="259" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>' +
    '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>' +
    headings +
    paragraphStyle(
      'Title',
      'Title',
      '<w:spacing w:after="80"/>',
      '<w:sz w:val="56"/><w:szCs w:val="56"/>'
    ) +
    paragraphStyle(
      'TOCHeading',
      'TOC Heading',
      '',
      '<w:b/><w:sz w:val="28"/><w:szCs w:val="28"/>'
    ) +
    toc +
    paragraphStyle(
      'FootnoteText',
      'footnote text',
      '<w:spacing w:after="0" w:line="240" w:lineRule="auto"/>',
      '<w:sz w:val="20"/><w:szCs w:val="20"/>'
    ) +
    paragraphStyle('CommentText', 'annotation text', '', '<w:sz w:val="20"/><w:szCs w:val="20"/>') +
    '<w:style w:type="character" w:default="1" w:styleId="DefaultParagraphFont"><w:name w:val="Default Paragraph Font"/><w:uiPriority w:val="1"/><w:semiHidden/></w:style>' +
    '<w:style w:type="character" w:styleId="Hyperlink"><w:name w:val="Hyperlink"/><w:basedOn w:val="DefaultParagraphFont"/><w:rPr><w:color w:val="0563C1"/><w:u w:val="single"/></w:rPr></w:style>' +
    '<w:style w:type="character" w:styleId="FootnoteReference"><w:name w:val="footnote reference"/><w:rPr><w:vertAlign w:val="superscript"/></w:rPr></w:style>' +
    '<w:style w:type="character" w:styleId="CommentReference"><w:name w:val="annotation reference"/><w:rPr><w:sz w:val="16"/><w:szCs w:val="16"/></w:rPr></w:style>' +
    '<w:style w:type="table" w:default="1" w:styleId="TableNormal"><w:name w:val="Normal Table"/><w:tblPr><w:tblInd w:w="0" w:type="dxa"/><w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="108" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style>' +
    '<w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/><w:basedOn w:val="TableNormal"/><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:tblPr><w:tblBorders>' +
    ['top', 'left', 'bottom', 'right', 'insideH', 'insideV']
      .map((side) => `<w:${side} w:val="single" w:sz="4" w:space="0" w:color="auto"/>`)
      .join('') +
    '</w:tblBorders></w:tblPr></w:style>' +
    '</w:styles>'
  )
}

const BULLETS = ['•', 'o', '▪']
const ORDERED_FORMATS = ['decimal', 'lowerLetter', 'lowerRoman']

export function numberingXML(lists: readonly ListDefinition[]): string {
  const abstracts = lists
    .map((list, index) => {
      const levels = Array.from({ length: 9 }, (_, level) => {
        const indent = 720 * (level + 1)
        const format = list.ordered ? ORDERED_FORMATS[level % 3] : 'bullet'
        const textValue = list.ordered ? `%${level + 1}.` : BULLETS[level % 3]
        return (
          `<w:lvl w:ilvl="${level}">${el('w:start', { 'w:val': level === 0 ? list.start : 1 })}` +
          `${el('w:numFmt', { 'w:val': format })}${el('w:lvlText', { 'w:val': textValue })}<w:lvlJc w:val="start"/>` +
          `<w:pPr>${el('w:ind', { 'w:start': indent, 'w:hanging': 360 })}</w:pPr>` +
          '</w:lvl>'
        )
      }).join('')
      return `<w:abstractNum w:abstractNumId="${index}"><w:multiLevelType w:val="hybridMultilevel"/>${levels}</w:abstractNum>`
    })
    .join('')
  const nums = lists
    .map(
      (list, index) => `<w:num w:numId="${list.numId}"><w:abstractNumId w:val="${index}"/></w:num>`
    )
    .join('')
  return `${XML_HEADER}<w:numbering xmlns:w="${NS.w}">${abstracts}${nums}</w:numbering>`
}

export function settingsXML(model: WriterDocument): string {
  return (
    `${XML_HEADER}<w:settings xmlns:w="${NS.w}">` +
    (model.trackChanges ? '<w:trackRevisions/>' : '') +
    '<w:defaultTabStop w:val="720"/><w:characterSpacingControl w:val="doNotCompress"/>' +
    '<w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat>' +
    '</w:settings>'
  )
}

export function corePropertiesXML(title: string, creator: string): string {
  return (
    `${XML_HEADER}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" ` +
    'xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" ' +
    'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
    `<dc:title>${escapeText(title)}</dc:title><dc:creator>${escapeText(creator)}</dc:creator>` +
    '</cp:coreProperties>'
  )
}

/** Word's watermark: a VML WordArt shape behind the text, anchored in the header. */
export function watermarkXML(watermarkText: string, color = '#C0C0C0'): string {
  return (
    '<w:p><w:r><w:pict>' +
    `<v:shape id="PowerPlusWaterMarkObject" o:spid="_x0000_s2049" type="#_x0000_t136" style="position:absolute;margin-left:0;margin-top:0;width:460pt;height:115pt;rotation:315;z-index:-251657216;mso-position-horizontal:center;mso-position-horizontal-relative:margin;mso-position-vertical:center;mso-position-vertical-relative:margin" o:allowincell="f" fillcolor="${escapeText(color)}" stroked="f">` +
    '<v:fill opacity=".5"/>' +
    `<v:textpath style="font-family:&quot;Calibri&quot;;font-size:1pt" string="${escapeText(watermarkText)}"/>` +
    '</v:shape></w:pict></w:r></w:p>'
  )
}

export function commentsXML(
  comments: readonly WriterComment[],
  commentNumber: (id: string) => number
): string {
  const items = comments
    .map((comment) => {
      const paragraphs = comment.text.split('\n').map((line) => {
        const rtl = detectDirection(line) === 'rtl'
        return `<w:p><w:pPr><w:pStyle w:val="CommentText"/>${rtl ? '<w:bidi/>' : ''}</w:pPr><w:r><w:t xml:space="preserve">${escapeText(line)}</w:t></w:r></w:p>`
      })
      return el(
        'w:comment',
        {
          'w:id': commentNumber(comment.id),
          'w:author': comment.author || 'Lawha',
          'w:date': comment.date || undefined,
          'w:initials': comment.initials
        },
        paragraphs.join('')
      )
    })
    .join('')
  return `${XML_HEADER}<w:comments ${DOCUMENT_NAMESPACES}>${items}</w:comments>`
}
