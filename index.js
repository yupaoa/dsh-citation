/**
 * dsh-citation — 宿主半身。
 *
 * 这个插件不需要任何宿主能力：引用是纯前端能力（选区 → 输入框胶囊 → 提交时
 * 由 client half 注册的 reference source codec 展开成引用块文本）。这里保留一个
 * 空插件，是因为 bundle patch 要挂载它，profile 的 bundles 列表也按包名解析。
 */
export const name = 'dsh-citation'

export function apply() {}
