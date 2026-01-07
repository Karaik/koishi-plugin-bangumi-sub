import { h } from 'koishi'
import type { Context, Logger } from 'koishi'
import type { Config } from '../types'
import type { BangumiService } from '../services/bangumi'
import { formatTemplate } from '../utils/template'

export function setupBangumiLinkMiddleware(
  ctx: Context,
  config: Config,
  logger: Logger,
  bangumiService: BangumiService,
) {
  const { messages } = config
  const linkMessages = messages.link
  const detailMessages = messages.detail
  // 监听消息，检测bangumi链接
  ctx.middleware(async (session, next) => {
    const message = session.content.trim()

    // 检测是否为bangumi链接
    const bangumiUrlRegex = /https?:\/\/(?:bangumi\.tv|bgm\.tv)\/subject\/\d+/
    const match = message.match(bangumiUrlRegex)

    if (match) {
      const url = match[0]

      try {
        // 发送处理提示
        const statusMessage = await session.send(
          h('quote', { id: session.messageId }) + formatTemplate(linkMessages.status, {})
        )

        const result = await bangumiService.parseBangumiLink(url)

        if (result) {
          const { info, screenshot } = result

          // 构建番剧信息
          const detailLines: string[] = []
          if (info.title) detailLines.push(formatTemplate(detailMessages.title, { title: info.title }))
          if (info.title_cn && info.title_cn !== info.title) {
            detailLines.push(formatTemplate(detailMessages.titleCn, { title: info.title_cn }))
          }
          if (info.airDate) detailLines.push(formatTemplate(detailMessages.airDate, { date: info.airDate }))
          if (info.rating) {
            detailLines.push(formatTemplate(detailMessages.rating, { rating: info.rating.toFixed(1) }))
          }
          if (info.rank) detailLines.push(formatTemplate(detailMessages.rank, { rank: info.rank }))
          if (info.summary) {
            const shortSummary = info.summary.length > 200
              ? info.summary.substring(0, 200) + '...'
              : info.summary
            detailLines.push(formatTemplate(detailMessages.summary, { summary: shortSummary }))
          }

          // 构建回复内容
          const content: h[] = []

          // 添加封面图（如果有）
          if (info.coverUrl) {
            content.push(h.image(info.coverUrl))
          }

          // 添加文本信息
          content.push(h.text(detailLines.join('\n')))

          // 成功解析，撤回状态消息
          if (statusMessage) {
            try {
              await session.bot.deleteMessage(session.channelId, statusMessage[0])
            } catch (e) {
              if (config.debug) logger.warn('撤回状态消息失败:', e)
            }
          }

          // 先发送番剧信息
          await session.send(content)

          // 如果有截图，单独发送截图
          if (screenshot) {
            await session.send([
              h.text(formatTemplate(linkMessages.screenshotLabel, {})),
              h.image(screenshot, 'image/png')
            ])
          }

          return // 阻止消息继续传播

        } else {
          // 解析失败，撤回状态消息并提示
          if (statusMessage) {
            try {
              await session.bot.deleteMessage(session.channelId, statusMessage[0])
            } catch (e) {
              if (config.debug) logger.warn('撤回状态消息失败:', e)
            }
          }
          await session.send(formatTemplate(linkMessages.parseFail, {}))
          return
        }

      } catch (error) {
        logger.error('处理bangumi链接时发生错误:', error)
        await session.send(formatTemplate(linkMessages.error, {}))
        return
      }
    }

    // 如果不是bangumi链接，继续正常处理
    return next()
  })
}
