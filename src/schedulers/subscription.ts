import type { Context, Logger } from 'koishi'
import type { Config } from '../types'
import type { SubscriptionService } from '../services/subscription'

export function setupSubscriptionScheduler(
  ctx: Context,
  config: Config,
  logger: Logger,
  subscriptionService: SubscriptionService,
) {
  const subscriptionInterval = setInterval(
    subscriptionService.checkAndPushSubscriptions,
    config.subscriptionInterval * 60 * 1000,
  )
  
  // 插件销毁时清理定时器
  ctx.on('dispose', () => {
    clearInterval(subscriptionInterval)
    logger.info('[订阅推送] 定时器已清理')
  })
}
