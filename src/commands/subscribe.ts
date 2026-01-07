import { h } from 'koishi'
import type { Command } from 'koishi'
import type { CommandDeps } from './types'
import { formatTemplate } from '../utils/template'

export function registerSubscribeCommand(parent: Command, deps: CommandDeps) {
  const { ctx, config, logger, bangumiService } = deps
  const { messages } = config
  const subscribeMessages = messages.subscribe
  const weekNames = messages.weekNames

  parent.subcommand('订阅 <bangumiId:string>', '订阅指定番剧的播出提醒')
    .action(async ({ session }, bangumiId) => {
      if (!bangumiId || !/^\d+$/.test(bangumiId)) {
        return formatTemplate(subscribeMessages.invalidId, {})
      }

      // 引用原消息并发送提示
      const statusMessage = await session.send(
        h('quote', { id: session.messageId }) + formatTemplate(subscribeMessages.status, { id: bangumiId })
      )

      try {
        // 从当前数据中查找番剧信息
        const allItems = await bangumiService.fetchCalendarData()
        const bangumi = allItems.find(item => item.id === bangumiId)
        
        if (!bangumi) {
          return formatTemplate(subscribeMessages.notFound, { id: bangumiId })
        }

        // 检查是否已经订阅
        const existing = await ctx.database.get('bangumi_sub', {
          bangumiId: bangumiId,
          channelId: session.channelId
        })

        if (existing.length > 0) {
          return formatTemplate(subscribeMessages.already, { title: bangumi.title_cn || bangumi.title })
        }

        // 添加订阅
        await ctx.database.create('bangumi_sub', {
          bangumiId: bangumiId,
          channelId: session.channelId,
          bangumiTitle: bangumi.title,
          bangumiTitleCn: bangumi.title_cn,
          weekday: bangumi.weekday,
          airTime: bangumi.airTime?.time || messages.detail.timeUnknown,
          subscribedAt: new Date()
        })

        // 成功完成操作，撤回状态消息
        if (statusMessage) {
          try {
            await session.bot.deleteMessage(session.channelId, statusMessage[0])
          } catch (e) {
            if (config.debug) logger.warn('撤回状态消息失败:', e)
          }
        }

        return formatTemplate(subscribeMessages.success, {
          title: bangumi.title_cn || bangumi.title,
          weekday: weekNames[bangumi.weekday] || messages.detail.unknown,
          time: bangumi.airTime?.time || messages.detail.timeUnknown,
        })

      } catch (error) {
        logger.error(`处理番剧订阅请求时发生错误:`, error)
        return formatTemplate(subscribeMessages.error, {})
      }
    })
}
