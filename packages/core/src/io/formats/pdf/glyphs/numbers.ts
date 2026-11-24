/** A number as content streams write it: three decimals, no negative zero. */
export const num = (value: number) => {
  const rounded = Math.round(value * 1000) / 1000
  return Object.is(rounded, -0) ? '0' : String(rounded)
}

export const hex4 = (value: number) => value.toString(16).padStart(4, '0').toUpperCase()

/** Text as UTF-16 code units in hex, as PDF text strings and ToUnicode maps write it. */
export function utf16Hex(text: string): string {
  let out = ''
  for (let i = 0; i < text.length; i += 1) out += hex4(text.charCodeAt(i))
  return out
}
