import { Context, Logger, Schema } from 'koishi'
// 确保项目中安装了 puppeteer 插件
import {} from 'koishi-plugin-puppeteer'
import { registerCommands } from './commands'
import { setupBangumiLinkMiddleware } from './middleware/bangumi-link'
import { setupSubscriptionScheduler } from './schedulers/subscription'
import { createBangumiService } from './services/bangumi'
import { createSubscriptionService } from './services/subscription'
import type { Config as PluginConfig } from './types'

// 插件名称
export const name = 'bangumi-sub'

// 依赖 puppeteer 服务和数据库
export const inject = ['puppeteer', 'database']

// 日志记录器
const logger = new Logger(name)

export type { Config } from './types'

const MessagesSchema = Schema.object({
  weekNames: Schema.array(String).default(['', '周一', '周二', '周三', '周四', '周五', '周六', '周日']),
  today: Schema.object({
    status: Schema.string().default('正在查询今日新番，请稍等...'),
    fetchError: Schema.string().default('获取番剧数据失败，请稍后再试。'),
    noItems: Schema.string().default('今天是{weekday}，似乎没有新番播出哦。'),
    error: Schema.string().default('查询过程中发生错误，请稍后再试。'),
    title: Schema.string().default('今日新番 ({weekday}) - {date}'),
  }).description('今日新番'),
  week: Schema.object({
    status: Schema.string().default('正在查询本周新番，请稍等...'),
    fetchError: Schema.string().default('获取番剧数据失败，请稍后再试。'),
    error: Schema.string().default('查询过程中发生错误，请稍后再试。'),
    title: Schema.string().default('本周新番 - {date}'),
  }).description('本周新番'),
  day: Schema.object({
    invalidDay: Schema.string().default('请输入有效的数字（1-7），1为周一，7为周日。'),
    status: Schema.string().default('正在查询{weekday}新番，请稍等...'),
    fetchError: Schema.string().default('获取番剧数据失败，请稍后再试。'),
    noItems: Schema.string().default('{weekday}似乎没有新番播出哦。'),
    error: Schema.string().default('查询过程中发生错误，请稍后再试。'),
    title: Schema.string().default('{weekday}新番 - {date}'),
  }).description('查看新番'),
  subscribe: Schema.object({
    invalidId: Schema.string().default('请输入有效的番剧 ID（纯数字）。'),
    status: Schema.string().default('正在查询番剧信息 (ID: {id})...'),
    notFound: Schema.string().default('找不到 ID 为 {id} 的番剧。请确认 ID 是否正确或该番剧是否为本季新番。'),
    already: Schema.string().default('番剧「{title}」已经在当前群组订阅过了。'),
    success: Schema.string().default('✅ 订阅成功！\n\n番剧：{title}\n播出时间：{weekday} {time}\n\n将在播出时间为您推送提醒。'),
    error: Schema.string().default('订阅过程中发生错误，请稍后再试。'),
  }).description('番剧订阅'),
  list: Schema.object({
    empty: Schema.string().default('当前群组暂无番剧订阅。\n\n使用「新番/订阅 <ID>」来订阅番剧。'),
    item: Schema.string().default('{index}. {title}\n   播出时间：{weekday} {time}\n   番剧ID：{id}'),
    header: Schema.string().default('📺 当前群组的番剧订阅列表：\n\n{list}\n\n共 {count} 个订阅'),
    error: Schema.string().default('查看订阅时发生错误，请稍后再试。'),
  }).description('查看订阅'),
  delete: Schema.object({
    empty: Schema.string().default('当前群组暂无番剧订阅。'),
    invalidIndex: Schema.string().default('序号无效。请输入 1 到 {max} 之间的数字。'),
    success: Schema.string().default('✅ 已成功删除订阅：{title}'),
    error: Schema.string().default('删除订阅时发生错误，请稍后再试。'),
  }).description('删除订阅'),
  clear: Schema.object({
    success: Schema.string().default('✅ 已清空当前群组的所有番剧订阅。'),
    error: Schema.string().default('清空订阅时发生错误，请稍后再试。'),
  }).description('清空订阅'),
  test: Schema.object({
    empty: Schema.string().default('当前群组暂无订阅，无法测试。'),
    start: Schema.string().default('将开始推送测试消息...'),
    result: Schema.string().default('测试完成，共成功推送 {success} / {total} 条订阅。'),
  }).description('订阅推送测试'),
  link: Schema.object({
    status: Schema.string().default('正在解析bangumi链接...'),
    parseFail: Schema.string().default('解析bangumi链接失败，请检查链接是否正确。'),
    error: Schema.string().default('处理链接时发生错误，请稍后再试。'),
    screenshotLabel: Schema.string().default('📸 网页截图：'),
  }).description('链接解析'),
  detail: Schema.object({
    digestNickname: Schema.string().default('每日番剧速报'),
    digestContent: Schema.string().default('{title}\n数据来源：{source}'),
    source: Schema.string().default('bgmlist.com'),
    title: Schema.string().default('标题：{title}'),
    titleCn: Schema.string().default('中文标题：{title}'),
    airTime: Schema.string().default('播出时间：{time}'),
    airDate: Schema.string().default('开播日期：{date}'),
    rating: Schema.string().default('⭐ 评分：{rating}'),
    rank: Schema.string().default('📈 排名：{rank}'),
    platform: Schema.string().default('📺 平台：{platforms}'),
    summary: Schema.string().default('📝 简介：{summary}'),
    link: Schema.string().default('🔗 链接：{url}'),
    unknown: Schema.string().default('未知'),
    timeUnknown: Schema.string().default('时间未知'),
  }).description('番剧详情'),
  push: Schema.object({
    title: Schema.string().default('📺 番剧播出提醒'),
    testTitle: Schema.string().default('📢 番剧订阅测试'),
    message: Schema.string().default('{title}\n\n{name}\n播出时间：{weekday} {time}\n番剧链接：{url}'),
  }).description('订阅推送'),
  render: Schema.object({
    puppeteerMissing: Schema.string().default('图片渲染失败：Puppeteer 服务未启用，请使用 -t 选项查看文本格式结果。'),
    screenshotEmpty: Schema.string().default('图片渲染失败：返回空数据，请稍后再试。'),
    screenshotBufferEmpty: Schema.string().default('图片渲染失败：生成的图片为空，请稍后再试。'),
    error: Schema.string().default('图片渲染失败：{error}'),
  }).description('渲染失败提示'),
}).default({})

// 插件配置 Schema
export const Config: Schema<PluginConfig> = Schema.object({
  debug: Schema.boolean().default(false).description('启用调试模式，将在控制台输出详细日志。'),
  detailsForToday: Schema.boolean().default(false).description('「今日新番」指令是否输出详细番剧信息（包含封面图等）。'),
  subscriptionInterval: Schema.number().default(60).description('订阅推送检查的间隔时间（分钟），默认为 60 分钟。'),
  enableWebpageScreenshot: Schema.boolean().default(false).description('链接解析时是否附带网页截图，默认关闭。'),
  messages: MessagesSchema,
})

/**
 * 插件主函数
 */
export function apply(ctx: Context, config: PluginConfig) {
  // 扩展数据库表
  ctx.model.extend('bangumi_sub', {
    id: 'unsigned',
    bangumiId: 'string',
    channelId: 'string',
    bangumiTitle: 'string',
    bangumiTitleCn: 'string',
    weekday: 'integer',
    airTime: 'string',
    subscribedAt: 'timestamp',
  }, {
    autoInc: true,
  })

  const bangumiService = createBangumiService(ctx, config, logger)
  const subscriptionService = createSubscriptionService(ctx, config, logger)

  registerCommands(ctx, {
    ctx,
    config,
    logger,
    bangumiService,
    subscriptionService,
  })

  setupSubscriptionScheduler(ctx, config, logger, subscriptionService)
  setupBangumiLinkMiddleware(ctx, config, logger, bangumiService)
}
