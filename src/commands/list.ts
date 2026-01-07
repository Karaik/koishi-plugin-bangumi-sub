import type { Command } from 'koishi'
import type { CommandDeps } from './types'
import { formatTemplate } from '../utils/template'

export function registerListCommand(parent: Command, deps: CommandDeps) {
  const { ctx, logger, config } = deps
  const { messages } = config
  const listMessages = messages.list
  const weekNames = messages.weekNames

  parent.subcommand('查看订阅', '查看当前群组的所有番剧订阅')
    .action(async ({ session }) => {
      try {
        const subscriptions = await ctx.database.get('bangumi_sub', {
          channelId: session.channelId
        })

        if (subscriptions.length === 0) {
          return formatTemplate(listMessages.empty, {})
        }

        const subList = subscriptions.map((sub, index) => {
          const weekday = weekNames[sub.weekday] || messages.detail.unknown
          return formatTemplate(listMessages.item, {
            index: index + 1,
            title: sub.bangumiTitleCn || sub.bangumiTitle,
            weekday,
            time: sub.airTime,
            id: sub.bangumiId,
          })
        }).join('\n\n')

        return formatTemplate(listMessages.header, {
          list: subList,
          count: subscriptions.length,
        })

      } catch (error) {
        logger.error(`查看订阅时发生错误:`, error)
        return formatTemplate(listMessages.error, {})
      }
    })
}
