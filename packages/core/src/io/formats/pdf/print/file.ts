import { compact } from 'es-toolkit'

/**
 * The objects of a PDF as jsPDF writes one (uncompressed, one body, a classic cross-reference
 * table), to change and write again with a fresh cross-reference table.
 */

export interface PDFObject {
  /** The object's dictionary or value, as text. */
  dict: string
  /** Stream bytes, when the object is a stream. */
  stream?: Uint8Array
}

export interface PDFFile {
  objects: Map<number, PDFObject>
  root: number
  info: number | null
  /** The trailer's `/ID` array, as written. */
  id: string | null
}

const LATIN1 = new TextDecoder('latin1')

export function latin1(bytes: Uint8Array): string {
  return LATIN1.decode(bytes)
}

/** Text whose characters are all below 256 as its bytes. */
export function latin1Bytes(text: string): Uint8Array {
  const out = new Uint8Array(text.length)
  for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i) & 0xff
  return out
}

/** A reference's object number from `N 0 R` text. */
export function refNumber(text: string | undefined | null): number | null {
  const match = text ? /^\s*(\d+)\s+\d+\s+R/.exec(text) : null
  return match ? Number(match[1]) : null
}

/** The value text after `/Key` in a dictionary: a number, name, reference, array, or string. */
export function dictValue(dict: string, key: string): string | null {
  const match = new RegExp(`/${key}(?![A-Za-z0-9])\\s*`).exec(dict)
  if (!match) return null
  const start = match.index + match[0].length
  const rest = dict.slice(start)
  const ref = /^\d+\s+\d+\s+R/.exec(rest)
  if (ref) return ref[0]
  if (rest.startsWith('[')) return rest.slice(0, matchingClose(rest, '[', ']') + 1)
  if (rest.startsWith('<<')) return rest.slice(0, matchingDict(rest) + 2)
  if (rest.startsWith('(')) return rest.slice(0, matchingClose(rest, '(', ')') + 1)
  return /^[^\s/[\]<>()]*(?:\/[^\s/[\]<>()]+)?/.exec(rest)?.[0] ?? null
}

function matchingClose(text: string, open: string, close: string): number {
  let depth = 0
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\\') {
      i++
      continue
    }
    if (text[i] === open) depth++
    else if (text[i] === close && --depth === 0) return i
  }
  return text.length - 1
}

/** Index of the `>>` closing the dictionary `text` starts with. */
export function matchingDict(text: string): number {
  let depth = 0
  for (let i = 0; i < text.length - 1; i++) {
    if (text.startsWith('<<', i)) {
      depth++
      i++
    } else if (text.startsWith('>>', i)) {
      depth--
      if (depth === 0) return i
      i++
    }
  }
  return text.length - 2
}

/** The dictionary with `/Key value` set, replacing what the key held. */
export function setDictValue(dict: string, key: string, value: string): string {
  const existing = dictValue(dict, key)
  if (existing !== null) {
    const match = new RegExp(`/${key}(?![A-Za-z0-9])\\s*`).exec(dict)
    if (match) {
      const start = match.index
      const end = match.index + match[0].length + existing.length
      return `${dict.slice(0, start)}/${key} ${value}${dict.slice(end)}`
    }
  }
  const close = dict.lastIndexOf('>>')
  return `${dict.slice(0, close)}/${key} ${value}\n${dict.slice(close)}`
}

export function removeDictKey(dict: string, key: string): string {
  const existing = dictValue(dict, key)
  const match = new RegExp(`/${key}(?![A-Za-z0-9])\\s*`).exec(dict)
  if (existing === null || !match) return dict
  return dict.slice(0, match.index) + dict.slice(match.index + match[0].length + existing.length)
}

export function parsePDF(bytes: Uint8Array): PDFFile {
  const text = latin1(bytes)
  const objects = new Map<number, PDFObject>()
  const finder = /(\d+)\s+\d+\s+obj\b|\bxref\b/g
  let pos = 0
  for (;;) {
    finder.lastIndex = pos
    const header = finder.exec(text)
    if (!header || header[0] === 'xref') break
    const number = Number(header[1])
    const bodyStart = header.index + header[0].length
    const streamAt = text.indexOf('stream', bodyStart)
    const endAt = text.indexOf('endobj', bodyStart)
    if (endAt === -1) break
    if (streamAt !== -1 && streamAt < endAt) {
      const dict = text.slice(bodyStart, streamAt).trim()
      let dataStart = streamAt + 'stream'.length
      if (text[dataStart] === '\r') dataStart++
      if (text[dataStart] === '\n') dataStart++
      const length = Number(dictValue(dict, 'Length') ?? Number.NaN)
      const dataEnd = Number.isFinite(length)
        ? dataStart + length
        : text.indexOf('endstream', dataStart)
      const stream = bytes.slice(dataStart, dataEnd)
      const close = text.indexOf('endobj', dataEnd)
      objects.set(number, { dict, stream })
      pos = close + 'endobj'.length
    } else {
      objects.set(number, { dict: text.slice(bodyStart, endAt).trim() })
      pos = endAt + 'endobj'.length
    }
  }
  const trailerAt = text.lastIndexOf('trailer')
  const trailer = trailerAt !== -1 ? text.slice(trailerAt) : ''
  const root = refNumber(dictValue(trailer, 'Root'))
  if (root === null) throw new Error('This PDF has no catalog')
  return {
    objects,
    root,
    info: refNumber(dictValue(trailer, 'Info')),
    id: dictValue(trailer, 'ID')
  }
}

export function nextObjectNumber(file: PDFFile): number {
  return Math.max(0, ...file.objects.keys()) + 1
}

export function addObject(file: PDFFile, object: PDFObject): number {
  const number = nextObjectNumber(file)
  file.objects.set(number, object)
  return number
}

function concat(chunks: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0))
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.length
  }
  return out
}

/** The file written out, its streams' lengths and the cross-reference table made anew. */
export function writePDF(file: PDFFile, version: string): Uint8Array {
  const chunks: Uint8Array[] = [latin1Bytes(`%PDF-${version}\n%\xe2\xe3\xcf\xd3\n`)]
  let offset = chunks[0].length
  const offsets = new Map<number, number>()
  const size = nextObjectNumber(file)
  for (const number of [...file.objects.keys()].sort((a, b) => a - b)) {
    const object = file.objects.get(number)
    if (!object) continue
    offsets.set(number, offset)
    const parts: Uint8Array[] = []
    if (object.stream) {
      const dict = setDictValue(object.dict, 'Length', String(object.stream.length))
      parts.push(latin1Bytes(`${number} 0 obj\n${dict}\nstream\n`))
      parts.push(object.stream)
      parts.push(latin1Bytes('\nendstream\nendobj\n'))
    } else {
      parts.push(latin1Bytes(`${number} 0 obj\n${object.dict}\nendobj\n`))
    }
    for (const part of parts) {
      chunks.push(part)
      offset += part.length
    }
  }
  const rows = ['0000000000 65535 f \n']
  for (let number = 1; number < size; number++) {
    const at = offsets.get(number)
    rows.push(
      at === undefined ? '0000000000 65535 f \n' : `${String(at).padStart(10, '0')} 00000 n \n`
    )
  }
  const entries = [
    `/Size ${size}`,
    `/Root ${file.root} 0 R`,
    file.info === null ? '' : `/Info ${file.info} 0 R`,
    file.id ? `/ID ${file.id}` : ''
  ]
  const trailer = compact(entries).join('\n')
  chunks.push(
    latin1Bytes(
      `xref\n0 ${size}\n${rows.join('')}trailer\n<<\n${trailer}\n>>\nstartxref\n${offset}\n%%EOF\n`
    )
  )
  return concat(chunks)
}
