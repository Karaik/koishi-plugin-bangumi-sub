import type { Command } from 'koishi'
import type { CommandDeps } from './types'
import { formatTemplate } from '../utils/template'

export function registerTestCommand(parent: Command, deps: CommandDeps) {
  const { ctx, subscriptionService, config } = deps
  const testMessages = config.messages.test

  parent.subcommand('订阅推送测试', '立即推送当前群组的所有订阅作为测试')
    .action(async ({ session }) => {
      const subscriptions = await ctx.database.get('bangumi_sub', {
        channelId: session.channelId,
      })

      if (subscriptions.length === 0) {
        return formatTemplate(testMessages.empty, {})
      }

      await session.send(formatTemplate(testMessages.start, {}))
      let successCount = 0
      for (const sub of subscriptions) {
        if (await subscriptionService.sendPushNotification(sub, true)) {
          successCount++
        }
        // 短暂延迟以避免消息刷屏
        await new Promise(r => setTimeout(r, 1000))
      }

      return formatTemplate(testMessages.result, {
        success: successCount,
        total: subscriptions.length,
      })
    })
}
