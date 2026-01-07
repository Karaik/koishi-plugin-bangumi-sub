import { h } from 'koishi'
import type { Command } from 'koishi'
import type { CommandDeps } from './types'
import { formatTemplate } from '../utils/template'

export function registerWeekCommand(parent: Command, deps: CommandDeps) {
  const { config, logger, bangumiService } = deps
  const weekMessages = config.messages.week

  parent.subcommand('本周新番', '查询本周播出的所有新番（按星期分类）')
    .action(async ({ session }) => {
      // 引用原消息并发送提示
      const statusMessage = await session.send(
        h('quote', { id: session.messageId }) + formatTemplate(weekMessages.status, {})
      )
      
      try {
        const allItems = await bangumiService.fetchCalendarData()
        if (!allItems.length) {
          // 数据获取失败，不撤回状态消息
          return formatTemplate(weekMessages.fetchError, {})
        }

        // 按星期和播出时间排序
        allItems.sort((a, b) => {
          if (a.weekday !== b.weekday) {
            return a.weekday - b.weekday
          }
          // 在同一天内按播出时间排序
          const timeA = a.airTime?.time || '99:99'
          const timeB = b.airTime?.time || '99:99'
          return timeA.localeCompare(timeB)
        })

        const result = await bangumiService.renderHtmlTable(
          allItems,
          formatTemplate(weekMessages.title, { date: new Date().toLocaleDateString('zh-CN') }),
          true,
        )
        
        // 成功完成所有操作，撤回状态消息
        if (statusMessage) {
          try {
            await session.bot.deleteMessage(session.channelId, statusMessage[0])
          } catch (e) {
            if (config.debug) logger.warn('撤回状态消息失败:', e)
          }
        }

        return result
      } catch (error) {
        logger.error(`处理本周新番请求时发生错误:`, error)
        // 发生错误，不撤回状态消息，让用户看到查询过程
        return formatTemplate(weekMessages.error, {})
      }
    })
}
