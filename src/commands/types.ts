import type { Context, Logger } from 'koishi'
import type { Config } from '../types'
import type { BangumiService } from '../services/bangumi'
import type { SubscriptionService } from '../services/subscription'

export interface CommandDeps {
  ctx: Context
  config: Config
  logger: Logger
  bangumiService: BangumiService
  subscriptionService: SubscriptionService
}
