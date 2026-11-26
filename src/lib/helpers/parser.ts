import { XMLParser } from 'fast-xml-parser'

import { calverVersion, log } from './utils'

export const parser = new XMLParser({ ignoreAttributes: false })

export function sleep(ms: number) {
	return new Promise(resolve => setTimeout(resolve, ms))
}

let lock: Promise<void> = Promise.resolve()
let pendingLockCount = 0

async function withLock<T>(fn: () => Promise<T>): Promise<T> {
	pendingLockCount++
	let release!: () => void
	const next = new Promise<void>(r => (release = r))
	const prev = lock
	lock = next
	await prev
	try {
		return await fn()
	} finally {
		release()
		pendingLockCount--
	}
}

function getApplianceId(): string {
	return 'hare'
}

let _casBase = ''
let _casUrl = ''
let _nextToken = ''

async function resolveCAS(): Promise<string> {
	const raw = (localStorage.getItem('casUrl') ?? '').replace(/\/+$/, '').replace(/^https?:\/\//, '')
	if (!raw) {
		_casBase = ''
		_casUrl = ''
		return ''
	}
	if (_casBase && _casUrl === raw) return _casBase
	for (const scheme of ['http', 'https']) {
		try {
			const base = `${scheme}://${raw}`
			const response = await fetch(`${base}/healthz`, { signal: AbortSignal.timeout(2000) })
			if (!response.ok) continue
			_casBase = base
			_casUrl = raw
			return base
		} catch {}
	}
	_casBase = ''
	_casUrl = ''
	return ''
}

async function reportAndNext(casBase: string, body: Record<string, unknown>): Promise<string> {
	const res = await fetch(`${casBase}/report-and-acquire`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(body),
		signal: AbortSignal.timeout(35_000),
	})
	if (!res.ok) return ''
	const data = await res.json()
	return data.token ?? ''
}

async function casFetch(url: string, headers: Record<string, string>, userAgent: string): Promise<Response | null> {
	const casBase = await resolveCAS()
	if (!casBase) return null

	try {
		return await withLock(async () => {
			const applianceId = getApplianceId()
			const queuedAt = Date.now()

			const token =
				_nextToken ||
				(await (async () => {
					const backlog = Math.max(0, pendingLockCount - 1)
					const acq = await fetch(`${casBase}/acquire`, {
						method: 'POST',
						headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify({ appliance_id: applianceId, priority_class: 'P1_HIGH', backlog }),
						signal: AbortSignal.timeout(35_000),
					})
					if (!acq.ok) return ''
					const data = await acq.json()
					return data.token ?? ''
				})())
			if (!token) return null

			_nextToken = ''
			const acquiredAt = Date.now()
			const apiSentAt = Date.now()

			const response = await fetch(`${url}&userAgent=${userAgent} using Hare by Kractero`, {
				method: 'GET',
				headers,
			})

			const apiRecvAt = Date.now()

			_nextToken = await reportAndNext(casBase, {
				token,
				appliance_id: applianceId,
				priority_class: 'P1_HIGH',
				next_priority_class: 'P1_HIGH',
				backlog: Math.max(0, pendingLockCount - 1),
				queued_at: new Date(queuedAt).toISOString(),
				acquired_at: new Date(acquiredAt).toISOString(),
				api_sent_at: new Date(apiSentAt).toISOString(),
				api_recv_at: new Date(apiRecvAt).toISOString(),
				ns_remaining: Number(response.headers.get('RateLimit-Remaining') ?? 50),
				ns_reset: Number(response.headers.get('RateLimit-Reset') ?? 0),
				ns_rate_limit: Number(response.headers.get('RateLimit-Limit') ?? 50),
				status_code: response.status,
				retry_after: Number(response.headers.get('Retry-After') ?? 0),
			})

			// Let the caller retry through CAS instead of falling back to an uncoordinated request.
			if (response.status === 429) _nextToken = ''

			return response
		})
	} catch {
		return null
	}
}

export async function parseXML(url: string, userAgent: string, password?: string, xpin?: string) {
	const headers: Record<string, string> = {
		'User-Agent': `Used by ${userAgent} with Hare v${calverVersion}, written by Kractero`,
	}

	if (password) {
		headers['X-Password'] = password
	}

	if (xpin) {
		headers['X-Pin'] = xpin
	}

	try {
		for (;;) {
			let response: Response | null = null
			if (typeof localStorage !== 'undefined') {
				response = await casFetch(url, headers, userAgent)
			}
			const coordinated = response !== null
			response ??= await fetch(`${url}&userAgent=${userAgent} using Hare by Kractero`, {
				method: 'GET',
				headers,
			})

			const ratelimitRemaining = Number(response.headers.get('RateLimit-Remaining'))
			const ratelimitReset = Number(response.headers.get('RateLimit-Reset'))
			const retryAfter = Number(response.headers.get('Retry-After'))

			if (!response.ok) {
				if (response.status === 429) {
					const waitTime = retryAfter || ratelimitReset || 30
					await sleep(waitTime * 1000)
					continue
				}

				const code = response.status
				const text = await response.text()
				const match = text.match(/<h1[^>]*>(.*?)<\/h1>/s)
				const message = match?.[1]?.trim()
				throw new Error(message || `failed with error code ${code}`)
			}

			// CAS hands out tokens at the API's pace; direct requests still need local throttling.
			if (!coordinated) {
				if (ratelimitRemaining > 0) {
					await sleep((ratelimitReset / ratelimitRemaining) * 1000)
				} else {
					await sleep(ratelimitReset * 1000)
				}
			}

			const xml = await response.text()
			const xmlObj = parser.parse(xml)
			if (response.headers.get('x-pin')) xmlObj['x-pin'] = response.headers.get('x-pin') || ''

			return xmlObj
		}
	} catch (error) {
		if (error instanceof Error) {
			log('error', error.message)
		}
		throw error
	}
}
