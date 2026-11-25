<script lang="ts">
	import { onDestroy, onMount } from 'svelte'
	import { page } from '$app/state'
	import Buttons from '$lib/components/Buttons.svelte'
	import OpenButton from '$lib/components/buttons/OpenButton.svelte'
	import FormCheckbox from '$lib/components/FormCheckbox.svelte'
	import FormSelect from '$lib/components/FormSelect.svelte'
	import InputCredentials from '$lib/components/InputCredentials.svelte'
	import Terminal from '$lib/components/Terminal.svelte'
	import ToolContent from '$lib/components/ToolContent.svelte'
	import { parseXML } from '$lib/helpers/parser'
	import { checkUserAgent, pushHistory, urlParameters } from '$lib/helpers/utils'
	import type { Issue } from '$lib/types'

	type QueuedLink = { url: string; tableText: string; linkStyle?: string; nationIndex?: number }
	type Puppet = { nation: string; password: string }

	const BUFFER_AHEAD = 5

	const abortController = new AbortController()
	let domain = ''
	let info = $state<Array<{ text: string; color?: string }>>([])
	let progress = $state<Array<{ text: string; color?: string }>>([])
	let counter = $state(0)
	let downloadable = $state(false)
	let content = $state<QueuedLink[]>([])
	let stoppable = $state(false)
	let stopped = $state(false)
	let main = $state('')
	let puppets = $state('')
	let password = $state('')
	let mode = $state('')
	let issueCount = $state('5')
	let packCount = $state('All')
	let minPack = $state('0')
	let autoclosepacks = $state(true)
	let fetchOnDemand = $state(false)
	let errors: Array<{ field: string | number; message: string }> = $state([])
	let testmode: string | null

	let puppetList: Array<Puppet> = []
	let runConfig = { main: '', password: '', mode: 'Both', issueCount: '5', packCount: '9', minPack: '0' }
	let nextNationIndex = 0
	let currentNationIndex = 0
	let issuesCount = 0
	let packsCount = 0
	let onDemandRun = false
	let fetching = false
	let runId = 0

	onMount(() => {
		domain = `https://www.nationstates.net`
		main = page.url.searchParams.get('main') || (localStorage.getItem('main') as string) || ''
		puppets = (localStorage.getItem('gotissuesPuppets') as string) || ''
		password = (localStorage.getItem('password') as string) || ''
		mode = page.url.searchParams.get('mode') || (localStorage.getItem('gotissuesMode') as string) || 'Both'
		issueCount = page.url.searchParams.get('count') || (localStorage.getItem('gotissuesIssueCount') as string) || '5'
		packCount =
			page.url.searchParams.get('packCount') || (localStorage.getItem('gotissuesPackCount') as string) || 'All'
		minPack = page.url.searchParams.get('minPack') || (localStorage.getItem('gotissuesMinPack') as string) || '0'
		fetchOnDemand =
			(page.url.searchParams.get('fetchOnDemand') ?? (localStorage.getItem('gotissuesFetchOnDemand') as string)) ===
			'true'
		testmode = page.url.searchParams.get('test')
		autoclosepacks = Boolean(
			page.url.searchParams.get('autoclosepacks') || localStorage.getItem('gotissuesAutoclosePacks') || true
		)
	})
	onDestroy(() => abortController.abort())

	function parsePuppets(): Array<Puppet> {
		return puppets.split('\n').map(entry => {
			let nation = entry
			let nationSpecificPassword = ''
			if (nation.includes(',')) {
				nation = entry.split(',')[0]
				nationSpecificPassword = entry.split(',')[1]
			}
			return { nation, password: nationSpecificPassword }
		})
	}

	async function addNation(index: number, run: number): Promise<Array<QueuedLink>> {
		const packLinks: Array<QueuedLink> = []
		if (run !== runId || stopped || abortController.signal.aborted) return packLinks
		const { nation, password: nationSpecificPassword } = puppetList[index]
		if (!nation) return packLinks
		const nation_formatted = nation.toLowerCase().replaceAll(' ', '_')
		try {
			progress = [...progress, { text: `Processing ${nation} ${index + 1}/${puppetList.length}` }]
			const xmlObj = await parseXML(
				`${domain}/cgi-bin/api.cgi?nation=${nation}&q=issues+packs`,
				runConfig.main,
				nationSpecificPassword ? nationSpecificPassword : runConfig.password
			)
			if (run !== runId || stopped || abortController.signal.aborted) return packLinks
			const packs = xmlObj.NATION.PACKS

			if (runConfig.mode === 'Both' || runConfig.mode === 'Issues') {
				if (packs && packs >= 9) {
					info = [...info, { text: `${nation} has over 9 packs, skipping issues`, color: 'blue' }]
				} else {
					const issues: Issue = xmlObj.NATION.ISSUES.ISSUE || []
					let issueIds: Array<string> = []
					if (!Array.isArray(issues)) issueIds.push(issues['@_id'])
					else issueIds = issues.map(issue => issue['@_id'])

					if (testmode === 'test') {
						const limitedIssues = issueIds.slice(0, Number(runConfig.issueCount))
						const firstIssue = limitedIssues[0]

						if (firstIssue) {
							const remainingIssues = limitedIssues.slice(1).join(',')

							const singleLink = `${domain}/container=${nation_formatted}/nation=${nation_formatted}/page=show_dilemma/dilemma=${firstIssue}/template-overall=none?${
								remainingIssues ? `remainingIssues=${remainingIssues}&` : ''
							}${urlParameters('gotIssues', runConfig.main)}`

							content.push({
								url: singleLink,
								tableText: `Link to Issue`,
								nationIndex: index,
							})
							issuesCount += limitedIssues.length
						}
					} else {
						for (let i = 0; i < Math.min(issueIds.length, Number(runConfig.issueCount)); i++) {
							let issue = issueIds[i]
							content.push({
								url: `${domain}/container=${nation_formatted}/nation=${nation_formatted}/page=show_dilemma/dilemma=${issue}/template-overall=none?${urlParameters('gotIssues', runConfig.main)}`,
								tableText: `Link to Issue`,
								nationIndex: index,
							})
							issuesCount++
						}
					}
				}
			}
			if (runConfig.mode === 'Both' || runConfig.mode === 'Packs') {
				const packsToOpen = Math.min(packs - Number(runConfig.minPack), Number(runConfig.packCount))
				if (packs === 0) {
					if (runConfig.mode === 'Packs')
						progress = [...progress, { text: `${nation} has no packs, skipping!`, color: 'blue' }]
					return packLinks
				}
				if (packs >= Number(runConfig.minPack)) {
					const target = !onDemandRun && runConfig.mode === 'Both' ? packLinks : content
					if (packsToOpen < packs) {
						const basePage = `${domain}/page=deck/nation=${nation_formatted}?close=me&${urlParameters('gotIssues', runConfig.main)}`
						target.push({ url: basePage, tableText: 'Base Page', nationIndex: index })
					}
					for (let i = 0; i < packsToOpen; i++) {
						const packLink = `${domain}/page=deck/container=${nation_formatted}/nation=${nation_formatted}?${urlParameters('gotIssues', runConfig.main)}`
						target.push({
							url: packLink,
							tableText: `Link to Pack`,
							nationIndex: index,
						})
						packsCount++
					}
				} else {
					info = [...info, { text: `${nation} has less packs than ${runConfig.minPack}, skipping!`, color: 'blue' }]
				}
			}
		} catch (err) {
			if (run === runId && !stopped) info = [...info, { text: `Error processing ${nation} with ${err}`, color: 'red' }]
		}
		return packLinks
	}

	async function refillQueue(run: number) {
		if (!onDemandRun || fetching || stopped || run !== runId) return
		fetching = true
		let fetchedAny = false
		try {
			while (run === runId && !stopped && !abortController.signal.aborted && nextNationIndex < puppetList.length) {
				const withinBuffer = nextNationIndex <= currentNationIndex + BUFFER_AHEAD
				const needsFirstLink = content.length === 0
				if (!withinBuffer && !needsFirstLink) break

				if (!fetchedAny) {
					fetchedAny = true
					if (progress.at(-1)?.text.startsWith('Buffered ')) {
						progress = progress.slice(0, -1)
					}
				}

				const index = nextNationIndex
				nextNationIndex++
				await addNation(index, run)
			}
		} finally {
			if (run === runId) {
				fetching = false
				if (onDemandRun && !stopped) {
					if (nextNationIndex >= puppetList.length && stoppable) {
						stoppable = false
						progress = [
							...progress,
							{
								text: `Finished processing ${puppetList.length} nations, equaling ${issuesCount} issues and ${packsCount} packs!`,
								color: 'green',
							},
						]
					} else if (fetchedAny) {
						progress = [
							...progress,
							{
								text: `Buffered ${nextNationIndex}/${puppetList.length} nations, equaling ${issuesCount} issues and ${packsCount} packs.`,
								color: 'green',
							},
						]
					}
				}
			}
		}
	}

	function handleOpen(item: QueuedLink) {
		if (!onDemandRun) return
		if (typeof item.nationIndex === 'number') {
			currentNationIndex = Math.max(currentNationIndex, item.nationIndex)
		}
		void refillQueue(runId)
	}

	async function onSubmit(e: Event) {
		e.preventDefault()
		pushHistory(
			`?main=${main}&mode=${mode}${mode === 'Issues' ? `&count=${issueCount}` : mode === 'Packs' ? `&packCount=${packCount}&minPack=${minPack}` : `&count=${issueCount}&packCount=${packCount}&minPack=${minPack}&autoclose=${autoclosepacks}`}&fetchOnDemand=${fetchOnDemand}${testmode ? `&test=${testmode}` : ''}`
		)
		errors = checkUserAgent(main)
		if (errors.length > 0) return
		const run = ++runId
		fetching = false
		downloadable = false
		stoppable = true
		stopped = false
		progress = []
		info = [
			{
				text: `Initiating gotIssues...mode set to ${mode} for ${mode === 'Issues' ? `${issueCount} issues` : `${packCount} packs`}`,
			},
		]
		counter = 0
		content = []
		localStorage.removeItem('ns_remainingIssues')
		puppetList = parsePuppets()
		mode = mode.charAt(0).toUpperCase() + mode.slice(1)
		runConfig = {
			main,
			password,
			mode,
			issueCount,
			packCount: packCount === 'All' ? '9' : packCount,
			minPack,
		}
		onDemandRun = fetchOnDemand
		nextNationIndex = 0
		currentNationIndex = 0
		issuesCount = 0
		packsCount = 0

		if (onDemandRun) {
			info = [
				...info,
				{
					text: `Fetch on Demand enabled, buffering ${BUFFER_AHEAD} nations ahead.`,
					color: 'blue',
				},
			]
			await refillQueue(run)
			return
		}

		let packContent: Array<QueuedLink> = []
		for (let i = 0; i < puppetList.length; i++) {
			if (run !== runId || abortController.signal.aborted || stopped) break
			packContent.push(...(await addNation(i, run)))
		}
		if (run !== runId) return
		content = [...content, ...packContent]
		progress = [
			...progress,
			{
				text: `Finished processing ${puppetList.length} nations, equaling ${issuesCount} issues and ${packsCount} packs!`,
				color: 'green',
			},
		]
		downloadable = true
		stoppable = false
	}
</script>

<ToolContent
	toolTitle="gotIssues"
	icon="🗒️"
	caption="An even faster way to answer issues with JavaScript."
	author="9003"
	originalBlurb="rewritten in JS for browser use by Kractero"
	link="https://github.com/jmikk/gotIssues"
	additional={`<p class="text-xs mb-16">
	For optimal use, this script is intended to be used with
	<a class="underline" href="https://raw.githubusercontent.com/jmikk/gotIssues/master/autoclose%3D1.user.js" target="_blank" rel="noreferrer noopener">
		autoclose
	</a> and
	<a class="underline" href="https://github.com/dithpri/RCES/raw/master/userscripts/issue_answering/NsIssueCompactorRand.user.js" target="_blank" rel="noreferrer noopener">
		NSIssueCompactorRand
	</a>
</p>
<p class="text-xs mb-16">
	Password input is optional and will be disabled if the puppet list includes a comma for nation,password.
</p>
<p class="text-xs mb-16">
	Fetch on Demand only loads ${BUFFER_AHEAD} nations ahead as you open links instead of fetching everything up front.
	Sheet downloads are disabled in this mode.
</p>`} />

<div class="flex flex-col gap-8 break-normal lg:w-5xl lg:max-w-5xl lg:flex-row">
	<form onsubmit={onSubmit} class="flex flex-col gap-8">
		<InputCredentials bind:errors bind:main bind:puppets bind:password authenticated={true} />
		<FormSelect id="mode" label="Issues and Packs" bind:bindValue={mode} items={['Both', 'Issues', 'Packs']} />
		{#if mode === 'Issues' || mode === 'Both'}
			<FormSelect id="issueCount" label="Issues Count" bind:bindValue={issueCount} items={['1', '2', '3', '4', '5']} />
		{/if}
		{#if mode === 'Packs' || mode === 'Both'}
			<FormSelect
				id="packCount"
				label="Pack Count"
				bind:bindValue={packCount}
				items={['All', '1', '2', '3', '4', '5', '6', '7', '8', '9']} />
			<FormSelect
				id="minPack"
				label="Minimum Floor"
				subTitle={`Open ${packCount} packs on a nation up to the floor of ${minPack} packs. Always keep at least ${minPack} packs.`}
				bind:bindValue={minPack}
				items={['0', '1', '2', '3', '4', '5', '6', '7', '8', '9']} />
			<FormCheckbox bind:checked={autoclosepacks} id="autoclosepacks" label="Autoclose Packs" />
		{/if}
		<FormCheckbox
			bind:checked={fetchOnDemand}
			id="fetchOnDemand"
			label="Fetch on Demand"
			subTitle={`Only fetch ${BUFFER_AHEAD} nations ahead as you open links.`}
			disabled={stoppable} />
		<Buttons
			stopButton={true}
			bind:stopped
			bind:stoppable
			downloadButton={!fetchOnDemand}
			bind:downloadable
			bind:content
			name="gotIssues">
			<OpenButton bind:progress bind:openNewLinkArr={content} {stopped} {stoppable} onOpen={handleOpen} />
		</Buttons>
	</form>
	<Terminal bind:progress bind:info />
</div>
