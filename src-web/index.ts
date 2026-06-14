import { invoke } from '@tauri-apps/api/core'
import { isDate, isNumber, merge } from 'es-toolkit'

import { createCORSFetch } from './fetch'
import type { CORSFetchConfig, CORSFetchInit } from './fetch'
import type { ClearCookiesConfig } from './types/ClearCookiesConfig'
import type { ClientConfig } from './types/ClientConfig'
import type { CookieEntry } from './types/CookieEntry'
import type { DeleteCookieConfig } from './types/DeleteCookieConfig'
import type { GetAllCookiesConfig } from './types/GetAllCookiesConfig'
import type { GetAllDomainCookiesConfig } from './types/GetAllDomainCookiesConfig'
import type { GetCookieConfig } from './types/GetCookieConfig'
import type { SetCookieConfig } from './types/SetCookieConfig'
import { createCORSXMLHttpRequestConstructor } from './xhr'

declare global {
  interface Window {
    CORSFetch?: CORSFetch
    fetchNative: typeof fetch
    fetchCORS: (
      input: Parameters<typeof fetch>[0],
      init: CORSFetchInit
    ) => ReturnType<CORSFetch['fetch']>
    fetch: CORSFetch['fetch']
    XMLHttpRequestNative: typeof XMLHttpRequest
  }
}

export interface CookieOptions {
  domain?: string
  path?: string
  expires?: Date | string
  maxAge?: number
  secure?: boolean
  httpOnly?: boolean
  sameSite?: 'Strict' | 'Lax' | 'None'
}

type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P]
}

export const GLOBAL_INSTANCE_KEY = ''

export class CORSFetch {
  /**
   * @param config 如果`config.request.instanceKey`是`""`或`undefined`，则默认注入全局，并使用全局instance
   */
  public static async init(config?: DeepPartial<CORSFetchConfig>): Promise<CORSFetch> {
    const cors = new CORSFetch(config)
    const instanceKey = cors.config.request.instanceKey

    console.debug('Create cors instance.', instanceKey)
    const prepareConfig: ClientConfig = cors.config.request
    await invoke<void>('plugin:better-cors-fetch|prepare_requester', { client: prepareConfig })

    if (instanceKey == GLOBAL_INSTANCE_KEY && !window.CORSFetch) {
      const corsFetch = cors.fetch.bind(cors)

      window.CORSFetch = cors
      window.fetchNative = window.fetch.bind(window)
      window.fetch = corsFetch
      window.fetchCORS = (input, init) => cors.fetch(input, init, true)
      window.XMLHttpRequestNative = window.XMLHttpRequest
      window.XMLHttpRequest = cors.XHR
    }
    console.debug('Create cors instance done.', instanceKey)
    return cors
  }

  protected constructor(config?: DeepPartial<CORSFetchConfig>) {
    void this.setConfig(config ?? {})
  }

  private _config: CORSFetchConfig = {
    include: [],
    exclude: [],
    request: {
      proxy: null,
      connectTimeout: null,
      maxRedirections: null,
      userAgent: navigator.userAgent,
      danger: { acceptInvalidCerts: false, acceptInvalidHostnames: false },
      instanceKey: GLOBAL_INSTANCE_KEY
    }
  }

  private _fetch = createCORSFetch(() => this._config)

  public readonly XHR: typeof XMLHttpRequest = createCORSXMLHttpRequestConstructor(
    this.fetch.bind(this)
  )

  public get config(): CORSFetchConfig {
    return this._config
  }

  public setConfig(newConfig: DeepPartial<CORSFetchConfig>): Promise<void> {
    this._config = merge(this._config, newConfig)
    return invoke<void>('plugin:better-cors-fetch|prepare_requester', {
      config: this._config
    }).catch(() => {})
  }

  public fetch(
    input: Parameters<typeof fetch>[0],
    init?: CORSFetchInit,
    force = false
  ): Promise<Response> {
    return this._fetch(input, init, force)
  }

  public setCookie(url: string | URL, content: string): Promise<void> {
    const config: SetCookieConfig = {
      url: String(url),
      content,
      instanceKey: this.config.request.instanceKey
    }
    return invoke<void>('plugin:better-cors-fetch|set_cookie', { config })
  }

  public getCookie(url: string | URL, name: string): Promise<string | null> {
    const config: GetCookieConfig = {
      url: String(url),
      name,
      instanceKey: this.config.request.instanceKey
    }
    return invoke<string | null>('plugin:better-cors-fetch|get_cookie', { config })
  }

  public getAllDomainCookies(url: string | URL): Promise<CookieEntry[]> {
    const config: GetAllDomainCookiesConfig = {
      url: String(url),
      instanceKey: this.config.request.instanceKey
    }
    return invoke<CookieEntry[]>('plugin:better-cors-fetch|get_all_domain_cookies', { config })
  }

  public getAllCookies(): Promise<CookieEntry[]> {
    const config: GetAllCookiesConfig = { instanceKey: this.config.request.instanceKey }
    return invoke<CookieEntry[]>('plugin:better-cors-fetch|get_all_cookies', { config })
  }

  public deleteCookie(url: string | URL, path = '/', name: string): Promise<boolean> {
    const config: DeleteCookieConfig = {
      url: url.toString(),
      name,
      path,
      instanceKey: this.config.request.instanceKey
    }
    return invoke<boolean>('plugin:better-cors-fetch|delete_cookie', { config })
  }

  public clearCookie(): Promise<void> {
    const config: ClearCookiesConfig = { instanceKey: this.config.request.instanceKey }
    return invoke<void>('plugin:better-cors-fetch|clear_cookie', { config })
  }

  public setCookieByParts(
    url: string | URL,
    name: string,
    value: string,
    options: CookieOptions = {}
  ): Promise<void> {
    const segments = [`${name}=${value}`]

    if (options.domain) segments.push(`Domain=${options.domain}`)
    if (options.path) segments.push(`Path=${options.path}`)
    if (options.expires) {
      const expires = isDate(options.expires)
        ? options.expires.toUTCString()
        : new Date(options.expires).toUTCString()
      segments.push(`Expires=${expires}`)
    }
    if (isNumber(options.maxAge)) segments.push(`Max-Age=${options.maxAge}`)
    if (options.secure) segments.push('Secure')
    if (options.httpOnly) segments.push('HttpOnly')
    if (options.sameSite) segments.push(`SameSite=${options.sameSite}`)

    return this.setCookie(url, segments.join('; '))
  }
}