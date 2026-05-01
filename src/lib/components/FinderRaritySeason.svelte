<script lang="ts">
	import Checkbox from './ui/checkbox/checkbox.svelte'

	interface Props {
		config: Record<string, number[]>
	}

	let { config = $bindable() }: Props = $props()

	const rarities = ['common', 'uncommon', 'rare', 'ultra-rare', 'epic', 'legendary']
	const seasons = [1, 2, 3, 4]

	function handleToggle(rarity: string, season: number, checked: boolean | 'indeterminate') {
		if (checked === true) {
			if (!config[rarity].includes(season)) {
				config[rarity] = [...config[rarity], season]
			}
		} else if (checked === false) {
			config[rarity] = config[rarity].filter((s) => s !== season)
		}
	}
</script>

<div class="flex flex-col gap-2 rounded-lg border p-4">
	<div class="grid grid-cols-[1fr_repeat(4,40px)] items-center gap-2">
		<div class="text-xs font-bold uppercase text-muted-foreground">Rarity</div>
		{#each seasons as season}
			<div class="text-center text-xs font-bold text-muted-foreground">S{season}</div>
		{/each}
	</div>
	{#each rarities as rarity}
		<div class="grid grid-cols-[1fr_repeat(4,40px)] items-center gap-2 border-t py-1 last:border-b-0">
			<div class="text-sm font-medium capitalize">{rarity.replace('-', ' ')}</div>
			{#each seasons as season}
				<div class="flex justify-center">
					<Checkbox
						checked={config[rarity].includes(season)}
						onCheckedChange={(val) => handleToggle(rarity, season, val)} />
				</div>
			{/each}
		</div>
	{/each}
</div>
