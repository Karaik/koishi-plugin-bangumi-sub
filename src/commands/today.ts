import { h } from 'koishi'
import type { Command } from 'koishi'
import type { CommandDeps } from './types'
import { formatTemplate } from '../utils/template'

export function registerTodayCommand(parent: Command, deps: CommandDeps) {
  const { config, logger, bangumiService } = deps
  const { messages } = config
  const weekNames = messages.weekNames
  const todayMessages = messages.today

  parent.subcommand('今日新番', '查询今天播出的所有新番')
    .action(async ({ session }) => {
      // 引用原消息并发送提示
      const statusMessage = await session.send(
        h('quote', { id: session.messageId }) + formatTemplate(todayMessages.status, {})
      )
      
      try {
        const allItems = await bangumiService.fetchCalendarData()
        if (!allItems.length) {
          // 数据获取失败，不撤回状态消息
          return formatTemplate(todayMessages.fetchError, {})
        }

        // 获取今天是星期几：周一(1) - 周日(7)
        const jsDay = new Date().getDay()
        const todayWeekday = jsDay === 0 ? 7 : jsDay

        // 筛选今天播出的番剧
        const todayItems = allItems.filter(item => item.weekday === todayWeekday)

        if (config.debug) {
          logger.info(`Today is ${weekNames[todayWeekday]} (${todayWeekday}), found ${todayItems.length} items`)
          logger.info(`Today's item IDs: ${todayItems.map(item => item.id).join(', ')}`)
        }

        if (todayItems.length === 0) {
          // 没有数据，不撤回状态消息
          return formatTemplate(todayMessages.noItems, { weekday: weekNames[todayWeekday] })
        }

        // 按播出时间排序（将没有解析到时间格式的排在后面）
        todayItems.sort((a, b) => {
          const timeA = a.airTime?.time || '99:99'
          const timeB = b.airTime?.time || '99:99'
          return timeA.localeCompare(timeB)
        })

        const title = formatTemplate(todayMessages.title, {
          weekday: weekNames[todayWeekday],
          date: new Date().toLocaleDateString('zh-CN'),
        })

        // 默认以图片表格形式输出
        let result: any
        if (config.detailsForToday) {
          // 同时输出表格图片和详细信息
          const tableImage = await bangumiService.renderHtmlTable(todayItems, title, false)
          await session.send(tableImage)
          
          // 发送详细信息
          result = await bangumiService.sendDetailedBangumiInfo(todayItems, title)
        } else {
          // 只输出表格图片
          result = await bangumiService.renderHtmlTable(todayItems, title, false)
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
        logger.error(`处理今日新番请求时发生错误:`, error)
        // 发生错误，不撤回状态消息，让用户看到查询过程
        return formatTemplate(todayMessages.error, {})
      }
    })
}
