import type { Command } from 'koishi'
import type { CommandDeps } from './types'
import { formatTemplate } from '../utils/template'

export function registerClearCommand(parent: Command, deps: CommandDeps) {
  const { ctx, logger, config } = deps
  const clearMessages = config.messages.clear

  parent.subcommand('清空订阅', '清空当前群组的所有番剧订阅')
    .action(async ({ session }) => {
      try {
        await ctx.database.remove('bangumi_sub', { channelId: session.channelId })
        return formatTemplate(clearMessages.success, {})
      } catch (error) {
        logger.error(`清空订阅时发生错误:`, error)
        return formatTemplate(clearMessages.error, {})
      }
    })
}
