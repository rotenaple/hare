<script lang="ts">
	import { onDestroy, onMount } from 'svelte'
	import { page } from '$app/state'
	import Buttons from '$lib/components/Buttons.svelte'
	import OpenButton from '$lib/components/buttons/OpenButton.svelte'
	import FormCheckbox from '$lib/components/FormCheckbox.svelte'
	import FormInput from '$lib/components/FormInput.svelte'
	import FormSelect from '$lib/components/FormSelect.svelte'
	import FormTextArea from '$lib/components/FormTextArea.svelte'
	import InputCredentials from '$lib/components/InputCredentials.svelte'
	import Terminal from '$lib/components/Terminal.svelte'
	import ToolContent from '$lib/components/ToolContent.svelte'
	import Button from '$lib/components/ui/button/button.svelte'
	import { parseXML } from '$lib/helpers/parser'
	import { checkUserAgent, pushHistory, urlParameters } from '$lib/helpers/utils'
	import type { Card } from '$lib/types'
	import { giftCard } from '$lib/helpers/gift'
	import FinderRaritySeason from '$lib/components/FinderRaritySeason.svelte'
	import Rarities from '$lib/components/Rarities.svelte'

	const abortController = new AbortController()
	let domain = ''
	let info = $state<Array<{ text: string; color?: string }>>([])
	let progress = $state<Array<{ text: string; color?: string }>>([])
	let content: Array<{ url: string; tableText: string; linkStyle?: string }> = $state([])
	let downloadable = $state(false)
	let stoppable = $state(false)
	let stopped = $state(false)
	let main = $state('')
	let puppets = $state('')
	let finderlist = $state('')
	let mode = $state('Gift')
	let password = $state('')
	let giftee = $state('')
	let errors: Array<{ field: string | number; message: string }> = $state([])
	let finderConfig = $state({
		common: [],
		uncommon: [],
		rare: [],
		'ultra-rare': [1, 2, 3, 4],
		epic: [1, 2, 3, 4],
		legendary: [1, 2, 3, 4],
	})
	let keepOne = $state('0')
	let giftOverMVValue = $state(10)
	let findMode = $state('Specific Cards')
	let exclusionNations = $state('')
	let highValueTarget = $state('')
	let lowValueTarget = $state('')
	let highValueThresholds = $state({
		common: 10,
		uncommon: 10,
		rare: 10,
		'ultra-rare': 10,
		epic: 10,
	})

	onMount(() => {
		domain = `https://${localStorage.getItem('connectionUrl') || 'www'}.nationstates.net`
		main = page.url.searchParams.get('main') || (localStorage.getItem('main') as string) || ''
		puppets = (localStorage.getItem('puppets') as string) || ''
		finderlist = (localStorage.getItem('finderList') as string) || ''
		password = (localStorage.getItem('password') as string) || ''
		mode = page.url.searchParams.get('mode') || (localStorage.getItem('finderMode') as string) || 'Gift'
		giftee =
			page.url.searchParams.get('giftee')?.split(',').join('\n') ||
			(localStorage.getItem('finderGiftee') as string) ||
			''
		if (localStorage.getItem('finderConfig')) {
			try {
				finderConfig = JSON.parse(localStorage.getItem('finderConfig') as string)
			} catch (e) {
				console.error('Failed to parse finderConfig', e)
			}
		}
		if (localStorage.getItem('highValueThresholds')) {
			try {
				highValueThresholds = JSON.parse(localStorage.getItem('highValueThresholds') as string)
			} catch (e) {
				console.error('Failed to parse highValueThresholds', e)
			}
		}
		if (page.url.searchParams.has('finderConfig')) {
			try {
				finderConfig = JSON.parse(page.url.searchParams.get('finderConfig') as string)
			} catch (e) {
				console.error('Failed to parse finderConfig from URL', e)
			}
		}
		highValueTarget =
			page.url.searchParams.get('highValueTarget') || localStorage.getItem('highValueTarget') || ''
		lowValueTarget = page.url.searchParams.get('lowValueTarget') || localStorage.getItem('lowValueTarget') || ''
		keepOne = page.url.searchParams.get('keepOne') || localStorage.getItem('keepOne') || '1'
		giftOverMVValue = parseFloat(
			page.url.searchParams.get('giftOverMVValue') || localStorage.getItem('giftOverMVValue') || '10'
		)
		findMode = page.url.searchParams.get('findMode') || localStorage.getItem('findMode') || 'Specific Cards'
		exclusionNations =
			page.url.searchParams.get('exclusionNations')?.split(',').join('\n') ||
			localStorage.getItem('exclusionNations') ||
			''
	})
	$effect(() => {
		localStorage.setItem('finderConfig', JSON.stringify(finderConfig))
	})
	$effect(() => {
		localStorage.setItem('exclusionNations', exclusionNations)
	})
	$effect(() => {
		localStorage.setItem('highValueTarget', highValueTarget)
	})
	$effect(() => {
		localStorage.setItem('lowValueTarget', lowValueTarget)
	})
	$effect(() => {
		localStorage.setItem('highValueThresholds', JSON.stringify(highValueThresholds))
	})

	onDestroy(() => abortController.abort())

	async function onSubmit(e: Event) {
		e.preventDefault()
		pushHistory(
			`?main=${main}&mode=${mode}${giftee ? `&giftee=${giftee.split('\n').join(',')}` : ''}&findMode=${findMode}${['General', '1949 Shanghai Mode'].includes(findMode) ? `&finderConfig=${JSON.stringify(finderConfig)}` : ''}${findMode === 'General' ? `&giftOverMVValue=${giftOverMVValue}` : ''}${findMode === '1949 Shanghai Mode' ? `&exclusionNations=${exclusionNations.split('\n').join(',')}&highValueTarget=${highValueTarget}&lowValueTarget=${lowValueTarget}` : ''}${keepOne ? `&keepOne=${keepOne}` : ''}`
		)
		errors = checkUserAgent(main)
		if (errors.length > 0) return
		downloadable = false
		stoppable = true
		stopped = false
		content = []
		progress = []
		// other = ''
		const puppetList = puppets.split('\n').map(puppet => {
			if (puppet.includes(',')) {
				const [nation, nationSpecificPassword] = puppet.split(',')
				return {
					nation: nation.toLowerCase().replaceAll(' ', '_'),
					nationSpecificPassword: nationSpecificPassword,
				}
			} else {
				return { nation: puppet.toLowerCase().replaceAll(' ', '_') }
			}
		})
		info = [{ text: `Initiating Finder...` }]
		let findCount = 0
		let failedGiftCount = 0

		const giftedCards = new Set()
		const soldCards = new Set()

		const toFind = finderlist.split('\n')
		const matches = toFind.map(matcher => {
			const info = matcher.split(',')
			const gifteeValue = info.length > 2 && info[2] ? info[2] : ''

			return {
				id: info[0],
				season: info[1],
				giftee: gifteeValue,
			}
		})
		let gifteeQueue = giftee
			.split('\n')
			.map(name => name.trim())
			.filter(Boolean)

		async function attemptGift({
			nation,
			id,
			season,
			main,
			xpin,
			nsp,
			password,
			overrideGiftee,
			gifteeList,
		}: {
			nation: string
			id: string
			season: string
			main: string
			xpin: string
			nsp?: string
			password: string
			overrideGiftee: string
			gifteeList: string[]
		}) {
			let attemptGiftee = overrideGiftee || gifteeList[0] || ''
			while (attemptGiftee) {
				const {
					cnx: newXpin,
					giftee: cg,
					fail,
				} = await giftCard({
					url: `${domain}/cgi-bin/api.cgi?nation=${nation}&cardid=${id}&season=${season}`,
					main,
					cnx: xpin,
					nsp,
					password,
					specificGiftee: attemptGiftee,
				})

				xpin = newXpin

				console.log(fail)
				if (fail === 'no capacity' || fail === `No such nation: "${cg}".`) {
					info = [
						...info.slice(-100),
						{ text: `${nation} failed to gift ${id} to ${cg}, ${fail}`, color: 'red' },
					]
					if (!overrideGiftee) gifteeList.shift()
					if (overrideGiftee) overrideGiftee = ''
					attemptGiftee = gifteeList[0] || ''
					console.log(attemptGiftee)
					continue
				}

				if (fail) {
					info = [
						...info.slice(-100),
						{ text: `${nation} failed to gift ${id} to ${cg}, ${fail}`, color: 'red' },
					]
					content.push({
						url: `${domain}/page=deck/container=${nation}/nation=${nation}/card=${id}/season=${season}/gift=1?${urlParameters('Finder', main)}&giftto=${cg.toLowerCase().replaceAll(' ', '_')}`,
						tableText: `Link to ${nation}`,
					})
					return { success: false, xpin, fail }
				}

				progress = [...progress.slice(-100), { text: `${nation} gifted ${id} to ${cg}`, color: 'green' }]
				giftedCards.add(`${id},${season}`)
				return { success: true, xpin }
			}

			return { success: false, xpin, fail: 'no available giftee' }
		}

		giftingPhase: {
			if (findMode === 'Specific Cards') {
				info = [...info, { text: `Finding -> ${toFind.length} cards...` }]
				if (matches.length < puppetList.length) {
					info = [...info, { text: `More puppets than cards, proceeding...` }]
					const perNationXPins = <Array<{ nation: string; xpin: string }>>[]
					for (let i = 0; i < matches.length; i++) {
						progress = [
							...progress.slice(-100),
							{ text: `Processing card ${i + 1}/${matches.length} cards` },
						]
						if (
							mode === 'Gift One' &&
							giftedCards.size > 0 &&
							toFind.length > 0 &&
							giftedCards.size === toFind.length
						) {
							progress = [
								...progress,
								{ text: `All cards provided have been gifted, skipping remaining puppets`, color: 'blue' },
							]
							break
						}
						if (mode === 'Sell One' && soldCards.size > 0 && toFind.length > 0 && soldCards.size === toFind.length) {
							progress = [
								...progress,
								{ text: `All cards provided have been sold, skipping remaining puppets`, color: 'blue' },
							]
							break
						}
						if (abortController.signal.aborted || stopped) {
							break
						}
						const { id: matchId, season: matchSeason, giftee: matchGiftee } = matches[i]
						const cardInfo = await parseXML(
							`https://www.nationstates.net/cgi-bin/api.cgi?q=card+owners;cardid=${matchId};season=${matchSeason}`,
							main
						)
						const owners = cardInfo.CARD.OWNERS
						const id = cardInfo.CARD.CARDID
						const season = cardInfo.CARD.SEASON

						if (!owners) continue

						let ownerArr: string[] = Array.isArray(owners.OWNER)
							? owners.OWNER.map((owner: string | number) => String(owner))
							: [String(owners.OWNER)]
						let processedOwners = new Set<string>()

						for (let i = 0; i < ownerArr.length; i++) {
							const owner = String(ownerArr[i])
							if (processedOwners.has(owner)) continue
							const matchedPuppet = puppetList.find(puppet => puppet.nation === owner)
							if (matchedPuppet) {
								let frequency = 0
								for (const o of ownerArr) {
									if (o === owner) frequency++
								}
								processedOwners.add(owner)
								if (giftedCards.has(`${id},${season}`) && mode === 'Gift One') {
									progress = [...progress.slice(-100), { text: `Already gifted ${id}`, color: 'blue' }]
									continue
								}
								if (soldCards.has(`${id},${season}`) && mode === 'Sell One') {
									progress = [...progress.slice(-100), { text: `Already sold ${id}`, color: 'blue' }]
									continue
								}

								const { nation, nationSpecificPassword } = matchedPuppet

								if (keepOne && puppetList.length === 1) {
									frequency = frequency - Number(keepOne)
								}

								for (let i = 0; i < frequency; i++) {
									if (abortController.signal.aborted || stopped) {
										break
									}

									if (matchSeason && matchSeason !== String(season)) {
										progress = [...progress, { text: `Found ${id} but not right season.`, color: 'blue' }]
									} else {
										if (mode.includes('Gift')) {
											const existingEntry = perNationXPins.find(entry => entry.nation === nation)
											const startingXpin = existingEntry?.xpin || ''
											const { success, xpin: newXpin } = await attemptGift({
												nation,
												id,
												season,
												main,
												xpin: startingXpin,
												nsp: nationSpecificPassword,
												password,
												overrideGiftee: matchGiftee,
												gifteeList: gifteeQueue,
											})

											if (success || newXpin) {
												if (existingEntry) {
													existingEntry.xpin = newXpin
												} else {
													perNationXPins.push({
														nation,
														xpin: newXpin,
													})
												}
											} else {
												failedGiftCount++
												if (gifteeQueue.length === 0) {
													info = [...info, { text: `No available giftees remaining. Stopping gifting.`, color: 'red' }]
													break giftingPhase
												}
											}
										} else {
											progress = [
												...progress.slice(-100),
												{ text: `${nation} owns ${id}, adding sell link!`, color: 'green' },
											]
											content.push({
												url: `${domain}/page=deck/container=${nation}/nation=${nation}/card=${id}/season=${season}?${urlParameters('Finder', main)}`,
												tableText: `Link to ${nation}`,
											})
											soldCards.add(`${id},${season}`)
										}
										findCount++
									}
								}
							}
						}
					}
				} else {
					info = [...info, { text: `More cards than puppets, proceeding...` }]
					const foundSet = new Set<string>()
					for (const match of matches) {
						const key = `${match.id},${match.season}`
						foundSet.add(key)
					}
					for (let i = 0; i < puppetList.length; i++) {
						if (
							mode === 'Gift One' &&
							giftedCards.size > 0 &&
							toFind.length > 0 &&
							giftedCards.size === toFind.length
						) {
							progress = [
								...progress,
								{ text: `All cards provided have been gifted, skipping remaining puppets`, color: 'blue' },
							]
							continue
						}
						if (mode === 'Sell One' && soldCards.size > 0 && toFind.length > 0 && soldCards.size === toFind.length) {
							progress = [
								...progress,
								{ text: `All cards provided have been sold, skipping remaining puppets`, color: 'blue' },
							]
							break
						}

						let currentNationXPin = ''
						const { nation, nationSpecificPassword } = puppetList[i]
						let keepGifting = true

						if (abortController.signal.aborted || stopped) {
							break
						}

						try {
							progress = [
								...progress.slice(-100),
								{ text: `Processing ${nation} ${i + 1}/${puppetList.length} puppets` },
							]
							const xmlDocument = await parseXML(`${domain}/cgi-bin/api.cgi?nationname=${nation}&q=cards+deck`, main)
							let cards: Array<Card> = xmlDocument.CARDS.DECK.CARD
							cards = cards ? (Array.isArray(cards) ? cards : [cards]) : []

							const cardIndex = new Map<string, number>()
							for (const card of cards) {
								const key = `${card.CARDID}|${card.SEASON}`
								cardIndex.set(key, (cardIndex.get(key) || 0) + 1)
							}

							const seen = new Set<string>()
							const filteredCards: Array<{ id: string; giftee: string; season: string; count: number }> = []

							for (const match of matches) {
								const key = `${match.id}|${match.season}`
								if (seen.has(key)) continue
								seen.add(key)

								const count = cardIndex.get(key) || 0
								if (count > 0) {
									filteredCards.push({
										id: match.id,
										giftee: match.giftee,
										season: match.season,
										count,
									})
								}
							}

							if (filteredCards && filteredCards.length > 0) {
								for (const { id, season, count: originalCount, giftee } of filteredCards) {
									if (giftedCards.has(`${id},${season}`) && mode === 'Gift One') {
										progress = [
											...progress.slice(-100),
											{ text: `Already gifted ${id} (S${season})`, color: 'blue' },
										]
										continue
									}
									if (soldCards.has(`${id},${season}`) && mode === 'Sell One') {
										progress = [
											...progress.slice(-100),
											{ text: `Already sold ${id} (S${season})`, color: 'blue' },
										]
										continue
									}

									const effectiveCount = keepOne ? originalCount - Number(keepOne) : originalCount
									if (effectiveCount <= 0) {
										if (foundSet.has(`${id},${season}`)) foundSet.delete(`${id},${season}`)
										continue
									}

									for (let i = 0; i < effectiveCount; i++) {
										if (
											mode === 'Gift One' &&
											giftedCards.size > 0 &&
											toFind.length > 0 &&
											giftedCards.size === toFind.length
										) {
											progress = [
												...progress,
												{ text: `${id},${season} already gifted from ${nation}, skipping`, color: 'blue' },
											]
											break
										}
										if (abortController.signal.aborted || stopped) {
											break
										}

										if (mode.includes('Gift') && keepGifting) {
											if (foundSet.has(`${id},${season}`)) foundSet.delete(`${id},${season}`)

											const {
												success,
												xpin: newXpin,
												fail,
											} = await attemptGift({
												nation,
												id,
												season,
												main,
												xpin: currentNationXPin,
												nsp: nationSpecificPassword,
												password,
												overrideGiftee: giftee,
												gifteeList: gifteeQueue,
											})

											currentNationXPin = newXpin
											if (!success) {
												failedGiftCount++
												if (gifteeQueue.length === 0) {
													info = [...info, { text: `No available giftees remaining. Stopping gifting.`, color: 'red' }]
													break giftingPhase
												}
												if (fail === 'not enough bank') keepGifting = false
											}
										} else {
											if (foundSet.has(`${id},${season}`)) foundSet.delete(`${id},${season}`)
											progress = [...progress.slice(-100), { text: `${nation} owns ${id}!`, color: 'green' }]
											content.push({
												url: `${domain}/page=deck/container=${nation}/nation=${nation}/card=${id}/season=${season}?${urlParameters('Finder', main)}`,
												tableText: `Link to ${nation}`,
											})
											soldCards.add(`${id},${season}`)
										}
										findCount++
									}
								}
							} else {
								progress = [...progress, { text: `Zero matches found on ${nation}, skipping!`, color: 'blue' }]
							}
						} catch (err) {
							info = [...info, { text: `Error processing ${nation} with ${err}`, color: 'red' }]
						}
					}
				}
			} else if (findMode === 'General') {
				let conditions = []
				Object.entries(finderConfig).forEach(([rarity, seasons]) => {
					if (seasons.length > 0) {
						conditions.push(`${rarity} (S${seasons.join(',')})`)
					}
				})
				if (giftOverMVValue) conditions.push(`cards over ${giftOverMVValue} MV`)
				info = [...info, { text: `Finding ${conditions.join(', ')}` }]
				for (let i = 0; i < puppetList.length; i++) {
					let currentNationXPin = ''
					let keepGifting = true
					const { nation, nationSpecificPassword } = puppetList[i]

					if (abortController.signal.aborted || stopped) {
						break
					}

					try {
						progress = [
							...progress.slice(-100),
							{ text: `Processing ${nation} ${i + 1}/${puppetList.length} puppets` },
						]
						const xmlDocument = await parseXML(`${domain}/cgi-bin/api.cgi?nationname=${nation}&q=cards+deck`, main)
						let cards: Array<Card> = xmlDocument.CARDS.DECK.CARD
						cards = cards ? (Array.isArray(cards) ? cards : [cards]) : []
						if (cards && cards.length > 0) {
							let filteredCards: Card[] = []

							filteredCards = [
								...filteredCards,
								...cards.filter(card => {
									const rarity = card.CATEGORY
									const season = Number(card.SEASON)
									return finderConfig[rarity]?.includes(season)
								}),
								...cards.filter(card => parseFloat(card.MARKET_VALUE) >= giftOverMVValue),
							]

							for (let j = 0; j < filteredCards.length; j++) {
								if (abortController.signal.aborted || stopped) {
									break
								}
								const id = filteredCards[j].CARDID
								const season = filteredCards[j].SEASON
								let matchGiftee = ''

								const match = matches.find(m => m.id === id && m.season === season)
								if (match) {
									matchGiftee = match.giftee
								}

								if (mode.includes('Gift') && keepGifting === true) {
									const {
										success,
										xpin: newXpin,
										fail,
									} = await attemptGift({
										nation,
										id,
										season,
										main,
										xpin: currentNationXPin,
										nsp: nationSpecificPassword,
										password,
										overrideGiftee: matchGiftee,
										gifteeList: gifteeQueue,
									})

									currentNationXPin = newXpin
									if (!success) {
										failedGiftCount++
										if (gifteeQueue.length === 0) {
											info = [...info, { text: `No available giftees remaining. Stopping gifting.`, color: 'red' }]
											break giftingPhase
										}
										if (fail === 'not enough bank') keepGifting = false
									}
								} else {
									progress = [
										...progress.slice(-100),
										{ text: `${nation} owns ${id}, adding to sell!`, color: 'green' },
									]
									content.push({
										url: `${domain}/page=deck/container=${nation}/nation=${nation}/card=${id}/season=${season}?${urlParameters('Finder', main)}`,
										tableText: `Link to ${nation}`,
									})
									soldCards.add(`${id},${season}`)
								}
								findCount++
							}
						} else {
							progress = [...progress, { text: `It is likely ${nation} has 0 cards, skipping!`, color: 'blue' }]
						}
					} catch (err) {
						info = [...info, { text: `Error processing ${nation} with ${err}`, color: 'red' }]
					}
				}
			} else if (findMode === '1949 Shanghai Mode') {
				info = [{ text: `Scanning ${puppetList.length} puppets for available cards...` }]
				const cardOwnership = new Map<
					string,
					Array<{ nation: string; nsp?: string; category: string; mv: number }>
				>()
				const puppetVirtualBanks = new Map<string, number>()
				const perNationXPins = new Map<string, string>()

				for (let i = 0; i < puppetList.length; i++) {
					if (stopped || abortController.signal.aborted) break
					const { nation, nationSpecificPassword } = puppetList[i]
					progress = [
						...progress.slice(-100),
						{ text: `Scanning puppet: ${nation} (${i + 1}/${puppetList.length})` },
					]
					try {
						const xml = await parseXML(`${domain}/cgi-bin/api.cgi?nationname=${nation}&q=cards+deck+info`, main)
						const bank = Number(xml.CARDS.INFO.BANK)
						puppetVirtualBanks.set(nation, bank)

						let cards: Array<Card> = xml.CARDS.DECK.CARD
						cards = cards ? (Array.isArray(cards) ? cards : [cards]) : []
						for (const card of cards) {
							const key = `${card.CARDID},${card.SEASON}`

							if (finderConfig[card.CATEGORY]?.includes(Number(card.SEASON))) {
								if (!cardOwnership.has(key)) cardOwnership.set(key, [])
								cardOwnership.get(key)!.push({
									nation,
									nsp: nationSpecificPassword,
									category: card.CATEGORY,
									mv: parseFloat(card.MARKET_VALUE),
								})
							}
						}
					} catch (err) {
						info = [
							...info.slice(-100),
							{ text: `Error scanning puppet ${nation}: ${err}`, color: 'red' },
						]
					}
				}

				const exclusionList = exclusionNations
					.split('\n')
					.map((n) => n.trim().toLowerCase().replaceAll(' ', '_'))
					.filter(Boolean)

				if (exclusionList.length > 0) {
					info = [...info.slice(-100), { text: `Scanning ${exclusionList.length} exclusion nations...` }]
					for (let i = 0; i < exclusionList.length; i++) {
						if (stopped || abortController.signal.aborted) break
						const nation = exclusionList[i]
						progress = [
							...progress.slice(-100),
							{ text: `Scanning exclusion: ${nation} (${i + 1}/${exclusionList.length})` },
						]
						try {
							const xml = await parseXML(
								`${domain}/cgi-bin/api.cgi?nationname=${nation}&q=cards+deck`,
								main
							)
							let cards: Array<Card> = xml.CARDS.DECK.CARD
							cards = cards ? (Array.isArray(cards) ? cards : [cards]) : []
							for (const card of cards) {
								const key = `${card.CARDID},${card.SEASON}`
								// Memory optimization: Prune the existing candidate map instead of storing a huge exclusion set
								if (cardOwnership.has(key)) {
									cardOwnership.delete(key)
								}
							}
						} catch (err) {
							info = [
								...info.slice(-100),
								{ text: `Error scanning exclusion ${nation}: ${err}`, color: 'red' },
							]
						}
					}
				}

				const costs: Record<string, number> = {
					common: 0.01,
					uncommon: 0.05,
					rare: 0.1,
					'ultra-rare': 0.2,
					epic: 0.5,
					legendary: 1.0,
				}

				const neededKeys = Array.from(cardOwnership.keys())

				// Bucket into High and Low value
				const highBucket: string[] = []
				const lowBucket: string[] = []

				for (const key of neededKeys) {
					const firstOwner = cardOwnership.get(key)![0]
					let isHigh = false
					if (firstOwner.category === 'legendary') {
						isHigh = true
					} else {
						const threshold =
							highValueThresholds[firstOwner.category as keyof typeof highValueThresholds] || 0
						if (firstOwner.mv >= threshold) isHigh = true
					}

					if (isHigh) highBucket.push(key)
					else lowBucket.push(key)
				}

				const sortBucket = (bucket: string[]) => {
					bucket.sort((a, b) => {
						const ownersA = cardOwnership.get(a)!.length
						const ownersB = cardOwnership.get(b)!.length
						if (ownersA !== ownersB) return ownersA - ownersB

						const costA = costs[cardOwnership.get(a)![0].category] || 0
						const costB = costs[cardOwnership.get(b)![0].category] || 0
						return costA - costB
					})
				}

				sortBucket(highBucket)
				sortBucket(lowBucket)

				const assignments: Array<{
					nation: string
					id: string
					season: string
					nsp?: string
					cost: number
					target: string
				}> = []
				const remainingGifts: Array<{ id: string; season: string; owners: string[] }> = []

				const processBucket = (bucket: string[], target: string) => {
					for (const key of bucket) {
						const potentialOwners = cardOwnership.get(key)!
						const cost = costs[potentialOwners[0].category] || 0

						const eligible = potentialOwners.filter((o) => puppetVirtualBanks.get(o.nation)! >= cost)
						if (eligible.length > 0) {
							eligible.sort(
								(a, b) => puppetVirtualBanks.get(b.nation)! - puppetVirtualBanks.get(a.nation)!
							)
							const choice = eligible[0]
							const [id, season] = key.split(',')
							assignments.push({ nation: choice.nation, id, season, nsp: choice.nsp, cost, target })
							puppetVirtualBanks.set(choice.nation, puppetVirtualBanks.get(choice.nation)! - cost)
						} else {
							const [id, season] = key.split(',')
							remainingGifts.push({ id, season, owners: potentialOwners.map((o) => o.nation) })
						}
					}
				}

				processBucket(highBucket, highValueTarget)
				processBucket(lowBucket, lowValueTarget)

				info = [
					...info.slice(-100),
					{
						text: `Allocated ${assignments.length} gifts (${highBucket.length} high, ${lowBucket.length} low). ${remainingGifts.length} cards skipped due to bank limits.`,
					},
				]
				for (let i = 0; i < assignments.length; i++) {
					if (stopped || abortController.signal.aborted) break
					const { nation, id, season, nsp, target } = assignments[i]
					progress = [
						...progress.slice(-100),
						{
							text: `Gifting ${id} (S${season}) to ${target} from ${nation} (${i + 1}/${assignments.length})`,
						},
					]

					const xpin = perNationXPins.get(nation) || ''
					const { success, xpin: newXpin } = await attemptGift({
						nation,
						id,
						season,
						main,
						xpin,
						nsp,
						password,
						overrideGiftee: target,
						gifteeList: [],
					})

					if (newXpin) perNationXPins.set(nation, newXpin)
					if (success) {
						findCount++
					} else {
						failedGiftCount++
						remainingGifts.push({ id, season, owners: [nation] })
					}
				}

				if (remainingGifts.length > 0) {
					for (const gift of remainingGifts) {
						content.push({
							url: `${domain}/page=deck/card=${gift.id}/season=${gift.season}?${urlParameters(
								'Finder',
								main
							)}`,
							tableText: `Remaining: ${gift.id} (S${gift.season}) on ${gift.owners.join(', ')}`,
						})
					}
					downloadable = true
				}
			}
		}
		progress = [
			...progress,
			{
				text: `Finished processing, found ${findCount} uniques, ${mode === 'Gift' ? `with ${failedGiftCount} failed gifts` : `on mode ${mode}.`}`,
				color: 'green',
			},
		]
		downloadable = true
		stoppable = false
	}

	async function fetchPreset(name: string) {
		const presets: {
			[key: string]: string | { [key: string]: string }
		} = await import('$lib/data/finderPresets.json')

		finderlist = presets[name] as string
	}
</script>

<ToolContent
	toolTitle="Finder"
	icon="🔎"
	caption="Find which of the specified nations have which of the specified cards."
	author="Kractero"
	link="https://github.com/Kractero/cards-utilities/blob/main/finder.py"
	additional={`<p class="mb-2">
	<strong>Specific Mode</strong> - Gifting specific cards based on their id,season. <br>
	<strong>General Mode</strong> - Gifting legendaries and cards over a certain mv. <br>
	<strong>1949 Shanghai Mode</strong> - Exfiltrates the most unique cards possible from the puppets list that you don't already own on other puppets.
	</p>
	<p class="mb-2">
	When gifting specific cards, you can specify the nation to gift to with CARDID,SEASON,GIFTTO instead of CARDID,SEASON on each line.
	GIFTTO will overrule the Gift To nation if provided. SEASON must be provided.
</p>
<p class="mb-2">
	For optimal use, you should use the
	<a class="underline" href="https://raw.githubusercontent.com/Kractero/userscripts/refs/heads/main/finderJDJDefault.user.js" target="_blank" rel="noreferrer noopener">
		finder gift default
	</a>
	userscript when gifting.
</p>
<p class="text-xs mb-16">
	Password input for gifting is optional and will be disabled if the puppet list includes a comma for nation,password.
</p>`} />

<div class="flex flex-col gap-8 break-normal lg:w-5xl lg:max-w-5xl lg:flex-row">
	<form onsubmit={onSubmit} class="flex flex-col gap-8">
		<InputCredentials
			bind:errors
			bind:main
			bind:puppets
			bind:password
			authenticated={mode.includes('Gift') ? true : false} />
		{#if mode.includes('Gift') && findMode !== '1949 Shanghai Mode'}
			<FormTextArea label={'Gift To'} bind:bindValue={giftee} id="giftee" required={true} />
		{/if}
		<FormSelect
			bind:bindValue={findMode}
			id="findMode"
			items={['Specific Cards', 'General', '1949 Shanghai Mode']}
			label="Behavior" />
		{#if findMode === 'Specific Cards'}
			<div class="-mb-6 flex flex-col">
				<p class="text-muted-foreground mb-1 text-center font-light">Presets</p>
				<div class="flex flex-wrap justify-center">
					<Button tabindex={-1} onclick={() => fetchPreset('Legendaries')} variant={'outline'}>Legendaries</Button>
					<Button tabindex={-1} onclick={() => fetchPreset('Fauzjhia')} variant={'outline'}>Fauzjhia</Button>
					<Button tabindex={-1} onclick={() => fetchPreset('Mikeswill')} variant={'outline'}>Mikeswill</Button>
					<Button tabindex={-1} onclick={() => fetchPreset('Apexiala')} variant={'outline'}>Apexiala</Button>
					<Button tabindex={-1} onclick={() => fetchPreset('Dr_Hooves')} variant={'outline'}>Dr Hooves</Button>
				</div>
			</div>
			<FormTextArea bind:bindValue={finderlist} label={'Cards to Find'} id="finderlist" required />
		{:else if findMode === 'General'}
			<FinderRaritySeason bind:config={finderConfig} />
			<FormInput bind:bindValue={giftOverMVValue} id="giftOverMVValue" label="Gift Over MV" />
		{:else if findMode === '1949 Shanghai Mode'}
			<div class="flex flex-col gap-4">
				<FormInput
					label={'High Value Target'}
					bind:bindValue={highValueTarget}
					id="highValueTarget"
					required={true} />
				<FormInput
					label={'Low Value Target'}
					bind:bindValue={lowValueTarget}
					id="lowValueTarget"
					required={true} />
			</div>
			<FormTextArea
				label={'Exclusion Nations'}
				bind:bindValue={exclusionNations}
				id="exclusionNations"
				required={true} />
			<Rarities label="High Value MV Thresholds" bind:rarities={highValueThresholds} />
			<FinderRaritySeason bind:config={finderConfig} />
		{/if}
		{#if findMode !== '1949 Shanghai Mode'}
			<FormSelect
				bind:bindValue={mode}
				id="mode"
				items={['Gift', 'Sell', 'Gift One', 'Sell One']}
				label="Gift Behavior" />
			{#if findMode === 'Specific Cards' && ['Gift', 'Sell'].includes(mode)}
				<FormInput bind:bindValue={keepOne} id="keepOne" label="Keep X Copy" />
			{/if}
		{/if}
		<div class="flex max-w-lg justify-center gap-2">
			<Buttons
				stopButton={true}
				bind:stopped
				bind:stoppable
				downloadButton={true}
				bind:downloadable
				bind:content
				type="html"
				name="Finder">
				<OpenButton bind:progress bind:openNewLinkArr={content} {stopped} {stoppable} />
			</Buttons>
		</div>
	</form>
	<Terminal bind:progress bind:info />
</div>
