/**
 * 插件目录表（协议 v3 的相对路径解析基准）。
 *
 * 清单里写的相对路径（服务的 command／cwd、外部 MCP 的脚本、自带面板的 entry）都相对于
 * 插件自己的安装目录解析——不是项目目录。这张表就是那个基准：
 *   注册表登记的 dir 优先（安装期落下来的），宿主还可以用 overrides 覆盖（外置插件不在安装目录里）。
 * 运行时与工具面都要用同一份，免得一处解析成插件目录、另一处解析成项目目录。
 */
export function collectPluginDirs({ registry = null, overrides = null } = {}) {
  const dirs = { ...(overrides ?? {}) }
  // 注意：registry.list() 给的是**清单**不是 id——按清单对象去查目录会一个都查不到。
  for (const manifest of registry?.list?.() ?? []) {
    const id = String(manifest?.id ?? '')
    if (!id) continue
    const dir = registry?.dirOf?.(id)
    if (dir && !dirs[id]) dirs[id] = dir
  }
  return dirs
}
