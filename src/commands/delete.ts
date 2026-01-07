import type { Command } from 'koishi'
import type { CommandDeps } from './types'
import { formatTemplate } from '../utils/template'

export function registerDeleteCommand(parent: Command, deps: CommandDeps) {
  const { ctx, logger, config } = deps
  const deleteMessages = config.messages.delete

  parent.subcommand('删除订阅 <index:posint>', '删除指定序号的番剧订阅')
    .action(async ({ session }, index) => {
      try {
        const subscriptions = await ctx.database.get('bangumi_sub', {
          channelId: session.channelId
        })

        if (subscriptions.length === 0) {
          return formatTemplate(deleteMessages.empty, {})
        }

        if (index > subscriptions.length) {
          return formatTemplate(deleteMessages.invalidIndex, { max: subscriptions.length })
        }

        // 序号从1开始，数组索引从0开始
        const subToDelete = subscriptions[index - 1]
        await ctx.database.remove('bangumi_sub', { id: subToDelete.id })

        return formatTemplate(deleteMessages.success, {
          title: subToDelete.bangumiTitleCn || subToDelete.bangumiTitle,
        })

      } catch (error) {
        logger.error(`删除订阅时发生错误:`, error)
        return formatTemplate(deleteMessages.error, {})
      }
    })
}
