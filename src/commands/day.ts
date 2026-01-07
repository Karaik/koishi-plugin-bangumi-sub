import { h } from 'koishi'
import type { Command } from 'koishi'
import type { CommandDeps } from './types'
import { formatTemplate } from '../utils/template'

export function registerDayCommand(parent: Command, deps: CommandDeps) {
  const { config, logger, bangumiService } = deps
  const { messages } = config
  const dayMessages = messages.day
  const weekNames = messages.weekNames

  parent.subcommand('查看新番 <day:posint>', '查看指定星期几的新番（1-7，1为周一，7为周日）')
    .action(async ({ session }, day) => {
      if (!day || day < 1 || day > 7) {
        return formatTemplate(dayMessages.invalidDay, {})
      }

      // 引用原消息并发送提示
      const dayName = weekNames[day]
      const statusMessage = await session.send(
        h('quote', { id: session.messageId }) + formatTemplate(dayMessages.status, { weekday: dayName })
      )

      try {
        const allItems = await bangumiService.fetchCalendarData()
        if (!allItems.length) {
          // 数据获取失败，不撤回状态消息
          return formatTemplate(dayMessages.fetchError, {})
        }

        // 筛选指定星期几播出的番剧
        const dayItems = allItems.filter(item => item.weekday === day)

        if (config.debug) {
          logger.info(`${dayName} (${day}), found ${dayItems.length} items`)
          logger.info(`${dayName} item IDs: ${dayItems.map(item => item.id).join(', ')}`)
        }

        if (dayItems.length === 0) {
          // 没有数据，不撤回状态消息
          return formatTemplate(dayMessages.noItems, { weekday: dayName })
        }

        // 按播出时间排序（将没有解析到时间格式的排在后面）
        dayItems.sort((a, b) => {
          const timeA = a.airTime?.time || '99:99'
          const timeB = b.airTime?.time || '99:99'
          return timeA.localeCompare(timeB)
        })

        const title = formatTemplate(dayMessages.title, {
          weekday: dayName,
          date: new Date().toLocaleDateString('zh-CN'),
        })

        // 默认以图片表格形式输出
        let result: any
        if (config.detailsForToday) {
          // 同时输出表格图片和详细信息
          const tableImage = await bangumiService.renderHtmlTable(dayItems, title, false)
          await session.send(tableImage)

          // 发送详细信息
          result = await bangumiService.sendDetailedBangumiInfo(dayItems, title)
        } else {
          // 只输出表格图片
          result = await bangumiService.renderHtmlTable(dayItems, title, false)
        }

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
        logger.error(`处理查看新番请求时发生错误:`, error)
        // 发生错误，不撤回状态消息，让用户看到查询过程
        return formatTemplate(dayMessages.error, {})
      }
    })
}
