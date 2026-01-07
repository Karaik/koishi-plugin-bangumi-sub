import type { Context } from 'koishi'
import type { CommandDeps } from './types'
import { registerClearCommand } from './clear'
import { registerDayCommand } from './day'
import { registerDeleteCommand } from './delete'
import { registerListCommand } from './list'
import { registerSubscribeCommand } from './subscribe'
import { registerTestCommand } from './test'
import { registerTodayCommand } from './today'
import { registerWeekCommand } from './week'

export function registerCommands(ctx: Context, deps: CommandDeps) {
  const parent = ctx.command('新番', '新番相关指令')
    .alias('番组订阅')
    .alias('番剧订阅')

  registerTodayCommand(parent, deps)
  registerWeekCommand(parent, deps)
  registerSubscribeCommand(parent, deps)
  registerListCommand(parent, deps)
  registerDeleteCommand(parent, deps)
  registerClearCommand(parent, deps)
  registerTestCommand(parent, deps)
  registerDayCommand(parent, deps)
}
