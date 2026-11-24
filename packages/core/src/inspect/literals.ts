/** A control character as a four-digit hex code. */
const hex4 = (char: string) =>
  (char.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, '0')

const SWIFT_ESCAPES: Record<string, string> = {
  '\\': '\\\\',
  '"': '\\"',
  '\n': '\\n',
  '\r': '\\r',
  '\t': '\\t',
  '\0': '\\0'
}

/**
 * A Swift string literal: Swift has no `\b`, `\f` or `\uXXXX`, which JSON writes, and reads
 * other control characters only as `\u{…}`.
 */
export function swiftString(text: string): string {
  const body = text.replace(
    // oxlint-disable-next-line no-control-regex -- control characters are what this escapes
    /[\\"\u0000-\u001F\u007F\u2028\u2029]/g,
    (char) => SWIFT_ESCAPES[char] ?? `\\u{${hex4(char)}}`
  )
  return `"${body}"`
}

const KOTLIN_ESCAPES: Record<string, string> = {
  '\\': '\\\\',
  '"': '\\"',
  $: '\\$',
  '\n': '\\n',
  '\r': '\\r',
  '\t': '\\t',
  '\b': '\\b'
}

/** A Kotlin string literal, where `$` would otherwise start a string template. */
export function kotlinString(text: string): string {
  const body = text.replace(
    // oxlint-disable-next-line no-control-regex -- control characters are what this escapes
    /[\\"$\u0000-\u001F\u007F\u2028\u2029]/g,
    (char) => KOTLIN_ESCAPES[char] ?? `\\u${hex4(char)}`
  )
  return `"${body}"`
}

/** Text for an XML attribute value in double quotes. */
export function escapeXML(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

/**
 * Text as an Android resource string in an XML attribute. Android reads `\` as an escape,
 * drops unescaped double quotes, rejects an unescaped apostrophe, and takes a leading `@` or `?`
 * for a resource reference, so each is escaped before the XML escaping; control characters,
 * which XML cannot hold, go as Android's `\uXXXX`.
 */
export function androidText(text: string): string {
  const escaped = text
    .replaceAll('\\', '\\\\')
    .replaceAll("'", "\\'")
    .replaceAll('"', '\\"')
    .replaceAll('\n', '\\n')
    .replaceAll('\t', '\\t')
    // XML cannot hold other control characters at all, even as references.
    // oxlint-disable-next-line no-control-regex -- control characters are what this escapes
    .replace(/[\u0000-\u001F\u007F]/g, (char) => `\\u${hex4(char)}`)
  return escapeXML(/^[@?]/.test(escaped) ? `\\${escaped}` : escaped)
}
