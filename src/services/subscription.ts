import type { Context, Logger } from 'koishi'
import type { BangumiSubscription, Config } from '../types'
import { formatTemplate } from '../utils/template'

export interface SubscriptionService {
  sendPushNotification: (sub: BangumiSubscription, isTest?: boolean) => Promise<boolean>
  checkAndPushSubscriptions: () => Promise<void>
}

export function createSubscriptionService(ctx: Context, config: Config, logger: Logger): SubscriptionService {
  const { messages } = config
  const weekNames = messages.weekNames
  /**
   * 发送推送通知
   * @param sub 订阅对象
   * @param isTest 是否为测试
   * @returns {Promise<boolean>} 是否发送成功
   */
  async function sendPushNotification(sub: BangumiSubscription, isTest: boolean = false): Promise<boolean> {
    try {
      const title = isTest ? messages.push.testTitle : messages.push.title
      const message = formatTemplate(messages.push.message, {
        title,
        name: sub.bangumiTitleCn || sub.bangumiTitle,
        weekday: weekNames[sub.weekday],
        time: sub.airTime,
        url: `https://bgm.tv/subject/${sub.bangumiId}`,
      })

      // 发送到对应群组
      const bots = ctx.bots.filter(bot => bot.status === 1)
      if (bots.length > 0) {
        const bot = bots[0] // 使用第一个在线的机器人
        await bot.sendMessage(sub.channelId, message)

        if (config.debug) {
          logger.info(`[订阅推送] 已推送: ${sub.bangumiTitleCn || sub.bangumiTitle} 到群组 ${sub.channelId}`)
        }
        return true
      } else {
        logger.warn('[订阅推送] 没有在线的机器人可用于推送')
        return false
      }
    } catch (error) {
      logger.error(`[订阅推送] 推送失败 (群组: ${sub.channelId}, 番剧: ${sub.bangumiId}):`, error)
      return false
    }
  }

  // 定时检查和推送订阅
  async function checkAndPushSubscriptions() {
    if (config.debug) logger.info('[订阅推送] 开始检查番剧订阅...')
    
    try {
      const now = new Date()
      const intervalMillis = config.subscriptionInterval * 60 * 1000
      const lastCheckTime = new Date(now.getTime() - intervalMillis)

      const jsDay = now.getDay()
      const todayWeekday = jsDay === 0 ? 7 : jsDay
      
      if (config.debug) {
        logger.info(`[订阅推送] 检查时间范围: ${lastCheckTime.toLocaleTimeString()} - ${now.toLocaleTimeString()}, 星期: ${todayWeekday}`)
      }
      
      const todaySubscriptions = await ctx.database.get('bangumi_sub', {
        weekday: todayWeekday
      })
      
      if (todaySubscriptions.length === 0) {
        if (config.debug) logger.info('[订阅推送] 今天没有需要推送的订阅')
        return
      }
      
      let pushedCount = 0
      for (const sub of todaySubscriptions) {
        if (!sub.airTime || !/^\d{2}:\d{2}$/.test(sub.airTime)) continue

        const [hour, minute] = sub.airTime.split(':').map(Number)
        const airTimeDate = new Date(now)
        airTimeDate.setHours(hour, minute, 0, 0)

        // 检查播出时间是否在上次检查和现在之间
        if (airTimeDate > lastCheckTime && airTimeDate <= now) {
          if (await sendPushNotification(sub)) {
            pushedCount++
          }
        }
      }
      
      if (config.debug) {
        logger.info(`[订阅推送] 检查完成，共推送 ${pushedCount} 条提醒`)
      }
      
    } catch (error) {
      logger.error('[订阅推送] 检查订阅时发生错误:', error)
    }
  }

  return {
    sendPushNotification,
    checkAndPushSubscriptions,
  }
}
