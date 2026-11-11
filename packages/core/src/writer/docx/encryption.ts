import CFB from 'cfb'
import { fromUint8Array, toUint8Array } from 'js-base64'
import forge from 'node-forge'

import { attrOf, find, parseXML } from './xml'

/**
 * Password-protected Office files: ECMA-376 Agile Encryption (MS-OFFCRYPTO), as Word 2010 and
 * later write when a document has an open password. The package is encrypted with AES-256-CBC
 * under a random key, which is wrapped with a key derived from the password by 100,000 rounds of
 * SHA-512, and an HMAC-SHA512 guards the whole encrypted package.
 */

const SPIN_COUNT = 100_000
const SEGMENT = 4096

const BLOCK_VERIFIER_INPUT = [0xfe, 0xa7, 0xd2, 0x76, 0x3b, 0x4b, 0x9e, 0x79]
const BLOCK_VERIFIER_VALUE = [0xd7, 0xaa, 0x0f, 0x6d, 0x30, 0x61, 0x34, 0x4e]
const BLOCK_KEY_VALUE = [0x14, 0x6e, 0x0b, 0xe7, 0xab, 0xac, 0xd0, 0xd6]
const BLOCK_HMAC_KEY = [0x5f, 0xb2, 0xad, 0x01, 0x0c, 0xb9, 0xe1, 0xf6]
const BLOCK_HMAC_VALUE = [0xa0, 0x67, 0x7f, 0x02, 0xb2, 0x2c, 0x84, 0x33]

/** The data-space streams every encrypted package carries, the same in every file. */
const DATA_SPACES: Record<string, string> = {
  '\u0006DataSpaces/Version':
    'PAAAAE0AaQBjAHIAbwBzAG8AZgB0AC4AQwBvAG4AdABhAGkAbgBlAHIALgBEAGEAdABhAFMAcABhAGMAZQBzAAEAAAABAAAAAQAAAA==',
  '\u0006DataSpaces/DataSpaceMap':
    'CAAAAAEAAABoAAAAAQAAAAAAAAAgAAAARQBuAGMAcgB5AHAAdABlAGQAUABhAGMAawBhAGcAZQAyAAAAUwB0AHIAbwBuAGcARQBuAGMAcgB5AHAAdABpAG8AbgBEAGEAdABhAFMAcABhAGMAZQAAAA==',
  '\u0006DataSpaces/DataSpaceInfo/StrongEncryptionDataSpace':
    'CAAAAAEAAAAyAAAAUwB0AHIAbwBuAGcARQBuAGMAcgB5AHAAdABpAG8AbgBUAHIAYQBuAHMAZgBvAHIAbQAAAA==',
  '\u0006DataSpaces/TransformInfo/StrongEncryptionTransform/\u0006Primary':
    'WAAAAAEAAABMAAAAewBGAEYAOQBBADMARgAwADMALQA1ADYARQBGAC0ANAA2ADEAMwAtAEIARABEADUALQA1AEEANAAxAEMAMQBEADAANwAyADQANgB9AE4AAABNAGkAYwByAG8AcwBvAGYAdAAuAEMAbwBuAHQAYQBpAG4AZQByAC4ARQBuAGMAcgB5AHAAdABpAG8AbgBUAHIAYQBuAHMAZgBvAHIAbQAAAAEAAAABAAAAAQAAAAAAAAAAAAAAAAAAAAQAAAA='
}

export class DocxPasswordError extends Error {
  override name = 'DocxPasswordError'

  constructor(readonly reason: 'wrong-password' | 'unsupported' | 'damaged') {
    super(reason)
  }
}

const raw = (bytes: Uint8Array | readonly number[]) =>
  forge.util.binary.raw.encode(bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes))
const bytesOf = (binary: string) => forge.util.binary.raw.decode(binary)

function random(length: number): string {
  const bytes = new Uint8Array(length)
  crypto.getRandomValues(bytes)
  return raw(bytes)
}

const sha512 = (data: string) => forge.md.sha512.create().update(data).digest().getBytes()

function uint32(value: number): string {
  return String.fromCharCode(
    value & 0xff,
    (value >>> 8) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 24) & 0xff
  )
}

function utf16le(text: string): string {
  let out = ''
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i)
    out += String.fromCharCode(code & 0xff, code >>> 8)
  }
  return out
}

/** The password hash after the spin count, before a block key picks the derived key. */
function passwordHash(password: string, salt: string, spinCount: number): string {
  let hash = sha512(salt + utf16le(password))
  for (let i = 0; i < spinCount; i += 1) hash = sha512(uint32(i) + hash)
  return hash
}

function derivedKey(hash: string, blockKey: readonly number[], bytes: number): string {
  const key = sha512(hash + raw(blockKey))
  return key.length >= bytes ? key.slice(0, bytes) : key + '6'.repeat(bytes - key.length)
}

function ivFor(salt: string, blockKey: string, size = 16): string {
  return sha512(salt + blockKey).slice(0, size)
}

function aes(key: string, iv: string, data: string, encrypt: boolean): string {
  const cipher = encrypt
    ? forge.cipher.createCipher('AES-CBC', key)
    : forge.cipher.createDecipher('AES-CBC', key)
  cipher.start({ iv })
  cipher.update(forge.util.createBuffer(data))
  // The format pads blocks itself, with zeros; PKCS #7 padding is off both ways. forge's types
  // leave out `finish`'s padding callback, which its documentation describes.
  const finish: (padding?: () => boolean) => boolean = cipher.finish.bind(cipher)
  finish(() => true)
  return cipher.output.getBytes()
}

const zeroPad = (data: string, size = 16) =>
  data.length % size === 0 ? data : data + '\0'.repeat(size - (data.length % size))

function cryptPackage(key: string, salt: string, data: string, encrypt: boolean): string {
  let out = ''
  for (let offset = 0, segment = 0; offset < data.length; offset += SEGMENT, segment += 1) {
    const chunk = data.slice(offset, offset + SEGMENT)
    out += aes(key, ivFor(salt, uint32(segment)), encrypt ? zeroPad(chunk) : chunk, encrypt)
  }
  return out
}

function hmac(key: string, data: string): string {
  const mac = forge.hmac.create()
  mac.start('sha512', key)
  mac.update(data)
  return mac.digest().getBytes()
}

const b64 = (binary: string) => fromUint8Array(bytesOf(binary))
const unb64 = (text: string | null) => (text ? raw(toUint8Array(text)) : '')

/** Encrypts a `.docx` (or any OOXML package) with an open password. */
export function encryptDocx(docx: Uint8Array, password: string): Uint8Array {
  const secretKey = random(32)
  const keySalt = random(16)
  const passwordSalt = random(16)
  const hash = passwordHash(password, passwordSalt, SPIN_COUNT)
  const verifier = random(16)
  const encryptedVerifierInput = aes(
    derivedKey(hash, BLOCK_VERIFIER_INPUT, 32),
    passwordSalt,
    verifier,
    true
  )
  const encryptedVerifierValue = aes(
    derivedKey(hash, BLOCK_VERIFIER_VALUE, 32),
    passwordSalt,
    sha512(verifier),
    true
  )
  const encryptedKey = aes(derivedKey(hash, BLOCK_KEY_VALUE, 32), passwordSalt, secretKey, true)

  const content = raw(docx)
  const size = content.length
  const header = uint32(size) + uint32(Math.floor(size / 0x1_0000_0000))
  const encryptedPackage = header + cryptPackage(secretKey, keySalt, content, true)
  const hmacKey = random(64)
  const encryptedHmacKey = aes(secretKey, ivFor(keySalt, raw(BLOCK_HMAC_KEY)), hmacKey, true)
  const encryptedHmacValue = aes(
    secretKey,
    ivFor(keySalt, raw(BLOCK_HMAC_VALUE)),
    hmac(hmacKey, encryptedPackage),
    true
  )

  const algorithm =
    'blockSize="16" keyBits="256" hashSize="64" cipherAlgorithm="AES" cipherChaining="ChainingModeCBC" hashAlgorithm="SHA512"'
  const xml =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n' +
    '<encryption xmlns="http://schemas.microsoft.com/office/2006/encryption" xmlns:p="http://schemas.microsoft.com/office/2006/keyEncryptor/password" xmlns:c="http://schemas.microsoft.com/office/2006/keyEncryptor/certificate">' +
    `<keyData saltSize="16" ${algorithm} saltValue="${b64(keySalt)}"/>` +
    `<dataIntegrity encryptedHmacKey="${b64(encryptedHmacKey)}" encryptedHmacValue="${b64(encryptedHmacValue)}"/>` +
    '<keyEncryptors><keyEncryptor uri="http://schemas.microsoft.com/office/2006/keyEncryptor/password">' +
    `<p:encryptedKey spinCount="${SPIN_COUNT}" saltSize="16" ${algorithm} saltValue="${b64(passwordSalt)}" ` +
    `encryptedVerifierHashInput="${b64(encryptedVerifierInput)}" encryptedVerifierHashValue="${b64(encryptedVerifierValue)}" encryptedKeyValue="${b64(encryptedKey)}"/>` +
    '</keyEncryptor></keyEncryptors></encryption>'
  // Version 4.4 (Agile) and the reserved flags 0x40, then the XML descriptor.
  const info = bytesOf(String.fromCharCode(4, 0, 4, 0, 0x40, 0, 0, 0) + forge.util.encodeUtf8(xml))

  const container = CFB.utils.cfb_new()
  for (const [path, data] of Object.entries(DATA_SPACES))
    CFB.utils.cfb_add(container, path, toUint8Array(data))
  CFB.utils.cfb_add(container, 'EncryptionInfo', info)
  CFB.utils.cfb_add(container, 'EncryptedPackage', bytesOf(encryptedPackage))
  // The library's placeholder entry is not part of the format.
  CFB.utils.cfb_del(container, '\u0001Sh33tJ5')
  return new Uint8Array(CFB.write(container, { type: 'array' }) as number[])
}

function streamOf(container: CFB.CFB$Container, name: string): string | null {
  // eslint-disable-next-line unicorn/no-array-method-this-argument -- CFB.find is not Array#find.
  const entry = CFB.find(container, name)
  const content = entry?.content
  if (!content) return null
  return raw(content instanceof Uint8Array ? content : Uint8Array.from(content))
}

/** Opens a password-protected `.docx`; throws `DocxPasswordError` for a wrong password. */
export function decryptDocx(file: Uint8Array, password: string): Uint8Array {
  let container: CFB.CFB$Container
  try {
    container = CFB.read(file, { type: 'array' })
  } catch {
    throw new DocxPasswordError('damaged')
  }
  const info = streamOf(container, 'EncryptionInfo')
  const encryptedPackage = streamOf(container, 'EncryptedPackage')
  if (!info || !encryptedPackage) throw new DocxPasswordError('damaged')
  if (info.charCodeAt(0) !== 4 || info.charCodeAt(2) !== 4)
    throw new DocxPasswordError('unsupported')
  const root = parseXML(forge.util.decodeUtf8(info.slice(8)))
  const keyData = find(root, 'keyData')
  const encryptedKey = find(root, 'encryptedKey')
  if (
    attrOf(keyData, 'hashAlgorithm') !== 'SHA512' ||
    attrOf(keyData, 'cipherAlgorithm') !== 'AES'
  ) {
    throw new DocxPasswordError('unsupported')
  }
  const keyBytes = Number(attrOf(encryptedKey, 'keyBits') ?? 256) / 8
  const passwordSalt = unb64(attrOf(encryptedKey, 'saltValue'))
  const hash = passwordHash(
    password,
    passwordSalt,
    Number(attrOf(encryptedKey, 'spinCount') ?? SPIN_COUNT)
  )
  const verifier = aes(
    derivedKey(hash, BLOCK_VERIFIER_INPUT, keyBytes),
    passwordSalt,
    unb64(attrOf(encryptedKey, 'encryptedVerifierHashInput')),
    false
  )
  const verifierHash = aes(
    derivedKey(hash, BLOCK_VERIFIER_VALUE, keyBytes),
    passwordSalt,
    unb64(attrOf(encryptedKey, 'encryptedVerifierHashValue')),
    false
  )
  if (sha512(verifier) !== verifierHash.slice(0, 64)) throw new DocxPasswordError('wrong-password')
  const secretKey = aes(
    derivedKey(hash, BLOCK_KEY_VALUE, keyBytes),
    passwordSalt,
    unb64(attrOf(encryptedKey, 'encryptedKeyValue')),
    false
  ).slice(0, keyBytes)
  const keySalt = unb64(attrOf(keyData, 'saltValue'))
  const size = bytesOf(encryptedPackage.slice(0, 4)).reduce(
    (total, byte, index) => total + byte * 256 ** index,
    0
  )
  const plain = cryptPackage(secretKey, keySalt, encryptedPackage.slice(8), false)
  return bytesOf(plain.slice(0, size))
}
