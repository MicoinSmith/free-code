import type { LocalCommandCall } from '../../types/command.js'
import { getCompanion, roll, petCompanion, rollWithSeed } from '../../buddy/companion.js'
import { companionUserId } from '../../buddy/companion.js'
import { getGlobalConfig, saveGlobalConfig } from '../../utils/config.js'
import { RARITY_STARS, RARITY_COLORS } from '../../buddy/types.js'

export const call: LocalCommandCall = async (args, extra) => {
  const config = getGlobalConfig()
  const stored = config.companion
  const trimmed = args.trim()

  if (trimmed === 'pet' && stored) {
    petCompanion()
    return { type: 'text', value: '' }
  }

  const seedOverride = trimmed || undefined

  if (trimmed && stored) {
    // User provided args → reroll with that as seed and persist
    const config = getGlobalConfig()
    const { bones } = rollWithSeed(trimmed)
    saveGlobalConfig((c) => ({
      ...c,
      companion: {
        name: bones.species,
        personality: 'friendly',
        hatchedAt: Date.now(),
      },
    }))
    const stars = RARITY_STARS[bones.rarity]
    return {
      type: 'text',
      value: `Rerolled! 🎲\n${bones.species} ${stars} — Rarity: ${bones.rarity}${bones.shiny ? ' ✨ SHINY' : ''}\nAsk the model to name them!`,
    }
  }

  const companion = getCompanion(seedOverride)

  if (!stored && companion) {
    saveGlobalConfig((c) => ({
      ...c,
      companion: {
        name: 'Buddy',
        personality: 'friendly',
        hatchedAt: Date.now(),
      },
    }))
    const stars = RARITY_STARS[companion.rarity]
    return {
      type: 'text',
      value: `A wild ${companion.species} appeared! 🎉\n${companion.species} ${stars} — Rarity: ${companion.rarity}${companion.shiny ? ' ✨ SHINY' : ''}\nAsk the model to name them!`,
    }
  }

  if (!companion) {
    const userId = config.oauthAccount?.accountUuid ?? config.userID ?? 'anon'
    const { bones } = roll(userId)
    saveGlobalConfig((c) => ({
      ...c,
      companion: {
        name: 'Buddy',
        personality: 'curious',
        hatchedAt: Date.now(),
      },
    }))
    const stars = RARITY_STARS[bones.rarity]
    return {
      type: 'text',
      value: `A wild ${bones.species} appeared! 🎉\n${bones.species} ${stars} — Rarity: ${bones.rarity}${bones.shiny ? ' ✨ SHINY' : ''}\nAsk the model to name them!`,
    }
  }

  const stars = RARITY_STARS[companion.rarity]
  return {
    type: 'text',
    value: `${companion.name} — ${companion.species} ${stars}\nPersonality: ${companion.personality}\nRarity: ${companion.rarity}${companion.shiny ? ' ✨ SHINY' : ''}\n\nTip: type /buddy <anything> to reroll!`,
  }
}
