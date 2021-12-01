import { EncryptJWT, jwtDecrypt } from "jose"
import hkdf from "@panva/hkdf"
import { v4 as uuid } from "uuid"
import { SessionStore } from "../core/lib/cookie"
import type { NextApiRequest } from "next"
import type { JWT, JWTDecodeParams, JWTEncodeParams } from "./types"
import type { LoggerInstance } from ".."

export * from "./types"

const DEFAULT_MAX_AGE = 30 * 24 * 60 * 60 // 30 days

const now = () => (Date.now() / 1000) | 0

/** Issues a JWT. By default, the JWT is encrypted using "A256GCM". */
export async function encode({
  token = {},
  secret,
  maxAge = DEFAULT_MAX_AGE,
}: JWTEncodeParams) {
  const encryptionSecret = await getDerivedEncryptionKey(secret)
  return await new EncryptJWT(token)
    .setProtectedHeader({ alg: "dir", enc: "A256GCM" })
    .setIssuedAt()
    .setExpirationTime(now() + maxAge)
    .setJti(uuid())
    .encrypt(encryptionSecret)
}

/** Decodes a NextAuth.js issued JWT. */
export async function decode({
  token,
  secret,
}: JWTDecodeParams): Promise<JWT | null> {
  if (!token) return null
  const encryptionSecret = await getDerivedEncryptionKey(secret)
  const { payload } = await jwtDecrypt(token, encryptionSecret, {
    clockTolerance: 15,
  })
  return payload
}

export interface GetTokenParams<R extends boolean = false> {
  /** The request containing the JWT either in the cookies or in the `Authorization` header. */
  req: NextApiRequest
  /**
   * Use secure prefix for cookie name, unless URL in `NEXTAUTH_URL` is http://
   * or not set (e.g. development or test instance) case use unprefixed name
   */
  secureCookie?: boolean
  /** If the JWT is in the cookie, what name `getToken()` should look for. */
  cookieName?: string
  /**
   * `getToken()` will return the raw JWT if this is set to `true`
   * @default false
   */
  raw?: R
  secret: string
  decode?: typeof decode
  logger?: LoggerInstance | Console
}

/**
 * Takes a NextAuth.js request (`req`) and returns either the NextAuth.js issued JWT's payload,
 * or the raw JWT string. We look for the JWT in the either the cookies, or the `Authorization` header.
 * [Documentation](https://next-auth.js.org/tutorials/securing-pages-and-api-routes#using-gettoken)
 */
export async function getToken<R extends boolean = false>(
  params?: GetTokenParams<R>
): Promise<R extends true ? string : JWT | null> {
  const {
    req,
    secureCookie = !(
      !process.env.NEXTAUTH_URL ||
      process.env.NEXTAUTH_URL.startsWith("http://")
    ),
    cookieName = secureCookie
      ? "__Secure-next-auth.session-token"
      : "next-auth.session-token",
    raw,
    decode: _decode = decode,
    logger = console,
  } = params ?? {}

  if (!req) throw new Error("Must pass `req` to JWT getToken()")

  const sessionStore = new SessionStore(
    { name: cookieName, options: { secure: secureCookie } },
    { cookies: req.cookies, headers: req.headers },
    logger
  )

  const token = sessionStore.value
  // @ts-expect-error
  if (!token) return null

  // @ts-expect-error
  if (raw) return token

  try {
    // @ts-expect-error
    return await _decode({ token, ...params })
  } catch {
    // @ts-expect-error
    return null
  }
}

async function getDerivedEncryptionKey(secret: string | Buffer) {
  return await hkdf(
    "sha256",
    secret,
    "",
    "NextAuth.js Generated Encryption Key",
    32
  )
}